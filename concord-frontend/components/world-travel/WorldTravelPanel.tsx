'use client';

/**
 * WorldTravelPanel — portal selector for cross-world travel.
 *
 * Renders a slide-in panel from the left edge with:
 *   - The user's current world (highlighted)
 *   - Every registered world from /api/world-travel/worlds
 *   - One-click travel via POST /api/world-travel/travel
 *   - Skill-affinity readout per world (helps the player decide)
 *
 * Toggled via the `concordia:world-travel-toggle` window event so a HUD
 * key bind can pop it. Travel is FREE — sparks are only spent on the
 * Concord Link, not on world travel itself.
 */

import { useCallback, useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

interface WorldRow {
  world_id: string;
  name: string;
  description: string | null;
  tagline: string | null;
  is_hub: boolean;
  skill_affinity: Record<string, number> | null;
}

const TOP_AFFINITIES = (affinity: Record<string, number> | null, n = 3): Array<[string, number]> => {
  if (!affinity) return [];
  return Object.entries(affinity)
    .filter(([k]) => k !== 'default')
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
};

export function WorldTravelPanel({ myUserId: _myUserId }: { myUserId: string }) {
  const [open, setOpen] = useState(false);
  const [worlds, setWorlds] = useState<WorldRow[]>([]);
  const [currentWorld, setCurrentWorld] = useState('concordia');
  const [traveling, setTraveling] = useState<string | null>(null);

  // Toggle via window event
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    window.addEventListener('concordia:world-travel-toggle', onToggle);
    return () => window.removeEventListener('concordia:world-travel-toggle', onToggle);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [meRes, worldsRes] = await Promise.all([
        fetch('/api/world-travel/me', { credentials: 'same-origin' }),
        fetch('/api/world-travel/worlds'),
      ]);
      if (meRes.ok) {
        const json = await meRes.json();
        if (json?.currentWorld) setCurrentWorld(json.currentWorld);
      }
      if (worldsRes.ok) {
        const json = await worldsRes.json();
        if (Array.isArray(json?.worlds)) setWorlds(json.worlds);
      }
    } catch { /* network errors silent */ }
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  // Realtime: world:traveled (someone else might trigger this; refresh)
  useEffect(() => {
    const off = subscribe<{ fromWorld: string; toWorld: string }>('world:traveled', (msg) => {
      setCurrentWorld(msg.toWorld);
    });
    return off;
  }, []);

  const travel = useCallback(async (toWorld: string) => {
    if (toWorld === currentWorld) return;
    setTraveling(toWorld);
    try {
      const res = await fetch('/api/world-travel/travel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toWorld }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        useUIStore.getState().addToast({
          type: 'error',
          message: json.reason || json.error || 'Travel failed.',
          duration: 5000,
        });
        return;
      }
      setCurrentWorld(toWorld);
      try {
        useUIStore.getState().addToast({
          type: 'success',
          message: `Traveled to ${toWorld}`,
          duration: 4000,
        });
      } catch { /* toast best-effort */ }
      try {
        window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
          detail: { action: 'triggerSFX', sfxId: 'fanfare-short' },
        }));
      } catch { /* sfx best-effort */ }
    } catch (e: unknown) {
      useUIStore.getState().addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'Network error.',
        duration: 5000,
      });
    } finally {
      setTraveling(null);
    }
  }, [currentWorld]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-purple-500/50 bg-slate-900/80 px-3 py-1.5 text-xs text-purple-200 backdrop-blur-sm hover:bg-slate-800/80"
        aria-label="Open World Travel"
      >
        Worlds · <span className="text-purple-100">{currentWorld}</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-y-0 left-0 z-40 flex w-full max-w-md flex-col border-r border-purple-500/30 bg-slate-950/95 backdrop-blur-md">
      <header className="flex items-center justify-between border-b border-purple-500/20 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-purple-100">World Travel</h2>
          <p className="text-[10px] uppercase tracking-wider text-purple-400/80">
            currently in {currentWorld}
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {worlds.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">No worlds registered.</p>
        ) : worlds.map((w) => {
          const isCurrent = w.world_id === currentWorld;
          const isTraveling = traveling === w.world_id;
          const top = TOP_AFFINITIES(w.skill_affinity);
          return (
            <button
              key={w.world_id}
              onClick={() => travel(w.world_id)}
              disabled={isCurrent || isTraveling}
              className={`block w-full rounded border p-3 text-left transition-colors ${
                isCurrent
                  ? 'border-purple-400 bg-purple-950/40 text-purple-100 cursor-default'
                  : 'border-slate-800 bg-slate-900/40 text-slate-200 hover:border-purple-500/60 hover:bg-purple-950/20'
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {w.name}
                  {w.is_hub && <span className="ml-2 text-[10px] uppercase tracking-wider text-purple-300">hub</span>}
                </h3>
                {isCurrent ? (
                  <span className="text-[10px] uppercase tracking-wider text-purple-300">here</span>
                ) : isTraveling ? (
                  <span className="text-[10px] text-purple-400">traveling…</span>
                ) : null}
              </div>
              {w.tagline && (
                <p className="mb-1 text-[11px] italic text-slate-400">{w.tagline}</p>
              )}
              {w.description && (
                <p className="mb-2 text-[11px] text-slate-300">{w.description}</p>
              )}
              {top.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {top.map(([domain, mult]) => (
                    <span
                      key={domain}
                      className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
                        mult >= 0.9 ? 'bg-emerald-900/60 text-emerald-200'
                        : mult >= 0.5 ? 'bg-amber-900/60 text-amber-200'
                        : 'bg-rose-900/60 text-rose-200'
                      }`}
                    >
                      {domain.replace(/_/g, ' ')} ×{mult.toFixed(2)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
        <p className="px-1 pt-3 text-center text-[10px] text-slate-400">
          Travel between worlds is free. The Concord Link costs sparks for cross-world messages.
        </p>
      </div>
    </div>
  );
}
