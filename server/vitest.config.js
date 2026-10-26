import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
      CLIENT_ORIGIN: 'http://localhost:5173',
      // Needs a running MongoDB. Override with TEST_MONGODB_URI.
      MONGODB_URI: process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/vybe_test',
      PRESENCE_GRACE_MS: '250',
    },
  },
});
