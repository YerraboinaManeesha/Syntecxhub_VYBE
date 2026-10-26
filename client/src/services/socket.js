import { io } from 'socket.io-client';
import { authApi } from './api.js';

// Empty = same origin (local dev through the Vite proxy). In production this is the Render URL.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;

/**
 * One socket per signed-in session. The `auth` function runs on every (re)connect attempt and
 * fetches a fresh 60-second token, so a long-lived credential is never held in JavaScript.
 */
export function createSocket() {
  return io(SOCKET_URL, {
    autoConnect: false,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    auth: (callback) => {
      authApi
        .socketToken()
        .then(({ token }) => callback({ token }))
        .catch(() => callback({ token: '' }));
    },
  });
}
