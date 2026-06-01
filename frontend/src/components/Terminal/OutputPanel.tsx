import { Terminal } from 'lucide-react';

interface OutputPanelProps {
  output: string;
  isExecuting: boolean;
}

export default function OutputPanel({ output, isExecuting }: OutputPanelProps) {
  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] border border-slate-700 rounded-md overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-800 border-b border-slate-700 shadow-sm">
        <Terminal size={16} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-200">Terminal Output</span>
        {isExecuting && (
          <span className="ml-auto text-xs font-semibold text-emerald-400 animate-pulse bg-emerald-400/10 px-2 py-1 rounded-full">Executing...</span>
        )}
      </div>
      <div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-slate-300 whitespace-pre-wrap">
        {output || <span className="text-slate-500 italic">No output yet. Run your code to see results.</span>}
      </div>
    </div>
  );
}
