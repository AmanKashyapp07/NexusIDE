import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// Monaco language-service workers. Vite's `?worker` suffix compiles each of
// these into a dedicated Worker constructor. Routing language processing
// (syntax, formatting, AST) off the main thread is REQUIRED for the collab
// engine — otherwise the main thread is starved by WebSocket + CRDT + React
// work, and the Yjs `sync` event never fires under load (rapid file switch).
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import './index.css';
import App from './App.tsx';

// Register the worker factory globally BEFORE Monaco initializes.
(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

// Use the locally-bundled Monaco workers instead of loading from jsDelivr CDN.
// Without this, @monaco-editor/react defaults to fetching workers from a CDN,
// which fails when offline or when CDN requests are blocked/throttled.
loader.config({ monaco });

createRoot(document.getElementById('root')!).render(
  <App />
);
