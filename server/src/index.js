import { env, assertEnv } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { buildServer } from './app.js';
import { cleanupOrphans } from './services/attachmentService.js';
import { closeStaleCalls } from './services/callService.js';

async function main() {
  assertEnv();
  await connectDb(env.mongoUri);
  console.log('Connected to MongoDB');
  // Nobody is on a call after a restart: close anything left ringing or ongoing.
  await closeStaleCalls();

  // Uploads that were never sent expire after an hour; sweep them now and every 30 minutes.
  const sweep = () => cleanupOrphans().catch((e) => console.error('[cleanup]', e.message));
  sweep();
  setInterval(sweep, 30 * 60 * 1000).unref();

  const { httpServer, io } = buildServer();
  httpServer.listen(env.port, () => {
    console.log(`VYBE server listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    io.close();
    httpServer.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
