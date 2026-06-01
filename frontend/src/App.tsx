import { useState, useRef } from 'react';
import CodeEditor from './components/Editor/CodeEditor';
import OutputPanel from './components/Terminal/OutputPanel';
import { Play, Code2, Users } from 'lucide-react';

function App() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [output, setOutput] = useState('');
  const [language, setLanguage] = useState('javascript');
  const editorRef = useRef<any>(null);

  // In a real app, generate a unique ID or use URL param
  const workspaceId = 'default-workspace'; 

  const handleExecute = async () => {
    if (!editorRef.current) return;
    const code = editorRef.current.getValue();
    
    setIsExecuting(true);
    setOutput('');
    
    try {
      const response = await fetch('http://localhost:4000/api/workspace/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language }),
      });
      
      const data = await response.json();
      if (data.error) {
        setOutput(`Error: ${data.error}`);
      } else {
        setOutput(data.output);
      }
    } catch (error: any) {
      setOutput(`Failed to execute: ${error.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 shadow-lg relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-xl border border-indigo-500/20">
            <Code2 className="text-indigo-400" size={24} />
          </div>
          <h1 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400">
            Cloud IDE
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/50 shadow-inner">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <Users size={16} className="text-slate-400 ml-1" />
            <span className="text-xs font-bold text-slate-300 tracking-wide uppercase">Live</span>
          </div>
          
          <select 
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-sm font-medium rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all cursor-pointer hover:bg-slate-700"
          >
            <option value="javascript">JavaScript (Node 20)</option>
            <option value="python">Python (3.10)</option>
          </select>
          
          <button 
            onClick={handleExecute}
            disabled={isExecuting}
            className="group flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white px-6 py-2 rounded-lg font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <Play size={16} className={`transition-transform group-hover:scale-110 ${isExecuting ? "animate-pulse" : ""}`} fill="currentColor" />
            {isExecuting ? 'Running...' : 'Run Code'}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex gap-4 p-4 overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950">
        <div className="flex-1 min-w-[50%] h-full">
          <CodeEditor 
            workspaceId={workspaceId} 
            language={language}
            onEditorReady={(editor) => editorRef.current = editor}
          />
        </div>
        <div className="w-[40%] h-full">
          <OutputPanel output={output} isExecuting={isExecuting} />
        </div>
      </main>
    </div>
  );
}

export default App;
