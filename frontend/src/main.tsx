import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import './index.css';
import App from './App.tsx';

// Use the locally-bundled Monaco workers instead of loading from jsDelivr CDN.
// Without this, @monaco-editor/react defaults to fetching workers from a CDN,
// which fails when offline or when CDN requests are blocked/throttled.
loader.config({ monaco });

createRoot(document.getElementById('root')!).render(
  <App />
);
