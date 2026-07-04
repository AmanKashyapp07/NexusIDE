import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { 
  Trash2,
  RefreshCw,
  AlertTriangle,
  Info
} from 'lucide-react';
import { useToast } from '../Toast/Toast';
import { apiUrl, wsUrl } from '../../lib/backendUrls';

interface TerminalPanelProps {
  workspaceId: string;
  userRole?: 'admin' | 'editor' | 'viewer' | null;
  isVisible: boolean;
}

export default function TerminalPanel({ workspaceId, userRole, isVisible }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { addToast } = useToast();
  
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [reconnectCounter, setReconnectCounter] = useState(0);

  const handleReconnect = useCallback(() => {
    setConnectionStatus('connecting');
    setError(null);
    setReconnectCounter(prev => prev + 1);
  }, []);

  const handleClear = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  }, []);

  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      const timer = setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      rows: 30,
      cols: 80,
      theme: {
        background: '#0d0c14',
        foreground: '#a9b1d6',
        cursor: '#bb9af7',
        cursorAccent: '#0d0c14',
        selectionBackground: 'rgba(187, 154, 247, 0.25)',
        black: '#32344a',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#444b6a',
        brightRed: '#ff7a93',
        brightGreen: '#b9f27c',
        brightYellow: '#ff9e64',
        brightBlue: '#7da6ff',
        brightMagenta: '#bb9af7',
        brightCyan: '#0db9d7',
        brightWhite: '#c0caf5',
      },
      scrollback: 10000,
      convertEol: true,
      lineHeight: 1.3,
      letterSpacing: 0.5,
    });

    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;

    const initFitTimeout = setTimeout(() => {
      if (xtermRef.current && fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    }, 100);

    const handleWindowResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };
    window.addEventListener('resize', handleWindowResize);

    const token = localStorage.getItem('token') || '';
    
    const terminalWsUrl = wsUrl(`/terminal/${workspaceId}?token=${token}`);
    const ws = new WebSocket(terminalWsUrl);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnectionStatus('connected');
      setError(null);
      addToast('Terminal session connected', 'success');
    };

    ws.onmessage = (event) => {
      if (terminal && !terminal.element) return;
      const data = new Uint8Array(event.data);
      terminal.write(data);
    };

    ws.onerror = () => {
      setError('Connection error');
      setConnectionStatus('disconnected');
      addToast('Terminal connection error', 'error');
    };

    ws.onclose = (event) => {
      setConnectionStatus('disconnected');
      if (event.code === 4401) {
        const msg = 'Session expired. Please log out and log back in.';
        setError(msg);
        addToast(msg, 'error');
      } else if (event.code === 4403) {
        const msg = 'Access denied: Insufficient permission';
        setError(msg);
        addToast(msg, 'error');
      } else if (event.code === 4404) {
        const msg = 'Workspace not found';
        setError(msg);
        addToast(msg, 'error');
      } else if (event.code === 4500) {
        const msg = 'Docker is unavailable on the host system. Please ensure Docker Desktop is running.';
        setError(msg);
        addToast(msg, 'error');
      } else if (event.code === 1000) {
        terminal.write('\r\n\x1b[38;2;187;154;247m[Terminal session ended cleanly]\x1b[0m\r\n');
      } else {
        const msg = 'Connection closed unexpectedly';
        setError(msg);
        addToast(msg, 'error');
      }
    };

    const disposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      disposable.dispose();
      clearTimeout(initFitTimeout);
      window.removeEventListener('resize', handleWindowResize);
      
      // Detach listeners to prevent state updates and toasts during unmount/cleanup
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [workspaceId, reconnectCounter]); 

  // [AFK MANAGEMENT] Heartbeat Ping
  // Tracks user activity to prevent container hibernation.
  useEffect(() => {
    let isActive = true; // Assume active on mount

    const activityHandler = () => { isActive = true; };
    window.addEventListener('keydown', activityHandler, { passive: true });
    window.addEventListener('mousemove', activityHandler, { passive: true });

    const interval = setInterval(() => {
      if (isActive) {
        isActive = false; // reset for next cycle
        const token = localStorage.getItem('token');
        fetch(apiUrl(`/workspace/${workspaceId}/heartbeat`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }).catch(() => {}); // Fire and forget
      }
    }, 2 * 60 * 1000); // 2 minutes

    return () => {
      window.removeEventListener('keydown', activityHandler);
      window.removeEventListener('mousemove', activityHandler);
      clearInterval(interval);
    };
  }, [workspaceId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0d0c14] text-[#a9b1d6] font-sans">

      {/* Internal toolbar: clear + read-only badge */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.05] px-3 select-none">
        <div className="flex items-center gap-2">
          {userRole === 'viewer' && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-400/80" title="Read-only mode">
              <Info size={12} />
              Read-only
            </span>
          )}
        </div>
        <button
          onClick={handleClear}
          className="flex items-center justify-center h-5 w-5 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-colors"
          title="Clear Terminal"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="flex-1 relative min-h-0">
        {connectionStatus !== 'connected' && (
          <div className="absolute inset-0 z-10 flex items-start justify-center pt-10 bg-[#0d0c14]/70 backdrop-blur-sm">
            {connectionStatus === 'connecting' ? (
              <div className="flex items-center gap-3 px-4 py-2.5 text-[13px] bg-white/5 text-zinc-300 border border-white/10 shadow-lg rounded-xl">
                <RefreshCw size={14} className="animate-spin text-violet-400" />
                Starting terminal session...
              </div>
            ) : (
              <div className="flex flex-col min-w-[300px] bg-[rgba(13,12,20,0.95)] text-zinc-300 border border-white/10 shadow-2xl rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07]">
                  <AlertTriangle size={14} className="text-red-400" />
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-zinc-200">
                    {error ? 'Process Exited with Error' : 'Process Exited'}
                  </span>
                </div>
                <div className="px-4 py-4 text-[13px] text-zinc-400">
                  <p>{error || 'The terminal process has terminated.'}</p>
                </div>
                <div className="flex justify-end gap-2 px-4 py-3 border-t border-white/[0.07]">
                  <button
                    onClick={handleReconnect}
                    className="px-3 py-1.5 text-[12px] font-semibold text-white bg-violet-600/80 hover:bg-violet-500/80 transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/50"
                  >
                    Relaunch Terminal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div
          ref={terminalRef}
          className="absolute inset-0 p-3 pt-2 [&_.xterm-viewport::-webkit-scrollbar]:w-2 [&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent [&_.xterm-viewport::-webkit-scrollbar-thumb]:bg-white/10 [&_.xterm-viewport:hover::-webkit-scrollbar-thumb]:bg-white/20 [&_.xterm-viewport::-webkit-scrollbar-thumb:hover]:bg-white/30"
        />
      </div>
    </div>
  );
}
