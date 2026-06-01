import { TerminalSquare } from 'lucide-react';

interface OutputPanelProps {
  output: string;
  isExecuting: boolean;
}

export default function OutputPanel({ output, isExecuting }: OutputPanelProps) {
  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#c9d1d9]">
      {isExecuting && (
        <div className="px-4 py-2 bg-[#1f6feb1a] border-b border-[#388bfd66] text-xs font-semibold text-[#58a6ff] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#58a6ff] animate-pulse"></span>
          Running code locally...
        </div>
      )}
      <div className="flex-1 p-4 overflow-y-auto font-mono text-[13px] whitespace-pre-wrap leading-relaxed">
        {output ? (
          <span className={output.includes('[Error]') || output.includes('Error:') ? 'text-[#f85149]' : 'text-[#c9d1d9]'}>
            {output}
          </span>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[#8b949e] opacity-60 mt-10">
            <TerminalSquare size={32} className="mb-2" />
            <p className="italic">No output yet. Run your code to see results.</p>
          </div>
        )}
      </div>
    </div>
  );
}
