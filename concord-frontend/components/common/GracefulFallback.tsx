'use client';

/**
 * GracefulFallback — Shows helpful messages instead of crashes when
 * any brain goes offline. Non-AI features always work.
 */

import { ReactNode } from 'react';
import { useBrainHealth } from '@/hooks/useBrainHealth';

interface FallbackProps {
  /** Feature name to display in the fallback message */
  feature: string;
  /** Which brain is required for this feature */
  brainRequired: 'conscious' | 'utility' | 'subconscious' | 'repair' | 'none';
  children: ReactNode;
}

export function GracefulFallback({ feature, brainRequired, children }: FallbackProps) {
  const { brainStatus, isLoading } = useBrainHealth();

  if (brainRequired === 'none') return <>{children}</>;

  // While loading, show children optimistically
  if (isLoading) return <>{children}</>;

  const brain = brainStatus[brainRequired];

  // Unknown / never-fetched status (null) — do not block the feature. Only
  // show the yellow strip when we positively know the required brain is offline.
  if (!brain) return <>{children}</>;

  if (!brain.online) {
    return (
      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <p className="text-amber-400 text-sm font-medium">
          {feature} temporarily unavailable
        </p>
        <p className="text-gray-400 text-xs mt-1">
          AI features are reconnecting. Your data is safe.
          Non-AI features continue to work normally.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export default GracefulFallback;
