import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/ide/',
  // Exclude monaco-editor from Vite's dep optimizer so the local worker files
  // are served as-is and @monaco-editor/react doesn't fall back to the CDN.
  server: {
    allowedHosts: true,
    fs: {
      allow: ['..']
    }
  },
  preview: {
    allowedHosts: true,
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
            return 'monaco-vendor';
          }
          if (id.includes('node_modules/yjs') || id.includes('node_modules/y-protocols') || id.includes('node_modules/y-websocket') || id.includes('node_modules/y-monaco')) {
            return 'yjs-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons-vendor';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'react-vendor';
          }
        },
      },
    },
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
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, '../testing/setup.ts')],
    include: ['../testing/frontend/*.test.{ts,tsx}', '../testing/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'node_modules/**', 'dist/**', '../testing/services/**', '../testing/db/**', '../testing/integration/**'],
  },
});
