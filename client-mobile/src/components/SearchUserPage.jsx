import React, { useState } from 'react';
import { userAPI, friendAPI, groupAPI } from '../utils/api';
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

export default function SearchUserPage({ onClose, friends, onRefresh }) {
  const [tab, setTab] = useState('user');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [requestedIds, setRequestedIds] = useState(new Set());
  const [appliedGroupIds, setAppliedGroupIds] = useState(new Set());

  async function searchUsers() {
    if (!q.trim()) return;
    setLoading(true); setMsg(''); setResults([]);
    try {
      const data = await userAPI.search(q);
      setResults(data);
      if (data.length === 0) setMsg('没有找到用户');
    } catch { setMsg('搜索失败，请稍后重试'); }
    finally { setLoading(false); }
  }

  async function searchGroups() {
    if (!q.trim()) return;
    setLoading(true); setMsg(''); setResults([]);
    try {
      const data = await groupAPI.search(q);
      setResults(data);
      if (data.length === 0) setMsg('没有找到群聊');
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

  async function applyJoinGroup(groupId) {
    try {
      await groupAPI.joinRequest(groupId);
      setAppliedGroupIds(s => new Set([...s, groupId]));
      setMsg('申请已发送！');
    } catch (err) { setMsg(err?.error || '申请失败'); }
  }

  function isFriend(id) { return friends.some(f => String(f.id) === String(id)); }
  function isRequested(id) { return requestedIds.has(id); }
  function isApplied(groupId) { return appliedGroupIds.has(groupId); }

  const placeholder = tab === 'user' ? '输入用户名或昵称' : '输入群号搜索群聊';

  return (
    <div className="modal-overlay search-page-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box search-page">
        <div className="modal-header">
          <h3>{tab === 'user' ? '搜索用户' : '搜索群聊'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs" style={{ padding: '0 20px 0' }}>
          <button className={`auth-tab${tab === 'user' ? ' active' : ''}`} onClick={() => { setTab('user'); setMsg(''); setResults([]); setQ(''); }}>搜索用户</button>
          <button className={`auth-tab${tab === 'group' ? ' active' : ''}`} onClick={() => { setTab('group'); setMsg(''); setResults([]); setQ(''); }}>搜索群聊</button>
        </div>

        <div className="search-bar">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (tab === 'user' ? searchUsers() : searchGroups())}
            placeholder={placeholder}
          />
          <button onClick={() => tab === 'user' ? searchUsers() : searchGroups()} disabled={loading}>{loading ? '...' : '搜索'}</button>
        </div>
        {msg && <div className="search-msg">{msg}</div>}
        <div className="search-results">
          {tab === 'user'
            ? results.map(u => (
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
            ))
            : results.map(g => (
              <div key={g.id} className="search-result-item">
                <Avatar src={g.avatar_url} name={g.name} />
                <div className="search-user-info">
                  <div className="search-user-name">{g.name}</div>
                  <div className="search-user-id">群号: {g.group_id} · {g.member_count} 名成员</div>
                </div>
                {g.is_member
                  ? <span className="badge-already">已是成员</span>
                  : isApplied(g.id)
                  ? <span className="badge-already">已申请</span>
                  : <button className="btn-sm btn-primary" onClick={() => applyJoinGroup(g.id)}>申请加入</button>
                }
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
