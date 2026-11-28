'use client';

/**
 * LensBody, LensColumns, LensTabStrip — a lens body that holds at 390px.
 *
 * Built from the mobile root causes the November walk filed most:
 *   - grid children that keep their intrinsic width and push the page wider
 *     (grid-input-intrinsic-width-clip): every column and child here is min-w-0;
 *   - a floating button covering the last row (RCA-mobile-clip-fab): LensBody keeps
 *     room at the bottom for it, plus the safe-area inset;
 *   - a tab strip whose last tab looks clipped with no sign there is more
 *     (mobile-tab-strip-no-affordance): LensTabStrip scrolls, fades its edges only
 *     where there is more to see, and keeps the active tab in view;
 *   - a page wider than the screen: LensBody clips horizontal overflow at its root,
 *     but the check spec `noHorizontalScroll` still catches a child that overflows.
 * Keyboard: the tab strip is one Tab stop; arrows, Home and End move between tabs
 * (lib/a11y/roving-tabs — the same contract the app already uses).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { onRovingTabsKeyDown, rovingTabIndex } from '@/lib/a11y/roving-tabs';

export function LensBody({ children, fab = false, className, label }: { children: ReactNode; fab?: boolean; className?: string; label?: string }) {
  return (
    <div data-testid="lens-body" aria-label={label}
      className={cn('mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-4 pt-3 sm:px-6', fab ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]', className)}>
      {children}
    </div>
  );
}

const COLS: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' };
/** One column on a phone; `cols` from the md breakpoint up. Every child is min-w-0. */
export function LensColumns({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  return <div data-testid="lens-columns" className={cn('grid min-w-0 grid-cols-1 gap-3 [&>*]:min-w-0', COLS[cols], className)}>{children}</div>;
}

export interface LensTab { id: string; label: string; count?: ReactNode; disabled?: boolean }
export function LensTabStrip({ tabs, active, onSelect, label, className }: { tabs: LensTab[]; active: string; onSelect: (id: string) => void; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = ref.current; if (!el) return;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  };
  useEffect(() => {
    measure();
    const el = ref.current; if (!el) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [tabs.length]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [active]);
  const anyActive = tabs.some((t) => t.id === active);
  return (
    <div className={cn('relative min-w-0', className)} data-testid="lens-tabstrip">
      <div ref={ref} role="tablist" aria-label={label} onKeyDown={onRovingTabsKeyDown} onScroll={measure}
        className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto scroll-smooth">
        {tabs.map((t, i) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === active} disabled={t.disabled}
            tabIndex={rovingTabIndex(t.id === active, i, anyActive)} onClick={() => onSelect(t.id)}
            className={cn('shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
              t.id === active ? 'bg-[color:var(--lk-accent,#1d4ed8)] text-[color:var(--lk-on-accent,#fff)]' : 'text-[color:var(--lk-text,#171717)] hover:bg-[color:var(--lk-line,#e5e5e5)]', t.disabled && 'opacity-50')}>
            {t.label}{t.count !== undefined ? <span className="ml-1.5 tabular-nums opacity-80">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {edges.left ? <span aria-hidden data-testid="tabstrip-more-left" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[color:var(--lk-surface,#fff)] to-transparent" /> : null}
      {edges.right ? <span aria-hidden data-testid="tabstrip-more-right" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[color:var(--lk-surface,#fff)] to-transparent" /> : null}
    </div>
  );
}
