import React, { useState } from 'react';
import { groupAPI, fileAPI } from '../utils/api';
import { useChatStore } from '../store';
import { fallbackAvatar, handleAvatarError } from '../utils/avatar';
import { getSocket } from '../hooks/useSocket';
import { localMessageCache } from '../utils/localMessageCache';
import { confirmDialog } from '../utils/appDialog';

const ROLE_LABEL = { 2: '群主', 1: '管理员', 0: '' };

function Avatar({ src, name, size = 36 }) {
  const fb = fallbackAvatar(name);
  return (
    <img src={src || fb} alt={name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', background: '#eef', flexShrink: 0 }}
      onError={e => handleAvatarError(e, name)}
    />
  );
}

export default function GroupDetailPanel({ group, currentUserId, onClose, onUpdated }) {
  const { friends, groups, setGroups, removeMessages, removeGroupCompletely, markGroupInactive } = useChatStore();
  const [announcement, setAnnouncement] = useState(group.announcement || '');
  const [editAnnounce, setEditAnnounce] = useState(false);
  const [msg, setMsg] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(group.name);
  const [isUploading, setIsUploading] = useState(false);
  const [copied, setCopied] = useState(false);

  const myRole = group.members?.find(m => String(m.id) === String(currentUserId))?.role ?? 0;
  const isOwner = myRole === 2;
  const isAdmin = myRole >= 1;

  async function removeGroupLocally() {
    getSocket()?.emit('group:leave', { groupId: group.id });
    removeGroupCompletely(group.id);
    removeMessages(`1_${group.id}`);
    await localMessageCache.clearConversations([{ type: 1, id: group.id }]).catch(() => {});
  }

  function markDissolvedLocally() {
    getSocket()?.emit('group:leave', { groupId: group.id });
    markGroupInactive(group.id, 'dissolved', group);
  }

  async function saveAnnouncement() {
    try {
      await groupAPI.updateAnnouncement(group.id, announcement);
      setEditAnnounce(false);
      setMsg('公告已更新');
      onUpdated && onUpdated();
    } catch { setMsg('更新失败'); }
  }

  async function kickMember(userId) {
    if (!await confirmDialog('确认踢出该成员？', { title: '移出成员', confirmText: '踢出', tone: 'danger' })) return;
    try {
      await groupAPI.kick(group.id, userId);
      setMsg('已踢出');
      onUpdated && onUpdated();
    } catch { setMsg('操作失败'); }
  }

  async function setAdmin(userId, action) {
    try {
      await groupAPI.setAdmin(group.id, userId, action);
      setMsg(action === 'set' ? '已设为管理员' : '已取消管理员');
      onUpdated && onUpdated();
    } catch { setMsg('操作失败'); }
  }

  async function leaveGroup() {
    if (!await confirmDialog('确认退出该群聊？退出后会删除本地该群聊记录。', { title: '退出群聊', confirmText: '退出', tone: 'danger' })) return;
    try {
      await groupAPI.leave(group.id);
      await removeGroupLocally();
      onClose();
    } catch (e) { setMsg(e?.error || '操作失败'); }
  }

  async function dissolveGroup() {
    if (!await confirmDialog('确认解散该群聊？此操作不可撤销！', { title: '解散群聊', confirmText: '解散', tone: 'danger' })) return;
    try {
      await groupAPI.dissolve(group.id);
      markDissolvedLocally();
      onClose();
    } catch (e) { setMsg(e?.error || '操作失败'); }
  }

  async function inviteMembers() {
    if (selectedFriends.length === 0) return;
    try {
      await groupAPI.invite(group.id, selectedFriends);
      setMsg(`已邀请 ${selectedFriends.length} 人`);
      setShowInvite(false);
      setSelectedFriends([]);
      onUpdated && onUpdated();
    } catch { setMsg('邀请失败'); }
  }

  async function saveGroupName() {
    if (!newName.trim() || newName === group.name) {
      setEditingName(false);
      return;
    }
    try {
      await groupAPI.updateInfo(group.id, { name: newName.trim() });
      setEditingName(false);
      setMsg('群名称已更新');
      onUpdated && onUpdated();
      // 同时更新侧边栏会话列表中的名称
      setGroups(groups.map(g => String(g.id) === String(group.id) ? { ...g, name: newName.trim() } : g));
    } catch { setMsg('更新失败'); }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setMsg('图片不能超过 3MB');
      e.target.value = '';
      return;
    }

    try {
      setIsUploading(true);
      setMsg('正在上传...');
      const res = await fileAPI.uploadGroupAvatar(file);
      await groupAPI.updateInfo(group.id, { avatar_url: res.file_url });
      setMsg('群头像已更新');

      setIsUploading(false);
      onUpdated && onUpdated();
      setGroups(groups.map(g => String(g.id) === String(group.id) ? { ...g, avatar_url: res.file_url } : g));
    } catch {

      setMsg('上传失败');
      setIsUploading(false);
    }
  }

  const memberIds = new Set(group.members?.map(m => String(m.id)) || []);
  const invitableFriends = friends.filter(f => !memberIds.has(String(f.id)));

  function handleCopyGroupId() {
    navigator.clipboard.writeText(group.group_id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="group-detail-panel">
      <div className="group-detail-header">
        <button className="gdp-close" onClick={onClose}>✕</button>
        <h4>群聊信息</h4>
      </div>

      <div className="gdp-body">
        <div className="gdp-group-info">
          <div style={{ position: 'relative' }}>
            <Avatar src={group.avatar_url} name={group.name} size={52} />
            {isAdmin && (
              <label className="gdp-avatar-edit-overlay" title="修改头像">
                <input type="file" hidden accept="image/*" onChange={handleAvatarChange} disabled={isUploading} />
                <span>📷</span>
              </label>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingName ? (
              <div className="gdp-name-edit-box">
                <input
                  autoFocus
                  className="gdp-name-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onBlur={saveGroupName}
                  onKeyDown={e => e.key === 'Enter' && saveGroupName()}
                />
              </div>
            ) : (
              <div className="gdp-name-row">
                <div className="gdp-group-name">{group.name}</div>
                {isAdmin && (
                  <button className="gdp-name-edit-btn" onClick={() => setEditingName(true)} title="修改名称">✎</button>
                )}
              </div>
            )}
            <div className="gdp-group-count">{group.members?.length || 0} 名成员</div>
          </div>
        </div>

        {group.group_id && (
          <div className="gdp-section" style={{ padding: '8px 16px' }}>
            <div className="gdp-section-title" style={{ marginBottom: 4 }}>群号</div>
            <div className="gdp-group-id-row">
              <span className="gdp-group-id-value">{group.group_id}</span>
              <button className={`gdp-group-id-copy-btn${copied ? ' copied' : ''}`} onClick={handleCopyGroupId}>{copied ? '已复制' : '复制'}</button>
            </div>
          </div>
        )}

        <div className="gdp-section">
          <div className="gdp-section-title">
            群公告
            {isAdmin && !editAnnounce && (
              <button className="gdp-edit-btn" onClick={() => setEditAnnounce(true)}>编辑</button>
            )}
          </div>
          {editAnnounce ? (
            <>
              <textarea className="gdp-announce-input" value={announcement}
                onChange={e => setAnnouncement(e.target.value)} rows={3} placeholder="输入群公告..." />
              <div className="gdp-announce-btns">
                <button className="btn-sm btn-ghost" onClick={() => setEditAnnounce(false)}>取消</button>
                <button className="btn-sm btn-primary" onClick={saveAnnouncement}>保存</button>
              </div>
            </>
          ) : (
            <div className="gdp-announce-text">{announcement || '暂无公告'}</div>
          )}
        </div>

        <div className="gdp-section">
          <div className="gdp-section-title">
            成员列表
            {isAdmin && (
              <button className="gdp-edit-btn" onClick={() => setShowInvite(v => !v)}>+ 邀请</button>
            )}
          </div>

          {showInvite && (
            <div className="gdp-invite-box">
              <div className="gdp-invite-list">
                {invitableFriends.length === 0
                  ? <span className="gdp-empty">好友已全部在群内</span>
                  : invitableFriends.map(f => (
                    <label key={f.id} className="gdp-invite-item">
                      <input type="checkbox"
                        checked={selectedFriends.includes(f.id)}
                        onChange={e => {
                          if (e.target.checked) setSelectedFriends(p => [...p, f.id]);
                          else setSelectedFriends(p => p.filter(id => id !== f.id));
                        }}
                      />
                      <Avatar src={f.avatar_url} name={f.nickname} size={26} />
                      <span>{f.remark || f.nickname}</span>
                    </label>
                  ))
                }
              </div>
              {invitableFriends.length > 0 && (
                <button className="btn-sm btn-primary" style={{ marginTop: 8 }} onClick={inviteMembers}>
                  邀请所选 ({selectedFriends.length})
                </button>
              )}
            </div>
          )}

          <div className="gdp-member-list">
            {(group.members || []).map(m => (
              <div key={m.id} className="gdp-member-item">
                <Avatar src={m.avatar_url} name={m.nickname} size={30} />
                <div className="gdp-member-info">
                  <span className="gdp-member-name">{m.nickname}</span>
                  {ROLE_LABEL[m.role] && <span className="gdp-role-badge">{ROLE_LABEL[m.role]}</span>}
                </div>
                {isAdmin && String(m.id) !== String(currentUserId) && m.role < myRole && (
                  <div className="gdp-member-actions">
                    {isOwner && (
                      m.role === 1
                        ? <button className="gdp-action-btn" onClick={() => setAdmin(m.id, 'unset')}>取消管理</button>
                        : <button className="gdp-action-btn" onClick={() => setAdmin(m.id, 'set')}>设管理</button>
                    )}
                    <button className="gdp-action-btn danger" onClick={() => kickMember(m.id)}>移出</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {msg && <div className="gdp-msg">{msg}</div>}

        <div className="gdp-footer">
          {isOwner
            ? <button className="gdp-danger-btn" onClick={dissolveGroup}>解散群聊</button>
            : <button className="gdp-danger-btn" onClick={leaveGroup}>退出群聊</button>
          }
        </div>
      </div>
    </div>
  );
}
