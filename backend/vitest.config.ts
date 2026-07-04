import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
    include: ['../testing/backend/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'node_modules/**', '../testing/backend/node_modules/**'],
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      'y-websocket': path.resolve(__dirname, 'node_modules/y-websocket'),
      'yjs': path.resolve(__dirname, 'node_modules/yjs'),
      'ws': path.resolve(__dirname, 'node_modules/ws'),
      'jsonwebtoken': path.resolve(__dirname, 'node_modules/jsonwebtoken'),
      'socket.io-client': path.resolve(__dirname, 'node_modules/socket.io-client'),
      'supertest': path.resolve(__dirname, 'node_modules/supertest'),
    },
  },
});
