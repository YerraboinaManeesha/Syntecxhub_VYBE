// Centralized API client. Every request:
//  - sends the HttpOnly session cookie (credentials: 'include'; JavaScript never sees it)
//  - carries the X-Requested-With header the server requires as CSRF protection
//  - fails with a typed ApiError carrying a user-presentable message

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, code, field, fields } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.fields = fields;
  }
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function request(method, path, { body, query } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}/api${path}${buildQuery(query)}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'vybe' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', {
      status: 0,
      code: 'network',
    });
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    /* non-JSON response */
  }

  if (!response.ok || !json?.success) {
    const info = json?.error || {};
    const fallback = response.status >= 500 ? 'The server had a problem. Please try again.' : 'Request failed';
    const error = new ApiError(info.message || fallback, {
      status: response.status,
      code: info.code,
      field: info.field,
      fields: info.fields,
    });
    // An expired session anywhere outside the auth endpoints means the user must sign in again.
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('vybe:unauthorized'));
    }
    throw error;
  }
  return json.data;
}

/** Server-relative URLs (like /api/attachments/ID) need the API base when the client is hosted elsewhere. */
export const assetUrl = (path) => (path ? (path.startsWith('http') ? path : `${BASE}${path}`) : '');

/**
 * Uploads one file as multipart/form-data with progress reporting (fetch cannot report upload progress).
 * Returns { promise, abort }. The promise rejects with an ApiError.
 */
export function uploadFile(path, file, { onProgress, method = 'POST' } = {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open(method, `${BASE}/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'vybe');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () =>
      reject(new ApiError('Cannot reach the server. Check your connection and try again.', { status: 0, code: 'network' }));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => reject(new ApiError('Upload cancelled', { status: 0, code: 'aborted' }));
    xhr.onload = () => {
      const json = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && json?.success) {
        onProgress?.(100);
        resolve(json.data);
        return;
      }
      if (xhr.status === 401) window.dispatchEvent(new CustomEvent('vybe:unauthorized'));
      const info = json?.error || {};
      const fallback =
        xhr.status === 413 ? 'That file is too large.' : xhr.status >= 500 ? 'The server had a problem. Please try again.' : 'Upload failed';
      reject(new ApiError(info.message || fallback, { status: xhr.status, code: info.code }));
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export const authApi = {
  register: (body) => request('POST', '/auth/register', { body }),
  login: (body) => request('POST', '/auth/login', { body }),
  logout: () => request('POST', '/auth/logout', { body: {} }),
  me: () => request('GET', '/auth/me'),
  socketToken: () => request('GET', '/auth/socket-token'),
};

export const usersApi = {
  search: ({ q, page, limit }) => request('GET', '/users', { query: { q, page, limit } }),
  updateMe: (body) => request('PATCH', '/users/me', { body }),
  uploadAvatar: (file, onProgress) => uploadFile('/users/me/avatar', file, { onProgress }),
  removeAvatar: () => request('DELETE', '/users/me/avatar'),
  block: (id) => request('POST', `/users/${id}/block`, { body: {} }),
  unblock: (id) => request('DELETE', `/users/${id}/block`),
};

export const conversationsApi = {
  list: () => request('GET', '/conversations'),
  startPrivate: (userId) => request('POST', '/conversations', { body: { userId } }),
  messages: (id, { before, limit } = {}) => request('GET', `/conversations/${id}/messages`, { query: { before, limit } }),
  read: (id) => request('POST', `/conversations/${id}/read`, { body: {} }),
  editMessage: (id, messageId, content) => request('PATCH', `/conversations/${id}/messages/${messageId}`, { body: { content } }),
  deleteMessage: (id, messageId, scope) => request('DELETE', `/conversations/${id}/messages/${messageId}`, { query: { scope } }),
  clearChat: (id) => request('DELETE', `/conversations/${id}/messages`),
  react: (id, messageId, emoji) => request('PUT', `/conversations/${id}/messages/${messageId}/reaction`, { body: { emoji } }),
  pin: (id, messageId) => request('PUT', `/conversations/${id}/pins/${messageId}`, { body: {} }),
  unpin: (id, messageId) => request('DELETE', `/conversations/${id}/pins/${messageId}`),
  upload: (id, file, onProgress) => uploadFile(`/conversations/${id}/attachments`, file, { onProgress }),
  shared: (id, { group, before, limit } = {}) => request('GET', `/conversations/${id}/shared`, { query: { group, before, limit } }),
};

export const attachmentsApi = {
  discard: (attachmentId) => request('DELETE', `/attachments/${attachmentId}`),
};

export const groupsApi = {
  create: ({ name, memberIds }) => request('POST', '/groups', { body: { name, memberIds } }),
  addMembers: (id, userIds) => request('POST', `/groups/${id}/members`, { body: { userIds } }),
  leave: (id) => request('DELETE', `/groups/${id}/members/me`),
};

export const callsApi = {
  history: ({ before, limit, filter, conversationId } = {}) => request('GET', '/calls', { query: { before, limit, filter, conversationId } }),
  unseen: () => request('GET', '/calls/unseen'),
  markSeen: () => request('POST', '/calls/seen', { body: {} }),
  remove: (id) => request('DELETE', `/calls/${id}`),
  clearAll: () => request('DELETE', '/calls'),
};