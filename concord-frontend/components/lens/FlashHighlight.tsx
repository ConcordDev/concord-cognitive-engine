'use client';

/**
 * FlashHighlight — pulse a brief ring on its children when `flashKey`
 * increments.  Pairs with useTilePush.
 *
 * Phase 11 (Item 8).
 *
 *   const { flashKey } = useTilePush({ lensId: 'world', queryKeys: [...] });
 *   <FlashHighlight flashKey={flashKey}>...</FlashHighlight>
 */

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FlashHighlightProps {
  flashKey: number;
  children: ReactNode;
  /** Tailwind ring-color override. Default indigo. */
  ringClass?: string;
  /** Flash duration ms. Default 900. */
  durationMs?: number;
  className?: string;
}

export function FlashHighlight({
  flashKey,
  children,
  ringClass = 'ring-indigo-400/70',
  durationMs = 900,
  className,
}: FlashHighlightProps) {
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (flashKey === 0) return;
    setFlashing(true);
    const id = window.setTimeout(() => setFlashing(false), durationMs);
    return () => window.clearTimeout(id);
  }, [flashKey, durationMs]);

  return (
    <div
      className={cn(
        'rounded transition-shadow duration-300',
        flashing ? `ring-2 ring-offset-2 ring-offset-transparent ${ringClass}` : '',
        className,
      )}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export default FlashHighlight;
