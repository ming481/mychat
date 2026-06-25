import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bubble } from '@chatui/core';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useAuthStore, useChatStore } from '../store';
import { fileAPI, groupAPI, messageAPI, withAssetVersion } from '../utils/api';
import { getSocket } from '../hooks/useSocket';
import { fallbackAvatar } from '../utils/avatar';
import { localMessageCache } from '../utils/localMessageCache';
import ContextMenu from './ContextMenu';
import GroupDetailPanel from './GroupDetailPanel';
import ImageViewer from './ImageViewer';
import { alertDialog } from '../utils/appDialog';

dayjs.locale('zh-cn');

const MSG_TYPE = { TEXT: 0, IMAGE: 1, FILE: 2 };
const LOCAL_MESSAGE_LIMIT = 20;
const avatarCache = new Map();
const T = {
  back: '\u8fd4\u56de',
  typing: '\u6b63\u5728\u8f93\u5165...',
  send: '\u53d1\u9001',
  upload: '\u53d1\u9001\u6587\u4ef6',
  uploadBig: '\u6587\u4ef6\u5927\u5c0f\u8d85\u8fc7 20MB\uff0c\u8bf7\u53d1\u9001\u8f83\u5c0f\u7684\u6587\u4ef6',
  uploadFail: '\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  sendFail: '\u53d1\u9001\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u8fde\u63a5\u72b6\u6001\u540e\u91cd\u8bd5',
  disconnected: '\u8fde\u63a5\u5df2\u65ad\u5f00\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  recalledByMe: '\u4f60\u64a4\u56de\u4e86\u4e00\u6761\u6d88\u606f',
  recalledByOther: () => '\u5bf9\u65b9\u5df2\u7ecf\u64a4\u56de\u8be5\u6d88\u606f',
  imageExpired: '\u56fe\u7247\u5df2\u8fc7\u671f',
  fileExpired: '\u6587\u4ef6\u5df2\u8fc7\u671f',
  downloadImage: '\u4e0b\u8f7d\u56fe\u7247',
  downloadFile: '\u4e0b\u8f7d\u6587\u4ef6',
  reply: '\u56de\u590d',
  loadMore: '\u67e5\u770b\u66f4\u591a\u6d88\u606f',
  loading: '\u52a0\u8f7d\u4e2d...',
  noMore: '\u6ca1\u6709\u66f4\u591a\u6d88\u606f\u4e86',
  placeholder: '\u53d1\u6d88\u606f...',
  welcome: '\u6b22\u8fce\u4f7f\u7528 ChatApp',
  chooseChat: '\u4ece\u5de6\u4fa7\u9009\u62e9\u597d\u53cb\u6216\u7fa4\u804a\uff0c\u5f00\u59cb\u5bf9\u8bdd\u5427',
  kicked: '\u60a8\u5df2\u88ab\u79fb\u51fa\u7fa4\u804a',
  dissolved: '\u8be5\u7fa4\u804a\u5df2\u88ab\u89e3\u6563',
  unfriended: '\u60a8\u548c\u5bf9\u65b9\u5df2\u89e3\u9664\u597d\u53cb\u5173\u7cfb',
};

const READONLY_STATES = ['kicked', 'dissolved', 'unfriended'];

function convKey(type, id) {
  return `${type}_${id}`;
}

function fmtBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function formatChatTime(value) {
  const time = dayjs(value);
  const now = dayjs();
  if (!time.isValid()) return '';
  if (time.isSame(now, 'day')) return time.format('HH:mm');
  if (!time.isSame(now, 'year')) return time.format('YYYY年M月D日 HH:mm');
  if (now.diff(time, 'day') < 7) return time.format('dddd HH:mm');
  return time.format('M月D日 HH:mm');
}

function directDownload(url, name) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name || url.split('/').pop() || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function waitForSocket(socket, timeout = 2500) {
  return new Promise(resolve => {
    if (socket?.connected) return resolve(socket);
    if (!socket) return resolve(null);
    const timer = setTimeout(() => {
      socket.off('connect', handleConnect);
      resolve(socket.connected ? socket : null);
    }, timeout);
    const handleConnect = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    socket.once('connect', handleConnect);
    socket.connect();
  });
}

function latestNumericMessageId(messages) {
  return (messages || []).reduce((max, msg) => {
    const id = Number(msg?.id || 0);
    return Number.isFinite(id) ? Math.max(max, id) : max;
  }, 0);
}

