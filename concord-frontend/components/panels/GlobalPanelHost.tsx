'use client';

// concord-frontend/components/panels/GlobalPanelHost.tsx
//
// The ad-hoc half of cross-mounting: summon ANY registered panel as a modal over
// whatever lens you're on. Mounted once globally in app/lenses/layout.tsx (beside
// ConKayOverlay — the proven global mount point). Listens for the `concord:panel-open`
// CustomEvent (see lib/panel-dispatcher.ts), lazy-loads the panel's component, and
// renders it in a dialog. One panel at a time; Esc / backdrop / ✕ closes.
//
// Standalone by design — unlike the world HUD's PanelHost it does NOT depend on
// HUDContextProvider, so it is safe to mount on every lens.

import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType } from 'react';
import { getPanelById } from '@/lib/panel-registry';
import { PANEL_OPEN_EVENT, PANEL_CLOSE_EVENT } from '@/lib/panel-dispatcher';

export function GlobalPanelHost() {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { panelId?: string } | undefined;
      if (detail?.panelId && getPanelById(detail.panelId)) setActiveId(detail.panelId);
    }
    function onClose() { setActiveId(null); }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setActiveId(null);
    }
    window.addEventListener(PANEL_OPEN_EVENT, onOpen);
    window.addEventListener(PANEL_CLOSE_EVENT, onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(PANEL_OPEN_EVENT, onOpen);
      window.removeEventListener(PANEL_CLOSE_EVENT, onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const entry = activeId ? getPanelById(activeId) : undefined;

  // Lazy component for the active panel — code-split, fetched only on open.
  const LazyPanel = useMemo<ComponentType<Record<string, unknown>> | null>(
    () => (entry ? (lazy(entry.load) as unknown as ComponentType<Record<string, unknown>>) : null),
    [entry],
  );

  if (!entry || !LazyPanel) return null;

  return (
    <div
      className="fixed inset-0 z-[58] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={entry.label}
      data-testid="global-panel-host"
      data-panel-id={entry.id}
      onClick={(e) => { if (e.target === e.currentTarget) setActiveId(null); }}
    >
      <div className="w-[32rem] max-w-[92vw] max-h-[82vh] bg-zinc-950 border border-zinc-700/60 rounded-lg shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-zinc-100 truncate">{entry.label}</h2>
            <p className="text-[10px] text-zinc-400 truncate">{entry.id} · cross-lens panel</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveId(null)}
            aria-label="Close panel"
            className="text-xs text-zinc-400 hover:text-zinc-200 shrink-0"
          >✕ Esc</button>
        </header>
        <div className="flex-1 overflow-auto p-3">
          <Suspense fallback={<div className="p-6 text-sm text-zinc-400">Loading {entry.label}…</div>}>
            {/* Self-contained panels ignore extra props; onChange is a no-op signal. */}
            <LazyPanel onChange={() => { /* no-op: panel owns its own state */ }} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default GlobalPanelHost;
