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

import { Suspense, lazy, useCallback, useMemo, useState, type ComponentType } from 'react';
import { X } from 'lucide-react';
import { useLensTool } from '@/lib/lens-dock';
import { panelsForDestination } from '@/lib/panel-affinity';
import { getPanelById } from '@/lib/panel-registry';

export function CrossMountedPanels({ destination }: { destination: string }) {
  const panelIds = useMemo(
    () => panelsForDestination(destination).filter((id) => getPanelById(id)),
    [destination],
  );
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Opened from the lens header toolbar ("Panels"); only registers when this
  // destination actually has curated panels.
  useLensTool('panels', useCallback(() => setOpen((o) => !o), []), panelIds.length > 0);

  // Default the active tab to the first curated panel once opened.
  const currentId = activeId ?? panelIds[0] ?? null;
  const entry = currentId ? getPanelById(currentId) : undefined;
  const LazyPanel = useMemo<ComponentType<Record<string, unknown>> | null>(
    () => (entry ? (lazy(entry.load) as unknown as ComponentType<Record<string, unknown>>) : null),
    [entry],
  );

  if (panelIds.length === 0 || !open) return null;

  return (
    <section
      className="border-t border-zinc-800/80 bg-zinc-950/40"
      data-testid="cross-mounted-panels"
      data-destination={destination}
    >
      {open && (
        <div className="px-3 pb-3 pt-2">
          {/* tab strip */}
          <div className="mb-2 flex flex-wrap items-center gap-1">
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto rounded-md p-1 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200"
              aria-label="Close cross-lens panels"
            >
              <X className="h-3.5 w-3.5" />
            </button>
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
