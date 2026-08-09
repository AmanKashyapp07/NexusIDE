import { useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';

interface CreateWorkspaceCardProps {
  isCreating: boolean;
  onSubmit: (title: string) => void;
}

/**
 * Dashboard Sub-Component: CreateWorkspaceCard
 * Form card for spinning up a new workspace environment.
 */
export default function CreateWorkspaceCard({ isCreating, onSubmit }: CreateWorkspaceCardProps) {
  const [title, setTitle] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(title);
  };

  return (
    <div className="nx-card relative overflow-hidden">
      {/* Top shimmer accent */}
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />

      <h3 className="text-sm font-semibold text-white mb-1">Create Workspace</h3>
      <p className="text-xs text-zinc-500 mb-5">Spin up a new isolated environment.</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. React-Sandbox"
          focusColor="focus:border-violet-500/50 focus:ring-violet-500/50"
        />
        <Button
          type="submit"
          variant="primary"
          loading={isCreating}
          icon={<Plus size={16} />}
        >
          Create Now
        </Button>
      </form>
    </div>
  );
}
