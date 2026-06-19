import React, { useEffect, useState } from 'react';
import '@chatui/core/dist/index.css';
import './styles/app.css';
import { useAuthStore, useChatStore } from './store';
import { useSocket } from './hooks/useSocket';
import { authAPI } from './utils/api';
import AuthPage from './pages/AuthPage';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';

function AppLayout() {
  useSocket();
  const { activeChat } = useChatStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    if (!window.chatApp?.onDownloadCompleted) return undefined;
    return window.chatApp.onDownloadCompleted(({ savePath }) => {
      alert(`下载完成，已保存到：\n${savePath}`);
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
  const { token, user, setAuth, logout } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }

    if (user) setChecking(false);

    authAPI.me()
      .then(nextUser => {
        setAuth(token, nextUser);
        setChecking(false);
      })
      .catch(() => {
        logout();
        setChecking(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div className="app-startup">
        <div className="app-startup-logo">ChatApp</div>
        <div className="app-startup-text">正在启动...</div>
      </div>
    );
  }

  return token ? <AppLayout /> : <AuthPage />;
}