export default function ChatWindow() {
  const { user } = useAuthStore();
  const {
    activeChat, setActiveChat,
    messages: allMessages,
    setMessages, prependMessages, addMessage, replaceMessage,
    upsertConversation,
    typing,
  } = useChatStore();

  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [uploadPct, setUploadPct] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [groupInfo, setGroupInfo] = useState(null);
  const [viewerUrl, setViewerUrl] = useState(null);
  const [avatarMap, setAvatarMap] = useState({});
  const [positionedKey, setPositionedKey] = useState(null);

  const pageRef = useRef(1);
  const typingActiveRef = useRef(false);
  const activeChatRef = useRef(activeChat);
  const loadingRef = useRef(false);
  const loadedKeyRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatAreaRef = useRef(null);
  const scrollElementRef = useRef(null);
  const pendingBottomScrollRef = useRef(false);
  const historyLoadReadyAtRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const userNearBottomRef = useRef(true);
  const preservingScrollRef = useRef(null);
  const lastMessageIdRef = useRef(null);
  const messageItemCacheRef = useRef(new Map());

  const getScrollElement = useCallback(() => {
    const root = chatAreaRef.current;
    if (!root) return null;
    const cached = scrollElementRef.current;
    if (cached && root.contains(cached)) return cached;

    const candidates = Array.from(root.querySelectorAll('.desktop-message-scroll, .InfiniteScroll, .PullToRefresh, .MessageContainer, .PullLoad, .ChatApp'));
    const scrollable = candidates.find(el => {
      const style = window.getComputedStyle(el);
      return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4;
    });
    const el = scrollable
      || candidates.find(item => item.classList.contains('desktop-message-scroll'))
      || candidates.find(item => item.classList.contains('InfiniteScroll'))
      || candidates.find(item => item.classList.contains('PullToRefresh'))
      || candidates.find(item => item.classList.contains('PullLoad'))
      || candidates.find(item => item.classList.contains('MessageContainer'))
      || candidates[0]
      || root;
    scrollElementRef.current = el;
    return el;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = getScrollElement();
    if (el) el.scrollTop = el.scrollHeight;
    userNearBottomRef.current = true;
  }, [getScrollElement]);

  const settleBottomAfterMediaLoad = useCallback(() => {
    if (!pendingBottomScrollRef.current && !userNearBottomRef.current) return;
    requestAnimationFrame(() => {
      scrollToBottom(false);
      const el = getScrollElement();
      if (el) lastScrollTopRef.current = el.scrollTop;
    });
  }, [getScrollElement, scrollToBottom]);

  const handleImageLoad = useCallback((event) => {
    const img = event.currentTarget;
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    const frame = img.closest('.msg-image-wrap');
    if (frame) {
      frame.classList.remove('aspect-wide', 'aspect-square', 'aspect-tall');
      frame.classList.add(ratio >= 1.45 ? 'aspect-wide' : ratio <= 0.72 ? 'aspect-tall' : 'aspect-square');
    }
    settleBottomAfterMediaLoad();
  }, [settleBottomAfterMediaLoad]);

  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  useEffect(() => {
    const chat = activeChat;
    return () => {
      const socket = getSocket();
      if (typingActiveRef.current && socket?.connected && chat?.type === 0) {
        socket.emit('typing:stop', { targetId: chat.id, isGroup: false });
      }
      typingActiveRef.current = false;
    };
  }, [activeChat]);

  useEffect(() => {
    if (activeChat) return;
    loadedKeyRef.current = null;
    lastMessageIdRef.current = null;
    scrollElementRef.current = null;
    preservingScrollRef.current = null;
    pendingBottomScrollRef.current = false;
    historyLoadReadyAtRef.current = 0;
    lastScrollTopRef.current = 0;
    setPositionedKey(null);
  }, [activeChat]);

  useEffect(() => {
    if (!activeChat) return;
    const key = convKey(activeChat.type, activeChat.id);
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    lastMessageIdRef.current = null;
    scrollElementRef.current = null;
    preservingScrollRef.current = null;
    historyLoadReadyAtRef.current = 0;
    lastScrollTopRef.current = 0;
    pageRef.current = 1;
    setHasMore(true);
    setShowDetail(false);
    setReplyTo(null);
    setCtxMenu(null);
    pendingBottomScrollRef.current = true;
    const current = useChatStore.getState().messages[key] || [];
    if (current.length) {
      const serverLastId = Number(activeChat.lastMessageId || 0) || 0;
      if (serverLastId && latestNumericMessageId(current) < serverLastId && !READONLY_STATES.includes(activeChat.groupState)) {
        loadMessages(activeChat, 1, true);
      } else if (current.length > LOCAL_MESSAGE_LIMIT) {
        setMessages(key, current.slice(-LOCAL_MESSAGE_LIMIT));
      }
    } else {
      loadMessages(activeChat, 1, true);
    }
    if (activeChat.type === 1 && !READONLY_STATES.includes(activeChat.groupState)) {
      groupAPI.get(activeChat.id).then(setGroupInfo).catch(() => {});
    }
    messageAPI.markRead(activeChat.id, activeChat.type).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.id, activeChat?.type]);

  async function loadMessages(chat, page, reset) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!reset) setLoading(true);
    const key = convKey(chat.type, chat.id);
    try {
      if (reset) {
        let cached = await localMessageCache.getLatestMessages(chat.type, chat.id, LOCAL_MESSAGE_LIMIT).catch(() => []);
        const serverLastId = Number(chat.lastMessageId || 0) || 0;
        const latestLocalId = latestNumericMessageId(cached);
        const needsRecallRefresh = Boolean(chat.lastIsRecalled) && latestLocalId === serverLastId;
        const syncAfterId = needsRecallRefresh
          ? Math.max(0, serverLastId - 1)
          : Math.max(latestLocalId, Number(localMessageCache.getClearedAfterId(chat.type, chat.id) || 0));
        if (serverLastId && (latestLocalId < serverLastId || needsRecallRefresh) && !READONLY_STATES.includes(chat.groupState)) {
          const data = chat.type === 0
            ? await messageAPI.syncPrivate(chat.id, syncAfterId)
            : await messageAPI.syncGroup(chat.id, syncAfterId);
          await localMessageCache.saveMessages(chat.type, chat.id, data).catch(() => {});
          cached = await localMessageCache.getLatestMessages(chat.type, chat.id, LOCAL_MESSAGE_LIMIT).catch(() => cached);
        }
        if (cached.length) {
          pendingBottomScrollRef.current = true;
          setMessages(key, cached);
          return;
        }
        if (READONLY_STATES.includes(chat.groupState)) {
          pendingBottomScrollRef.current = true;
          setMessages(key, []);
          setHasMore(false);
          return;
        }
        const clearedAfterId = localMessageCache.getClearedAfterId(chat.type, chat.id);
        if (clearedAfterId) {
          const data = chat.type === 0
            ? await messageAPI.syncPrivate(chat.id, clearedAfterId)
            : await messageAPI.syncGroup(chat.id, clearedAfterId);
          await localMessageCache.saveMessages(chat.type, chat.id, data).catch(() => {});
          const merged = await localMessageCache.getLatestMessages(chat.type, chat.id, LOCAL_MESSAGE_LIMIT).catch(() => []);
          pendingBottomScrollRef.current = true;
          setMessages(key, merged);
          setHasMore(false);
          return;
        }
        pendingBottomScrollRef.current = true;
        setMessages(key, []);
        setHasMore(false);
        return;
      }

      const currentMessages = useChatStore.getState().messages[key] || [];
      const older = currentMessages[0]
        ? await localMessageCache.getOlderMessages(chat.type, chat.id, currentMessages[0].created_at, LOCAL_MESSAGE_LIMIT).catch(() => [])
        : [];
      if (older.length) {
        pageRef.current = Math.max(1, pageRef.current - 1);
        const el = getScrollElement();
        preservingScrollRef.current = el ? {
          top: el.scrollTop,
          height: el.scrollHeight,
        } : null;
        prependMessages(key, older);
        return;
      }
      if (localMessageCache.getClearedAfterId(chat.type, chat.id)) {
        setHasMore(false);
        return;
      }
      setHasMore(false);
    } catch (err) {
      console.error('load messages failed', err);
    } finally {
      loadingRef.current = false;
      if (!reset) setLoading(false);
    }
  }

  const loadMore = useCallback(async () => {
    const chat = activeChatRef.current;
    if (!chat || loadingRef.current) return;
    const next = pageRef.current + 1;
    pageRef.current = next;
    await loadMessages(chat, next, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const closeMenu = () => setCtxMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    const currentKey = activeChat ? convKey(activeChat.type, activeChat.id) : null;
    const handleScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const movingUp = el.scrollTop < lastScrollTopRef.current - 2;
      lastScrollTopRef.current = el.scrollTop;
      userNearBottomRef.current = distance < 96;
      if (
        currentKey
        && Date.now() >= historyLoadReadyAtRef.current
        && movingUp
        && positionedKey === currentKey
        && !pendingBottomScrollRef.current
        && el.scrollTop <= 72
        && hasMore
        && !loadingRef.current
        && !preservingScrollRef.current
      ) {
        loadMore();
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    lastScrollTopRef.current = el.scrollTop;
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [activeChat, positionedKey, getScrollElement, hasMore, loadMore]);

  const rawMessages = useMemo(() => (
    activeChat ? (allMessages[convKey(activeChat.type, activeChat.id)] || []) : []
  ), [activeChat, allMessages]);
  const groupState = activeChat?.groupState || 'active';
  const isReadOnlyChat = READONLY_STATES.includes(groupState);
  const groupStateText = groupState === 'kicked' ? T.kicked : groupState === 'dissolved' ? T.dissolved : groupState === 'unfriended' ? T.unfriended : '';

  useEffect(() => {
    const urls = Array.from(new Set(rawMessages
      .map(msg => msg.sender_avatar)
      .filter(Boolean)
      .map(url => withAssetVersion(url, 'chat-avatar'))
      .filter(url => typeof url === 'string' && url.includes('/uploads/'))));

    urls.forEach(url => {
      if (avatarMap[url]) return;
      const cached = avatarCache.get(url);
      if (cached) {
        setAvatarMap(prev => ({ ...prev, [url]: cached }));
        return;
      }
      fetch(url, { cache: 'reload' })
        .then(res => {
          if (!res.ok) throw new Error(`avatar ${res.status}`);
          return res.blob();
        })
        .then(blob => {
          const objectUrl = URL.createObjectURL(blob);
          avatarCache.set(url, objectUrl);
          setAvatarMap(prev => ({ ...prev, [url]: objectUrl }));
        })
        .catch(() => {});
    });
  }, [rawMessages, avatarMap]);

  function getMessageAvatar(msg) {
    if (!msg.sender_avatar) return fallbackAvatar(msg.sender_nickname);
    const url = withAssetVersion(msg.sender_avatar, 'chat-avatar');
    return avatarMap[url] || url || fallbackAvatar(msg.sender_nickname);
  }

  function buildContent(msg) {
    if (msg.is_recalled) {
      return { text: String(msg.sender_id) === String(user.id) ? T.recalledByMe : T.recalledByOther(msg.sender_nickname) };
    }
    if (msg.type === MSG_TYPE.IMAGE) return { picUrl: withAssetVersion(msg.file_url || msg.content, msg.updated_at || msg.id) };
    if (msg.type === MSG_TYPE.FILE) return { name: msg.file_name, size: fmtBytes(msg.file_size), url: withAssetVersion(msg.file_url || msg.content, msg.updated_at || msg.id) };
    return { text: msg.content || '' };
  }

  const chatMessages = useMemo(() => {
    let lastTimeMarker = 0;
    const cache = messageItemCacheRef.current;
    const seen = new Set();
    const getCachedItem = (id, signature, build) => {
      seen.add(id);
      const cached = cache.get(id);
      if (cached?.signature === signature) return cached.item;
      const item = build();
      cache.set(id, { signature, item });
      return item;
    };
    const items = rawMessages.flatMap(msg => {
      const isMe = String(msg.sender_id) === String(user.id);
      const createdAt = new Date(msg.created_at).getTime();
      const hasTime = Number.isFinite(createdAt) && (!lastTimeMarker || createdAt - lastTimeMarker > 5 * 60 * 1000);
      if (hasTime) lastTimeMarker = createdAt;
      const result = [];
      if (hasTime) {
        const text = formatChatTime(createdAt);
        result.push(getCachedItem(`time_${msg.id}`, `system|${text}`, () => ({
          _id: `time_${msg.id}`,
          type: 'system',
          content: { text },
        })));
      }
      if (msg.system_notice) {
        const text = msg.content || '';
        result.push(getCachedItem(`notice_${msg.id}`, `notice|${text}`, () => ({
          _id: `notice_${msg.id}`,
          type: 'system',
          content: { text },
          _raw: msg,
        })));
        return result;
      }
      let type = 'text';
      if (!msg.is_recalled) {
        if (msg.type === MSG_TYPE.IMAGE) type = 'image';
        else if (msg.type === MSG_TYPE.FILE) type = 'file';
      }
      const avatar = getMessageAvatar(msg);
      const content = buildContent(msg);
      const signature = JSON.stringify({
        id: msg.id,
        type,
        position: isMe ? 'right' : 'left',
        avatar,
        name: msg.sender_nickname,
        createdAt,
        content,
        recalled: msg.is_recalled,
        status: msg.status,
        reply_to: msg.reply_to,
        reply_preview: msg.reply_preview,
      });
      result.push(getCachedItem(`msg_${msg.id}`, signature, () => ({
        _id: msg.id,
        type,
        content,
        position: isMe ? 'right' : 'left',
        user: { avatar, name: msg.sender_nickname },
        createdAt,
        hasTime: false,
        _raw: msg,
      })));
      return result;
    });
    Array.from(cache.keys()).forEach(key => {
      if (!seen.has(key)) cache.delete(key);
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawMessages, avatarMap, user.id]);

  useLayoutEffect(() => {
    if (!activeChat) return;
    const key = convKey(activeChat.type, activeChat.id);
    const lastId = rawMessages[rawMessages.length - 1]?.id || null;
    if (lastId && lastMessageIdRef.current && lastId !== lastMessageIdRef.current && userNearBottomRef.current) {
      pendingBottomScrollRef.current = true;
    }
    lastMessageIdRef.current = lastId;
    if (preservingScrollRef.current) {
      const snapshot = preservingScrollRef.current;
      preservingScrollRef.current = null;
      const el = getScrollElement();
      if (el) {
        const addedHeight = el.scrollHeight - snapshot.height;
        el.scrollTop = Math.max(0, snapshot.top + addedHeight);
        lastScrollTopRef.current = el.scrollTop;
        userNearBottomRef.current = false;
        historyLoadReadyAtRef.current = Date.now() + 500;
      }
      return;
    }
    if (!chatMessages.length) {
      setPositionedKey(key);
      return;
    }
    if (!pendingBottomScrollRef.current && positionedKey === key) return;
    scrollToBottom(false);
    pendingBottomScrollRef.current = false;
    historyLoadReadyAtRef.current = Date.now() + 700;
    const el = getScrollElement();
    if (el) lastScrollTopRef.current = el.scrollTop;
    const reveal = () => {
      scrollToBottom(false);
      const nextEl = getScrollElement();
      if (nextEl) lastScrollTopRef.current = nextEl.scrollTop;
      setPositionedKey(key);
    };
    let secondRaf = null;
    const raf = requestAnimationFrame(() => {
      scrollToBottom(false);
      const midEl = getScrollElement();
      if (midEl) lastScrollTopRef.current = midEl.scrollTop;
      secondRaf = requestAnimationFrame(reveal);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (secondRaf) cancelAnimationFrame(secondRaf);
    };
  }, [activeChat, chatMessages.length, positionedKey, rawMessages, scrollToBottom, getScrollElement]);

  const handleSend = useCallback(async (type, val) => {
    if (type !== 'text' || !val?.trim()) return;
    const chat = activeChatRef.current;
    let socket = getSocket();
    if (!chat) return;
    if (READONLY_STATES.includes(chat.groupState)) return;
    if (!socket?.connected) {
      socket = await waitForSocket(socket);
      if (!socket?.connected) {
        alertDialog(T.disconnected, { title: '提示' });
        return;
      }
    }
    const key = convKey(chat.type, chat.id);
    const tempId = `temp_${Date.now()}`;
    const replySnap = replyTo;
    const sentAt = new Date().toISOString();
    const optimisticMsg = {
      id: tempId,
      sender_id: user.id,
      sender_nickname: user.nickname,
      sender_avatar: user.avatar_url,
      type: MSG_TYPE.TEXT,
      content: val,
      reply_to: replySnap?.id || null,
      reply_preview: replySnap ? { content: replySnap.content, sender: replySnap.sender_nickname } : null,
      created_at: sentAt,
      status: 0,
      is_recalled: false,
    };
    addMessage(key, optimisticMsg);
    pendingBottomScrollRef.current = true;
    upsertConversation({
      target_id: chat.id, type: chat.type,
      target_name: chat.name, target_avatar: chat.avatar,
      last_content: val, last_msg_type: MSG_TYPE.TEXT,
      last_msg_time: sentAt, updated_at: sentAt,
      unread_count: 0,
    });
    setReplyTo(null);
    if (typingActiveRef.current && socket?.connected && chat.type === 0) {
      socket.emit('typing:stop', { targetId: chat.id, isGroup: false });
      typingActiveRef.current = false;
    }
    socket.emit(
      chat.type === 0 ? 'message:private' : 'message:group',
      { ...(chat.type === 0 ? { receiverId: Number(chat.id) } : { groupId: Number(chat.id) }), type: 0, content: val, replyTo: replySnap?.id || null },
      res => {
        if (res?.success) {
          replaceMessage(key, tempId, res.message);
          localMessageCache.saveMessages(chat.type, chat.id, [res.message]).catch(err => console.error('save sent message failed', err));
          upsertConversation({
            target_id: chat.id, type: chat.type,
            target_name: chat.name, target_avatar: chat.avatar,
            last_content: res.message.content, last_msg_type: res.message.type,
            last_message_id: res.message.id,
            last_msg_time: res.message.created_at, updated_at: res.message.created_at,
            unread_count: 0,
          });
        } else {
          replaceMessage(key, tempId, { ...optimisticMsg, status: -1, content: `${val}\n(${T.sendFail})` });
          alertDialog(T.sendFail, { title: '发送失败' });
        }
      }
    );
  }, [addMessage, replaceMessage, replyTo, upsertConversation, user]);

  const sendFile = useCallback(async (file) => {
    const chat = activeChatRef.current;
    const socket = getSocket();
    if (!chat || !file || !socket?.connected) return;
    if (READONLY_STATES.includes(chat.groupState)) return;
    if (file.size > 20 * 1024 * 1024) {
      alertDialog(T.uploadBig, { title: '文件过大' });
      return;
    }
    const key = convKey(chat.type, chat.id);
    try {
      setUploadPct(0);
      const res = await fileAPI.upload(file, e => {
        if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100));
      });
      setUploadPct(null);
      const isImg = file.type.startsWith('image/');
      socket.emit(
        chat.type === 0 ? 'message:private' : 'message:group',
        {
          ...(chat.type === 0 ? { receiverId: Number(chat.id) } : { groupId: Number(chat.id) }),
          type: isImg ? MSG_TYPE.IMAGE : MSG_TYPE.FILE,
          content: res.file_url,
          fileName: res.file_name,
          fileSize: res.file_size,
          fileUrl: res.file_url,
        },
        ack => {
          if (ack?.success) {
            addMessage(key, ack.message);
            localMessageCache.saveMessages(chat.type, chat.id, [ack.message]).catch(err => console.error('save sent file message failed', err));
            pendingBottomScrollRef.current = true;
            upsertConversation({
              target_id: chat.id, type: chat.type,
              target_name: chat.name, target_avatar: chat.avatar,
              last_content: ack.message.content, last_msg_type: ack.message.type,
              last_message_id: ack.message.id,
              last_msg_time: ack.message.created_at, updated_at: ack.message.created_at,
              unread_count: 0,
            });
          }
        }
      );
    } catch (err) {
      console.error('upload failed', err);
      setUploadPct(null);
      alertDialog(T.uploadFail, { title: '上传失败' });
    }
  }, [addMessage, upsertConversation]);

  const handleFileSelect = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) sendFile(file);
    event.target.value = '';
  }, [sendFile]);

  const handleInputChange = useCallback((value, isFocused) => {
    const chat = activeChatRef.current;
    const socket = getSocket();
    if (READONLY_STATES.includes(chat?.groupState)) return;
    if (!socket?.connected || !chat || chat.type !== 0) return;
    const hasText = Boolean(String(value || '').trim()) && Boolean(isFocused);
    if (hasText && !typingActiveRef.current) {
      typingActiveRef.current = true;
      socket.emit('typing:start', { targetId: chat.id, isGroup: false });
    } else if (!hasText && typingActiveRef.current) {
      typingActiveRef.current = false;
      socket.emit('typing:stop', { targetId: chat.id, isGroup: false });
    }
  }, []);

  const handleContextMenu = useCallback((event, msg) => {
    event.preventDefault();
    setCtxMenu({ x: event.clientX, y: event.clientY, msg: msg._raw });
  }, []);

  const handleRecall = useCallback((msg) => {
    getSocket()?.emit('message:recall', { messageId: msg.id });
    setCtxMenu(null);
  }, []);

  const handleReply = useCallback((msg) => {
    setReplyTo(msg);
    setCtxMenu(null);
  }, []);

  function renderMessageContent(msg) {
    const raw = msg._raw;
    if (raw?.is_recalled) return <div className="msg-recalled">{msg.content.text}</div>;
    const isExpired = raw?.is_expired
      || (msg.type === 'file' && !msg.content?.url)
      || (msg.type === 'image' && !msg.content?.picUrl);
    const replyBlock = raw?.reply_to && raw?.reply_preview ? (
      <div className="msg-reply-preview">
        <span className="msg-reply-name">{raw.reply_preview.sender}</span>
        <span className="msg-reply-text">{raw.reply_preview.content}</span>
      </div>
    ) : null;

    if (msg.type === 'image') return (
      <div onContextMenu={event => handleContextMenu(event, msg)}>
        {replyBlock}
        {isExpired ? <div className="msg-expired">{T.imageExpired}</div> : (
          <div className="msg-image-wrap aspect-square" onClick={() => setViewerUrl(msg.content.picUrl)}>
            <img src={msg.content.picUrl} alt="" className="msg-image" loading="lazy" onLoad={handleImageLoad} onError={event => { event.currentTarget.style.display = 'none'; }} />
            <button className="msg-download-btn" type="button" onClick={(event) => { event.stopPropagation(); directDownload(msg.content.picUrl, msg.content.picUrl.split('/').pop() || 'image'); }} title={T.downloadImage}>↓</button>
          </div>
        )}
      </div>
    );

    if (msg.type === 'file') return (
      <div onContextMenu={event => handleContextMenu(event, msg)}>
        {replyBlock}
        {isExpired ? <div className="msg-expired">{T.fileExpired}</div> : (
          <a className="msg-file" href={msg.content.url} download={msg.content.name} target="_blank" rel="noreferrer">
            <span className="msg-file-icon">FILE</span>
            <div className="msg-file-info">
              <div className="msg-file-name">{msg.content.name}</div>
              <div className="msg-file-size">{msg.content.size}</div>
            </div>
            <button className="msg-file-download" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); directDownload(msg.content.url, msg.content.name); }} title={T.downloadFile}>↓</button>
          </a>
        )}
      </div>
    );

    return (
      <div onContextMenu={event => handleContextMenu(event, msg)}>
        {replyBlock}
        <Bubble content={msg.content.text} />
      </div>
    );
  }

  const isTyping = activeChat?.type === 0 && typing[String(activeChat?.id)];

  const CustomComposer = useMemo(() => function DesktopComposer({ onSend, placeholder, chatType, chatId }) {
    const [text, setText] = useState('');
    const textareaRef = useRef(null);
    const textRef = useRef('');
    const focusedRef = useRef(false);
    const typingTextStateRef = useRef(false);

    useEffect(() => {
      let cancelled = false;
      const draftChat = { type: chatType, id: chatId };
      const loadDraft = () => {
        localMessageCache.getDraft(draftChat.type, draftChat.id)
          .then(draft => {
            if (cancelled || !draft) return;
            textRef.current = draft;
            setText(draft);
            localMessageCache.clearDraft(draftChat.type, draftChat.id).catch(() => {});
            requestAnimationFrame(() => {
              if (!textareaRef.current) return;
              textareaRef.current.style.height = 'auto';
              textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
            });
          })
          .catch(() => {});
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(loadDraft);
      });
      return () => {
        cancelled = true;
        localMessageCache.saveDraft(draftChat.type, draftChat.id, textRef.current).catch(() => {});
        if (typingActiveRef.current) {
          const socket = getSocket();
          if (socket?.connected && draftChat.type === 0) {
            socket.emit('typing:stop', { targetId: draftChat.id, isGroup: false });
          }
          typingActiveRef.current = false;
        }
      };
    }, [chatType, chatId]);

    const updateTyping = useCallback((value, isFocused, force = false) => {
      const hasText = Boolean(String(value || '').trim());
      if (!force && typingTextStateRef.current === hasText) return;
      typingTextStateRef.current = hasText;
      handleInputChange(value, isFocused);
    }, []);

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, [text]);

    const handleChange = (event) => {
      const value = event.target.value;
      textRef.current = value;
      setText(value);
      updateTyping(value, focusedRef.current);
    };
    const sendText = () => {
      if (!text.trim()) return;
      if (isReadOnlyChat) return;
      onSend('text', text);
      textRef.current = '';
      setText('');
      localMessageCache.clearDraft(chatType, chatId).catch(() => {});
      updateTyping('', false, true);
      requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendText();
      }
    };

    return (
      <div className="custom-composer">
        <div className="custom-composer-input-wrap">
          <textarea
            ref={textareaRef}
            className="custom-composer-input"
            placeholder={isReadOnlyChat ? groupStateText : placeholder}
            value={text}
            onChange={handleChange}
            onFocus={() => {
              focusedRef.current = true;
              updateTyping(text, true, true);
            }}
            onBlur={() => {
              focusedRef.current = false;
              updateTyping('', false, true);
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isReadOnlyChat}
          />
        </div>
        <button className={`custom-composer-send ${text.trim() ? 'active' : ''}`} type="button" onMouseDown={event => event.preventDefault()} onClick={sendText} disabled={isReadOnlyChat || !text.trim()}>{T.send}</button>
        <button className="custom-composer-upload" type="button" onMouseDown={event => event.preventDefault()} onClick={() => fileInputRef.current?.click()} title={T.upload} disabled={isReadOnlyChat}>+</button>
      </div>
    );
  }, [handleInputChange, groupStateText, isReadOnlyChat]);

  if (!activeChat) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-inner">
          <div className="chat-empty-icon" aria-hidden="true" />
          <h3>{T.welcome}</h3>
          <p>{T.chooseChat}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      <div className="chat-navbar">
        <button className="chat-back-btn" type="button" onClick={() => { setPositionedKey(null); setActiveChat(null); }}>{T.back}</button>
        <div className="chat-navbar-title">
          {activeChat.name}
          {isReadOnlyChat && <span className="chat-typing-hint"> {groupStateText}</span>}
          {!isReadOnlyChat && isTyping && <span className="chat-typing-hint"> {T.typing}</span>}
        </div>
        {activeChat.type === 1 && !isReadOnlyChat && (
          <button className="chat-detail-btn" type="button" onClick={() => setShowDetail(value => !value)} title="\u7fa4\u804a\u4fe1\u606f">...</button>
        )}
      </div>

      {uploadPct !== null && (
        <div className="upload-progress-bar">
          <div className="upload-progress-inner" style={{ width: `${uploadPct}%` }} />
          <span className="upload-progress-text">{uploadPct}%</span>
        </div>
      )}

      {replyTo && (
        <div className="reply-bar">
          <div className="reply-bar-content">
            <span className="reply-bar-label">{T.reply} {replyTo.sender_nickname}: </span>
            <span className="reply-bar-text">{replyTo.content}</span>
          </div>
          <button className="reply-bar-close" type="button" onClick={() => setReplyTo(null)}>x</button>
        </div>
      )}

      <div
        ref={chatAreaRef}
        className={`chat-messages-area${positionedKey === convKey(activeChat.type, activeChat.id) ? ' is-positioned' : ' is-positioning'}`}
      >
        <div className="desktop-chat-surface" key={convKey(activeChat.type, activeChat.id)}>
          <div className="desktop-message-scroll">
            <div className="desktop-message-list">
              {chatMessages.map(msg => {
                if (msg.type === 'system') {
                  return (
                    <div className="desktop-system-message" key={msg._id}>
                      <span>{msg.content.text}</span>
                    </div>
                  );
                }
                const isRight = msg.position === 'right';
                return (
                  <div className={`desktop-message-row ${isRight ? 'right' : 'left'}`} key={msg._id}>
                    {!isRight && <img className="desktop-message-avatar" src={msg.user.avatar} alt="" />}
                    <div className="desktop-message-main">
                      {!isRight && <div className="desktop-message-name">{msg.user.name}</div>}
                      <div className="desktop-message-bubble">
                        {renderMessageContent(msg)}
                      </div>
                    </div>
                    {isRight && <img className="desktop-message-avatar" src={msg.user.avatar} alt="" />}
                  </div>
                );
              })}
            </div>
          </div>
          <CustomComposer
            key={convKey(activeChat.type, activeChat.id)}
            chatType={activeChat.type}
            chatId={activeChat.id}
            onSend={handleSend}
            placeholder={T.placeholder}
          />
        </div>
        {loading && positionedKey === convKey(activeChat.type, activeChat.id) && (
          <div className="chat-history-loading" aria-label={T.loading}>
            <span />
          </div>
        )}
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelect} accept="*/*" />
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          msg={ctxMenu.msg}
          currentUserId={user.id}
          onRecall={handleRecall}
          onReply={handleReply}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {showDetail && activeChat.type === 1 && !isReadOnlyChat && groupInfo && (
        <GroupDetailPanel
          group={groupInfo}
          currentUserId={user.id}
          onClose={() => setShowDetail(false)}
          onUpdated={() => groupAPI.get(activeChat.id).then(setGroupInfo).catch(() => {})}
        />
      )}

      <ImageViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </div>
  );
}
