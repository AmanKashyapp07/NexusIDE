import { useState, useRef } from 'react';
import CodeEditor from './components/Editor/CodeEditor';
import OutputPanel from './components/Terminal/OutputPanel';
import { Play, Cloud, Users, Book } from 'lucide-react';

function App() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [output, setOutput] = useState('');
  const [language, setLanguage] = useState('javascript');
  const editorRef = useRef<any>(null);

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
    <div className="flex flex-col h-screen w-full bg-[#0d1117] text-[#c9d1d9] font-sans">
      {/* GitHub-style Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#161b22] text-[#c9d1d9] border-b border-[#30363d]">
        <div className="flex items-center gap-3">
          <Cloud className="text-white" size={32} />
          <div className="flex items-center text-sm font-semibold">
            <span className="text-[#8b949e] hover:text-blue-400 cursor-pointer transition-colors">amankashyap</span>
            <span className="mx-1 text-[#8b949e]">/</span>
            <span className="hover:text-blue-400 cursor-pointer transition-colors text-white">sandbox-ide</span>
            <span className="ml-2 px-2 py-0.5 text-xs font-medium border border-[#30363d] rounded-full text-[#8b949e]">Public</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 bg-[#21262d] hover:bg-[#30363d] cursor-pointer rounded-md text-xs font-medium transition-colors border border-[#30363d]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <Users size={14} className="text-[#8b949e]" />
            Live Sync
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-[#0d1117] border-b border-[#30363d]">
        <div className="flex items-center gap-2 text-sm">
          <Book size={16} className="text-[#8b949e]" />
          <span className="font-semibold text-[#c9d1d9]">main.js</span>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-[#21262d] border border-[#30363d] text-[#c9d1d9] text-sm font-medium rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer hover:bg-[#30363d]"
          >
            <option value="javascript">JavaScript (Node 20)</option>
            <option value="python">Python (3.10)</option>
            <option value="cpp">C++ (GCC/Clang)</option>
            <option value="bash">Bash Script</option>
          </select>
          
          <button 
            onClick={handleExecute}
            disabled={isExecuting}
            className="flex items-center gap-2 bg-[#238636] hover:bg-[#2ea043] border border-[rgba(240,246,252,0.1)] text-white px-3 py-1.5 rounded-md font-medium text-sm transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={14} fill="currentColor" />
            {isExecuting ? 'Running...' : 'Run Code'}
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <main className="flex-1 flex gap-4 p-6 overflow-hidden">
        <div className="flex-1 h-full bg-[#0d1117] border border-[#30363d] rounded-md shadow-sm overflow-hidden flex flex-col">
          <div className="bg-[#161b22] border-b border-[#30363d] px-4 py-2 text-xs font-semibold text-[#8b949e]">
            Code Editor
          </div>
          <div className="flex-1">
            <CodeEditor 
              workspaceId={workspaceId} 
              language={language}
              onEditorReady={(editor) => editorRef.current = editor}
            />
          </div>
        </div>
        
        <div className="w-[40%] h-full bg-[#0d1117] border border-[#30363d] rounded-md shadow-sm overflow-hidden flex flex-col">
          <div className="bg-[#161b22] border-b border-[#30363d] px-4 py-2 text-xs font-semibold text-[#8b949e]">
            Terminal
          </div>
          <div className="flex-1 bg-[#0d1117]">
            <OutputPanel output={output} isExecuting={isExecuting} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
