'use client';

// Wave 4 gap-closure — Status Window HUD (Foundry Phase-7 "isekai-style"
// status panel, docs/lens-specs/foundry-capability-map.md "Honest residual").
//
// server/lib/foundry/status-window.js#composeStatusWindow + the
// status.window / status.award_title / status.titles macros
// (server/domains/foundry-systems.js) were real and tested but had zero
// frontend caller. This HUD is that caller.
//
// Config-gated: useFoundrySystemGate('status-window') reads the current
// world's real rule_modulators.foundry.systems (written at Foundry publish
// time by compiler.js from the worldspec's selected systems) — this HUD
// renders nothing at all for a world whose worldspec never selected
// status-window, and never fabricates a status panel for it.
//
// Honest scope note: `composeStatusWindow`'s `sources` param (stats/skills/
// effects/inventoryCount) is caller-supplied so the lib stays decoupled from
// schema drift (see the lib's own header comment). This HUD does not yet
// thread real live combat/skill state into `sources` — that plumbing lives
// in a dozen different local-state slices inside app/lenses/world/page.tsx
// and wiring it is a larger follow-up. What IS fully real end-to-end here:
// the world-adaptive `style`, and the titles list (status.award_title /
// status.titles / status.window all round-trip through the real
// `player_titles` table). No stat is ever invented to fill the panel.

import { useCallback, useEffect, useState } from 'react';
import { ScrollText, X, Crown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useFoundrySystemGate } from './useFoundrySystemGate';

interface StatusWindow {
  style: 'classic-rpg' | 'minimal' | 'ornate' | 'sci-fi-hud';
  titles: string[];
  activeTitle: string | null;
  stats: Record<string, unknown>;
  skills: Array<{ id: string; level: number }>;
  effects: unknown[];
  inventoryCount: number;
  hiddenStats?: Record<string, unknown>;
}

// One class bundle per configured style — the four options a Foundry
// worldspec's status-window system exposes (system-registry.js configSchema).
const STYLE_CLASSES: Record<StatusWindow['style'], { panel: string; header: string; accent: string; label: string }> = {
  'classic-rpg': {
    panel: 'border-amber-600/50 bg-gradient-to-b from-amber-950/95 to-zinc-950/95',
    header: 'text-amber-300',
    accent: 'text-amber-200',
    label: 'Status',
  },
  minimal: {
    panel: 'border-zinc-700 bg-zinc-950/95',
    header: 'text-zinc-300',
    accent: 'text-zinc-200',
    label: 'Status',
  },
  ornate: {
    panel: 'border-yellow-500/60 bg-gradient-to-b from-purple-950/95 to-zinc-950/95 shadow-[0_0_20px_rgba(234,179,8,0.15)]',
    header: 'text-yellow-300',
    accent: 'text-yellow-100',
    label: 'The Status Window',
  },
  'sci-fi-hud': {
    panel: 'border-cyan-500/60 bg-zinc-950/95 shadow-[0_0_16px_rgba(34,211,238,0.2)] font-mono',
    header: 'text-cyan-300',
    accent: 'text-cyan-100',
    label: 'STATUS.WND',
  },
};

interface Props {
  worldId: string;
}

export function StatusWindowHUD({ worldId }: Props) {
  const gate = useFoundrySystemGate(worldId, 'status-window');
  const [open, setOpen] = useState(false);
  const [win, setWin] = useState<StatusWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!gate.enabled || !worldId) return;
    try {
      const r = await lensRun<{ window: StatusWindow }>('status', 'window', { worldId });
      if (r.data?.ok && r.data.result?.window) {
        setWin(r.data.result.window);
        setError(null);
      } else {
        setError(r.data?.error || 'Could not load status window');
      }
    } catch {
      setError('Could not load status window');
    }
  }, [gate.enabled, worldId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Discoverable via the command palette, matching the concordia:open-*
  // dispatch idiom other palette-launched HUDs (e.g. DungeonHUD) use.
  useEffect(() => {
    function onOpen() { setOpen(true); }
    window.addEventListener('concordia:open-status-window', onOpen);
    return () => window.removeEventListener('concordia:open-status-window', onOpen);
  }, []);

  // Honest gate: nothing renders — not even the launcher button — for a
  // world whose worldspec never selected status-window.
  if (!gate.loaded || !gate.enabled) return null;

  const styleClasses = STYLE_CLASSES[win?.style ?? 'classic-rpg'];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Status window"
        className="pointer-events-auto fixed bottom-52 right-4 z-20 rounded-lg border border-amber-500/30 bg-black/70 px-2 py-1.5 text-center text-[10px] text-amber-200 backdrop-blur-sm hover:bg-amber-500/10"
      >
        <ScrollText size={12} className="mb-0.5 inline" />
        <div>Status</div>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur"
          onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        >
          <div className={`w-full max-w-sm rounded-xl border p-4 shadow-2xl ${styleClasses.panel}`}>
            <header className={`mb-3 flex items-center justify-between border-b border-white/10 pb-2 ${styleClasses.header}`}>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ScrollText size={14} /> {styleClasses.label}
              </h2>
              <button aria-label="Close" onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-white/10">
                <X size={12} />
              </button>
            </header>

            {error && <p className="mb-2 text-[11px] text-rose-300">{error}</p>}

            {!win && !error && (
              <p className="py-4 text-center text-[12px] text-zinc-500">Loading…</p>
            )}

            {win && (
              <div className="space-y-3">
                {win.activeTitle && (
                  <div className={`flex items-center gap-1.5 text-sm ${styleClasses.accent}`}>
                    <Crown size={13} />
                    {win.activeTitle}
                  </div>
                )}

                {Object.keys(win.stats).length > 0 ? (
                  <ul className="space-y-1">
                    {Object.entries(win.stats).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between text-[11px] text-zinc-300">
                        <span className="capitalize">{k}</span>
                        <span className={styleClasses.accent}>{String(v)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-zinc-500">No live stat feed wired to this panel yet.</p>
                )}

                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                    Titles ({win.titles.length})
                  </div>
                  {win.titles.length === 0 ? (
                    <p className="text-[11px] text-zinc-500">No titles earned yet.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
                      {win.titles.map((t) => (
                        <li
                          key={t}
                          className={`rounded border border-white/10 px-1.5 py-0.5 text-[10px] ${
                            t === win.activeTitle ? styleClasses.accent : 'text-zinc-400'
                          }`}
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default StatusWindowHUD;
