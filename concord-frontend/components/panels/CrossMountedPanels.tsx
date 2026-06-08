'use client';

// concord-frontend/components/panels/CrossMountedPanels.tsx
//
// The curated half of cross-mounting: render the panels the affinity map says
// genuinely deepen THIS destination, as a collapsible tab strip at the foot of
// the lens. Mounted once from app/lenses/layout.tsx keyed by the current lens
// slug, so it appears only on destinations that have a curated affinity list
// (finance / healthcare / code today) — no per-page surgery, and it extends to
// any future destination just by editing lib/panel-affinity.ts.
//
// Each panel is the SAME self-contained component authored in its home lens,
// lazy-loaded and rendered as-is (it fetches its own data via lensRun). Nothing
// new is built — this is pure recombination.

import { Suspense, lazy, useMemo, useState, type ComponentType } from 'react';
import { ChevronDown, ChevronUp, LayoutPanelLeft } from 'lucide-react';
import { panelsForDestination } from '@/lib/panel-affinity';
import { getPanelById } from '@/lib/panel-registry';

export function CrossMountedPanels({ destination }: { destination: string }) {
  const panelIds = useMemo(
    () => panelsForDestination(destination).filter((id) => getPanelById(id)),
    [destination],
  );
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Default the active tab to the first curated panel once opened.
  const currentId = activeId ?? panelIds[0] ?? null;
  const entry = currentId ? getPanelById(currentId) : undefined;
  const LazyPanel = useMemo<ComponentType<Record<string, unknown>> | null>(
    () => (entry ? (lazy(entry.load) as unknown as ComponentType<Record<string, unknown>>) : null),
    [entry],
  );

  if (panelIds.length === 0) return null;

  return (
    <section
      className="border-t border-zinc-800/80 bg-zinc-950/40"
      data-testid="cross-mounted-panels"
      data-destination={destination}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-semibold text-zinc-300 hover:text-zinc-100"
        aria-expanded={open}
      >
        <LayoutPanelLeft className="h-3.5 w-3.5 text-cyan-400/80" />
        Cross-lens panels
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{panelIds.length}</span>
        {open ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronUp className="ml-auto h-4 w-4" />}
      </button>

      {open && (
        <div className="px-3 pb-3">
          {/* tab strip */}
          <div className="mb-2 flex flex-wrap gap-1">
            {panelIds.map((id) => {
              const p = getPanelById(id)!;
              const active = id === currentId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveId(id)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? 'bg-cyan-500/15 text-cyan-100 border border-cyan-400/30'
                      : 'text-zinc-400 hover:bg-zinc-800/60 border border-transparent'
                  }`}
                  title={p.description}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {/* active panel — lazy, self-fetching */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
            {entry && LazyPanel ? (
              <Suspense fallback={<div className="p-4 text-sm text-zinc-400">Loading {entry.label}…</div>}>
                <LazyPanel onChange={() => { /* no-op: panel owns its own state */ }} />
              </Suspense>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

export default CrossMountedPanels;
