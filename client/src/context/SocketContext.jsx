import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createSocket } from '../services/socket.js';
import { useAuth } from './AuthContext.jsx';

const SocketContext = createContext({ socket: null, status: 'connecting', epoch: 0 });

/**
 * Owns the single Socket.io connection for the signed-in user. It is created once per user,
 * never per render, and fully cleaned up on logout or unmount.
 *
 *  status: 'connecting' | 'connected' | 'disconnected'
 *  epoch:  increments on every successful (re)connect so other layers can resynchronise
 */
export function SocketProvider({ children }) {
  const { user, checkSession } = useAuth();
  const userId = user?.id;
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;

    const instance = createSocket();
    let retryTimer;
    let attempts = 0;
    setSocket(instance);
    setStatus('connecting');

    // socket.io retries transport failures by itself, but not a rejected handshake or a
    // server-initiated disconnect. This covers those cases with a backoff.
    const scheduleRetry = () => {
      clearTimeout(retryTimer);
      attempts += 1;
      const delay = Math.min(1000 * 2 ** attempts, 15000);
      retryTimer = setTimeout(() => {
        if (!instance.connected) instance.connect();
      }, delay);
    };

    instance.on('connect', () => {
      attempts = 0;
      setStatus('connected');
      setEpoch((value) => value + 1);
    });
    instance.on('disconnect', (reason) => {
      setStatus('disconnected');
      if (reason === 'io server disconnect') scheduleRetry();
    });
    instance.on('connect_error', (error) => {
      setStatus('disconnected');
      if (error.message === 'unauthorized') {
        // Either the session expired (checkSession signs the user out) or the token fetch failed
        // transiently. Retry only while the session is still valid.
        checkSession().then((stillSignedIn) => stillSignedIn && scheduleRetry());
      }
    });

    const onOnline = () => {
      if (!instance.connected) instance.connect();
    };
    window.addEventListener('online', onOnline);

    instance.connect();

    return () => {
      clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      instance.removeAllListeners();
      instance.disconnect();
      setSocket(null);
      setStatus('connecting');
    };
  }, [userId, checkSession]);

  const value = useMemo(() => ({ socket, status, epoch }), [socket, status, epoch]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
