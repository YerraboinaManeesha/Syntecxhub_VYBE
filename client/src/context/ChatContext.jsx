import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { conversationsApi, groupsApi } from '../services/api.js';
import { newId } from '../utils/format.js';
import { useAuth } from './AuthContext.jsx';
import { useSocket } from './SocketContext.jsx';
import { useToast } from './ToastContext.jsx';

const ChatContext = createContext(null);

const SEND_TIMEOUT_MS = 10_000;
const TYPING_RESEND_MS = 2000;
const TYPING_IDLE_MS = 2500;
const TYPING_EXPIRE_MS = 5000;

// ---------- pure helpers ----------

const byActivity = (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt);

function sortMessages(list) {
  const server = list.filter((m) => !m.status);
  const local = list.filter((m) => m.status);
  server.sort((a, b) => {
    const diff = new Date(a.createdAt) - new Date(b.createdAt);
    return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
  });
  local.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return [...server, ...local];
}

/**
 * Union of messages by id. A local (pending/failed) message disappears as soon as the server copy
 * with the same clientMsgId shows up, whichever of the ack or the broadcast arrives first.
 */
function mergeMessages(existing, incoming) {
  const byId = new Map();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);

  const confirmed = new Set();
  for (const message of byId.values()) if (!message.status) confirmed.add(message.clientMsgId);

  const merged = [...byId.values()].filter((m) => !(m.status && confirmed.has(m.clientMsgId)));
  return sortMessages(merged);
}

/**
 * Reply quotes are snapshots inside other messages. When the quoted message is edited or deleted,
 * every quote of it in the open thread follows, so a deleted message's text never lingers on screen.
 */
function refreshQuotes(items, message) {
  if (message.status || !message.id) return items;
  return items.map((m) => {
    if (m.replyTo?.id !== message.id) return m;
    if (message.deleted) return { ...m, replyTo: { ...m.replyTo, deleted: true, content: '', attachmentKind: null } };
    const content = message.content.length > 140 ? `${message.content.slice(0, 140)}…` : message.content;
    if (content === m.replyTo.content) return m;
    return { ...m, replyTo: { ...m.replyTo, content } };
  });
}

// ---------- reducer ----------

const initialState = {
  conversations: [],
  convStatus: 'loading', // loading | ready | error
  convError: '',
  threads: {}, // id -> { items, hasMore, status: loading|ready|error, loadingOlder, error }
  typing: {}, // conversationId -> { userId: name }
  presence: {}, // userId -> boolean (latest known)
};

function participantsPresence(conversations) {
  const map = {};
  for (const conversation of conversations) {
    for (const participant of conversation.participants) map[participant.id] = participant.online;
  }
  return map;
}

