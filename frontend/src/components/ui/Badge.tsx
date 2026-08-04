import type { ReactNode } from 'react';

type BadgeColor = 'emerald' | 'amber' | 'indigo' | 'zinc' | 'red';

interface BadgeProps {
  color?: BadgeColor;
  /** Optional pulsing dot before the label */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const COLOR_CLASSES: Record<BadgeColor, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  amber:   'bg-amber-500/10  text-amber-400  border-amber-500/20',
  indigo:  'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  zinc:    'bg-zinc-500/10   text-zinc-400   border-zinc-500/20',
  red:     'bg-red-500/10    text-red-400    border-red-500/20',
};

const DOT_COLORS: Record<BadgeColor, string> = {
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-500',
  indigo:  'bg-indigo-500',
  zinc:    'bg-zinc-500',
  red:     'bg-red-500',
};

/**
 * UI Primitive: Badge
 * Small status indicator chip. Business-logic free.
 */
export default function Badge({ color = 'zinc', dot = false, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${COLOR_CLASSES[color]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT_COLORS[color]}`} />}
      {children}
    </span>
  );
}
