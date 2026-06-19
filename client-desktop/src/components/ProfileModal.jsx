import React, { useState } from 'react';
import { useAuthStore } from '../store';
import { userAPI, fileAPI, authAPI, withAssetVersion } from '../utils/api';
import { fallbackAvatar, handleAvatarError } from '../utils/avatar';
import { getSocket } from '../hooks/useSocket';
import ChatSettingsPanel from './ChatSettingsPanel';

const STATUS_OPTIONS = [
  { value: 1, label: '在线', color: '#44cc77' },
  { value: 2, label: '忙碌', color: '#f5a623' },
  { value: 3, label: '隐身', color: '#888' },
  { value: 4, label: '请勿打扰', color: '#e74c3c' },
];

export default function ProfileModal({ onClose }) {
  const { user, updateUser, logout } = useAuthStore();
  const [tab, setTab] = useState('profile');
  const [form, setForm] = useState({
    nickname: user?.nickname || '',
    signature: user?.signature || '',
    gender: user?.gender || '',
    region: user?.region || '',
  });
  const [pwForm, setPwForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function saveProfile() {
    setLoading(true);
    setMsg('');
    try {
      const updated = await userAPI.updateProfile(form);
      updateUser({ ...user, ...updated });
      setMsg('保存成功');
    } catch {
      setMsg('保存失败');
    } finally {
      setLoading(false);
    }
  }

  async function changePassword() {
    if (!pwForm.oldPassword) return setMsg('请输入原密码');
    if (pwForm.newPassword.length < 6) return setMsg('新密码至少 6 位');
    if (pwForm.newPassword !== pwForm.confirm) return setMsg('两次密码不一致');
    setLoading(true);
    setMsg('');
    try {
      await authAPI.changePassword({ oldPassword: pwForm.oldPassword, newPassword: pwForm.newPassword });
      setMsg('密码修改成功');
      setPwForm({ oldPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      setMsg(err?.error || '修改失败');
    } finally {
      setLoading(false);
    }
  }

  async function uploadAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setMsg('头像不能超过 3MB');
      e.target.value = '';
      return;
    }
    setMsg('上传中...');
    try {
      const res = await fileAPI.uploadAvatar(file);
      updateUser({ ...user, avatar_url: withAssetVersion(res.avatar_url) });
      setMsg('头像已更新');
    } catch (err) {
      setMsg(err?.error || '上传失败');
    } finally {
      e.target.value = '';
    }
  }

  async function changeStatus(status) {
    try {
      const updated = await userAPI.updateStatus(status);
      updateUser({ ...user, ...updated, status });
    } catch {}
  }

  async function handleLogout() {
    setLoading(true);
    setMsg('');
    try {
      await authAPI.logout();
      getSocket()?.disconnect();
      logout();
      onClose();
    } catch (err) {
      setMsg(err?.error || '退出登录失败');
    } finally {
      setLoading(false);
    }
  }

  const avatarName = user?.nickname || user?.username;
  const avatarFb = fallbackAvatar(avatarName);

  return (
    <div className="modal-overlay modal-overlay--profile" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-box--profile">
        <div className="modal-header">
          <h3>个人资料</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="profile-avatar-section">
          <label className="profile-avatar-label">
            <img
              src={user?.avatar_url || avatarFb}
              alt="avatar"
              className="profile-avatar"
              onError={e => handleAvatarError(e, avatarName)}
            />
            <div className="profile-avatar-overlay">更换头像</div>
            <input className="profile-avatar-input" type="file" accept="image/*" onChange={uploadAvatar} />
          </label>
          <div className="profile-username">@{user?.username}</div>
          <div className="profile-status-picker">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s.value}
                className={`status-btn${user?.status === s.value ? ' active' : ''}`}
                style={{ '--status-color': s.color }}
                onClick={() => changeStatus(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-tabs" style={{ padding: '0 20px' }}>
          <button className={`auth-tab${tab === 'profile' ? ' active' : ''}`} onClick={() => { setTab('profile'); setMsg(''); }}>基本资料</button>
          <button className={`auth-tab${tab === 'security' ? ' active' : ''}`} onClick={() => { setTab('security'); setMsg(''); }}>账号安全</button>
          <button className={`auth-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => { setTab('chat'); setMsg(''); }}>聊天设置</button>
        </div>

        {tab === 'profile' && (
          <div className="profile-form">
            {[
              { key: 'nickname', label: '昵称', placeholder: '设置昵称' },
              { key: 'signature', label: '个性签名', placeholder: '说点什么...' },
              { key: 'gender', label: '性别', placeholder: '男 / 女 / 保密' },
              { key: 'region', label: '地区', placeholder: '城市或地区' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="auth-field">
                <label>{label}</label>
                <input
                  value={form[key]}
                  placeholder={placeholder}
                  onChange={e => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            {msg && <div className="search-msg">{msg}</div>}
            <button className="auth-btn" onClick={saveProfile} disabled={loading}>
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        )}

        {tab === 'security' && (
          <div className="profile-form">
            {[
              { key: 'oldPassword', label: '当前密码' },
              { key: 'newPassword', label: '新密码' },
              { key: 'confirm', label: '确认新密码' },
            ].map(({ key, label }) => (
              <div key={key} className="auth-field">
                <label>{label}</label>
                <input
                  type="password"
                  value={pwForm[key]}
                  placeholder={label}
                  onChange={e => setPwForm({ ...pwForm, [key]: e.target.value })}
                />
              </div>
            ))}
            {msg && <div className="search-msg">{msg}</div>}
            <button className="auth-btn" onClick={changePassword} disabled={loading}>
              {loading ? '修改中...' : '修改密码'}
            </button>
            <button
              className="auth-btn"
              style={{ marginTop: 10, background: 'rgba(231,76,60,0.15)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)' }}
              onClick={handleLogout}
              disabled={loading}
            >
              退出登录
            </button>
          </div>
        )}

        {tab === 'chat' && (
          <>
            <ChatSettingsPanel onMessage={setMsg} />
            {msg && <div className="search-msg">{msg}</div>}
          </>
        )}
      </div>
    </div>
  );
}
