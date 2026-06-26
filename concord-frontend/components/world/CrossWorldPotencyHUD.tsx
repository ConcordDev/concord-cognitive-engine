'use client';

/**
 * CrossWorldPotencyHUD — top-right HUD chip showing how each of the
 * player's skills performs in the current world.
 *
 * Backed by the `cross_world_effectiveness.for_player` macro (Sprint 5).
 * The substrate has always read each world's meta.json `skill_affinity`
 * table; this HUD is the first surface that lets the player SEE it.
 *
 * Layout:
 *   Compact pill (always visible) — current world + strongest/weakest
 *   skill at-a-glance. Click expands to the full per-domain panel with
 *   one row per skill the player has: domain, level, multiplier as a
 *   percentage, and the dialogue-ready note ("cyber actively dampens
 *   magic" / "your skill level carries you partly").
 *
 * Polls every 30 s. Re-fetches on `concordia:activeWorldId` change.
 */

import { useEffect, useState, useCallback } from 'react';

interface PotencyRow {
  domain: string;
  level: number;
  multiplier: number;
  affinity: number;
  floor: number;
  dominant: 'level_floor' | 'world_affinity';
  note: string;
}

interface PotencyResponse {
  ok: boolean;
  worldId: string;
  worldKnown: boolean;
  worldDescription: string | null;
  rows: PotencyRow[];
  strongest: PotencyRow | null;
  weakest: PotencyRow | null;
}

function pctBadgeColor(mul: number): string {
  if (mul >= 0.9) return 'bg-emerald-500/85 text-emerald-50';
  if (mul >= 0.6) return 'bg-amber-500/80 text-amber-50';
  if (mul >= 0.3) return 'bg-orange-500/80 text-orange-50';
  return 'bg-red-500/85 text-red-50';
}

function pctLabel(mul: number): string {
  return `${Math.round(mul * 100)}%`;
}

export default function CrossWorldPotencyHUD() {
  const [data, setData] = useState<PotencyResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [worldId, setWorldId] = useState<string>('concordia-hub');

  const refresh = useCallback(async () => {
    try {
      const wid = typeof window !== 'undefined'
        ? localStorage.getItem('concordia:activeWorldId') || 'concordia-hub'
        : 'concordia-hub';
      setWorldId(wid);
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'cross_world_effectiveness',
          name: 'for_player',
          input: { worldId: wid },
        }),
      });
      if (!r.ok) return;
      const j = await r.json();
      if (j?.ok || j?.result?.ok) {
        const payload = j.result || j;
        setData(payload as PotencyResponse);
      }
    } catch { /* offline / unauth — silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'concordia:activeWorldId') refresh();
    };
    // Same-tab world travel: the `storage` event only fires in OTHER tabs, so
    // listen for the active tab's `concordia:active-world-changed` too (real
    // consumer of useWorldTravel's dispatch — previously it had none).
    const onWorldChanged = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('concordia:active-world-changed', onWorldChanged);
    return () => {
      clearInterval(id);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('concordia:active-world-changed', onWorldChanged);
    };
  }, [refresh]);

  if (!data || !data.worldKnown || !data.rows || data.rows.length === 0) {
    return null;
  }

  const strongest = data.strongest;
  const weakest = data.weakest;

  return (
    <div
      className="fixed top-4 right-4 z-40 select-none"
      data-testid="cross-world-potency-hud"
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/80 backdrop-blur ring-1 ring-zinc-700/60 shadow-lg text-xs font-medium text-zinc-100 hover:bg-zinc-800/90 transition-colors"
        title="Click to see how every skill of yours performs here"
      >
        <span className="text-zinc-400">⊕</span>
        <span className="text-zinc-200">{worldId}</span>
        {strongest && (
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${pctBadgeColor(strongest.multiplier)}`}>
            {strongest.domain} {pctLabel(strongest.multiplier)}
          </span>
        )}
        {weakest && weakest !== strongest && (
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${pctBadgeColor(weakest.multiplier)}`}>
            {weakest.domain} {pctLabel(weakest.multiplier)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 w-80 max-h-[60vh] overflow-y-auto rounded-xl bg-zinc-900/95 backdrop-blur ring-1 ring-zinc-700/60 shadow-2xl text-xs text-zinc-100">
          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="font-semibold text-zinc-100">Skill potency in {worldId}</div>
            {data.worldDescription && (
              <div className="mt-1 text-zinc-400 text-[11px] leading-snug">{data.worldDescription}</div>
            )}
          </div>
          <ul className="divide-y divide-zinc-800">
            {data.rows.map(row => (
              <li key={row.domain} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-200">{row.domain}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-zinc-400 text-[10px]">L{row.level}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${pctBadgeColor(row.multiplier)}`}>
                      {pctLabel(row.multiplier)}
                    </span>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-400 leading-snug">
                  {row.note}
                </div>
                <div className="mt-1.5 flex gap-2 text-[10px] text-zinc-400">
                  <span title="World skill_affinity from meta.json">affinity {Math.round(row.affinity * 100)}%</span>
                  <span title="Level floor: 0.10 + 0.40 × (level/maxLevel)">floor {Math.round(row.floor * 100)}%</span>
                  <span className={row.dominant === 'level_floor' ? 'text-emerald-400' : 'text-amber-400'}>
                    {row.dominant === 'level_floor' ? '🧠 level carries' : '🌍 world dictates'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
