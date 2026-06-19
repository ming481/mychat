import React, { useState } from 'react';
import { userAPI, friendAPI, groupAPI } from '../utils/api';
// import { useChatStore } from '../store';
import { getSocket } from '../hooks/useSocket';
import { handleAvatarError, useAvatarSrc } from '../utils/avatar';

function Avatar({ src, name, size = 40 }) {
  const displaySrc = useAvatarSrc(src, name);
  return (
    <img src={displaySrc} alt={name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      onError={e => handleAvatarError(e, name)}
    />
  );
}

export default function SearchModal({ onClose, friends, onRefresh }) {
  const [tab, setTab] = useState('search'); // search | create
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [requestedIds, setRequestedIds] = useState(new Set());
  // Group creation
  const [groupName, setGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [creating, setCreating] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setLoading(true); setMsg(''); setResults([]);
    try {
      const data = await userAPI.search(q);
      setResults(data);
      if (data.length === 0) setMsg('没有找到用户');
    } catch { setMsg('搜索失败，请稍后重试'); }
    finally { setLoading(false); }
  }

  async function addFriend(id) {
    try {
      await friendAPI.sendRequest(id);
      const socket = getSocket();
      if (socket) socket.emit('friend:request', { targetId: id });
      setRequestedIds(s => new Set([...s, id]));
      setMsg('好友申请已发送！');
      onRefresh && onRefresh();
    } catch (err) { setMsg(err?.error || '发送失败'); }
  }

  async function createGroup() {
    if (!groupName.trim()) return setMsg('请输入群名称');
    setCreating(true);
    try {
      const g = await groupAPI.create({ name: groupName, memberIds: selectedFriends });
      setMsg('群聊创建成功！');
      onRefresh && onRefresh();
      // Join the room
      const socket = getSocket();
      if (socket) socket.emit('group:join', { groupId: g.id });
      setTimeout(onClose, 800);
    } catch { setMsg('创建失败'); }
    finally { setCreating(false); }
  }

  function isFriend(id) { return friends.some(f => String(f.id) === String(id)); }
  function isRequested(id) { return requestedIds.has(id); }

  return (
    <div className="modal-overlay search-page-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box search-page">
        <div className="modal-header">
          <h3>{tab === 'create' ? '创建群聊' : '搜索用户'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs" style={{ padding: '0 20px 0' }}>
          <button className={`auth-tab${tab === 'search' ? ' active' : ''}`} onClick={() => { setTab('search'); setMsg(''); }}>搜索用户</button>
          <button className={`auth-tab${tab === 'create' ? ' active' : ''}`} onClick={() => { setTab('create'); setMsg(''); }}>创建群聊</button>
        </div>

        {tab === 'search' && (
          <>
            <div className="search-bar">
              <input
                autoFocus value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="输入用户名或昵称"
              />
              <button onClick={search} disabled={loading}>{loading ? '...' : '搜索'}</button>
            </div>
            {msg && <div className="search-msg">{msg}</div>}
            <div className="search-results">
              {results.map(u => (
                <div key={u.id} className="search-result-item">
                  <Avatar src={u.avatar_url} name={u.nickname} />
                  <div className="search-user-info">
                    <div className="search-user-name">{u.nickname}</div>
                    <div className="search-user-id">@{u.username}</div>
                  </div>
                  {isFriend(u.id)
                    ? <span className="badge-already">已是好友</span>
                    : isRequested(u.id)
                    ? <span className="badge-already">已申请</span>
                    : <button className="btn-sm btn-primary" onClick={() => addFriend(u.id)}>加好友</button>
                  }
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'create' && (
          <div className="create-group" style={{ padding: '16px 20px 20px' }}>
            <div className="auth-field" style={{ marginBottom: 16 }}>
              <label>群聊名称</label>
              <input
                autoFocus value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="给群起个名字"
                style={{ padding: '10px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%' }}
              />
            </div>
            <div className="friend-select-title">选择好友加入群聊（已选 {selectedFriends.length} 人）</div>
            <div className="friend-select-list">
              {friends.length === 0
                ? <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>还没有好友，先去添加吧</div>
                : friends.map(f => (
                  <label key={f.id} className="friend-select-item">
                    <input
                      type="checkbox"
                      checked={selectedFriends.includes(f.id)}
                      onChange={e => {
                        if (e.target.checked) setSelectedFriends(p => [...p, f.id]);
                        else setSelectedFriends(p => p.filter(id => id !== f.id));
                      }}
                    />
                    <Avatar src={f.avatar_url} name={f.nickname} size={28} />
                    <span>{f.remark || f.nickname}</span>
                  </label>
                ))
              }
            </div>
            {msg && <div className="search-msg">{msg}</div>}
            <div className="modal-actions">
              <button className="btn-ghost" style={{ padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }} onClick={onClose}>取消</button>
              <button className="btn-primary" style={{ padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'var(--accent)', color: '#fff', fontWeight: 600 }} onClick={createGroup} disabled={creating || !groupName.trim()}>
                {creating ? '创建中...' : '创建群聊'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
