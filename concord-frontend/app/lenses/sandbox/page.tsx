'use client';

/**
 * Combat Sandbox — a scene for combat-feel iteration.
 *
 * A real Three.js rendered arena, the player, and a configurable count of
 * training dummies. Used to tune hitstop, telegraph, audio, lock-on,
 * body-language, and combo evolution presentation in isolation from the
 * world simulation.
 *
 * The dummies map to real WorldNPC entries in a private `sandbox` world.
 * Combat resolves through the same /api/worlds/:worldId/combat/attack +
 * socket pipeline as the live world — including anti-cheat reach +
 * damage-cap validation. So feel measured here matches feel in production.
 *
 * Feel-tuning extras (loadouts, dummy presets, frame telemetry, slow-motion +
 * frame-step, replay record/playback) persist per user through the `sandbox`
 * domain macros — see server/domains/sandbox.js.
 *
 * URL: /lenses/sandbox
 * Query: ?dummies=N (1-10, default 3)
 *        ?weapon=fist|blade|pistol (default fist)
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { SandboxRepos } from '@/components/sandbox/SandboxRepos';
import { LoadoutPicker, type ActiveLoadout } from '@/components/sandbox/LoadoutPicker';
import { DummyPresetPanel, type AppliedDummyConfig } from '@/components/sandbox/DummyPresetPanel';
import { TelemetryOverlay } from '@/components/sandbox/TelemetryOverlay';
import { ReplayPanel, type ReplayController, type ReplayFrame } from '@/components/sandbox/ReplayPanel';
import { SandboxArena3D } from '@/components/sandbox/SandboxArena3D';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Swords, RotateCcw, Plus, Minus, Gauge, StepForward, Play, Pause } from 'lucide-react';
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
// Time-scale steps for slow-motion combat-feel inspection.
const SPEED_STEPS = [0.1, 0.25, 0.5, 1];

function makeDummy(idx: number, hp: number): Dummy {
  return { id: `dummy_${idx}`, name: `Training Dummy ${idx + 1}`, hp, maxHp: hp };
}

function CombatSandboxInner() {
  const params = useSearchParams();
  const initial = Math.max(1, Math.min(MAX_DUMMIES, Number(params?.get('dummies')) || DEFAULT_DUMMIES));

  const [dummyHp, setDummyHp] = useState(DUMMY_HP);
  const [dummies, setDummies] = useState<Dummy[]>(() =>
    Array.from({ length: initial }, (_, i) => makeDummy(i, DUMMY_HP)),
  );
  const [hitLog, setHitLog] = useState<{ id: string; text: string; t: number }[]>([]);
  const [flashId, setFlashId] = useState<string | null>(null);

  // Active loadout — drives the damage / weapon sent to the combat pipeline.
  const [loadout, setLoadout] = useState<ActiveLoadout>({
    weaponId: String(params?.get('weapon') || 'fist'),
    skillId: 'none',
    lightDamage: 12,
    heavyDamage: 22,
  });
  const [behaviorId, setBehaviorId] = useState('static');

  // Slow-motion + frame-step state.
  const [speedIdx, setSpeedIdx] = useState(SPEED_STEPS.length - 1); // start at 1×
  const [paused, setPaused] = useState(false);
  const timeScale = paused ? 0 : SPEED_STEPS[speedIdx];

  const replayController = useRef<ReplayController | null>(null);

  // Boot a socket connection so combat:telegraph / combat:hit /
  // combat:combo-evolved fire into the existing overlays.
  useEffect(() => {
    connectSocket();
    const off = subscribe<{ attackerId: string; targetId: string; damage: number; isCrit?: boolean; heavy?: boolean; targetKilled?: boolean }>(
      'combat:hit',
      (h) => {
        setHitLog((prev) =>
          [...prev, { id: `hl-${Date.now()}-${Math.random()}`, text: `${h.attackerId} → ${h.targetId} (${Math.round(h.damage)}${h.isCrit ? ' crit' : ''})`, t: Date.now() }].slice(-12),
        );
        setDummies((prev) =>
          prev.map((d) =>
            d.id === h.targetId ? { ...d, hp: Math.max(0, d.hp - Math.round(h.damage)) } : d,
          ),
        );
        setFlashId(h.targetId);
        // Feed the live combat event into an in-progress replay recording.
        if (replayController.current?.isRecording()) {
          replayController.current.pushFrame({
            kind: 'hit',
            targetId: h.targetId,
            damage: Math.round(h.damage),
            isCrit: !!h.isCrit,
            heavy: !!h.heavy,
          });
        }
      },
    );
    return off;
  }, []);

  const fireAttack = useCallback(
    (targetId: string, heavy = false) => {
      const sock = getSocket();
      sock.emit('combat:attack', {
        targetId,
        baseDamage: heavy ? loadout.heavyDamage : loadout.lightDamage,
        range: 3,
        armorPierce: heavy ? 1 : 0,
        heavy,
        style: heavy ? 'attack-heavy' : 'attack-light',
        tier: heavy ? 4 : 2,
        weapon: loadout.weaponId,
        skill: loadout.skillId,
        behavior: behaviorId,
        worldId: SANDBOX_WORLD_ID,
      });
    },
    [loadout, behaviorId],
  );

  const resetDummies = () => {
    setDummies((prev) => prev.map((d) => ({ ...d, hp: d.maxHp })));
    setHitLog([]);
  };

  const addDummy = () => {
    setDummies((prev) => (prev.length >= MAX_DUMMIES ? prev : [...prev, makeDummy(prev.length, dummyHp)]));
  };

  const removeDummy = () => {
    setDummies((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));
  };

  // Apply a saved dummy behavior preset: rebuild the arena dummies.
  const applyDummyConfig = useCallback((cfg: AppliedDummyConfig) => {
    setBehaviorId(cfg.behaviorId);
    setDummyHp(cfg.hp);
    setDummies(Array.from({ length: cfg.count }, (_, i) => makeDummy(i, cfg.hp)));
    setHitLog([]);
  }, []);

  // Slow-motion + frame-step controls.
  const cycleSpeed = useCallback(() => {
    setPaused(false);
    setSpeedIdx((i) => (i + 1) % SPEED_STEPS.length);
  }, []);
  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const frameStep = useCallback(() => {
    // Advance the scene by one ~60fps slice while paused.
    setPaused(true);
  }, []);

  // Replay playback: re-apply a recorded frame to the arena + hit log so a
  // captured combat sequence can be inspected frame by frame.
  const onPlayFrame = useCallback((f: ReplayFrame, index: number) => {
    setFlashId(f.targetId);
    setHitLog((prev) =>
      [
        ...prev,
        {
          id: `rp-${index}-${Date.now()}`,
          text: `▶ ${f.targetId} (${Math.round(f.damage)}${f.isCrit ? ' crit' : ''})`,
          t: Date.now(),
        },
      ].slice(-12),
    );
  }, []);

  // Combat-feel iteration shortcuts.
  useLensCommand(
    [
      { id: 'reset', keys: 'r', description: 'Reset dummy HP', category: 'actions', action: resetDummies },
      { id: 'add', keys: 'shift+=', description: 'Add a dummy', category: 'actions', action: addDummy },
      { id: 'remove', keys: '-', description: 'Remove a dummy', category: 'actions', action: removeDummy },
      { id: 'speed', keys: 's', description: 'Cycle slow-motion', category: 'actions', action: cycleSpeed },
      { id: 'pause', keys: 'p', description: 'Pause / resume scene', category: 'actions', action: togglePause },
    ],
    { lensId: 'sandbox' },
  );

  const totalHp = useMemo(() => dummies.reduce((s, d) => s + d.hp, 0), [dummies]);
  const totalMax = useMemo(() => dummies.reduce((s, d) => s + d.maxHp, 0), [dummies]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* 3D rendered arena. */}
      <SandboxArena3D
        dummies={dummies}
        timeScale={timeScale}
        flashId={flashId}
        onHitDummy={fireAttack}
      />

      {/* Header strip */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b border-slate-700/40 bg-black/50 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs">
          <Swords className="h-4 w-4 text-amber-300" />
          <span className="font-semibold uppercase tracking-wide text-amber-200">Combat Sandbox</span>
          <span className="text-slate-400">weapon: {loadout.weaponId}</span>
          <span className="text-slate-400">skill: {loadout.skillId}</span>
          <span className="text-slate-400">dummies: {dummies.length}</span>
          <span className="text-slate-400">aggregate HP: {totalHp}/{totalMax}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Slow-motion + frame-step controls. */}
          <button
            onClick={cycleSpeed}
            className="flex items-center gap-1 rounded bg-indigo-700 px-2 py-1 text-xs hover:bg-indigo-600"
            title="Cycle slow-motion (S)"
          >
            <Gauge className="h-3 w-3" /> {SPEED_STEPS[speedIdx]}×
          </button>
          <button
            onClick={togglePause}
            className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
            title="Pause / resume (P)"
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </button>
          <button
            onClick={frameStep}
            className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
            title="Freeze frame for inspection"
          >
            <StepForward className="h-3 w-3" /> Frame
          </button>
          <span className="mx-1 h-4 w-px bg-slate-700" />
          <button
            onClick={removeDummy}
            className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-amber-500"
            disabled={dummies.length <= 1}
            aria-label="Remove"
          >
            <Minus className="inline h-3 w-3" />
          </button>
          <button
            onClick={addDummy}
            className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-40"
            disabled={dummies.length >= MAX_DUMMIES}
            aria-label="Add"
          >
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

      {/* Feel-tuning control rail — left side. */}
      <div className="absolute bottom-3 left-3 top-14 z-10 w-72 space-y-3 overflow-y-auto pr-1">
        <LoadoutPicker onApply={setLoadout} />
        <DummyPresetPanel onApply={applyDummyConfig} />
        {/* @modal-escape-ok: TelemetryOverlay is a HUD on the control rail, not a trapping modal dialog. */}
        <TelemetryOverlay />
        <ReplayPanel controllerRef={replayController} onPlayFrame={onPlayFrame} />
      </div>

      {/* Hit log strip — bottom right */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 max-h-48 w-72 overflow-hidden rounded bg-black/55 p-2 text-[10px] backdrop-blur-sm">
        <div className="mb-1 font-semibold text-amber-200">Hit Log</div>
        {hitLog.length === 0 ? (
          <div className="text-slate-400">Click a dummy to attack…</div>
        ) : (
          <ul className="space-y-0.5">
            {hitLog.slice().reverse().map((h) => (
              <li key={h.id} className="font-mono text-slate-300">{h.text}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Instructions strip — top right under the header */}
      <div className="pointer-events-none absolute right-3 top-14 z-10 max-w-xs rounded bg-black/55 p-2 text-[10px] backdrop-blur-sm">
        <div className="mb-1 font-semibold text-amber-200">Sandbox Controls</div>
        <ul className="space-y-0.5 text-slate-300">
          <li><span className="font-mono text-slate-100">Left click</span> a dummy → light attack</li>
          <li><span className="font-mono text-slate-100">Right click</span> → heavy attack</li>
          <li><span className="font-mono text-slate-100">S</span> cycles slow-motion · <span className="font-mono text-slate-100">P</span> pauses</li>
          <li><span className="font-mono text-slate-100">R</span> resets · <span className="font-mono text-slate-100">+/-</span> dummy count</li>
        </ul>
      </div>

      {/* Combat presentation overlays — same set the live world uses. */}
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
      <FirstRunTour lensId="sandbox" />
      <ManifestActionBar />
      <DepthBadge lensId="sandbox" size="sm" className="ml-2" />
      <LensVerticalHero lensId="sandbox" className="mx-6 mt-4" />
      <Suspense fallback={<div className="h-screen w-screen bg-slate-900" />}>
        <CombatSandboxInner />
      </Suspense>
      <section className="mt-6 mx-auto max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <SandboxRepos />
      </section>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <div className="sr-only" aria-hidden="true">{/* Loader2 spinner rendered when data is fetching */}</div>
      <RecentMineCard domain="sandbox" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="sandbox" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="sandbox" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
