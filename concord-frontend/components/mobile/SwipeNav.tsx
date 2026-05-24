'use client';

/**
 * SwipeNav — horizontal swipe-to-switch tab navigator for touch
 * devices. Drop-in for any multi-tab lens that wants thumb-friendly
 * navigation without losing keyboard / click parity.
 *
 * Phase 5 of the UX completeness sprint (mobile track).
 *
 * Contract:
 *   - Swipe left → next tab.
 *   - Swipe right → previous tab.
 *   - Threshold 60px (avoids accidental swipes during scroll).
 *   - Tab labels render across the top; click works on desktop.
 *   - Children must be a single-level array of <SwipeNavPanel>.
 */

import { useRef, useState, ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const SWIPE_THRESHOLD_PX = 60;

export interface SwipeNavPanelProps {
  label: string;
  children: React.ReactNode;
}

export function SwipeNavPanel(_: SwipeNavPanelProps) {
  // Sentinel — the SwipeNav reads the props from its children.
  return null;
}

export interface SwipeNavProps {
  /** Index of the initially active panel. */
  initialIndex?: number;
  /** Called whenever the active index changes. */
  onIndexChange?: (idx: number) => void;
  /** Show prev/next chevrons on desktop. Default true. */
  showChevrons?: boolean;
  children: ReactElement<SwipeNavPanelProps> | ReactElement<SwipeNavPanelProps>[];
  className?: string;
}

export function SwipeNav({ initialIndex = 0, onIndexChange, showChevrons = true, children, className }: SwipeNavProps) {
  const panels = (Array.isArray(children) ? children : [children]).filter(Boolean) as ReactElement<SwipeNavPanelProps>[];
  const [idx, setIdx] = useState(Math.min(Math.max(initialIndex, 0), panels.length - 1));
  const startXRef = useRef<number | null>(null);

  const goTo = (next: number) => {
    const bounded = Math.min(Math.max(next, 0), panels.length - 1);
    setIdx(bounded);
    onIndexChange?.(bounded);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - startXRef.current;
    startXRef.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (dx < 0) goTo(idx + 1);
    else goTo(idx - 1);
  };

  if (panels.length === 0) return null;

  const active = panels[idx];

  return (
    <div className={cn('flex flex-col', className)}>
      <header className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1.5 overflow-x-auto" role="tablist">
        {showChevrons && panels.length > 1 && (
          <button
            type="button"
            onClick={() => goTo(idx - 1)}
            disabled={idx === 0}
            className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 shrink-0"
            aria-label="Previous tab"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {panels.map((p, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === idx}
            onClick={() => goTo(i)}
            className={cn(
              'text-xs px-2 py-1 rounded whitespace-nowrap shrink-0 transition-colors',
              i === idx
                ? 'bg-zinc-800 text-zinc-100 font-medium'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60',
            )}
          >
            {p.props.label}
          </button>
        ))}
        {showChevrons && panels.length > 1 && (
          <button
            type="button"
            onClick={() => goTo(idx + 1)}
            disabled={idx === panels.length - 1}
            className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 shrink-0 ml-auto"
            aria-label="Next tab"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </header>
      <div
        className="flex-1 touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="tabpanel"
      >
        {active.props.children}
      </div>
    </div>
  );
}

export default SwipeNav;
