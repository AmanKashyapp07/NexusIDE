import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // Exclude monaco-editor from Vite's dep optimizer so the local worker files
  // are served as-is and @monaco-editor/react doesn't fall back to the CDN.
  server: {
    fs: {
      allow: ['..']
    }
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@testing-library/react': path.resolve(__dirname, 'node_modules/@testing-library/react'),
      '@testing-library/jest-dom': path.resolve(__dirname, 'node_modules/@testing-library/jest-dom'),
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      '@monaco-editor/react': path.resolve(__dirname, 'node_modules/@monaco-editor/react'),
      'yjs': path.resolve(__dirname, 'node_modules/yjs'),
      'y-websocket': path.resolve(__dirname, 'node_modules/y-websocket'),
      'y-monaco': path.resolve(__dirname, 'node_modules/y-monaco'),
      'socket.io-client': path.resolve(__dirname, 'node_modules/socket.io-client'),
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, '../testing/frontend/setup.ts')],
    globals: true,
    include: ['../testing/frontend/**/*.test.{ts,tsx}'],
    exclude: ['../testing/e2e/**', '**/node_modules/**', 'node_modules/**', 'dist/**', '../testing/frontend/node_modules/**'],
  },
});
