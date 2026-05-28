'use client';

// Phase DA4 — Run-mode hotbar group.
//
// A 6-button cluster that mounts inline with the existing world hotbar.
// Each button launches a run-based gameplay mode that needs a dedicated
// entry point (no NPC, no building station). Clicking opens a small
// configure-and-start modal that POSTs to the relevant /api/{mode}/start
// endpoint.
//
// Modes: Roguelite (CB1), Horde (CB2), Extraction (CC8), Asymmetric
// Horror (CC6 — ghost OR investigator), Time Loop (CC5), Brawl
// matchmaker (CA7 alt path).

import { useCallback, useState } from 'react';
import { Dice5, Zap, Crosshair, Ghost, Hourglass, Swords, X } from 'lucide-react';

interface ModeConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  description: string;
  start: (worldId: string) => Promise<{ ok: boolean; error?: string; sessionId?: string }>;
}

const MODES: ModeConfig[] = [
  {
    id: 'roguelite',
    label: 'Roguelite',
    icon: Dice5,
    color: 'border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20',
    description: 'Enter a procgen region. Die or extract — meta-currency banks.',
    start: async (worldId) => {
      const r = await fetch('/api/roguelite/run/start', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId, regionId: `${worldId}-procgen` }),
      });
      return await r.json();
    },
  },
  {
    id: 'horde',
    label: 'Horde',
    icon: Zap,
    color: 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20',
    description: 'Bullet heaven. Auto-attack. Wave scaling. Pick 1 of 3 upgrades each wave.',
    start: async (worldId) => {
      const r = await fetch('/api/horde/start', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      return await r.json();
    },
  },
  {
    id: 'extraction',
    label: 'Extraction',
    icon: Crosshair,
    color: 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
    description: 'Tarkov-lite. Pickup loot. Reach the extract zone before timer.',
    start: async (worldId) => {
      const r = await fetch('/api/extraction/start', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      return await r.json();
    },
  },
  {
    id: 'horror-ghost',
    label: 'Horror (Ghost)',
    icon: Ghost,
    color: 'border-slate-500/40 bg-slate-500/10 text-slate-200 hover:bg-slate-500/20',
    description: 'Host an asymmetric horror session as the ghost. Win by downing investigators.',
    start: async (worldId) => {
      const r = await fetch('/api/horror/session/start', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      return await r.json();
    },
  },
  {
    id: 'time-loop',
    label: 'Time Loop',
    icon: Hourglass,
    color: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20',
    description: 'Enter a looped world. 22-min cycles. Memories survive.',
    start: async (worldId) => {
      const r = await fetch('/api/time-loop/start', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      return await r.json();
    },
  },
  {
    id: 'brawl',
    label: 'Brawl',
    icon: Swords,
    color: 'border-pink-500/40 bg-pink-500/10 text-pink-200 hover:bg-pink-500/20',
    description: 'Fist-only 1v1. Sifu profile. Wait for an opponent.',
    start: async () => {
      // Just open the open-invites query — the actual invite happens via NPC menu.
      const r = await fetch('/api/combat/brawl/invites', { credentials: 'include' });
      return await r.json();
    },
  },
];

interface Props {
  worldId: string;
}

export function GameModesHotbarGroup({ worldId }: Props) {
  const [confirm, setConfirm] = useState<ModeConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Listen for command-palette-driven mode starts (DA3).
  // The palette dispatches concordia:start-mode with { mode }.
  useState(() => {
    if (typeof window === 'undefined') return;
    function onPaletteStart(e: Event) {
      const detail = (e as CustomEvent<{ mode: string }>).detail;
      const m = MODES.find((x) => x.id === detail?.mode);
      if (m) setConfirm(m);
    }
    window.addEventListener('concordia:start-mode', onPaletteStart);
    return () => window.removeEventListener('concordia:start-mode', onPaletteStart);
  });

  const launch = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const result = await confirm.start(worldId);
      if (result?.ok) {
        setFlash(`Started: ${confirm.label}`);
      } else {
        setFlash(result?.error ? `Failed: ${result.error}` : 'Failed to start');
      }
      setTimeout(() => setFlash(null), 3000);
    } catch (e: unknown) {
      setFlash(`Failed: ${e instanceof Error ? e.message : 'network'}`);
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, worldId]);

  return (
    <>
      <div className="flex gap-1">
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => setConfirm(m)}
              title={`${m.label} — ${m.description}`}
              className={`rounded border px-2 py-1 text-[10px] transition ${m.color}`}
            >
              <Icon size={12} className="mb-0.5 inline" />
              <div className="text-[9px]">{m.label}</div>
            </button>
          );
        })}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur"
          onClick={(e) => { if (e.currentTarget === e.target) setConfirm(null); }}
        >
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
            <header className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <confirm.icon size={14} /> Start {confirm.label}?
              </h2>
              <button onClick={() => setConfirm(null)} aria-label="Close" className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
                <X size={12} />
              </button>
            </header>
            <p className="mb-3 text-[12px] text-zinc-300">{confirm.description}</p>
            <button
              onClick={launch}
              disabled={busy}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-[12px] font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
            >
              {busy ? 'Starting…' : `Start ${confirm.label}`}
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {flash && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-md border border-emerald-500/40 bg-zinc-950/95 px-3 py-1.5 text-xs text-emerald-200 shadow-lg backdrop-blur">
          {flash}
        </div>
      )}
    </>
  );
}
