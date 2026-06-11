import { useState, useCallback } from 'react';
import { 
  TerminalSquare, 
  Loader2, 
  AlertTriangle, 
  Copy, 
  Check, 
  AlignLeft,
  Activity
} from 'lucide-react';

interface ExecutionMetrics {
  durationMs: number;
  exitCode: number;
  oomKilled: boolean;
  cpuUsagePercent?: number;
  memoryUsageBytes?: number;
}

interface OutputPanelProps {
  output: string;
  isExecuting: boolean;
  metrics?: ExecutionMetrics | null;
}

const MAX_RENDER_CHARS = 20_000;

export default function OutputPanel({ output, isExecuting, metrics }: OutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  let displayOutput = output;
  let wasTrimmed = false;
  let trimmedBytes = 0;

  if (output.length > MAX_RENDER_CHARS) {
    wasTrimmed = true;
    trimmedBytes = output.length - MAX_RENDER_CHARS;
    displayOutput = output.slice(-MAX_RENDER_CHARS);
  }

  // Determine output styling based on metrics or content
  const isError = (metrics && metrics.exitCode !== 0) || output.includes('Error:') || output.includes('Traceback');
  const isWarning = !isError && output.includes('[Warning]');

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#08070d] text-zinc-300 ring-1 ring-white/5">
      
      {/* Header Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0c0a14] px-4 py-2">
        <div className="flex items-center gap-3">
          <AlignLeft size={16} className="text-violet-400" />
          <span className="font-mono text-xs font-semibold tracking-wider text-zinc-300">
            OUTPUT
          </span>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2">
          {output && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
              title="Copy Output"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* Execution Metrics Header Bar */}
      {metrics && !isExecuting && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.04] bg-[#0c0a14]/50 px-4 py-2.5 text-xs font-sans text-zinc-400">
          <div className="flex items-center gap-2">
            <Activity size={14} className={metrics.exitCode === 0 ? 'text-emerald-500' : 'text-red-500'} />
            <span className={`font-semibold ${metrics.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {metrics.exitCode === 0 ? 'Success' : 'Failed'}
            </span>
          </div>
          
          <div className="h-3 w-px bg-white/10" />
          
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Exit Code</span>
            <span className={`font-mono rounded bg-white/5 px-1.5 py-0.5 ${metrics.exitCode === 0 ? 'text-zinc-200' : 'text-red-400 font-bold'}`}>
              {metrics.exitCode}
            </span>
          </div>
          
          <div className="h-3 w-px bg-white/10" />
          
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Time</span>
            <span className="font-mono text-zinc-200">{metrics.durationMs.toFixed(0)} ms</span>
          </div>

          {metrics.cpuUsagePercent !== undefined && metrics.cpuUsagePercent !== null && (
            <>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">CPU</span>
                <span className="font-mono text-zinc-200">{metrics.cpuUsagePercent.toFixed(1)}%</span>
              </div>
            </>
          )}

          {metrics.memoryUsageBytes !== undefined && metrics.memoryUsageBytes !== null && (
            <>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">RAM</span>
                <span className="font-mono text-zinc-200">
                  {metrics.memoryUsageBytes >= 1024 * 1024
                    ? `${(metrics.memoryUsageBytes / 1024 / 1024).toFixed(1)} MB`
                    : `${(metrics.memoryUsageBytes / 1024).toFixed(0)} KB`}
                </span>
              </div>
            </>
          )}

          {metrics.oomKilled && (
            <>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex items-center gap-1.5 rounded border border-red-500/20 bg-red-500/10 px-2 py-0.5 font-bold tracking-wide text-red-400">
                <AlertTriangle size={12} />
                OOM KILLED (100MB CAP)
              </div>
            </>
          )}
        </div>
      )}

      {/* Loading Overlay */}
      {isExecuting && (
        <div className="absolute inset-x-0 bottom-0 top-10 z-10 flex flex-col items-center justify-center gap-4 bg-[#08070d]/60 backdrop-blur-sm transition-all duration-300">
          <Loader2 size={32} className="animate-spin text-violet-500" />
          <span className="font-sans text-sm font-medium tracking-wide text-violet-200/80">
            Executing in sandbox...
          </span>
        </div>
      )}

      {/* Output Content Area */}
      <div className={`flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20 transition-opacity duration-300 ${isExecuting ? 'opacity-30' : 'opacity-100'}`}>
        {output ? (
          <div className="flex flex-col gap-3">
            {wasTrimmed && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-400/90 shadow-sm">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="flex flex-col font-sans text-[13px]">
                  <span className="font-semibold">Output truncated</span>
                  <span className="text-amber-400/70">
                    {(trimmedBytes / 1024).toFixed(1)} KB hidden. Showing the last {(MAX_RENDER_CHARS / 1000).toFixed(0)} KB.
                  </span>
                </div>
              </div>
            )}
            
            <pre className={`font-mono text-[13px] leading-relaxed tracking-wide whitespace-pre-wrap ${
              isError ? 'text-red-400' : isWarning ? 'text-amber-300' : 'text-zinc-300'
            }`}>
              {displayOutput}
            </pre>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500/60">
            <div className="rounded-full bg-white/5 p-4 ring-1 ring-white/10">
              <TerminalSquare size={32} className="opacity-80" strokeWidth={1.5} />
            </div>
            <p className="font-sans text-sm font-medium">Output will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}