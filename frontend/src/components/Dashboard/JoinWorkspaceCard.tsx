import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';

interface JoinWorkspaceCardProps {
  onSubmit: (id: string) => void;
}

/**
 * Dashboard Sub-Component: JoinWorkspaceCard
 * Form card for joining an existing workspace by ID.
 */
export default function JoinWorkspaceCard({ onSubmit }: JoinWorkspaceCardProps) {
  const [joinId, setJoinId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(joinId);
  };

  return (
    <div className="nx-card">
      <h3 className="text-sm font-semibold text-white mb-1">Join Workspace</h3>
      <p className="text-xs text-zinc-500 mb-5">Enter a UUID to collaborate with others.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="text"
          required
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          placeholder="Paste workspace ID..."
          className="font-mono text-zinc-300 placeholder:font-sans"
          focusColor="focus:border-emerald-500/50 focus:ring-emerald-500/50"
        />
        <Button
          type="submit"
          variant="secondary"
          icon={<ArrowRight size={16} className="opacity-70" />}
        >
          Join Environment
        </Button>
      </form>
    </div>
  );
}
