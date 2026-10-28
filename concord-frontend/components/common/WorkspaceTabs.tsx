'use client';

/**
 * WorkspaceTabs — the one tab strip every workspace header uses (core lenses
 * and destinations alike). Linear-style: quiet text tabs, the active tab is a
 * subtle filled pill, no per-lens accent colors and no underline rule — the
 * header row's own bottom border is the only line.
 *
 * Progressive disclosure (Product Chat review S7): a caller may pass
 * `maxVisible` to cap the strip — the remaining tabs live behind a
 * "More" menu instead of a 9-item wall. The ACTIVE tab is always in
 * the visible set (swapped in), and with a `storageKey` the last
 * overflow tab the user visited is promoted into the strip and
 * remembered per user. Callers that pass neither prop render exactly
 * as before.
 */

import Link from 'next/link';
import { useEffect, useState, type ComponentType } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WorkspaceTab {
  id: string;
  label: string;
  path: string;
  icon?: ComponentType<{ className?: string }>;
}

export function splitTabs(
  tabs: WorkspaceTab[],
  activePath: string,
  maxVisible?: number,
  promotedId?: string | null,
): { visible: WorkspaceTab[]; overflow: WorkspaceTab[] } {
  if (!maxVisible || tabs.length <= maxVisible) return { visible: tabs, overflow: [] };
  const visible = tabs.slice(0, maxVisible);
  const overflow = tabs.slice(maxVisible);
  const swapIn = (tab: WorkspaceTab | undefined, protect: (t: WorkspaceTab) => boolean) => {
    if (!tab || visible.some((t) => t.id === tab.id)) return;
    // Evict the last visible tab that isn't protected (never the
    // first tab — the core lens itself — and never a protected one).
    let evictIdx = -1;
    for (let i = visible.length - 1; i >= 1; i--) {
      if (!protect(visible[i])) { evictIdx = i; break; }
    }
    if (evictIdx === -1) return;
    const [evicted] = visible.splice(evictIdx, 1);
    overflow.push(evicted);
    const oi = overflow.findIndex((t) => t.id === tab.id);
    if (oi >= 0) overflow.splice(oi, 1);
    visible.push(tab);
  };
  const active = overflow.find((t) => t.path === activePath);
  swapIn(active, () => false);
  if (promotedId && promotedId !== active?.id) {
    swapIn(overflow.find((t) => t.id === promotedId), (t) => t.path === activePath);
  }
  return { visible, overflow };
}

export function WorkspaceTabs({
  tabs,
  activePath,
  label,
  maxVisible,
  storageKey,
}: {
  tabs: WorkspaceTab[];
  activePath: string;
  label: string;
  maxVisible?: number;
  storageKey?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [promotedId, setPromotedId] = useState<string | null>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      setPromotedId(window.localStorage.getItem(storageKey));
    } catch { /* storage unavailable */ }
  }, [storageKey]);

  const { visible, overflow } = splitTabs(tabs, activePath, maxVisible, promotedId);

  const remember = (tab: WorkspaceTab) => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, tab.id);
    } catch { /* storage unavailable */ }
    setPromotedId(tab.id);
  };

  const renderTab = (tab: WorkspaceTab, onNavigate?: () => void) => {
    const isActive = activePath === tab.path;
    return (
      <Link
        key={tab.id}
        href={tab.path}
        onClick={onNavigate}
        className={cn(
          'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors',
          isActive
            ? 'bg-white/[0.09] text-zinc-50'
            : 'text-zinc-500 hover:text-zinc-200',
        )}
        aria-current={isActive ? 'page' : undefined}
      >
        {tab.label}
      </Link>
    );
  };

  return (
    <div
      className="relative inline-flex max-w-full min-w-0"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setMoreOpen(false);
      }}
    >
      <nav
        className="inline-flex max-w-full min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar rounded-xl border border-white/[0.08] bg-white/[0.02] p-1"
        aria-label={label}
      >
        {visible.map((tab) => renderTab(tab))}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-3 text-[13px] text-zinc-500 transition-colors hover:text-zinc-200"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={`More ${label} tabs`}
          >
            More
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </nav>
      {moreOpen && overflow.length > 0 && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="absolute right-0 top-full z-50 mt-2 min-w-44 rounded-xl border border-white/10 bg-[#1c1c1c] p-1 shadow-xl"
            role="menu"
            aria-label={`More ${label} tabs`}
          >
            {overflow.map((tab) => renderTab(tab, () => { remember(tab); setMoreOpen(false); }))}
          </div>
        </>
      )}
    </div>
  );
}

export default WorkspaceTabs;