function reducer(state, action) {
  switch (action.type) {
    case 'CONVS_LOADING':
      return { ...state, convStatus: state.conversations.length ? state.convStatus : 'loading', convError: '' };
    case 'CONVS_LOADED':
      return {
        ...state,
        conversations: [...action.conversations].sort(byActivity),
        convStatus: 'ready',
        convError: '',
        // A fresh snapshot is newer than any presence events we may have missed while offline.
        presence: { ...state.presence, ...participantsPresence(action.conversations) },
      };
    case 'CONVS_ERROR':
      return { ...state, convStatus: state.conversations.length ? state.convStatus : 'error', convError: action.error };
    case 'CONV_UPSERT': {
      const rest = state.conversations.filter((c) => c.id !== action.conversation.id);
      return {
        ...state,
        conversations: [action.conversation, ...rest].sort(byActivity),
        presence: { ...state.presence, ...participantsPresence([action.conversation]) },
      };
    }
    case 'CONV_REMOVE': {
      const threads = { ...state.threads };
      delete threads[action.id];
      const typing = { ...state.typing };
      delete typing[action.id];
      return { ...state, conversations: state.conversations.filter((c) => c.id !== action.id), threads, typing };
    }
    case 'CONV_SET_UNREAD':
      return {
        ...state,
        conversations: state.conversations.map((c) => (c.id === action.id ? { ...c, unreadCount: action.count } : c)),
      };

    case 'THREAD_LOADING':
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.id]: { items: [], hasMore: false, loadingOlder: false, error: '', ...state.threads[action.id], status: 'loading' },
        },
      };
    case 'THREAD_LOADED': {
      const previous = state.threads[action.id];
      const previousServerCount = previous ? previous.items.filter((m) => !m.status).length : 0;
      // If older pages were already loaded, keep their hasMore; otherwise trust the server.
      const hasMore = previousServerCount > action.messages.length ? previous.hasMore : action.hasMore;
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.id]: {
            items: mergeMessages(previous?.items || [], action.messages),
            hasMore,
            status: 'ready',
            loadingOlder: false,
            error: '',
          },
        },
      };
    }
    case 'THREAD_ERROR':
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.id]: { items: [], hasMore: false, loadingOlder: false, ...state.threads[action.id], status: 'error', error: action.error },
        },
      };
    case 'THREAD_OLDER_LOADING':
      return {
        ...state,
        threads: { ...state.threads, [action.id]: { ...state.threads[action.id], loadingOlder: true } },
      };
    case 'THREAD_OLDER_LOADED': {
      const thread = state.threads[action.id];
      if (!thread) return state;
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.id]: { ...thread, items: mergeMessages(thread.items, action.messages), hasMore: action.hasMore, loadingOlder: false },
        },
      };
    }
    case 'THREAD_OLDER_FAILED': {
      const thread = state.threads[action.id];
      if (!thread) return state;
      return { ...state, threads: { ...state.threads, [action.id]: { ...thread, loadingOlder: false } } };
    }

    case 'MSG_ADD': {
      const thread = state.threads[action.message.conversationId];
      if (!thread) return state; // history not opened yet; it will be fetched fresh when opened
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.message.conversationId]: {
            ...thread,
            items: refreshQuotes(mergeMessages(thread.items, [action.message]), action.message),
          },
        },
      };
    }
    case 'MSG_LOCAL_SET': {
      const thread = state.threads[action.message.conversationId];
      if (!thread) return state;
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.message.conversationId]: { ...thread, items: mergeMessages(thread.items, [action.message]) },
        },
      };
    }
    case 'MSG_LOCAL_REMOVE': {
      const thread = state.threads[action.conversationId];
      if (!thread) return state;
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.conversationId]: { ...thread, items: thread.items.filter((m) => m.id !== `local:${action.clientMsgId}`) },
        },
      };
    }

    case 'THREAD_CLEAR': {
      // "Clear chat": the thread is empty for me; the conversation itself stays.
      const thread = state.threads[action.conversationId];
      if (!thread) return state;
      return {
        ...state,
        threads: { ...state.threads, [action.conversationId]: { ...thread, items: [], hasMore: false, loadingOlder: false, error: '', status: 'ready' } },
      };
    }

    case 'MSG_REMOVE': {
      const thread = state.threads[action.conversationId];
      if (!thread) return state;
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.conversationId]: { ...thread, items: thread.items.filter((m) => m.id !== action.messageId) },
        },
      };
    }

    case 'TYPING': {
      const current = { ...(state.typing[action.conversationId] || {}) };
      if (action.isTyping) current[action.userId] = action.name;
      else delete current[action.userId];
      return { ...state, typing: { ...state.typing, [action.conversationId]: current } };
    }
    case 'TYPING_CLEAR_ALL':
      return { ...state, typing: {} };

    case 'RECEIPT': {
      const { conversationId, userId, deliveredAt, readAt } = action;
      return {
        ...state,
        conversations: state.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          const old = c.receipts?.[userId] || {};
          const later = (a, b) => (a && b ? (Date.parse(a) >= Date.parse(b) ? a : b) : a || b || null);
          return {
            ...c,
            receipts: { ...c.receipts, [userId]: { deliveredAt: later(old.deliveredAt, deliveredAt), readAt: later(old.readAt, readAt) } },
          };
        }),
      };
    }

    case 'PRESENCE':
      return { ...state, presence: { ...state.presence, [action.userId]: action.online } };

    default:
      return state;
  }
}

