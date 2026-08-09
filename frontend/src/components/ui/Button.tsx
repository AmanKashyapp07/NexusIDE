import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'nx-btn-primary',
  secondary: 'nx-btn-secondary',
  danger:
    'flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed',
  ghost:
    'flex cursor-pointer items-center justify-center gap-2 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

/**
 * UI Primitive: Button
 * Variant-based button with optional loading state and leading icon.
 * Business-logic free — all behaviour via props/callbacks.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size, loading = false, icon, children, disabled, className = '', ...rest }, ref) => {
    const baseClass = VARIANT_CLASSES[variant];
    // size override only for ghost/danger (primary/secondary have full nx-btn styles)
    const sizeClass = size && variant !== 'primary' && variant !== 'secondary' ? SIZE_CLASSES[size] : '';

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseClass} ${sizeClass} ${className}`.trim()}
        {...rest}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
