import React, { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import '@chatui/core/dist/index.css';
import './styles/app.css';
import { useAuthStore, useChatStore } from './store';
import { useSocket } from './hooks/useSocket';
import { authAPI, setBootstrapping, consumePendingKickMessage } from './utils/api';
import { alertDialog } from './utils/appDialog';
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
    // 清除可能残留的 keyboard-open 类，避免跨组件挂载周期状态污染
    document.documentElement.classList.remove('keyboard-open');
    // Initialize the full-vh CSS variable to the current viewport height
    document.documentElement.style.setProperty('--full-vh', `${window.innerHeight}px`);

    const vp = window.visualViewport;
    let vpHeight = vp?.height;
    // Track viewport height when keyboard is closed, to maintain full-page height
    // even when adjustResize shrinks the viewport (fix for CreateGroupPage overlay)
    let closedVpHeight = vp?.height || window.innerHeight;

    function syncKeyboardOpen() {
      if (!vp) return;
      const prev = vpHeight;
      vpHeight = vp.height;
      const diff = vpHeight - prev; // >0 means keyboard dismissed, <0 means opened
      if (diff > 100) {
        // Keyboard was dismissed, save restored height
        closedVpHeight = vp.height;
        document.documentElement.style.setProperty('--full-vh', `${closedVpHeight}px`);
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
          document.documentElement.style.setProperty('--full-vh', `${closedVpHeight}px`);
          document.documentElement.classList.add('keyboard-open');
        }
      }
    }

    function onFocusIn(e) {
      const tag = e.target && e.target.tagName && e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
        document.documentElement.classList.add('keyboard-open');
        document.documentElement.style.setProperty('--full-vh', `${closedVpHeight}px`);
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
    setBootstrapping(true);

    async function bootstrapAuth() {
      ensureMobileStorageDirs().catch(err => console.error('ensure mobile storage dirs failed', err));

      let { token: activeToken } = useAuthStore.getState();
      if (!activeToken) {
        const nativeAuth = await hydrateFromNative();
        activeToken = nativeAuth?.token;
      }

      if (activeToken) {
        try {
          const nextUser = await authAPI.me();
          if (!cancelled) setAuth(activeToken, nextUser);
        } catch {
          if (!cancelled) logout();
        }
      }
    }

    bootstrapAuth();

    const timer = setTimeout(() => {
      if (!cancelled) {
        setBootstrapping(false);
        setChecking(false);
        if (Capacitor.isNativePlatform()) SplashScreen.hide();
      }
    }, 200);

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
