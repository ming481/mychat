const DB_NAME = 'chatapp-message-cache';
const DB_VERSION = 1;
const MESSAGE_STORE = 'messages';
const CLEAR_MARKERS_KEY = 'chatapp.messageClearMarkers.v1';
const DRAFTS_KEY = 'chatapp.messageDrafts.v1';

function currentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.id ? String(user.id) : 'anonymous';
  } catch {
    return 'anonymous';
  }
}

function conversationKey(type, id) {
  return `user_${currentUserId()}:${Number(type) === 1 ? 'group' : 'private'}_${id}`;
}

function nativePayload(type, id, extra = {}) {
  return { userId: currentUserId(), type, id, ...extra };
}

function toTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeMessage(key, msg) {
  const messageId = msg?.id ?? msg?.temp_id ?? `${Date.now()}_${Math.random()}`;
  return {
    ...msg,
    cache_id: `${key}:${messageId}`,
    conversation_key: key,
    message_id_sort: Number(messageId) || 0,
    created_sort: toTime(msg?.created_at),
    cached_at: Date.now(),
  };
}

function stripCacheFields(msg) {
  if (!msg) return msg;
  const {
    cache_id,
    conversation_key,
    message_id_sort,
    created_sort,
    cached_at,
    ...rest
  } = msg;
  return rest;
}

