import { TerminalSquare, Loader2 } from 'lucide-react';

interface OutputPanelProps {
  output: string;
  isExecuting: boolean;
}

export default function OutputPanel({ output, isExecuting }: OutputPanelProps) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#07080a] text-zinc-300">
      {isExecuting && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#07080a]/60 backdrop-blur-[2px] transition-all">
          <Loader2 size={36} className="animate-spin text-cyan-400" />
          <span className="animate-pulse font-sans text-sm font-medium tracking-wide text-cyan-300">Executing code in sandbox...</span>
        </div>
      )}
      <div className={`flex-1 overflow-y-auto p-5 font-mono text-[13px] leading-relaxed tracking-wide whitespace-pre-wrap transition-all duration-300 ${isExecuting ? 'opacity-30' : 'opacity-100'}`}>
        {output ? (
          <span className={output.includes('[Error]') || output.includes('Error:') ? 'text-red-400' : 'text-zinc-300'}>
            {output}
          </span>
        ) : (
          <div className="mt-10 flex h-full flex-col items-center justify-center gap-3 text-zinc-500/60">
            <TerminalSquare size={36} className="opacity-80" strokeWidth={1.5} />
            <p className="font-sans text-sm italic">Output will appear here after execution</p>
          </div>
        )}
      </div>
    </div>
  );
}

// this is a React component called OutputPanel that displays the output of code execution in a terminal-like interface. It accepts two props: output (a string containing the output to display) and isExecuting (a boolean indicating whether code execution is currently in progress). When isExecuting is true, an overlay with a loading spinner and message is shown on top of the output area, which is also dimmed. The output text is styled differently if it contains error messages, making it easier for users to identify errors in the output.
// react hook used is useState to manage the state of the output and execution status, and useEffect to handle side effects related to code execution. The component uses conditional rendering to display different content based on whether there is output to show and whether code execution is in progress. It also applies various CSS classes for styling and layout, creating a visually appealing and user-friendly interface for displaying code execution results.