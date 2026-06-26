import React, { useState, useRef, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { groupAPI } from '../utils/api';
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

export default function CreateGroupPage({ onClose, friends, onRefresh }) {
  const [groupName, setGroupName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // On native Android, switch to adjustNothing so keyboard overlays instead of compressing
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    Keyboard.setResizeMode({ mode: 'none' });
    return () => { Keyboard.setResizeMode({ mode: 'native' }); };
  }, []);

  async function createGroup() {
    if (!groupName.trim()) return setMsg('请输入群名称');
    setCreating(true);
    try {
      const g = await groupAPI.create({ name: groupName, groupId: groupId.trim() || undefined, memberIds: selectedFriends });
      setMsg('群聊创建成功！');
      onRefresh && onRefresh();
      const socket = getSocket();
      if (socket) socket.emit('group:join', { groupId: g.id });
      setTimeout(onClose, 800);
    } catch (err) { setMsg(err?.error || '创建失败'); }
    finally { setCreating(false); }
  }

  return (
    <div className="modal-overlay search-page-overlay create-group-page-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box search-page">
        <div className="modal-header">
          <h3>创建群聊</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="create-group" style={{ padding: '16px 20px 20px' }}>
          <div className="auth-field" style={{ marginBottom: 16 }}>
            <label>群聊名称</label>
            <input
              ref={inputRef}
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="给群起个名字"
              style={{ padding: '10px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%' }}
            />
          </div>
          <div className="auth-field" style={{ marginBottom: 16 }}>
            <label>输入群号</label>
            <input
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              placeholder="输入群号，用于搜索加群"
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
      </div>
    </div>
  );
}
