'use client';

/**
 * FactionWarBanner — top-center banner that surfaces active faction wars
 * happening in the world. Subscribes to the realtime tick + kill events
 * so players see "the world is alive" even when they're not joining one.
 *
 * Click → opens a list of active wars + tally + a Join Side button.
 *
 * Refresh strategy:
 *   - On mount: GET /api/faction-war/active
 *   - On every faction-war:tick event: update tally for that war id
 *   - On every faction-war:kill event: increment alive counter
 *   - On every faction-war:end event: remove the war from the list
 *
 * Empty state: nothing renders. The component is a no-op when there are
 * no active wars, so it doesn't claim screen real estate.
 */

import { useEffect, useState, useCallback } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface War {
  id: string;
  side_a: string;
  side_b: string;
  side_a_wins: number;
  side_b_wins: number;
  status: string;
}

export default function FactionWarBanner() {
  const [wars, setWars] = useState<War[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    fetch('/api/faction-war/active', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setWars(j.wars ?? []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Realtime updates — much cheaper than re-polling
  useEffect(() => {
    const offTick = subscribe<{ warId: string; tally: { side_a_wins: number; side_b_wins: number } }>(
      'faction-war:tick',
      (msg) => {
        if (!msg?.tally) return;
        setWars((prev) => prev.map((w) =>
          w.id === msg.warId
            ? { ...w, side_a_wins: msg.tally.side_a_wins, side_b_wins: msg.tally.side_b_wins }
            : w
        ));
      },
    );
    const offEnd = subscribe<{ warId: string }>(
      'faction-war:end',
      (msg) => { setWars((prev) => prev.filter((w) => w.id !== msg.warId)); },
    );
    return () => { offTick(); offEnd(); };
  }, []);

  if (wars.length === 0) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 bg-rose-950/85 border border-rose-500/50 rounded-md backdrop-blur-md hover:bg-rose-900/90 transition-colors"
        style={{ boxShadow: '0 0 16px rgba(244,63,94,0.25)' }}
      >
        <span className="inline-block w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest text-rose-300 font-semibold">
          {wars.length === 1 ? 'Faction War Active' : `${wars.length} Faction Wars`}
        </span>
      </button>

      {open && (
        <div className="mt-2 bg-slate-950/95 border border-rose-500/40 rounded-lg p-3 backdrop-blur-md min-w-[320px] shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-rose-300 font-semibold">
              Active Wars
            </span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-xs">×</button>
          </div>
          <div className="space-y-2">
            {wars.map((w) => (
              <div key={w.id} className="px-2 py-1.5 bg-slate-900/70 rounded">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-amber-300 font-mono">{w.side_a.replace(/_/g, ' ')}</span>
                  <span className="text-white font-bold font-mono">
                    {w.side_a_wins} : {w.side_b_wins}
                  </span>
                  <span className="text-cyan-300 font-mono">{w.side_b.replace(/_/g, ' ')}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-slate-500 italic">
            NPCs co-evolve in the background. Combat actions you take while
            nearby contribute to your side's collective intelligence.
          </div>
        </div>
      )}
    </div>
  );
}
