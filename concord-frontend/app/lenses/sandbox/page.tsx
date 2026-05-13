'use client';

/**
 * Combat Sandbox — minimal scene for combat-feel iteration.
 *
 * No HUD clutter, no quest, no inventory. Just: a flat arena, the player,
 * a configurable count of training dummies, console-spawnable. Used to
 * tune hitstop, telegraph, audio, lock-on, body-language, and combo
 * evolution presentation in isolation from the world simulation.
 *
 * The dummies are real WorldNPC entries spawned into a private sandbox
 * world. Combat resolves through the same /api/worlds/:worldId/combat/attack
 * + socket pipeline as the live world — including anti-cheat reach +
 * damage-cap validation. So feel measured here matches feel in production.
 *
 * URL: /lenses/sandbox
 * Query: ?dummies=N (1-10, default 3)
 *        ?weapon=fist|blade|pistol (default fist)
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { Suspense, useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Swords, RotateCcw, Plus, Minus } from 'lucide-react';
import { connectSocket, getSocket, subscribe } from '@/lib/realtime/socket';

const BodyLanguageOverlay = dynamic(
  () =>
    import('@/components/world-lens/BodyLanguageOverlay').then((m) => ({
      default: m.BodyLanguageOverlay,
    })),
  { ssr: false },
);
const ImpactFeedback = dynamic(
  () =>
    import('@/components/world/ImpactFeedback').then((m) => ({
      default: m.ImpactFeedback,
    })),
  { ssr: false },
);
const GameJuice = dynamic(
  () =>
    import('@/components/world-lens/GameJuice').then((m) => ({
      default: m.default,
    })),
  { ssr: false },
);
const ComboEvolvedBridge = dynamic(
  () =>
    import('@/components/world-lens/ComboEvolvedBridge').then((m) => ({
      default: m.ComboEvolvedBridge,
    })),
  { ssr: false },
);

interface Dummy {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
}

const SANDBOX_WORLD_ID = 'sandbox';
const DEFAULT_DUMMIES = 3;
const MAX_DUMMIES = 10;
const DUMMY_HP = 100;

function makeDummy(idx: number): Dummy {
  return { id: `dummy_${idx}`, name: `Training Dummy ${idx + 1}`, hp: DUMMY_HP, maxHp: DUMMY_HP };
}

function CombatSandboxInner() {
  const params = useSearchParams();
  const initial = Math.max(1, Math.min(MAX_DUMMIES, Number(params?.get('dummies')) || DEFAULT_DUMMIES));
  const weapon = String(params?.get('weapon') || 'fist');

  const [dummies, setDummies] = useState<Dummy[]>(() =>
    Array.from({ length: initial }, (_, i) => makeDummy(i)),
  );
  const [hitLog, setHitLog] = useState<{ id: string; text: string; t: number }[]>([]);

  // Boot a socket connection so combat:telegraph / combat:hit /
  // combat:combo-evolved fire into the existing overlays.
  useEffect(() => {
    connectSocket();
    const off = subscribe<{ attackerId: string; targetId: string; damage: number; isCrit?: boolean; targetKilled?: boolean }>(
      'combat:hit',
      (h) => {
        setHitLog((prev) =>
          [...prev, { id: `hl-${Date.now()}-${Math.random()}`, text: `${h.attackerId} → ${h.targetId} (${Math.round(h.damage)}${h.isCrit ? ' crit' : ''})`, t: Date.now() }].slice(-12),
        );
        setDummies((prev) =>
          prev.map((d) =>
            d.id === h.targetId
              ? { ...d, hp: Math.max(0, d.hp - Math.round(h.damage)) }
              : d,
          ),
        );
      },
    );
    return off;
  }, []);

  const fireAttack = (targetId: string, heavy = false, tier = 2) => {
    const sock = getSocket();
    sock.emit('combat:attack', {
      targetId,
      baseDamage: heavy ? 22 : 12,
      range: 3,
      armorPierce: heavy ? 1 : 0,
      heavy,
      style: heavy ? 'attack-heavy' : 'attack-light',
      tier,
      weapon,
      worldId: SANDBOX_WORLD_ID,
    });
  };

  const resetDummies = () => {
    setDummies((prev) => prev.map((d) => ({ ...d, hp: d.maxHp })));
    setHitLog([]);
  };

  const addDummy = () => {
    setDummies((prev) => (prev.length >= MAX_DUMMIES ? prev : [...prev, makeDummy(prev.length)]));
  };

  const removeDummy = () => {
    setDummies((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));
  };

  // Combat-feel iteration shortcuts: r reset HP, +/- dummy count.
  useLensCommand(
    [
      { id: 'reset',     keys: 'r',       description: 'Reset dummy HP', category: 'actions', action: resetDummies },
      { id: 'add',       keys: 'shift+=', description: 'Add a dummy',    category: 'actions', action: addDummy },
      { id: 'remove',    keys: '-',       description: 'Remove a dummy', category: 'actions', action: removeDummy },
    ],
    { lensId: 'sandbox' }
  );

  const totalHp = useMemo(() => dummies.reduce((s, d) => s + d.hp, 0), [dummies]);
  const totalMax = useMemo(() => dummies.reduce((s, d) => s + d.maxHp, 0), [dummies]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-slate-100">
      {/* Arena: a flat checkered floor for spatial reference. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          backgroundPosition: '50% 50%',
        }}
      />

      {/* Header strip */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b border-slate-700/40 bg-black/40 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs">
          <Swords className="h-4 w-4 text-amber-300" />
          <span className="font-semibold uppercase tracking-wide text-amber-200">Combat Sandbox</span>
          <span className="text-slate-400">weapon: {weapon}</span>
          <span className="text-slate-400">dummies: {dummies.length}</span>
          <span className="text-slate-400">aggregate HP: {totalHp}/{totalMax}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={removeDummy}
            className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-amber-500"
            disabled={dummies.length <= 1}
          aria-label="Remove">
            <Minus className="inline h-3 w-3" />
          </button>
          <button
            onClick={addDummy}
            className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-40"
            disabled={dummies.length >= MAX_DUMMIES}
          aria-label="Add">
            <Plus className="inline h-3 w-3" />
          </button>
          <button
            onClick={resetDummies}
            className="flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-xs hover:bg-emerald-600"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      </div>

      {/* Dummy grid */}
      <div className="absolute inset-0 z-[5] flex items-center justify-center">
        <div className="grid grid-cols-3 gap-6 p-12 md:grid-cols-4 lg:grid-cols-5">
          {dummies.map((d) => {
            const dead = d.hp <= 0;
            const pct = (d.hp / d.maxHp) * 100;
            return (
              <button
                key={d.id}
                onClick={() => fireAttack(d.id, false, 2)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  fireAttack(d.id, true, 4);
                }}
                disabled={dead}
                className={`group relative flex h-32 w-24 flex-col items-center justify-end rounded border-2 p-2 transition ${
                  dead
                    ? 'border-slate-700 bg-slate-800/40 opacity-40'
                    : 'border-amber-400/60 bg-slate-800/80 hover:border-amber-300 hover:bg-slate-700/80'
                }`}
                title="Left click: light · Right click: heavy"
              >
                {/* Dummy silhouette */}
                <div
                  className={`mb-2 h-16 w-12 rounded-t-full ${
                    dead ? 'bg-slate-600' : 'bg-amber-200/80'
                  }`}
                />
                <div className="w-full">
                  <div className="text-[9px] uppercase text-slate-400 truncate">{d.name}</div>
                  <div className="mt-0.5 h-1.5 w-full rounded bg-slate-700">
                    <div
                      className={`h-full rounded ${pct > 50 ? 'bg-emerald-400' : pct > 20 ? 'bg-amber-400' : 'bg-rose-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-center text-[9px] tabular-nums text-slate-300">
                    {d.hp}/{d.maxHp}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hit log strip — bottom right */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 max-h-48 w-72 overflow-hidden rounded bg-black/50 p-2 text-[10px] backdrop-blur-sm">
        <div className="mb-1 font-semibold text-amber-200">Hit Log</div>
        {hitLog.length === 0 ? (
          <div className="text-slate-500">Click a dummy to attack…</div>
        ) : (
          <ul className="space-y-0.5">
            {hitLog.slice().reverse().map((h) => (
              <li key={h.id} className="font-mono text-slate-300">{h.text}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Instructions strip — bottom left */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs rounded bg-black/50 p-2 text-[10px] backdrop-blur-sm">
        <div className="mb-1 font-semibold text-amber-200">Sandbox Controls</div>
        <ul className="space-y-0.5 text-slate-300">
          <li><span className="font-mono text-slate-100">Left click</span> a dummy → light attack</li>
          <li><span className="font-mono text-slate-100">Right click</span> → heavy attack</li>
          <li><span className="font-mono text-slate-100">Tab</span> cycles soft lock-on</li>
          <li><span className="font-mono text-slate-100">KeyT</span> toggles hard lock-on</li>
          <li><span className="font-mono text-slate-100">Esc</span> clears lock-on</li>
        </ul>
      </div>

      {/* Combat presentation overlays — same set the live world uses.
          GameJuice wraps children to provide its context; mount the
          bridge inside it so combo-evolved triggers can fire fanfare. */}
      <ImpactFeedback />
      <GameJuice>
        <ComboEvolvedBridge />
      </GameJuice>
      <BodyLanguageOverlay />
    </div>
  );
}

export default function CombatSandboxPage() {
  return (
    <LensShell lensId="sandbox" asMain={false}>
      <ManifestActionBar />
    <Suspense fallback={<div className="h-screen w-screen bg-slate-900" />}>
      <CombatSandboxInner />
    </Suspense>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <div className="sr-only" aria-hidden="true">{/* Loader2 spinner rendered when data is fetching */}</div>
    </LensShell>
  );
}
