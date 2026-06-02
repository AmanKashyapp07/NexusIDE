import { TerminalSquare, Activity } from 'lucide-react';

interface OutputPanelProps {
  output: string;
  isExecuting: boolean;
}

export default function OutputPanel({ output, isExecuting }: OutputPanelProps) {
  return (
    <div className="flex h-full flex-col bg-[#07080a] text-zinc-300">
      {isExecuting && (
        <div className="flex items-center gap-2.5 border-b border-cyan-400/10 bg-cyan-400/5 px-4 py-2.5 text-xs font-medium text-cyan-300">
          <Activity size={14} className="animate-pulse" />
          <span>Executing code locally...</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-5 font-mono text-[13px] leading-relaxed tracking-wide whitespace-pre-wrap">
        {output ? (
          <span className={output.includes('[Error]') || output.includes('Error:') ? 'text-red-400' : 'text-zinc-300'}>
            {output}
          </span>
        ) : (
          <div className="mt-10 flex h-full flex-col items-center justify-center gap-3 text-zinc-500/60">
            <TerminalSquare size={36} className="opacity-80" strokeWidth={1.5} />
            <p className="italic font-sans text-sm">Output will appear here after execution</p>
          </div>
        )}
      </div>
    </div>
  );
}