import React, { useState, useEffect, useMemo } from 'react';
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

  // Android: 用 'none' 模式防止键盘挤压好友列表导致输入框丢焦；
  // 同时不自动聚焦输入框，避免页面加载时卡顿。
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      Keyboard.setResizeMode({ mode: 'none' });
    } catch (_) { /* ignore */ }
    return () => {
      Keyboard.setResizeMode({ mode: 'native' }).catch(() => {});
    };
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

  // 用 useMemo 缓存好友列表 DOM，checkbox 切换时不会重新渲染整个列表，
  // 避免列表 reflow 传递到紧邻的输入框导致键盘回收。
  // checkbox 使用 defaultChecked（非受控），保持 DOM 稳定。
  const friendRows = useMemo(() => {
    if (friends.length === 0) {
      return <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>还没有好友，先去添加吧</div>;
    }
    return friends.map(f => (
      <label key={f.id} className="friend-select-item">
        <input
          type="checkbox"
          tabIndex={-1}
          defaultChecked={selectedFriends.includes(f.id)}
          onChange={e => {
            const cb = e.target;
            cb.checked = e.target.checked;
            // 立即 blur，防止 checkbox 持焦导致后续点击输入框时键盘回收
            cb.blur();
            setSelectedFriends(p =>
              cb.checked ? [...p, f.id] : p.filter(id => id !== f.id)
            );
          }}
        />
        <Avatar src={f.avatar_url} name={f.nickname} size={28} />
        <span>{f.remark || f.nickname}</span>
      </label>
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends]);

  return (
    <div className="modal-overlay search-page-overlay create-group-page-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box search-page">
        <div className="modal-header">
          <h3>创建群聊</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="create-group" style={{ padding: '12px 20px 12px' }}>
          <div className="auth-field" style={{ marginBottom: 8 }}>
            <label>群聊名称</label>
            <input
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="给群起个名字"
              style={{ padding: '9px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%' }}
            />
          </div>
          <div className="auth-field" style={{ marginBottom: 8 }}>
            <label>输入群号</label>
            <input
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              placeholder="输入群号，用于搜索加群"
              style={{ padding: '9px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', outline: 'none', width: '100%' }}
            />
          </div>
          {/* 缓冲层：隔离输入框与好友列表的布局域，防止列表 reflow 传递到输入框 */}
          <div style={{ flexShrink: 0, height: 12 }} />
          <div className="friend-select-title">选择好友加入群聊（已选 {selectedFriends.length} 人）</div>
          <div className="friend-select-list">
            {friendRows}
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
