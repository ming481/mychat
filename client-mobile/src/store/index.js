import { create } from 'zustand';
import { profileCache } from '../utils/profileCache';
import { clearNativeAuth, loadNativeAuth, saveNativeAuth } from '../utils/nativeAuthStorage';
import { localMessageCache } from '../utils/localMessageCache';

function mergeFriendStatuses(nextFriends, realtimeStatuses) {
  return (nextFriends || []).map(friend => {
    const realtimeStatus = realtimeStatuses?.get(String(friend.id));
    if (Number(friend.status || 0) > 0) return friend;
    if (Number(realtimeStatus || 0) > 0) return { ...friend, status: realtimeStatus };
    return friend;
  });
}

function mergeConversationStatuses(nextConversations, realtimeStatuses) {
  return (nextConversations || []).map(conv => {
    if (Number(conv.type) !== 0) return conv;
    const realtimeStatus = realtimeStatuses?.get(String(conv.target_id));
    if (Number(conv.target_status || 0) > 0) return conv;
    if (Number(realtimeStatus || 0) > 0) return { ...conv, target_status: realtimeStatus };
    return conv;
  });
}

function isClearedConversation(conv) {
  const lastMessageId = Number(conv?.last_message_id || conv?.lastMessageId || 0) || 0;
  if (!lastMessageId) return false;
  return localMessageCache.getClearedAfterId(conv.type, conv.target_id) >= lastMessageId;
}

function visibleConversations(conversations) {
  return (conversations || []).filter(conv => !isClearedConversation(conv));
}

export const useAuthStore = create((set, get) => ({
  token: localStorage.getItem('token') || null,
  user: (() => { try { return JSON.parse(localStorage.getItem('user') || 'null') || profileCache.getUser(); } catch { return profileCache.getUser(); } })(),
  setAuth: (token, user) => {
    const prevUser = get().user;
    const userChanged = prevUser?.id && user?.id && String(prevUser.id) !== String(user.id);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    saveNativeAuth(token, user);
    profileCache.setUser(user);
    if (userChanged) useChatStore.getState().resetChatState();
    set({ token, user });
  },
  updateUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user));
    saveNativeAuth(get().token, user);
    profileCache.setUser(user);
    set({ user });
  },
  hydrateFromNative: async () => {
    const nativeAuth = await loadNativeAuth();
    if (!nativeAuth.token) return null;
    localStorage.setItem('token', nativeAuth.token);
    if (nativeAuth.user) {
      localStorage.setItem('user', JSON.stringify(nativeAuth.user));
      profileCache.setUser(nativeAuth.user);
    }
    set({ token: nativeAuth.token, user: nativeAuth.user || get().user });
    return nativeAuth;
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearNativeAuth();
    profileCache.clearUser();
    useChatStore.getState().resetChatState();
    set({ token: null, user: null });
  },
}));

