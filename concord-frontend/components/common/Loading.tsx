'use client';

import { Loader2 } from 'lucide-react';

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  fullScreen?: boolean;
}

export function Loading({ size = 'md', text, fullScreen = false }: LoadingProps) {
  const sizeStyles = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  const content = (
    <div className="flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <Loader2 className={`${sizeStyles[size]} text-neon-cyan animate-spin`} aria-hidden="true" />
      {text ? <p className="text-sm text-gray-400">{text}</p> : <span className="sr-only">Loading…</span>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-lattice-void/90 flex items-center justify-center z-50">
        {content}
      </div>
    );
  }

  return content;
}

export function LoadingSkeleton({
  className = '',
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <div
      className={`bg-lattice-elevated rounded ${
        animated ? 'animate-pulse' : ''
      } ${className}`}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="lens-card space-y-3">
      <LoadingSkeleton className="h-4 w-3/4" />
      <LoadingSkeleton className="h-3 w-full" />
      <LoadingSkeleton className="h-3 w-5/6" />
      <div className="flex gap-2 mt-4">
        <LoadingSkeleton className="h-6 w-16 rounded-full" />
        <LoadingSkeleton className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}
