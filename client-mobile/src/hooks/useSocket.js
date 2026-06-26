import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore, useChatStore } from '../store';
import { localMessageCache } from '../utils/localMessageCache';
import { profileCache } from '../utils/profileCache';
import { groupAPI, messageAPI } from '../utils/api';

let socketInstance = null;
export function getSocket() { return socketInstance; }

const WS_URL = process.env.REACT_APP_WS_URL || 'http://122.51.21.204:5000';

function recalledMessage(messageId, senderId, createdAt, existing, myUser, senderInfo = {}) {
  const isMe = String(senderId) === String(myUser?.id);
  return {
    ...existing,
    id: messageId,
    sender_id: senderId,
    sender_nickname: existing?.sender_nickname || senderInfo.senderNickname || (isMe ? myUser?.nickname : undefined),
    sender_avatar: existing?.sender_avatar || senderInfo.senderAvatar || (isMe ? myUser?.avatar_url : undefined),
    type: 0,
    content: null,
    file_name: null,
    file_size: null,
    file_url: null,
    reply_to: null,
    reply_preview: null,
    is_recalled: true,
    created_at: createdAt || new Date().toISOString(),
  };
}

function applyRecall({ messageId, groupId, senderId, receiverId, createdAt, senderNickname, senderAvatar }, myUserId) {
  const chatType = groupId ? 1 : 0;
  const chatId = groupId || (Number(senderId) === Number(myUserId) ? receiverId : senderId);
  if (!chatId) return;
  const key = `${chatType}_${chatId}`;
  const store = useChatStore.getState();
  const existing = (store.messages[key] || []).find(msg => String(msg.id) === String(messageId));
  const myUser = useAuthStore.getState().user;
  const recalled = recalledMessage(messageId, senderId, createdAt, existing, myUser, { senderNickname, senderAvatar });
  if (existing) {
    store.updateMessage(key, messageId, recalled);
  } else {
    store.addMessage(key, recalled);
  }
  localMessageCache.saveMessages(chatType, chatId, [recalled])
    .then(async () => {
      const latest = (await localMessageCache.getLatestMessages(chatType, chatId, 1).catch(() => []))[0];
      if (latest && String(latest.id) === String(messageId)) {
        store.upsertConversation({
          target_id: chatId,
          type: chatType,
          last_content: latest.content,
          last_msg_type: latest.type,
          last_message_id: latest.id,
          last_msg_time: latest.created_at,
          updated_at: latest.created_at,
          is_recalled: true,
        });
      }
    })
    .catch(err => console.error('apply recall local cache failed', err));
}

