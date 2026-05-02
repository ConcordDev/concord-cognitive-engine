'use client';

/**
 * Quest Discovery — diegetic surface for active quests, ambient events,
 * and nearby points of interest. The audit flagged "no discovery surface"
 * as a key World-life gap; this component is that surface.
 *
 * Three lanes:
 *   active     — quests the player has accepted (compact tracker)
 *   nearby     — quests/events within proximity radius the player can pick up
 *   recent     — last 3 things that happened (kill, drop, level-up, hybrid born)
 *
 * Mounts as a slide-out tab on the right side, dismissible. Listens for:
 *   'concordia:quest:active'    — list of accepted quests
 *   'concordia:quest:nearby'    — list of nearby quest givers / events
 *   'concordia:event:notable'   — one-shot ambient notification
 *
 * The component does NOT fetch on its own — render-only. Producers
 * dispatch the events; this lets the world page own quest state.
 */

import { useEffect, useRef, useState } from 'react';

interface ActiveQuest {
  id:        string;
  title:     string;
  giver:     string;
  step:      number;
  totalSteps: number;
  reward?:   { xp?: number; sparks?: number };
}

interface NearbyQuest {
  id:           string;
  title:        string;
  giverName:    string;
  giverNpcId?:  string;
  distanceM:    number;
  kind:         'quest' | 'event' | 'crisis';
}

interface NotableEvent {
  id:    string;
  title: string;
  kind:  'kill' | 'drop' | 'level' | 'hybrid' | 'discovery' | 'craft';
  ts:    number;
}

const KIND_COLORS: Record<NotableEvent['kind'], string> = {
  kill:      '#ef4444',
  drop:      '#facc15',
  level:     '#a855f7',
  hybrid:    '#06b6d4',
  discovery: '#22d3ee',
  craft:     '#10b981',
};

export function QuestDiscovery() {
  const [open,   setOpen]   = useState(false);
  const [active, setActive] = useState<ActiveQuest[]>([]);
  const [nearby, setNearby] = useState<NearbyQuest[]>([]);
  const [recent, setRecent] = useState<NotableEvent[]>([]);
  const recentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onActive = (e: Event) => {
      const list = (e as CustomEvent<ActiveQuest[]>).detail;
      if (Array.isArray(list)) setActive(list);
    };
    const onNearby = (e: Event) => {
      const list = (e as CustomEvent<NearbyQuest[]>).detail;
      if (Array.isArray(list)) setNearby(list);
    };
    const onNotable = (e: Event) => {
      const ev = (e as CustomEvent<NotableEvent>).detail;
      if (!ev?.id) return;
      setRecent((prev) => [ev, ...prev].slice(0, 5));
      // Auto-purge after 30s so the lane doesn't accumulate forever
      if (recentTimer.current) clearTimeout(recentTimer.current);
      recentTimer.current = setTimeout(() => {
        setRecent((prev) => prev.filter((p) => Date.now() - p.ts < 30_000));
      }, 30_000);
    };
    window.addEventListener('concordia:quest:active', onActive);
    window.addEventListener('concordia:quest:nearby', onNearby);
    window.addEventListener('concordia:event:notable', onNotable);
    return () => {
      window.removeEventListener('concordia:quest:active', onActive);
      window.removeEventListener('concordia:quest:nearby', onNearby);
      window.removeEventListener('concordia:event:notable', onNotable);
      if (recentTimer.current) clearTimeout(recentTimer.current);
    };
  }, []);

  // Toggle key: J
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'j' || e.key === 'J') setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* Always-visible tab handle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-0 top-1/3 z-40 flex items-center gap-1 rounded-l-md border border-r-0 border-amber-400/40 bg-slate-900/80 px-2 py-1.5 text-[10px] uppercase tracking-wider text-amber-300 backdrop-blur-md hover:bg-slate-800/80"
        aria-label="Quest discovery"
      >
        <span>Quests</span>
        {(active.length + nearby.length) > 0 && (
          <span className="rounded-full bg-amber-400 px-1 py-0.5 text-[9px] font-bold text-slate-900">
            {active.length + nearby.length}
          </span>
        )}
      </button>

      {open && (
        <aside
          className="fixed right-0 top-0 z-40 h-full w-80 overflow-y-auto border-l border-amber-400/30 bg-slate-950/95 p-3 backdrop-blur-md"
          aria-label="Quest tracker"
        >
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-200">Quests &amp; Events</h2>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <section className="mb-4">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-amber-400">Active</p>
            {active.length === 0 ? (
              <p className="rounded border border-slate-800 bg-slate-900/40 p-2 text-center text-xs text-slate-500">
                No active quests. Press J to toggle this panel.
              </p>
            ) : (
              <div className="space-y-1">
                {active.map((q) => (
                  <div key={q.id} className="rounded border border-amber-400/40 bg-slate-900/50 p-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-xs font-semibold text-amber-100">{q.title}</h3>
                      <span className="text-[10px] text-amber-300">
                        {q.step + 1} / {q.totalSteps}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">from {q.giver}</p>
                    {q.reward && (
                      <p className="mt-1 text-[10px] text-emerald-300">
                        Reward: {q.reward.sparks ? `${q.reward.sparks} sparks` : ''}
                        {q.reward.xp ? ` · ${q.reward.xp} xp` : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-4">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-cyan-400">Nearby</p>
            {nearby.length === 0 ? (
              <p className="rounded border border-slate-800 bg-slate-900/40 p-2 text-center text-xs text-slate-500">
                Nothing within 100m. Walk around.
              </p>
            ) : (
              <div className="space-y-1">
                {nearby.map((q) => (
                  <div key={q.id} className={`rounded border p-2 ${q.kind === 'crisis' ? 'border-rose-400/50 bg-rose-950/30' : q.kind === 'event' ? 'border-cyan-400/40 bg-cyan-950/30' : 'border-slate-700 bg-slate-900/40'}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-100">{q.title}</h3>
                      <span className="text-[10px] text-slate-400">
                        {Math.round(q.distanceM)}m
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">{q.giverName}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">Recent</p>
            {recent.length === 0 ? (
              <p className="rounded border border-slate-800 bg-slate-900/40 p-2 text-center text-xs text-slate-500">
                Nothing notable yet.
              </p>
            ) : (
              <div className="space-y-1">
                {recent.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 p-1.5"
                  >
                    <div className="h-2 w-2 rounded-full" style={{ background: KIND_COLORS[ev.kind] }} />
                    <span className="text-[11px] text-slate-200">{ev.title}</span>
                    <span className="ml-auto text-[9px] text-slate-500">
                      {Math.max(0, Math.floor((Date.now() - ev.ts) / 1000))}s ago
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      )}
    </>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

export function setActiveQuests(list: ActiveQuest[]): void {
  try { window.dispatchEvent(new CustomEvent('concordia:quest:active', { detail: list })); } catch { /* SSR */ }
}
export function setNearbyQuests(list: NearbyQuest[]): void {
  try { window.dispatchEvent(new CustomEvent('concordia:quest:nearby', { detail: list })); } catch { /* SSR */ }
}
export function emitNotableEvent(ev: NotableEvent): void {
  try { window.dispatchEvent(new CustomEvent('concordia:event:notable', { detail: ev })); } catch { /* SSR */ }
}
