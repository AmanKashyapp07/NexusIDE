import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { 
  Plus,
  SplitSquareHorizontal,
  Trash2,
  ChevronUp,
  X,
  RefreshCw,
  AlertTriangle,
  Info
} from 'lucide-react';

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
        background: '#1a1b26',       // Tokyo Night Background
        foreground: '#a9b1d6',       // Tokyo Night Foreground
        cursor: '#f7768e',           // Tokyo Night Pink Cursor
        cursorAccent: '#1a1b26',
        selectionBackground: 'rgba(187, 154, 247, 0.3)', // Soft purple selection
        black: '#32344a',
        red: '#f7768e',              // Pinkish Red
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',          // Soft Purple
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
    
    const wsUrl = `ws://localhost:4000/terminal/${workspaceId}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnectionStatus('connected');
      setError(null);
    };

    ws.onmessage = (event) => {
      if (terminal && !terminal.element) return;
      const data = new Uint8Array(event.data);
      terminal.write(data);
    };

    ws.onerror = () => {
      setError('Connection error');
      setConnectionStatus('disconnected');
    };

    ws.onclose = (event) => {
      setConnectionStatus('disconnected');
      if (event.code === 4401) {
        setError('Session expired. Please log out and log back in.');
      } else if (event.code === 4403) {
        setError('Access denied: Insufficient permission');
      } else if (event.code === 4404) {
        setError('Workspace not found');
      } else if (event.code === 4500) {
        setError('Docker is unavailable on the host system. Please ensure Docker Desktop is running.');
      } else if (event.code === 1000) {
        terminal.write('\r\n\x1b[38;2;187;154;247m[Terminal session ended cleanly]\x1b[0m\r\n');
      } else {
        setError('Connection closed unexpectedly');
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
      
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [workspaceId, reconnectCounter]); 

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#1a1b26] text-[#a9b1d6] font-sans border-t border-[#292e42]">
      
      {/* Panel Header */}
      <div className="flex h-9 shrink-0 items-center justify-between px-4 select-none bg-[#1a1b26]">
        {/* Tabs */}
        <div className="flex h-full items-center gap-6 text-[11px] font-medium tracking-wide">
          <div className="flex h-full items-center text-[#565f89] hover:text-[#a9b1d6] cursor-pointer transition-colors">PROBLEMS</div>
          <div className="flex h-full items-center text-[#565f89] hover:text-[#a9b1d6] cursor-pointer transition-colors">OUTPUT</div>
          <div className="flex h-full items-center text-[#565f89] hover:text-[#a9b1d6] cursor-pointer transition-colors">DEBUG CONSOLE</div>
          <div className="flex h-full items-center text-[#f7768e] border-b-[1.5px] border-[#f7768e] cursor-default">
            TERMINAL
          </div>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-1 text-[#a9b1d6]">
          {userRole === 'viewer' && (
            <span className="flex items-center gap-1.5 mr-3 text-[11px] text-[#e0af68]" title="Read-only mode">
              <Info size={14} />
              Read-only
            </span>
          )}
          
          <button className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-[#292e42] transition-colors" title="New Terminal">
            <Plus size={14} />
          </button>
          <button className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-[#292e42] transition-colors" title="Split Terminal">
            <SplitSquareHorizontal size={14} />
          </button>
          <button 
            onClick={handleClear}
            className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-[#292e42] transition-colors" 
            title="Clear Terminal"
          >
            <Trash2 size={14} />
          </button>
          
          <div className="w-[1px] h-4 bg-[#292e42] mx-1" />
          
          <button className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-[#292e42] transition-colors">
            <ChevronUp size={16} />
          </button>
          <button className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-[#292e42] transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Terminal View area */}
      <div className="flex-1 relative">
        {/* Modal Overlay for Connection Issues */}
        {connectionStatus !== 'connected' && (
          <div className="absolute inset-0 z-10 flex items-start justify-center pt-10 bg-[#1a1b26]/60 backdrop-blur-sm">
            {connectionStatus === 'connecting' ? (
              <div className="flex items-center gap-3 px-4 py-2.5 text-[13px] bg-[#1f2335] text-[#a9b1d6] border border-[#292e42] shadow-lg shadow-black/20 rounded-md">
                <RefreshCw size={14} className="animate-spin text-[#bb9af7]" />
                Starting terminal session...
              </div>
            ) : (
              <div className="flex flex-col min-w-[300px] bg-[#1f2335] text-[#a9b1d6] border border-[#292e42] shadow-xl shadow-black/20 rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#292e42] bg-[#1a1b26]">
                  <AlertTriangle size={14} className="text-[#f7768e]" />
                  <span className="text-[12px] font-medium uppercase tracking-wide text-[#a9b1d6]">
                    {error ? 'Process Exited with Error' : 'Process Exited'}
                  </span>
                </div>
                <div className="px-4 py-5 text-[13px] text-[#9aa5ce]">
                  <p>{error || 'The terminal process has terminated.'}</p>
                </div>
                <div className="flex justify-end gap-2 px-4 py-3 bg-[#1a1b26] border-t border-[#292e42]">
                  <button 
                    onClick={handleReconnect}
                    className="px-3 py-1.5 text-[12px] font-medium text-[#1a1b26] bg-[#7aa2f7] hover:bg-[#8db4ff] transition-colors focus:outline-none focus:ring-2 focus:ring-[#bb9af7] rounded"
                  >
                    Relaunch Terminal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Terminal Container */}
        <div 
          ref={terminalRef} 
          className="absolute inset-0 p-3 pt-2 [&_.xterm-viewport::-webkit-scrollbar]:w-3 [&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent [&_.xterm-viewport::-webkit-scrollbar-thumb]:bg-[#292e42] [&_.xterm-viewport:hover::-webkit-scrollbar-thumb]:bg-[#3b4261] [&_.xterm-viewport::-webkit-scrollbar-thumb:hover]:bg-[#565f89] [&_.xterm-viewport]:scrollbar-thin [&_.xterm-viewport]:scrollbar-track-transparent" 
        />
      </div>
    </div>
  );
}