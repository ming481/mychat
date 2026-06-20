import React, { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import '@chatui/core/dist/index.css';
import './styles/app.css';
import { useAuthStore, useChatStore } from './store';
import { useSocket } from './hooks/useSocket';
import { authAPI } from './utils/api';
import { ensureMobileStorageDirs } from './utils/chatSettings';
import { runBackHandler } from './utils/backNavigation';
import AuthPage from './pages/AuthPage';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import AppDialogHost from './components/AppDialogHost';

function AppLayout() {
  useSocket();
  const { activeChat, setActiveChat } = useChatStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let removeListener = null;
    CapacitorApp.addListener('backButton', () => {
      // 优先关闭键盘：如果输入框有焦点，先让它失焦收起键盘
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable)) {
        focused.blur();
        return;
      }
      if (runBackHandler()) return;
      const currentChat = useChatStore.getState().activeChat;
      if (currentChat) {
        setActiveChat(null);
        return;
      }
      CapacitorApp.minimizeApp().catch(() => {});
    }).then(handle => {
      removeListener = () => handle.remove();
    });
    return () => {
      if (removeListener) removeListener();
    };
  }, [setActiveChat]);

  // Listen for focus events and visualViewport resize to detect soft keyboard on mobile.
  useEffect(() => {
    const vp = window.visualViewport;
    let vpHeight = vp?.height;

    function syncKeyboardOpen() {
      if (!vp) return;
      const prev = vpHeight;
      vpHeight = vp.height;
      const diff = vpHeight - prev; // >0 means keyboard dismissed, <0 means opened
      if (diff > 100) {
        // Keyboard was dismissed (e.g. Android IME back), blur any focused input
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable)) {
          focused.blur();
        }
        document.documentElement.classList.remove('keyboard-open');
      } else if (diff < -100) {
        // Keyboard opened, ensure class is set
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable)) {
          document.documentElement.classList.add('keyboard-open');
        }
      }
    }

    function onFocusIn(e) {
      const tag = e.target && e.target.tagName && e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
        document.documentElement.classList.add('keyboard-open');
      }
    }
    function onFocusOut(e) {
      setTimeout(() => {
        const active = document.activeElement;
        const atag = active && active.tagName && active.tagName.toLowerCase();
        if (!(atag === 'input' || atag === 'textarea' || (active && active.isContentEditable))) {
          document.documentElement.classList.remove('keyboard-open');
        }
      }, 50);
    }

    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    vp?.addEventListener('resize', syncKeyboardOpen);
    return () => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
      vp?.removeEventListener('resize', syncKeyboardOpen);
    };
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
  const { token, setAuth, logout, hydrateFromNative } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapAuth() {
      ensureMobileStorageDirs().catch(err => console.error('ensure mobile storage dirs failed', err));

      let { token: activeToken, user: activeUser } = useAuthStore.getState();
      if (!activeToken) {
        const nativeAuth = await hydrateFromNative();
        activeToken = nativeAuth?.token;
        activeUser = nativeAuth?.user;
      }

      if (!activeToken) {
        if (!cancelled) setChecking(false);
        return;
      }

      if (activeUser && !cancelled) setChecking(false);

      authAPI.me()
      .then(nextUser => {
        setAuth(activeToken, nextUser);
        setChecking(false);
      })
      .catch(() => {
        logout();
        setChecking(false);
      });
    }

    bootstrapAuth();
    return () => { cancelled = true; };
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

  return (
    <>
      {token ? <AppLayout /> : <AuthPage />}
      <AppDialogHost />
    </>
  );
}