export function useSocket() {
  const token = useAuthStore(state => state.token);
  const userId = useAuthStore(state => state.user?.id);
  const initialized = useRef(false);

  useEffect(() => {
    if (!token || !userId || initialized.current) return;
    initialized.current = true;
    const myUserId = Number(userId);

    const socket = io(WS_URL, {
      auth: { token },
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      withCredentials: true,
    });
    socketInstance = socket;

    socket.on('connect', () => {
      console.log('Socket connected id=', socket.id);
      window.dispatchEvent(new CustomEvent('chatapp:socket-connected'));
    });
    socket.on('connect_error', (e) => console.error('Socket error:', e.message));
    socket.on('disconnect', (r) => console.warn('Socket disconnected:', r));
    socket.on('kicked', ({ reason }) => {
      console.warn('Kicked:', reason);
      useAuthStore.getState().logout();
    });

    socket.on('online:list', (list) => useChatStore.getState().setOnlineUsers(list));
    socket.on('user:status', ({ userId, status }) => {
      useChatStore.getState().setUserOnline(userId, status);
      const currentUser = useAuthStore.getState().user;
      if (String(userId) === String(currentUser?.id) && Number(currentUser.status) !== Number(status)) {
        useAuthStore.getState().updateUser({ ...currentUser, status });
      }
    });

    socket.on('message:private', (msg) => {
      const myId = myUserId;
      const senderId = Number(msg.sender_id);
      const receiverId = Number(msg.receiver_id);
      const otherId = senderId === myId ? receiverId : senderId;
      const key = `0_${otherId}`;
      localMessageCache.saveMessages(0, otherId, [msg]).catch(err => console.error('save socket private message failed', err));

      const { activeChat, conversations } = useChatStore.getState();
      const isActive = activeChat?.type === 0 && String(activeChat.id) === String(otherId);
      if (isActive) useChatStore.getState().addMessage(key, msg);

      const currentUnread = conversations.find(c => c.type === 0 && String(c.target_id) === String(otherId))?.unread_count || 0;
      const isIncomingFromOther = senderId !== myId;
      const nextUnread = isIncomingFromOther ? (isActive ? 0 : currentUnread + 1) : currentUnread;

      if (isIncomingFromOther && isActive) {
        useChatStore.getState().clearUnread(otherId, 0);
        messageAPI.markRead(otherId, 0).catch(() => {});
      }

      useChatStore.getState().upsertConversation({
        target_id: otherId,
        type: 0,
        target_name: isIncomingFromOther ? msg.sender_nickname : null,
        target_avatar: isIncomingFromOther ? msg.sender_avatar : null,
        last_content: msg.content,
        last_msg_type: msg.type,
        last_message_id: msg.id,
        last_msg_time: msg.created_at,
        updated_at: msg.created_at,
        unread_count: nextUnread,
      });
    });

    socket.on('message:group', (msg) => {
      const myId = myUserId;
      const key = `1_${msg.group_id}`;
      const groupState = useChatStore.getState();
      const isKnownGroup = groupState.groups.some(g => String(g.id) === String(msg.group_id))
        || groupState.conversations.some(c => c.type === 1 && String(c.target_id) === String(msg.group_id))
        || (groupState.activeChat?.type === 1 && String(groupState.activeChat.id) === String(msg.group_id));
      if (!isKnownGroup) return;
      localMessageCache.saveMessages(1, msg.group_id, [msg]).catch(err => console.error('save socket group message failed', err));

      const { activeChat, conversations } = useChatStore.getState();
      const isActive = activeChat?.type === 1 && String(activeChat.id) === String(msg.group_id);
      if (isActive) useChatStore.getState().addMessage(key, msg);

      const currentUnread = conversations.find(c => c.type === 1 && String(c.target_id) === String(msg.group_id))?.unread_count || 0;
      const isIncomingFromOther = Number(msg.sender_id) !== myId;
      const nextUnread = isIncomingFromOther ? (isActive ? 0 : currentUnread + 1) : currentUnread;

      if (isIncomingFromOther && isActive) {
        useChatStore.getState().clearUnread(msg.group_id, 1);
        messageAPI.markRead(msg.group_id, 1).catch(() => {});
      }

      useChatStore.getState().upsertConversation({
        target_id: msg.group_id,
        type: 1,
        last_content: msg.content,
        last_msg_type: msg.type,
        last_message_id: msg.id,
        last_msg_time: msg.created_at,
        updated_at: msg.created_at,
        unread_count: nextUnread,
      });
    });

    socket.on('message:recalled', payload => applyRecall(payload, myUserId));

    socket.on('typing:start', ({ userId }) => useChatStore.getState().setTyping(userId, true));
    socket.on('typing:stop', ({ userId }) => useChatStore.getState().setTyping(userId, false));

    socket.on('user:profile_updated', (nextUser) => {
      if (!nextUser?.id) return;
      if (String(nextUser.id) === String(useAuthStore.getState().user?.id)) {
        useAuthStore.getState().updateUser({ ...useAuthStore.getState().user, ...nextUser });
      }
      profileCache.upsertFriend(nextUser);
      const { friends, conversations } = useChatStore.getState();
      useChatStore.getState().setFriends(friends.map(f => String(f.id) === String(nextUser.id) ? { ...f, ...nextUser } : f));
      useChatStore.setState({
        conversations: conversations.map(c => (
          c.type === 0 && String(c.target_id) === String(nextUser.id)
            ? { ...c, target_name: nextUser.nickname || c.target_name, target_avatar: nextUser.avatar_url || c.target_avatar }
            : c
        )),
      });
    });

    socket.on('group:profile_updated', (group) => {
      if (!group?.id) return;
      profileCache.upsertGroup(group);
      const { groups, conversations } = useChatStore.getState();
      useChatStore.getState().setGroups(groups.map(g => String(g.id) === String(group.id) ? { ...g, ...group } : g));
      useChatStore.setState({
        conversations: conversations.map(c => (
          c.type === 1 && String(c.target_id) === String(group.id)
            ? { ...c, target_name: group.name || c.target_name, target_avatar: group.avatar_url || c.target_avatar }
            : c
        )),
      });
    });

    socket.on('friend:request', (reqInfo) => {
      useChatStore.getState().addFriendRequest(reqInfo);
    });

    socket.on('group:join-request', () => {
      groupAPI.joinRequests().then(data => {
        const map = {};
        (Array.isArray(data) ? data : []).forEach(req => {
          const gid = String(req.group_id);
          if (!map[gid]) map[gid] = [];
          map[gid].push(req);
        });
        useChatStore.getState().setGroupJoinRequests(map);
      }).catch(() => {});
    });

    socket.on('friend:accepted', async () => {
      try {
        const { friendAPI } = await import('../utils/api');
        const friends = await friendAPI.list();
        useChatStore.getState().setFriends(friends);
      } catch (e) {
        console.error(e);
      }
    });

    socket.on('friend:deleted', ({ friendId, friend }) => {
      if (friendId == null) return;
      useChatStore.getState().markFriendInactive(friendId, friend || {});
    });

    socket.on('group:created', ({ group }) => {
      const { groups, setGroups } = useChatStore.getState();
      const exists = groups.some(g => String(g.id) === String(group.id));
      setGroups(exists
        ? groups.map(g => String(g.id) === String(group.id) ? { ...g, ...group } : g)
        : [...groups, group]);
      socket.emit('group:join', { groupId: group.id });
      useChatStore.getState().upsertConversation({
        target_id: group.id,
        type: 1,
        target_name: group.name,
        target_avatar: group.avatar_url,
        group_state: 'active',
        last_content: null,
        last_msg_type: null,
        last_msg_time: group.created_at,
        updated_at: group.created_at,
        unread_count: 0,
      });
    });

    socket.on('group:left', ({ groupId, reason = 'leave', group }) => {
      const state = useChatStore.getState();
      if (reason === 'kicked' || reason === 'dissolved') {
        state.markGroupInactive(groupId, reason, group || {});
        return;
      }
      state.removeGroupCompletely(groupId);
      state.removeMessages(`1_${groupId}`);
      localMessageCache.clearConversations([{ type: 1, id: groupId }]).catch(() => {});
    });

    const handleFocus = () => {
      if (socket && !socket.connected) socket.connect();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      socket.disconnect();
      socketInstance = null;
      initialized.current = false;
    };
  }, [token, userId]);

  return socketInstance;
}
