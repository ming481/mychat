const USER_KEY = 'chatapp.cache.user.v1';
const FRIENDS_KEY = 'chatapp.cache.friends.v1';
const GROUPS_KEY = 'chatapp.cache.groups.v1';

function currentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null') || read(USER_KEY, null);
    return user?.id ? String(user.id) : 'anonymous';
  } catch {
    return 'anonymous';
  }
}

function scopedKey(baseKey) {
  return `${baseKey}.user_${currentUserId()}`;
}

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const profileCache = {
  getUser: () => read(USER_KEY, null),
  setUser: user => { if (user) write(USER_KEY, user); },
  clearUser: () => localStorage.removeItem(USER_KEY),

  getFriends: () => read(scopedKey(FRIENDS_KEY), []),
  setFriends: friends => write(scopedKey(FRIENDS_KEY), Array.isArray(friends) ? friends : []),
  upsertFriend: friend => {
    if (!friend?.id) return;
    const list = profileCache.getFriends();
    const idx = list.findIndex(item => String(item.id) === String(friend.id));
    const next = idx >= 0 ? [...list] : [...list, friend];
    if (idx >= 0) next[idx] = { ...next[idx], ...friend };
    profileCache.setFriends(next);
  },

  getGroups: () => read(scopedKey(GROUPS_KEY), []),
  setGroups: groups => write(scopedKey(GROUPS_KEY), Array.isArray(groups) ? groups : []),
  upsertGroup: group => {
    if (!group?.id) return;
    const list = profileCache.getGroups();
    const idx = list.findIndex(item => String(item.id) === String(group.id));
    const next = idx >= 0 ? [...list] : [...list, group];
    if (idx >= 0) next[idx] = { ...next[idx], ...group };
    profileCache.setGroups(next);
  },
};
