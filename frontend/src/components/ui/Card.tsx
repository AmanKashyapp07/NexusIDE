import { type ReactNode, type HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div 
      className={`nx-card ${className}`} 
      {...props}
    >
      {children}
    </div>
  );
}
