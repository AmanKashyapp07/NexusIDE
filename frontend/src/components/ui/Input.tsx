import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional leading icon rendered inside the input field */
  leadingIcon?: ReactNode;
  /** Extra class overrides for focus ring color (e.g. 'focus:ring-emerald-500/50') */
  focusColor?: string;
}

/**
 * UI Primitive: Input
 * Unified text input with optional leading icon and focus glow.
 * Business-logic free — all behaviour via props/callbacks.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ leadingIcon, focusColor = 'focus:border-violet-500/50 focus:ring-violet-500/50', className = '', ...rest }, ref) => {
    if (leadingIcon) {
      return (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500">
            {leadingIcon}
          </div>
          <input
            ref={ref}
            className={`nx-input pl-9 placeholder:text-zinc-600 focus:ring-1 ${focusColor} ${className}`.trim()}
            {...rest}
          />
        </div>
      );
    }

    return (
      <input
        ref={ref}
        className={`nx-input placeholder:text-zinc-600 focus:ring-1 ${focusColor} ${className}`.trim()}
        {...rest}
      />
    );
  }
);

Input.displayName = 'Input';

export default Input;
