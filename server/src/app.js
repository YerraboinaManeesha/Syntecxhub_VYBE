import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import conversationRoutes from './routes/conversations.js';
import groupRoutes from './routes/groups.js';
import attachmentRoutes from './routes/attachments.js';
import callRoutes from './routes/calls.js';
import { initSockets } from './sockets/index.js';

export function createApp() {
  const app = express();

  // Render sits behind a proxy; needed so secure cookies and rate limiting see the real client.
  app.set('trust proxy', 1);

  // The API is called from another origin, so allow cross-origin resource use.
  // CORS below still limits which origin may make credentialed requests.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
    })
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  // Health check for Render. No auth, no database details.
  app.get('/api/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok', service: 'vybe-server' } });
  });

  app.use('/api', apiLimiter, csrfProtection);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/attachments', attachmentRoutes);
  app.use('/api/calls', callRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Builds the HTTP server with Express and Socket.io attached to the same port. */
export function buildServer() {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = initSockets(httpServer);
  app.set('io', io);
  return { app, httpServer, io };
}