function readClearMarkers() {
  try {
    return JSON.parse(localStorage.getItem(CLEAR_MARKERS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeClearMarkers(markers) {
  localStorage.setItem(CLEAR_MARKERS_KEY, JSON.stringify(markers || {}));
}

function removeClearMarker(type, id) {
  const markers = readClearMarkers();
  delete markers[markerKey(type, id)];
  writeClearMarkers(markers);
}

function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeDrafts(drafts) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts || {}));
}

function markerKey(type, id) {
  return conversationKey(type, id);
}

function messageId(msg) {
  return Number(msg?.id || msg?.message_id || 0) || 0;
}

function parseConversationKey(key) {
  const prefix = `user_${currentUserId()}:`;
  if (!String(key || '').startsWith(prefix)) return null;
  const raw = String(key).slice(prefix.length);
  const match = /^(private|group)_(.+)$/.exec(raw);
  if (!match) return null;
  return {
    type: match[1] === 'group' ? 1 : 0,
    id: match[2],
  };
}

function cachedConversationName(item) {
  const latest = item?.latest || {};
  if (Number(item?.type) === 1) {
    return latest.group_name || latest.target_name || `群聊 ${item.id}`;
  }
  const fromOther = String(latest.sender_id || '') && String(latest.sender_id) !== currentUserId();
  return (fromOther ? latest.sender_nickname : null) || latest.target_name || latest.nickname || `已删除好友 ${item.id}`;
}

function normalizeCachedConversation(item) {
  if (!item) return null;
  return {
    id: item.id,
    type: Number(item.type) === 1 ? 1 : 0,
    lastMessageId: Number(item.lastMessageId || item.last_message_id || messageId(item.latest)) || 0,
    latestTime: Number(item.latestTime || 0) || toTime(item.latest?.created_at),
    name: item.name || cachedConversationName(item),
    cachedOnly: true,
  };
}

function filterAfterClearMarker(type, id, messages) {
  const clearedAfterId = localMessageCache.getClearedAfterId(type, id);
  if (!clearedAfterId) return messages;
  return messages.filter(msg => messageId(msg) > clearedAfterId);
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
        const store = db.createObjectStore(MESSAGE_STORE, { keyPath: 'cache_id' });
        store.createIndex('conversation_time', ['conversation_key', 'created_sort', 'message_id_sort']);
        store.createIndex('conversation_key', 'conversation_key');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export const localMessageCache = {
  conversationKey,

  async getDraft(type, id) {
    if (window.chatApp?.localMessages?.getDraft) {
      return window.chatApp.localMessages.getDraft(nativePayload(type, id));
    }
    return readDrafts()[conversationKey(type, id)]?.text || '';
  },

  async saveDraft(type, id, text) {
    if (window.chatApp?.localMessages?.saveDraft) {
      await window.chatApp.localMessages.saveDraft(nativePayload(type, id, { text }));
      return;
    }
    const key = conversationKey(type, id);
    const drafts = readDrafts();
    const value = String(text || '');
    if (value) drafts[key] = { text: value, updated_at: new Date().toISOString() };
    else delete drafts[key];
    writeDrafts(drafts);
  },

  async clearDraft(type, id) {
    await this.saveDraft(type, id, '');
  },

  async saveMessages(type, id, messages) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    const nextMessages = filterAfterClearMarker(type, id, messages);
    if (!nextMessages.length) return;
    if (window.chatApp?.localMessages) {
      await window.chatApp.localMessages.save(nativePayload(type, id, { messages: nextMessages }));
      return;
    }
    const db = await openDb();
    const key = conversationKey(type, id);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE, 'readwrite');
      const store = tx.objectStore(MESSAGE_STORE);
      nextMessages.forEach(msg => store.put(normalizeMessage(key, msg)));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async replaceMessages(type, id, messages) {
    removeClearMarker(type, id);
    const nextMessages = Array.isArray(messages) ? messages : [];
    if (window.chatApp?.localMessages?.replace) {
      await window.chatApp.localMessages.replace(nativePayload(type, id, { messages: nextMessages }));
      return;
    }
    const db = await openDb();
    const key = conversationKey(type, id);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE, 'readwrite');
      const store = tx.objectStore(MESSAGE_STORE);
      const index = store.index('conversation_key');
      const request = index.openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    if (nextMessages.length) await this.saveMessages(type, id, nextMessages);
  },

  async getLatestMessages(type, id, limit = 50) {
    if (window.chatApp?.localMessages) {
      return window.chatApp.localMessages.getLatest(nativePayload(type, id, { limit }));
    }
    const db = await openDb();
    const key = conversationKey(type, id);
    const tx = db.transaction(MESSAGE_STORE, 'readonly');
    const index = tx.objectStore(MESSAGE_STORE).index('conversation_time');
    const range = IDBKeyRange.bound([key, 0, 0], [key, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
    const messages = [];

    await new Promise((resolve, reject) => {
      const request = index.openCursor(range, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || messages.length >= limit) {
          resolve();
          return;
        }
        messages.push(stripCacheFields(cursor.value));
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    return messages.reverse();
  },

  async getOlderMessages(type, id, beforeCreatedAt, limit = 50) {
    if (window.chatApp?.localMessages) {
      return window.chatApp.localMessages.getOlder(nativePayload(type, id, { beforeCreatedAt, limit }));
    }
    const db = await openDb();
    const key = conversationKey(type, id);
    const beforeTime = toTime(beforeCreatedAt) - 1;
    if (beforeTime < 0) return [];

    const tx = db.transaction(MESSAGE_STORE, 'readonly');
    const index = tx.objectStore(MESSAGE_STORE).index('conversation_time');
    const range = IDBKeyRange.bound([key, 0, 0], [key, beforeTime, Number.MAX_SAFE_INTEGER]);
    const messages = [];

    await new Promise((resolve, reject) => {
      const request = index.openCursor(range, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || messages.length >= limit) {
          resolve();
          return;
        }
        messages.push(stripCacheFields(cursor.value));
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    return messages.reverse();
  },

  async getLatestMessageId(type, id) {
    const latest = await this.getLatestMessages(type, id, 1);
    return latest[0]?.id || 0;
  },

  async deleteMessage(type, id, msgId) {
    if (window.chatApp?.localMessages?.deleteMessage) {
      await window.chatApp.localMessages.deleteMessage(nativePayload(type, id, { messageId: msgId }));
      return;
    }
    const db = await openDb();
    const key = conversationKey(type, id);
    const targetId = String(msgId);

    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE, 'readwrite');
      const index = tx.objectStore(MESSAGE_STORE).index('conversation_key');
      const request = index.openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value;
        if (String(value?.id ?? value?.message_id ?? value?.temp_id) === targetId) {
          cursor.delete();
        }
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async listConversations() {
    if (window.chatApp?.localMessages?.list) {
      const rows = await window.chatApp.localMessages.list(nativePayload(0, 0));
      return (Array.isArray(rows) ? rows : []).map(normalizeCachedConversation).filter(Boolean);
    }

    const db = await openDb();
    const prefix = `user_${currentUserId()}:`;
    const byKey = new Map();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE, 'readonly');
      const store = tx.objectStore(MESSAGE_STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value;
        const key = value?.conversation_key;
        if (String(key || '').startsWith(prefix)) {
          const current = byKey.get(key);
          const currentTime = Number(current?.created_sort || 0);
          const nextTime = Number(value?.created_sort || 0);
          const currentId = Number(current?.message_id_sort || 0);
          const nextId = Number(value?.message_id_sort || 0);
          if (!current || nextTime > currentTime || (nextTime === currentTime && nextId > currentId)) {
            byKey.set(key, value);
          }
        }
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    return Array.from(byKey.entries())
      .map(([key, latest]) => {
        const parsed = parseConversationKey(key);
        if (!parsed) return null;
        return normalizeCachedConversation({
          ...parsed,
          latest: stripCacheFields(latest),
          lastMessageId: messageId(latest),
          latestTime: Number(latest?.created_sort || 0),
        });
      })
      .filter(Boolean)
      .sort((a, b) => b.latestTime - a.latestTime);
  },

  getClearedAfterId(type, id) {
    const markers = readClearMarkers();
    return Number(markers[markerKey(type, id)] || 0) || 0;
  },

  async clearConversations(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    const markers = readClearMarkers();
    for (const item of items) {
      const latestLocalId = await this.getLatestMessageId(item.type, item.id).catch(() => 0);
      const latestKnownId = Number(item.lastMessageId || item.last_message_id || 0) || 0;
      markers[markerKey(item.type, item.id)] = Math.max(latestLocalId, latestKnownId, this.getClearedAfterId(item.type, item.id));
    }
    writeClearMarkers(markers);

    if (window.chatApp?.localMessages) {
      await window.chatApp.localMessages.clear(items.map(item => nativePayload(item.type, item.id)));
      return;
    }
    const db = await openDb();
    const keys = new Set(items.map(item => conversationKey(item.type, item.id)));

    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE, 'readwrite');
      const store = tx.objectStore(MESSAGE_STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (keys.has(cursor.value.conversation_key)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};
