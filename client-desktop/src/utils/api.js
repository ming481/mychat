import axios from 'axios';

// 默认使用固定后端地址（可被 REACT_APP_API_URL 覆盖）
// 替换为指定的服务器地址和端口
const defaultHost = 'http://122.51.21.204:5000';
const API_BASE = process.env.REACT_APP_API_URL || `${defaultHost}/api`;
const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return defaultHost;
  }
})();

export function resolveAssetURL(value) {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('/uploads/')) return value;
  return `${API_ORIGIN}${value}`;
}

export function withAssetVersion(value, version = Date.now()) {
  const url = resolveAssetURL(value);
  if (typeof url !== 'string') return url;
  if (!url.includes('/uploads/')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${version}`;
}

function normalizeUploadURLs(value) {
  if (Array.isArray(value)) return value.map(normalizeUploadURLs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeUploadURLs(item)])
    );
  }
  return resolveAssetURL(value);
}

const api = axios.create({ baseURL: API_BASE, withCredentials: true });
let isHandlingAuthError = false;

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => normalizeUploadURLs(res.data),
  (err) => {
    if (err.response?.status === 401) {
      if (!isHandlingAuthError) {
        isHandlingAuthError = true;
        const data = err.response.data;
        if (data?.kick) {
          alert(data.error || '登录状态已失效，请重新登录');
        }
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.reload();
      }
    }
    return Promise.reject(err.response?.data || err);
  }

);

export default api;

export const authAPI = {
  register:       (data) => api.post('/auth/register', data),
  login:          (data) => api.post('/auth/login', data),
  me:             ()     => api.get('/auth/me'),
  logout:         ()     => api.post('/auth/logout'),
  changePassword: (data) => api.post('/auth/change-password', data),
};


export const userAPI = {
  search:        (q)    => api.get(`/users/search?q=${encodeURIComponent(q)}`),
  get:           (id)   => api.get(`/users/${id}`),
  updateProfile: (data) => api.put('/users/profile', data),
  updateStatus:  (s)    => api.put('/users/status', { status: s }),
};

export const friendAPI = {
  list:          ()           => api.get('/friends'),
  sendRequest:   (friendId)   => api.post('/friends/request', { friendId }),
  requests:      ()           => api.get('/friends/requests'),
  handleRequest: (id, action) => api.put(`/friends/request/${id}`, { action }),
  delete:        (friendId)   => api.delete(`/friends/${friendId}`),
  setRemark:     (fid, remark)=> api.put(`/friends/${fid}/remark`, { remark }),
};

export const messageAPI = {
  getPrivate:    (friendId, page, markRead = 1) => api.get(`/messages/private/${friendId}?page=${page || 1}&markRead=${markRead}`),
  getGroup:      (groupId, page, markRead = 1)  => api.get(`/messages/group/${groupId}?page=${page || 1}&markRead=${markRead}`),
  syncPrivate:   (friendId, afterId, markRead = 1) => api.get(`/messages/private/${friendId}/sync?afterId=${afterId || 0}&markRead=${markRead}`),
  syncGroup:     (groupId, afterId, markRead = 1)  => api.get(`/messages/group/${groupId}/sync?afterId=${afterId || 0}&markRead=${markRead}`),
  unreadPrivate: (friendId, markRead = 1) => api.get(`/messages/private/${friendId}/unread?markRead=${markRead}`),
  unreadGroup:   (groupId, markRead = 1)  => api.get(`/messages/group/${groupId}/unread?markRead=${markRead}`),
  recall:        (id)             => api.put(`/messages/${id}/recall`),
  delete:        (id)             => api.delete(`/messages/${id}`),
  conversations: ()               => api.get('/messages/conversations'),
  markRead:      (targetId, type) => api.put(`/messages/conversations/${targetId}/read?type=${type}`),
  historySync:   (password)       => api.post('/messages/history-sync', { password }),
};

export const groupAPI = {
  list:               ()              => api.get('/groups'),
  create:             (data)          => api.post('/groups', data),
  get:                (id)            => api.get(`/groups/${id}`),
  invite:             (id, userIds)   => api.post(`/groups/${id}/invite`, { userIds }),
  kick:               (id, userId)    => api.delete(`/groups/${id}/members/${userId}`),
  leave:              (id)            => api.post(`/groups/${id}/leave`),
  dissolve:           (id)            => api.delete(`/groups/${id}`),
  setAdmin:           (id, uid, act)  => api.put(`/groups/${id}/admin/${uid}`, { action: act }),
  updateAnnouncement: (id, text)      => api.put(`/groups/${id}/announcement`, { announcement: text }),
  updateInfo:         (id, data)      => api.put(`/groups/${id}/info`, data),
};


export const fileAPI = {
  upload: (file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/files/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
    });
  },
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('avatar', file);
    return api.post('/files/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadGroupAvatar: (file) => {
    const form = new FormData();
    form.append('avatar', file);
    return api.post('/files/group-avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