export const useChatStore = create((set, get) => ({
  conversations: [],
  setConversations: (conversations) => set(state => ({
    conversations: mergeConversationStatuses(visibleConversations(conversations), state.onlineStatuses),
  })),
  removeConversation: (targetId, type) => set(state => ({
    conversations: state.conversations.filter(c => !(String(c.target_id) === String(targetId) && c.type === type)),
  })),
  markGroupInactive: (groupId, groupState, group = {}) => set(state => {
    const id = String(groupId);
    const groups = state.groups.filter(g => String(g.id) !== id);
    profileCache.setGroups(groups);
    const conversations = state.conversations.map(c =>
      Number(c.type) === 1 && String(c.target_id) === id
        ? {
            ...c,
            group_state: groupState,
            target_name: c.target_name || group.name,
            target_avatar: c.target_avatar || group.avatar_url,
          }
        : c
    );
    return {
      groups,
      conversations,
      activeChat: state.activeChat?.type === 1 && String(state.activeChat.id) === id
        ? { ...state.activeChat, groupState, name: state.activeChat.name || group.name, avatar: state.activeChat.avatar || group.avatar_url }
        : state.activeChat,
    };
  }),
  removeGroupCompletely: (groupId) => set(state => {
    const id = String(groupId);
    const groups = state.groups.filter(g => String(g.id) !== id);
    profileCache.setGroups(groups);
    return {
      groups,
      conversations: state.conversations.filter(c => !(Number(c.type) === 1 && String(c.target_id) === id)),
      activeChat: state.activeChat?.type === 1 && String(state.activeChat.id) === id ? null : state.activeChat,
    };
  }),
  removeFriend: (friendId) => set(state => {
    const id = String(friendId);
    const friends = state.friends.filter(f => String(f.id) !== id);
    profileCache.setFriends(friends);
    return {
      friends,
      activeChat: state.activeChat?.type === 0 && String(state.activeChat.id) === id
        ? { ...state.activeChat, groupState: 'unfriended' }
        : state.activeChat,
    };
  }),
  markFriendInactive: (friendId, friend = {}) => set(state => {
    const id = String(friendId);
    const friends = state.friends.filter(f => String(f.id) !== id);
    profileCache.setFriends(friends);
    return {
      friends,
      conversations: state.conversations.map(c =>
        Number(c.type) === 0 && String(c.target_id) === id
          ? {
              ...c,
              group_state: 'unfriended',
              target_name: c.target_name || friend.nickname || friend.username,
              target_avatar: c.target_avatar || friend.avatar_url,
            }
          : c
      ),
      activeChat: state.activeChat?.type === 0 && String(state.activeChat.id) === id
        ? { ...state.activeChat, groupState: 'unfriended', name: state.activeChat.name || friend.nickname, avatar: state.activeChat.avatar || friend.avatar_url }
        : state.activeChat,
    };
  }),
  upsertConversation: (conv) => {
    if (isClearedConversation(conv)) {
      set(state => ({
        conversations: state.conversations.filter(c => !(String(c.target_id) === String(conv.target_id) && c.type === conv.type)),
      }));
      return;
    }
    const list = get().conversations;
    const idx = list.findIndex(c => String(c.target_id) === String(conv.target_id) && c.type === conv.type);
    if (idx >= 0) {
      const updated = [...list];
      const next = { ...conv };
      if (next.is_recalled == null && (next.last_message_id || next.last_content != null || next.last_msg_type != null)) {
        next.is_recalled = false;
      }
      if (next.target_name == null || next.target_name === '') delete next.target_name;
      if (next.target_avatar == null || next.target_avatar === '') delete next.target_avatar;
      updated[idx] = { ...updated[idx], ...next };
      // Re-sort by updated_at desc
      updated.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      set({ conversations: updated });
    } else {
      const next = { ...conv };
      if (next.is_recalled == null && (next.last_message_id || next.last_content != null || next.last_msg_type != null)) {
        next.is_recalled = false;
      }
      set({ conversations: [next, ...list] });
    }
  },
  clearUnread: (targetId, type) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        String(c.target_id) === String(targetId) && c.type === type
          ? { ...c, unread_count: 0 }
          : c
      )
    }));
  },

  activeChat: null,
  setActiveChat: (chat) => set({ activeChat: chat }),

  messages: {},
  setMessages: (key, msgs) => set(state => ({ messages: { ...state.messages, [key]: msgs } })),
  removeMessages: (key) => set(state => {
    const next = { ...state.messages };
    delete next[key];
    return { messages: next };
  }),
  prependMessages: (key, msgs) => set(state => ({
    messages: { ...state.messages, [key]: [...msgs, ...(state.messages[key] || [])] }
  })),
  addMessage: (key, msg) => set(state => ({
    messages: {
      ...state.messages,
      [key]: [...(state.messages[key] || []).filter(m => String(m.id) !== String(msg.id)), msg],
    },
  })),
  removeMessage: (key, msgId) => set(state => ({
    messages: {
      ...state.messages,
      [key]: (state.messages[key] || []).filter(m => String(m.id) !== String(msgId)),
    },
  })),
  replaceMessage: (key, tempId, realMsg) => set(state => ({
    messages: {
      ...state.messages,
      [key]: (state.messages[key] || []).map(m => String(m.id) === String(tempId) ? { ...m, ...realMsg } : m),
    }
  })),
  updateMessage: (key, msgId, updates) => set(state => ({
    messages: {
      ...state.messages,
      [key]: (state.messages[key] || []).map(m => String(m.id) === String(msgId) ? { ...m, ...updates } : m),
    },
  })),

  friends: profileCache.getFriends(),
  setFriends: (friends) => set(state => {
    const merged = mergeFriendStatuses(friends, state.onlineStatuses);
    profileCache.setFriends(merged);
    return { friends: merged };
  }),

  friendRequests: [],
  setFriendRequests: (reqs) => set({ friendRequests: reqs }),
  addFriendRequest: (req) => set(state => ({ friendRequests: [req, ...state.friendRequests] })),
  removeFriendRequest: (id) => set(state => ({ friendRequests: state.friendRequests.filter(r => r.id !== id) })),

  groupJoinRequests: {},
  setGroupJoinRequests: (reqs) => set({ groupJoinRequests: reqs }),

  groups: profileCache.getGroups(),
  setGroups: (groups) => {
    profileCache.setGroups(groups);
    set({ groups });
  },

  onlineUsers: new Set(),
  onlineStatuses: new Map(),
  setOnlineUsers: (list) => set(state => {
    const statusMap = new Map((list || []).map(item => {
      if (item && typeof item === 'object') return [String(item.userId ?? item.id), Number(item.status ?? 1)];
      return [String(item), 1];
    }));
    const onlineUsers = new Set(Array.from(statusMap.entries()).filter(([, status]) => status > 0).map(([id]) => id));
    return {
      onlineUsers,
      onlineStatuses: statusMap,
      friends: state.friends.map(f => statusMap.has(String(f.id)) ? { ...f, status: statusMap.get(String(f.id)) } : f),
      conversations: state.conversations.map(c =>
        c.type === 0 && statusMap.has(String(c.target_id))
          ? { ...c, target_status: statusMap.get(String(c.target_id)) }
          : c
      ),
    };
  }),
  setUserOnline: (userId, status) => set(state => {
    const nextStatus = Number(status || 0);
    const s = new Set(state.onlineUsers);
    const statusMap = new Map(state.onlineStatuses);
    if (nextStatus > 0) s.add(String(userId)); else s.delete(String(userId));
    statusMap.set(String(userId), nextStatus);
    return {
      onlineUsers: s,
      onlineStatuses: statusMap,
      friends: state.friends.map(f => String(f.id) === String(userId) ? { ...f, status: nextStatus } : f),
      conversations: state.conversations.map(c =>
        c.type === 0 && String(c.target_id) === String(userId)
          ? { ...c, target_status: nextStatus }
          : c
      ),
    };
  }),

  typing: {},
  setTyping: (userId, val) => set(state => ({ typing: { ...state.typing, [String(userId)]: val } })),

  sidebarTab: 'chats',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  // Group detail panel
  groupDetail: null,
  setGroupDetail: (g) => set({ groupDetail: g }),

  resetChatState: () => set({
    conversations: [],
    activeChat: null,
    messages: {},
    friends: profileCache.getFriends(),
    friendRequests: [],
    groups: profileCache.getGroups(),
    groupJoinRequests: {},
    onlineUsers: new Set(),
    onlineStatuses: new Map(),
    typing: {},
    sidebarTab: 'chats',
    groupDetail: null,
  }),
}));
