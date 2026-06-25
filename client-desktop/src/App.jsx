import React, { useEffect, useState } from 'react';
import '@chatui/core/dist/index.css';
import './styles/app.css';
import { useAuthStore, useChatStore } from './store';
import { useSocket } from './hooks/useSocket';
import { authAPI, setBootstrapping, consumePendingKickMessage } from './utils/api';
import AuthPage from './pages/AuthPage';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import AppDialogHost from './components/AppDialogHost';
import { alertDialog } from './utils/appDialog';

function AppLayout() {
  useSocket();
  const { activeChat } = useChatStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    if (!window.chatApp?.onDownloadCompleted) return undefined;
    return window.chatApp.onDownloadCompleted(({ savePath }) => {
      alertDialog(`下载完成，已保存到：\n${savePath}`, { title: '下载完成' });
    });
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="app-layout">
      <div className={`app-sidebar${isMobile && activeChat ? ' hidden-mobile' : ''}`}>
        <Sidebar />
      </div>
      <div className={`app-main${isMobile && !activeChat ? ' hidden-mobile' : ''}`}>
        <ChatWindow />
      </div>
    </div>
  );
}

export default function App() {
  const { token, setAuth, logout } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBootstrapping(true);

    async function bootstrapAuth() {
      if (!token) return;
      try {
        const nextUser = await authAPI.me();
        if (!cancelled) setAuth(token, nextUser);
      } catch {
        if (!cancelled) logout();
      }
    }

    bootstrapAuth();

    const timer = setTimeout(() => {
      if (!cancelled) {
        setBootstrapping(false);
        setChecking(false);
      }
    }, 500);

    return () => { cancelled = true; clearTimeout(timer); setBootstrapping(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!checking) {
      const msg = consumePendingKickMessage();
      if (msg) {
        alertDialog(msg, { title: '登录失效', tone: 'danger' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking]);

  if (checking) {
    return (
      <div className="app-startup">
        <div className="app-startup-logo">ChatApp</div>
        <div className="app-startup-text">正在启动...</div>
      </div>
    );
  }

  return (
    <>
      {token ? <AppLayout /> : <AuthPage />}
      <AppDialogHost />
    </>
  );
}
