import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, usersApi } from '../services/api.js';
import { useToast } from './ToastContext.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const toast = useToast();
  const [user, setUser] = useState(null);
  // loading: restoring the session | ready | error: could not reach the server
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const userRef = useRef(null);
  userRef.current = user;

  const restore = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const data = await authApi.me();
      setUser(data.user);
      setStatus('ready');
    } catch (err) {
      if (err.status === 401) {
        setUser(null);
        setStatus('ready');
      } else {
        setError(err.message);
        setStatus('error');
      }
    }
  }, []);

  // Session restoration on first load (the cookie is sent automatically).
  useEffect(() => {
    restore();
  }, [restore]);

  // Any API call that comes back 401 means the session is gone.
  useEffect(() => {
    const onUnauthorized = () => {
      if (userRef.current) {
        setUser(null);
        toast.info('Your session has ended. Please sign in again.');
      }
    };
    window.addEventListener('vybe:unauthorized', onUnauthorized);
    return () => window.removeEventListener('vybe:unauthorized', onUnauthorized);
  }, [toast]);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await authApi.register(payload);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* Even if the request fails, drop the local session. The cookie expires on its own. */
    }
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (changes) => {
    const data = await usersApi.updateMe(changes);
    setUser(data.user);
    return data.user;
  }, []);

  // Used after a profile photo change: the server returns the fresh user.
  const applyUser = useCallback((next) => setUser(next), []);

  // Used by the socket layer: returns false only when the session is definitely invalid.
  const checkSession = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user);
      return true;
    } catch (err) {
      if (err.status === 401) {
        setUser(null);
        return false;
      }
      return true;
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, error, restore, login, register, logout, updateProfile, applyUser, checkSession }),
    [user, status, error, restore, login, register, logout, updateProfile, applyUser, checkSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