// ---------- provider ----------

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const { socket, status: socketStatus, epoch } = useSocket();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [activeId, setActiveId] = useState(null);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  const stateRef = useRef(state);
  stateRef.current = state;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const typingTimers = useRef(new Map());
  const outgoingTyping = useRef({ conversationId: null, lastSent: 0, idleTimer: null });
  const lastEpoch = useRef(0);

  const meId = user.id;

  // ----- conversations -----
  const loadConversations = useCallback(async () => {
    dispatch({ type: 'CONVS_LOADING' });
    try {
      const data = await conversationsApi.list();
      dispatch({ type: 'CONVS_LOADED', conversations: data.conversations });
    } catch (error) {
      dispatch({ type: 'CONVS_ERROR', error: error.message });
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ----- history -----
  const loadThread = useCallback(async (id) => {
    dispatch({ type: 'THREAD_LOADING', id });
    try {
      const data = await conversationsApi.messages(id, { limit: 30 });
      dispatch({ type: 'THREAD_LOADED', id, messages: data.messages, hasMore: data.hasMore });
    } catch (error) {
      dispatch({ type: 'THREAD_ERROR', id, error: error.message });
    }
  }, []);

  const loadOlder = useCallback(async (id) => {
    const thread = stateRef.current.threads[id];
    if (!thread || thread.loadingOlder || !thread.hasMore) return;
    const oldest = thread.items.find((m) => !m.status);
    if (!oldest) return;
    dispatch({ type: 'THREAD_OLDER_LOADING', id });
    try {
      const data = await conversationsApi.messages(id, { before: oldest.id, limit: 30 });
      dispatch({ type: 'THREAD_OLDER_LOADED', id, messages: data.messages, hasMore: data.hasMore });
    } catch (error) {
      dispatch({ type: 'THREAD_OLDER_FAILED', id });
      toast.error(error.message);
    }
  }, [toast]);

  // Opening a conversation fetches its latest messages.
  useEffect(() => {
    if (!activeId) return;
    const thread = stateRef.current.threads[activeId];
    if (!thread || thread.status === 'error') loadThread(activeId);
  }, [activeId, loadThread]);

  // ----- reconnect reconciliation -----
  // After the socket comes back, anything could have happened while it was away: refetch the
  // conversation list and the latest page of every open thread, then merge (no duplicates).
  useEffect(() => {
    if (!epoch || epoch === lastEpoch.current) return;
    lastEpoch.current = epoch;
    // Also on the very first connect: a message sent while this page was still connecting would otherwise be missed.
    loadConversations();
    for (const [id, thread] of Object.entries(stateRef.current.threads)) {
      if (thread.status === 'ready') {
        conversationsApi
          .messages(id, { limit: 30 })
          .then((data) => dispatch({ type: 'THREAD_LOADED', id, messages: data.messages, hasMore: data.hasMore }))
          .catch(() => {});
      }
    }
  }, [epoch, loadConversations]);

  // ----- delivery confirmation -----
  // Once this session is connected and the conversations are loaded, everything stored so far has reached it.
  const lastSyncEpoch = useRef(0);
  useEffect(() => {
    if (!socket || socketStatus !== 'connected' || state.convStatus !== 'ready' || lastSyncEpoch.current === epoch) return;
    lastSyncEpoch.current = epoch;
    socket.emit('delivery:sync');
  }, [socket, socketStatus, epoch, state.convStatus]);

  // ----- room membership (needed for typing) -----
  useEffect(() => {
    if (!socket || socketStatus !== 'connected' || !activeId) return undefined;
    socket.emit('conversation:join', { conversationId: activeId }, () => {});
    return () => {
      if (socket.connected) socket.emit('conversation:leave', { conversationId: activeId }, () => {});
    };
  }, [socket, socketStatus, epoch, activeId]);

  // ----- marking read -----
  const markRead = useCallback((id) => {
    dispatch({ type: 'CONV_SET_UNREAD', id, count: 0 });
    const current = socketRef.current;
    if (current?.connected) {
      current.timeout(5000).emit('message:read', { conversationId: id }, (error, response) => {
        if (error || !response?.ok) conversationsApi.read(id).catch(() => {});
      });
    } else {
      conversationsApi.read(id).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const activeUnread = state.conversations.find((c) => c.id === activeId)?.unreadCount || 0;
  useEffect(() => {
    if (activeId && visible && activeUnread > 0) markRead(activeId);
  }, [activeId, visible, activeUnread, markRead]);

  // ----- incoming socket events -----
  useEffect(() => {
    if (!socket) return undefined;

    // The server waits for this acknowledgement before telling the sender "delivered".
    const onMessageNew = ({ message }, ack) => {
      dispatch({ type: 'MSG_ADD', message });
      if (typeof ack === 'function') ack();
    };
    const onReceipt = (receipt) => dispatch({ type: 'RECEIPT', ...receipt });
    // Edited / deleted-for-everyone / reacted: the message is replaced by its new version.
    const onMessageUpdate = ({ message }) => dispatch({ type: 'MSG_ADD', message });
    // "Delete for me", on any of my sessions.
    const onMessageRemoved = ({ conversationId, messageId }) => dispatch({ type: 'MSG_REMOVE', conversationId, messageId });
    // "Clear chat", from any of my sessions.
    const onCleared = ({ conversationId }) => {
      dispatch({ type: 'THREAD_CLEAR', conversationId });
      dispatch({ type: 'CONV_SET_UNREAD', id: conversationId, count: 0 });
    };

    const onConversationUpdate = (payload) => {
      if (payload.removed) {
        dispatch({ type: 'CONV_REMOVE', id: payload.conversationId });
        return;
      }
      dispatch({ type: 'CONV_UPSERT', conversation: payload.conversation });
    };

    const onReadUpdate = ({ conversationId, unreadCount }) =>
      dispatch({ type: 'CONV_SET_UNREAD', id: conversationId, count: unreadCount });

    const onPresence = ({ userId, online }) => dispatch({ type: 'PRESENCE', userId, online });

    const onTyping = ({ conversationId, userId, name, isTyping }) => {
      const key = `${conversationId}:${userId}`;
      clearTimeout(typingTimers.current.get(key));
      typingTimers.current.delete(key);
      dispatch({ type: 'TYPING', conversationId, userId, name, isTyping });
      if (isTyping) {
        // If the "stopped" event is ever lost, the indicator expires on its own.
        typingTimers.current.set(
          key,
          setTimeout(() => dispatch({ type: 'TYPING', conversationId, userId, name, isTyping: false }), TYPING_EXPIRE_MS)
        );
      }
    };

    const onServerError = (error) => toast.error(error?.message || 'Something went wrong');
    const onDisconnect = () => dispatch({ type: 'TYPING_CLEAR_ALL' });

    socket.on('message:new', onMessageNew);
    socket.on('receipt:update', onReceipt);
    socket.on('message:update', onMessageUpdate);
    socket.on('message:removed', onMessageRemoved);
    socket.on('conversation:cleared', onCleared);
    socket.on('conversation:update', onConversationUpdate);
    socket.on('message:read:update', onReadUpdate);
    socket.on('presence:update', onPresence);
    socket.on('typing:update', onTyping);
    socket.on('error:notification', onServerError);
    socket.on('disconnect', onDisconnect);
    const timers = typingTimers.current;
    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('receipt:update', onReceipt);
      socket.off('message:update', onMessageUpdate);
      socket.off('message:removed', onMessageRemoved);
      socket.off('conversation:cleared', onCleared);
      socket.off('conversation:update', onConversationUpdate);
      socket.off('message:read:update', onReadUpdate);
      socket.off('presence:update', onPresence);
      socket.off('typing:update', onTyping);
      socket.off('error:notification', onServerError);
      socket.off('disconnect', onDisconnect);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [socket, toast]);

  // ----- sending -----
  const sendMessage = useCallback(
    (conversationId, text, { attachment = null, clientMsgId: retryClientMsgId, replyTo = null } = {}) => {
      const content = (text || '').trim();
      if (!content && !attachment) return;
      const clientMsgId = retryClientMsgId || newId();
      const local = {
        id: `local:${clientMsgId}`,
        conversationId,
        senderId: meId,
        sender: { id: meId, name: user.name, username: user.username },
        content,
        attachment,
        replyTo,
        clientMsgId,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      dispatch({ type: 'MSG_LOCAL_SET', message: local });

      const fail = (reason) =>
        dispatch({ type: 'MSG_LOCAL_SET', message: { ...local, status: 'failed', error: reason } });

      const payload = { conversationId, content, clientMsgId };
      if (attachment) payload.attachmentId = attachment.id;
      if (replyTo) payload.replyTo = replyTo.id;

      // Waits (briefly) for a usable connection, then hands the message to `deliver`.
      const whenConnected = (socketInstance, attempt, waitMs) => {
        if (socketInstance.connected) {
          deliver(socketInstance, attempt);
          return;
        }
        let settled = false;
        const onConnect = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          deliver(socketInstance, attempt);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          socketInstance.off('connect', onConnect);
          fail('Not connected');
        }, waitMs);
        socketInstance.once('connect', onConnect);
      };

      // Sends once. If the connection drops (or nothing answers) before the server confirms, the same message
      // is sent once more after the reconnect. That is safe: the server stores one message per clientMsgId.
      const deliver = (socketInstance, attempt) => {
        let done = false;
        const retryOnce = () => {
          if (attempt < 2) whenConnected(socketInstance, attempt + 1, 8000);
          else fail('No response from the server');
        };
        const onDrop = () => {
          if (done) return;
          done = true;
          retryOnce();
        };
        socketInstance.once('disconnect', onDrop);
        socketInstance.timeout(SEND_TIMEOUT_MS).emit('message:send', payload, (error, response) => {
          if (done) return;
          done = true;
          socketInstance.off('disconnect', onDrop);
          if (error) retryOnce();
          else if (response?.ok) dispatch({ type: 'MSG_ADD', message: response.message });
          else fail(response?.error?.message || 'Could not send');
        });
      };

      const current = socketRef.current;
      if (!current) {
        fail('Not connected');
        return;
      }
      // A reconnect may be moments away (the banner can clear a beat before the socket is usable).
      whenConnected(current, 1, 3000);
    },
    [meId, user.name, user.username]
  );

  const retryMessage = useCallback(
    (conversationId, clientMsgId) => {
      const message = stateRef.current.threads[conversationId]?.items.find((m) => m.id === `local:${clientMsgId}`);
      if (message) sendMessage(conversationId, message.content, { attachment: message.attachment, clientMsgId, replyTo: message.replyTo });
    },
    [sendMessage]
  );

  const discardMessage = useCallback((conversationId, clientMsgId) => {
    dispatch({ type: 'MSG_LOCAL_REMOVE', conversationId, clientMsgId });
  }, []);

  // ----- message actions (the server enforces every rule; these just apply its answer) -----
  const editMessage = useCallback(async (conversationId, messageId, content) => {
    const data = await conversationsApi.editMessage(conversationId, messageId, content);
    dispatch({ type: 'MSG_ADD', message: data.message });
  }, []);

  const deleteMessage = useCallback(async (conversationId, messageId, scope) => {
    const data = await conversationsApi.deleteMessage(conversationId, messageId, scope);
    if (scope === 'me') dispatch({ type: 'MSG_REMOVE', conversationId, messageId });
    else dispatch({ type: 'MSG_ADD', message: data.message });
  }, []);

  const clearChat = useCallback(async (conversationId) => {
    await conversationsApi.clearChat(conversationId);
    dispatch({ type: 'THREAD_CLEAR', conversationId });
    dispatch({ type: 'CONV_SET_UNREAD', id: conversationId, count: 0 });
  }, []);

  const reactToMessage = useCallback(async (conversationId, messageId, emoji) => {
    const data = await conversationsApi.react(conversationId, messageId, emoji);
    dispatch({ type: 'MSG_ADD', message: data.message });
  }, []);

  // Pin changes arrive for everyone (including this tab) as a conversation update.
  const pinMessage = useCallback((conversationId, messageId) => conversationsApi.pin(conversationId, messageId), []);
  const unpinMessage = useCallback((conversationId, messageId) => conversationsApi.unpin(conversationId, messageId), []);

  // ----- outgoing typing (throttled; never sent per keystroke) -----
  const stopTyping = useCallback(() => {
    const state = outgoingTyping.current;
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
    if (state.conversationId && socketRef.current?.connected) {
      socketRef.current.emit('typing:stop', { conversationId: state.conversationId });
    }
    state.conversationId = null;
    state.lastSent = 0;
  }, []);

  const notifyTyping = useCallback(
    (conversationId) => {
      const current = socketRef.current;
      if (!current?.connected) return;
      const state = outgoingTyping.current;
      if (state.conversationId && state.conversationId !== conversationId) stopTyping();

      const now = Date.now();
      if (state.conversationId !== conversationId || now - state.lastSent > TYPING_RESEND_MS) {
        current.emit('typing:start', { conversationId });
        state.lastSent = now;
      }
      state.conversationId = conversationId;
      clearTimeout(state.idleTimer);
      state.idleTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
    },
    [stopTyping]
  );

  useEffect(() => () => stopTyping(), [activeId, stopTyping]);

  // ----- actions that change conversations -----
  const startPrivate = useCallback(async (userId) => {
    const data = await conversationsApi.startPrivate(userId);
    dispatch({ type: 'CONV_UPSERT', conversation: data.conversation });
    return data.conversation;
  }, []);

  const createGroup = useCallback(async (name, memberIds) => {
    const data = await groupsApi.create({ name, memberIds });
    dispatch({ type: 'CONV_UPSERT', conversation: data.conversation });
    return data.conversation;
  }, []);

  const addMembers = useCallback(async (id, userIds) => {
    const data = await groupsApi.addMembers(id, userIds);
    dispatch({ type: 'CONV_UPSERT', conversation: data.conversation });
    return data.conversation;
  }, []);

  const leaveGroup = useCallback(async (id) => {
    await groupsApi.leave(id);
    dispatch({ type: 'CONV_REMOVE', id });
  }, []);

  const isOnline = useCallback((userId, fallback = false) => state.presence[userId] ?? fallback, [state.presence]);

  const totalUnread = useMemo(
    () => state.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [state.conversations]
  );

  const value = useMemo(
    () => ({
      ...state,
      activeId,
      setActiveId,
      totalUnread,
      isOnline,
      loadConversations,
      loadThread,
      loadOlder,
      sendMessage,
      retryMessage,
      discardMessage,
      editMessage,
      deleteMessage,
      clearChat,
      reactToMessage,
      pinMessage,
      unpinMessage,
      notifyTyping,
      stopTyping,
      startPrivate,
      createGroup,
      addMembers,
      leaveGroup,
    }),
    [
      state,
      activeId,
      totalUnread,
      isOnline,
      loadConversations,
      loadThread,
      loadOlder,
      sendMessage,
      retryMessage,
      discardMessage,
      editMessage,
      deleteMessage,
      clearChat,
      reactToMessage,
      pinMessage,
      unpinMessage,
      notifyTyping,
      stopTyping,
      startPrivate,
      createGroup,
      addMembers,
      leaveGroup,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}