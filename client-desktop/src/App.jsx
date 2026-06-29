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
      if (!token) {
        if (!cancelled) {
          setBootstrapping(false);
          setChecking(false);
        }
        return;
      }
      try {
        const nextUser = await authAPI.me();
        if (!cancelled) {
          setAuth(token, nextUser);
          setBootstrapping(false);
          setChecking(false);
        }
      } catch {
        if (!cancelled) {
          logout();
          setBootstrapping(false);
          setChecking(false);
        }
      }
    }

    bootstrapAuth();

    return () => { cancelled = true; setBootstrapping(false); };
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
    return null;
  }

  return (
    <>
      {token ? <AppLayout /> : <AuthPage />}
      <AppDialogHost />
    </>
  );
}
