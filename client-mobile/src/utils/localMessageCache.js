import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const DB_NAME = 'chatapp-message-cache';
const DB_VERSION = 1;
const MESSAGE_STORE = 'messages';
const CLEAR_MARKERS_KEY = 'chatapp.messageClearMarkers.v1';
const RECORDS_ROOT = 'ChatApp/Records';
const DRAFTS_FILE = 'drafts.json';

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
    return latest.group_name || latest.target_name || `缇よ亰 ${item.id}`;
  }
  const fromOther = String(latest.sender_id || '') && String(latest.sender_id) !== currentUserId();
  return (fromOther ? latest.sender_nickname : null) || latest.target_name || latest.nickname || `宸插垹闄ゅソ鍙?${item.id}`;
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
const recordWriteQueues = new Map();

function shouldUseRecordFiles() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function recordUserDir() {
  return `${RECORDS_ROOT}/user_${currentUserId()}`;
}

function recordFileName(type, id) {
  return `${Number(type) === 1 ? 'group' : 'private'}_${id}.json`;
}

function recordFilePath(type, id) {
  return `${recordUserDir()}/${recordFileName(type, id)}`;
}

function draftFilePath() {
  return `${recordUserDir()}/${DRAFTS_FILE}`;
}

function sortCachedMessages(messages) {
  return [...(messages || [])].sort((a, b) => {
    const timeDiff = Number(a?.created_sort || 0) - Number(b?.created_sort || 0);
    if (timeDiff) return timeDiff;
    return Number(a?.message_id_sort || 0) - Number(b?.message_id_sort || 0);
  });
}

function mergeCachedMessages(existing, incoming) {
  const byId = new Map();
  [...(existing || []), ...(incoming || [])].forEach(msg => {
    if (!msg) return;
    byId.set(msg.cache_id || `${msg.conversation_key}:${messageId(msg) || msg.temp_id || Math.random()}`, msg);
  });
  return sortCachedMessages(Array.from(byId.values()));
}

async function ensureRecordDir() {
  await Filesystem.mkdir({
    path: recordUserDir(),
    directory: Directory.Documents,
    recursive: true,
  }).catch(() => {});
}

async function readRecordMessages(type, id) {
  try {
    const result = await Filesystem.readFile({
      path: recordFilePath(type, id),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    const data = typeof result.data === 'string' ? result.data : '[]';
    const rows = JSON.parse(data || '[]');
    return sortCachedMessages(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

async function writeRecordMessages(type, id, messages) {
  await ensureRecordDir();
  await Filesystem.writeFile({
    path: recordFilePath(type, id),
    data: JSON.stringify(sortCachedMessages(messages)),
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

async function readDraftsFile() {
  try {
    const result = await Filesystem.readFile({
      path: draftFilePath(),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    return JSON.parse(String(result.data || '{}')) || {};
  } catch {
    return {};
  }
}

async function writeDraftsFile(drafts) {
  await ensureRecordDir();
  await Filesystem.writeFile({
    path: draftFilePath(),
    data: JSON.stringify(drafts || {}, null, 2),
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

function readLocalDrafts() {
  try {
    return JSON.parse(localStorage.getItem('chatapp.messageDrafts.v1') || '{}') || {};
  } catch {
    return {};
  }
}

function writeLocalDrafts(drafts) {
  localStorage.setItem('chatapp.messageDrafts.v1', JSON.stringify(drafts || {}));
}

function withRecordLock(type, id, task) {
  const path = recordFilePath(type, id);
  const prev = recordWriteQueues.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  recordWriteQueues.set(path, next.finally(() => {
    if (recordWriteQueues.get(path) === next) recordWriteQueues.delete(path);
  }));
  return next;
}

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
    const key = conversationKey(type, id);
    if (shouldUseRecordFiles()) {
      const drafts = await readDraftsFile();
      return drafts[key]?.text || '';
    }
    return readLocalDrafts()[key]?.text || '';
  },

  async saveDraft(type, id, text) {
    const key = conversationKey(type, id);
    const value = String(text || '');
    if (shouldUseRecordFiles()) {
      const drafts = await readDraftsFile();
      if (value) drafts[key] = { text: value, updated_at: new Date().toISOString() };
      else delete drafts[key];
      await writeDraftsFile(drafts);
      return;
    }
    const drafts = readLocalDrafts();
    if (value) drafts[key] = { text: value, updated_at: new Date().toISOString() };
    else delete drafts[key];
    writeLocalDrafts(drafts);
  },

  async clearDraft(type, id) {
    await this.saveDraft(type, id, '');
  },

  async saveMessages(type, id, messages) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    const nextMessages = filterAfterClearMarker(type, id, messages);
    if (!nextMessages.length) return;
    if (shouldUseRecordFiles()) {
      const key = conversationKey(type, id);
      await withRecordLock(type, id, async () => {
        const existing = await readRecordMessages(type, id);
        const normalized = nextMessages.map(msg => normalizeMessage(key, msg));
        await writeRecordMessages(type, id, mergeCachedMessages(existing, normalized));
      });
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
    if (shouldUseRecordFiles()) {
      const key = conversationKey(type, id);
      await withRecordLock(type, id, async () => {
        await writeRecordMessages(type, id, nextMessages.map(msg => normalizeMessage(key, msg)));
      });
      return;
    }
    const db = await openDb();
    const key = conversationKey(type, id);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_STORE, 'readwrite');
      const index = tx.objectStore(MESSAGE_STORE).index('conversation_key');
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
    if (shouldUseRecordFiles()) {
      const messages = await readRecordMessages(type, id);
      return messages.slice(-limit).map(stripCacheFields);
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
    if (shouldUseRecordFiles()) {
      const beforeTime = toTime(beforeCreatedAt) - 1;
      if (beforeTime < 0) return [];
      const messages = await readRecordMessages(type, id);
      return messages
        .filter(msg => Number(msg?.created_sort || 0) <= beforeTime)
        .slice(-limit)
        .map(stripCacheFields);
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
    if (shouldUseRecordFiles()) {
      const targetId = String(msgId);
      await withRecordLock(type, id, async () => {
        const messages = await readRecordMessages(type, id);
        await writeRecordMessages(type, id, messages.filter(value => (
          String(value?.id ?? value?.message_id ?? value?.temp_id) !== targetId
        )));
      });
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
    if (shouldUseRecordFiles()) {
      let entries = [];
      try {
        const result = await Filesystem.readdir({
          path: recordUserDir(),
          directory: Directory.Documents,
        });
        entries = result.files || [];
      } catch {
        return [];
      }

      const rows = await Promise.all(entries.map(async entry => {
        const name = typeof entry === 'string' ? entry : entry?.name;
        const match = /^(private|group)_(.+)\.json$/.exec(String(name || ''));
        if (!match) return null;
        const type = match[1] === 'group' ? 1 : 0;
        const id = match[2];
        const messages = await readRecordMessages(type, id);
        const latest = messages[messages.length - 1];
        if (!latest) return null;
        return normalizeCachedConversation({
          type,
          id,
          latest: stripCacheFields(latest),
          lastMessageId: messageId(latest),
          latestTime: Number(latest?.created_sort || 0),
        });
      }));

      return rows
        .filter(Boolean)
        .sort((a, b) => b.latestTime - a.latestTime);
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

    if (shouldUseRecordFiles()) {
      await Promise.all(items.map(item => withRecordLock(item.type, item.id, async () => {
        await Filesystem.deleteFile({
          path: recordFilePath(item.type, item.id),
          directory: Directory.Documents,
        }).catch(() => {});
      })));
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
