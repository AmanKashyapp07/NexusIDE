import React, { useEffect, useState } from 'react';
import { X, Check, ArrowRight } from 'lucide-react';
import { apiUrl } from '../../lib/backendUrls';
import { useToast } from '../Toast/Toast';

interface ConflictBlock {
  type: 'unchanged' | 'conflict';
  content?: string;
  ours?: string;
  theirs?: string;
  ourLabel?: string;
  theirLabel?: string;
}

interface ConflictResolverProps {
  workspaceId: string;
  fileId: string;
  filename: string;
  onClose: () => void;
  onResolved: () => void;
}

export default function ConflictResolver({
  workspaceId,
  fileId,
  filename,
  onClose,
  onResolved
}: ConflictResolverProps) {
  const [blocks, setBlocks] = useState<ConflictBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolutions, setResolutions] = useState<Record<number, 'ours' | 'theirs'>>({});
  const [isResolving, setIsResolving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    const fetchConflicts = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(apiUrl(`/workspace/${workspaceId}/files/${fileId}/conflicts`), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch conflicts');
        const data = await res.json();
        setBlocks(data.conflicts || []);
      } catch (err) {
        addToast('Failed to load conflicts', 'error');
        onClose();
      } finally {
        setLoading(false);
      }
    };
    fetchConflicts();
  }, [workspaceId, fileId, onClose, addToast]);

  const handleResolve = async () => {
    // Ensure all conflicts are resolved
    const conflictIndexes = blocks.map((b, i) => b.type === 'conflict' ? i : -1).filter(i => i !== -1);
    const missing = conflictIndexes.find(i => !resolutions[i]);
    if (missing !== undefined) {
      addToast('Please resolve all conflicts before submitting', 'error');
      return;
    }

    setIsResolving(true);
    try {
      // Build resolved content
      const resolvedContent = blocks.map((block, index) => {
        if (block.type === 'unchanged') return block.content || '';
        return resolutions[index] === 'ours' ? (block.ours || '') : (block.theirs || '');
      }).join('\n');

      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl(`/workspace/${workspaceId}/files/${fileId}/conflicts/resolve`), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ resolvedContent })
      });

      if (!res.ok) throw new Error('Failed to resolve conflicts');
      
      addToast('Conflicts resolved successfully', 'success');
      onResolved();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to resolve', 'error');
    } finally {
      setIsResolving(false);
    }
  };

  if (loading) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#050505]/80 backdrop-blur-sm">
        <div className="text-zinc-400">Loading conflicts...</div>
      </div>
    );
  }

  const conflictCount = blocks.filter(b => b.type === 'conflict').length;
  const resolvedCount = Object.keys(resolutions).length;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#0A0A0A] overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#121214] px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20">
            <X className="text-red-400" size={16} strokeWidth={2.5} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Resolve Conflicts in {filename}</h2>
            <p className="text-[11px] text-zinc-400">
              {resolvedCount} of {conflictCount} conflicts resolved
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={isResolving || resolvedCount < conflictCount}
            className="flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white transition-all hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResolving ? 'Resolving...' : 'Complete Merge'}
            {!isResolving && <Check size={14} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {blocks.map((block, index) => {
            if (block.type === 'unchanged') {
              return (
                <div key={index} className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-4 text-xs font-mono text-zinc-400 whitespace-pre-wrap">
                  {block.content}
                </div>
              );
            }

            const res = resolutions[index];
            
            return (
              <div key={index} className={`rounded-lg border-2 overflow-hidden transition-colors ${res ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
                <div className="flex bg-[#121214]">
                  {/* OURS */}
                  <div className={`flex-1 flex flex-col border-r border-white/[0.05] transition-colors ${res === 'ours' ? 'bg-emerald-500/5' : ''}`}>
                    <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.02] px-3 py-2">
                      <span className="text-xs font-semibold text-blue-400">Current Change (Ours)</span>
                      <button
                        onClick={() => setResolutions(prev => ({ ...prev, [index]: 'ours' }))}
                        className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${res === 'ours' ? 'bg-emerald-500 text-white' : 'bg-white/10 text-zinc-300 hover:bg-white/20'}`}
                      >
                        Accept Ours
                      </button>
                    </div>
                    <div className="flex-1 p-4 text-xs font-mono text-blue-300 whitespace-pre-wrap bg-blue-900/10">
                      {block.ours}
                    </div>
                  </div>

                  {/* THEIRS */}
                  <div className={`flex-1 flex flex-col transition-colors ${res === 'theirs' ? 'bg-emerald-500/5' : ''}`}>
                    <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.02] px-3 py-2">
                      <span className="text-xs font-semibold text-purple-400">Incoming Change (Theirs)</span>
                      <button
                        onClick={() => setResolutions(prev => ({ ...prev, [index]: 'theirs' }))}
                        className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${res === 'theirs' ? 'bg-emerald-500 text-white' : 'bg-white/10 text-zinc-300 hover:bg-white/20'}`}
                      >
                        Accept Theirs
                      </button>
                    </div>
                    <div className="flex-1 p-4 text-xs font-mono text-purple-300 whitespace-pre-wrap bg-purple-900/10">
                      {block.theirs}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
