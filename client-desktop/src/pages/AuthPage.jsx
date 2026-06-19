import React, { useState } from 'react';
import { authAPI } from '../utils/api';
import { useAuthStore } from '../store';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', nickname: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setAuth = useAuthStore(s => s.setAuth);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await authAPI.login({ username: form.username, password: form.password })
        : await authAPI.register(form);
      setAuth(res.token, res.user);
    } catch (err) {
      setError(err.error || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon" aria-hidden="true" />
          <h1 className="auth-logo-name">ChatApp</h1>
          <p className="auth-logo-sub">随时随地，畅快聊天</p>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>
            登录
          </button>
          <button className={`auth-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError(''); }}>
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="auth-field">
              <label>昵称</label>
              <input
                type="text"
                placeholder="设置昵称（可选）"
                value={form.nickname}
                onChange={e => setForm({ ...form, nickname: e.target.value })}
              />
            </div>
          )}
          <div className="auth-field">
            <label>用户名</label>
            <input
              type="text"
              placeholder="请输入用户名"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              required
              autoComplete="username"
            />
          </div>
          <div className="auth-field">
            <label>密码</label>
            <input
              type="password"
              placeholder={mode === 'register' ? '至少6位字符' : '请输入密码'}
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? '请稍候...' : mode === 'login' ? '登 录' : '注 册'}
          </button>
        </form>
      </div>
    </div>
  );
}
