import { z } from 'zod';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Conversation } from '../models/Conversation.js';
import { verifyToken } from '../utils/tokens.js';
import { blockedPeerIds, blockBetween } from '../services/blockService.js';
import { addConnection, removeConnection, isOnline } from '../services/presence.js';
import { createMessage, markAllDelivered, markRead, requireMembership } from '../services/conversationService.js';
import { conversationPayload, messageSendPayload } from '../validators/schemas.js';
import { AppError } from '../utils/AppError.js';
import { handler } from './handler.js';
import { registerCallHandlers } from './calls.js';
import {
  conversationRoom,
  emitConversationUpdate,
  emitMessageNew,
  emitReceipt,
  userRoom,
} from './emitters.js';

const SEND_LIMIT = 20; // messages
const SEND_WINDOW_MS = 10_000;

async function broadcastPresence(io, userId, online) {
  const contactIds = await Conversation.distinct('participants', { participants: userId });
  // People with a block in either direction never see this person's status.
  const hiddenFrom = await blockedPeerIds(userId);
  const rooms = contactIds.map(String).filter((id) => id !== String(userId) && !hiddenFrom.has(id)).map(userRoom);
  // Guard: emitting to an empty room list would broadcast to everyone.
  if (rooms.length === 0) return;
  io.to(rooms).emit('presence:update', { userId: String(userId), online });
}

export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 100_000,
  });

  // Users who just lost their last connection. Announced offline only if they do not come back
  // within the grace period, so a page refresh does not flash "offline" to everyone.
  const pendingOffline = new Map();

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = typeof token === 'string' ? verifyToken(token, 'socket') : null;
      if (!payload) return next(new Error('unauthorized'));

      const user = await User.findById(payload.sub).select('name username');
      if (!user) return next(new Error('unauthorized'));

      socket.data.user = { id: String(user._id), name: user.name, username: user.username };
      return next();
    } catch (error) {
      console.error('[socket] auth error', error);
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(userRoom(me.id));

    const cameOnline = addConnection(me.id, socket.id);
    if (cameOnline) {
      const timer = pendingOffline.get(me.id);
      if (timer) {
        clearTimeout(timer);
        pendingOffline.delete(me.id);
      } else {
        broadcastPresence(io, me.id, true).catch((e) => console.error('[presence]', e));
      }
    }

    const sendTimes = [];
    const withinRateLimit = () => {
      const now = Date.now();
      while (sendTimes.length && now - sendTimes[0] > SEND_WINDOW_MS) sendTimes.shift();
      if (sendTimes.length >= SEND_LIMIT) return false;
      sendTimes.push(now);
      return true;
    };

    // Joining a conversation room is the only way into one, and it is checked against the database.
    socket.on(
      'conversation:join',
      handler(socket, conversationPayload, async ({ conversationId }) => {
        await requireMembership(conversationId, me.id);
        await socket.join(conversationRoom(conversationId));
      })
    );

    socket.on(
      'conversation:leave',
      handler(socket, conversationPayload, async ({ conversationId }) => {
        await socket.leave(conversationRoom(conversationId));
      })
    );

    socket.on(
      'message:send',
      handler(socket, messageSendPayload, async ({ conversationId, content, clientMsgId, attachmentId, replyTo }) => {
        if (!withinRateLimit()) {
          throw new AppError(429, 'You are sending messages too quickly', { code: 'rate_limited' });
        }
        // Server decides who the sender is and whether they may post here.
        const conversation = await requireMembership(conversationId, me.id);

        // Persist first. Only a stored message is acknowledged or delivered.
        const sender = { _id: me.id, name: me.name, username: me.username };
        const { message, created, hiddenFrom } = await createMessage({ conversation, sender, content, clientMsgId, attachmentId, replyToId: replyTo });

        if (created) {
          await emitMessageNew(io, conversation._id, message, { skipUserIds: hiddenFrom });
          // Blocked recipients get no update at all; only the sender's own list is refreshed.
          emitConversationUpdate(io, conversation._id, hiddenFrom.length ? { onlyUserIds: [me.id] } : {}).catch((e) => console.error('[emit]', e));
        }
        // A retried send (created=false) is acknowledged with the stored message and not re-broadcast.
        return { message, duplicate: !created };
      })
    );

    socket.on(
      'message:read',
      handler(socket, conversationPayload, async ({ conversationId }) => {
        const conversation = await requireMembership(conversationId, me.id);
        const result = await markRead(conversation._id, me.id);
        io.to(userRoom(me.id)).emit('message:read:update', {
          conversationId: String(conversation._id),
          unreadCount: 0,
          lastReadAt: result.lastReadAt,
        });
        emitReceipt(io, conversation._id, me.id, { deliveredAt: result.deliveredAt, readAt: result.lastReadAt }).catch((e) =>
          console.error('[receipt]', e)
        );
        return { unreadCount: 0 };
      })
    );

    // Sent by the app after it has (re)loaded its conversations: everything stored so far has now reached
    // a signed-in session. Only ever advances the caller's own marker.
    socket.on(
      'delivery:sync',
      handler(
        socket,
        z.any(),
        async () => {
          const moved = await markAllDelivered(me.id);
          await Promise.all(moved.map((m) => emitReceipt(io, m.conversationId, me.id, m)));
        },
        { quiet: true }
      )
    );

    // Typing is ephemeral: relayed through the room, never stored. Only sockets that were
    // authorised into the room (via conversation:join) can send or receive it.
    const relayTyping = (isTyping) =>
      handler(
        socket,
        conversationPayload,
        async ({ conversationId }) => {
          const room = conversationRoom(conversationId);
          if (!socket.rooms.has(room)) return;
          if (isTyping) {
            const conv = await Conversation.findById(conversationId).select('type participants').lean();
            if (conv?.type === 'private') {
              const other = conv.participants.find((id) => String(id) !== me.id);
              const { mine, theirs } = await blockBetween(me.id, other);
              if (mine || theirs) return; // no typing indicator across a block
            }
          }
          socket.to(room).emit('typing:update', {
            conversationId,
            userId: me.id,
            name: me.name,
            isTyping,
          });
        },
        { quiet: true }
      );
    socket.on('typing:start', relayTyping(true));
    socket.on('typing:stop', relayTyping(false));

    const calls = registerCallHandlers(io, socket, me);

    socket.on('disconnecting', () => {
      // Clear any typing indicator this socket left behind.
      for (const room of socket.rooms) {
        if (room.startsWith('conversation:')) {
          socket.to(room).emit('typing:update', {
            conversationId: room.slice('conversation:'.length),
            userId: me.id,
            name: me.name,
            isTyping: false,
          });
        }
      }
    });

    socket.on('disconnect', () => {
      calls.onDisconnect();
      const wentOffline = removeConnection(me.id, socket.id);
      if (!wentOffline) return; // another tab/device is still connected

      const announce = () => {
        pendingOffline.delete(me.id);
        if (isOnline(me.id)) return;
        broadcastPresence(io, me.id, false).catch((e) => console.error('[presence]', e));
      };
      if (env.presenceGraceMs <= 0) return announce();
      pendingOffline.set(me.id, setTimeout(announce, env.presenceGraceMs));
    });
  });

  return io;
}
