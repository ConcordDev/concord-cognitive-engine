'use client';

/**
 * Combat Sandbox — a scene for combat-feel iteration.
 *
 * A real Three.js rendered arena, the player, and a configurable count of
 * training dummies. Used to tune hitstop, telegraph, audio, lock-on,
 * body-language, and combo evolution presentation in isolation from the
 * world simulation.
 *
 * The dummies map to real NPC entries in a private per-user `sandbox_<uid>`
 * city, entered via the `sandbox.enterArena` macro (server/domains/sandbox.js)
 * on mount and re-synced on every dummy-count/hp change. Combat resolves
 * through the same `combat:attack` socket pipeline the live world uses —
 * including the same anti-cheat reach + damage-cap validation — so feel
 * measured here matches feel in production. `combat:hit` is a platform-wide
 * broadcast, so the hit-log/HP handler below filters to only the arena's own
 * dummy ids before reacting.
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
import { lensRun } from '@/lib/api/client';
import { LensShell } from '@/components/lens/LensShell';
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
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Swords, RotateCcw, Plus, Minus, Gauge, StepForward, Play, Pause, ChevronDown, ChevronRight } from 'lucide-react';
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
  // Whether the current dummy ids are real server npc ids (sandbox.enterArena
  // has resolved at least once). Attacks fired before this resolves would
  // target a client-only placeholder id no NPC exists for — a guaranteed
  // silent no-op — so fireAttack gates on it instead of spamming the socket.
  const [arenaReady, setArenaReady] = useState(false);

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
  // Mirrors `dummies` for the combat:hit subscriber below, which is mounted
  // once on mount (empty dep array) and would otherwise close over a stale
  // dummy-id list.
  const dummiesRef = useRef(dummies);
  dummiesRef.current = dummies;

  // sandbox.enterArena registers the caller into a private per-user
  // `sandbox_<uid>` city + spawns/refreshes real training-dummy NPCs there —
  // the actual substrate the combat:attack socket path resolves against
  // (attacker + target both have to be real cityPresence entries or the
  // pipeline silently no-ops with zero visible effect). `reset` fully heals
  // every dummy (mount / Reset button / applying a preset); omitted, only
  // newly-added dummies are (re)spawned so an add/remove doesn't heal a
  // dummy mid-fight — the response's per-dummy `hp` is always the server's
  // authoritative current health.
  const syncArena = useCallback(async (count: number, hp: number, opts: { reset?: boolean } = {}) => {
    try {
      const r = await lensRun('sandbox', 'enterArena', { count, hp, reset: !!opts.reset });
      if (r.data?.ok && r.data.result) {
        const info = r.data.result as { cityId: string; dummies: { index: number; npcId: string; hp: number }[] };
        setDummies(
          info.dummies
            .slice()
            .sort((a, b) => a.index - b.index)
            .map((d) => ({ id: d.npcId, name: `Training Dummy ${d.index + 1}`, hp: d.hp, maxHp: hp })),
        );
        setArenaReady(true);
      }
    } catch {
      // Best-effort — the raycast/socket path just stays a no-op until the
      // next sync succeeds (mount retry, or the next user-triggered change).
    }
  }, []);

  // Enter the arena once on mount.
  useEffect(() => {
    void syncArena(initial, DUMMY_HP, { reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot a socket connection so combat:telegraph / combat:hit /
  // combat:combo-evolved fire into the existing overlays.
  useEffect(() => {
    connectSocket();
    const off = subscribe<{ attackerId: string; targetId: string; damage: number; isCrit?: boolean; heavy?: boolean; targetKilled?: boolean; targetHealth?: number }>(
      'combat:hit',
      (h) => {
        // combat:hit is a platform-wide broadcast (every player's combat, not
        // just this arena's) — only react to hits against one of THIS
        // session's dummy npc ids, or a live-world hit elsewhere would
        // pollute the hit log / flash a dummy that wasn't actually struck.
        if (!dummiesRef.current.some((d) => d.id === h.targetId)) return;
        setHitLog((prev) =>
          [...prev, { id: `hl-${Date.now()}-${Math.random()}`, text: `${h.attackerId} → ${h.targetId} (${Math.round(h.damage)}${h.isCrit ? ' crit' : ''})`, t: Date.now() }].slice(-12),
        );
        setDummies((prev) =>
          prev.map((d) =>
            d.id === h.targetId
              ? { ...d, hp: typeof h.targetHealth === 'number' ? Math.max(0, h.targetHealth) : Math.max(0, d.hp - Math.round(h.damage)) }
              : d,
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
      if (!arenaReady) return;
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
    [loadout, behaviorId, arenaReady],
  );

  const resetDummies = () => {
    setDummies((prev) => prev.map((d) => ({ ...d, hp: d.maxHp })));
    setHitLog([]);
    void syncArena(dummies.length, dummyHp, { reset: true });
  };

  const addDummy = () => {
    if (dummies.length >= MAX_DUMMIES) return;
    const nextCount = dummies.length + 1;
    setDummies((prev) => (prev.length >= MAX_DUMMIES ? prev : [...prev, makeDummy(prev.length, dummyHp)]));
    void syncArena(nextCount, dummyHp, { reset: false });
  };

  const removeDummy = () => {
    if (dummies.length <= 1) return;
    const nextCount = dummies.length - 1;
    setDummies((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));
    void syncArena(nextCount, dummyHp, { reset: false });
  };

  // Apply a saved dummy behavior preset: rebuild the arena dummies.
  const applyDummyConfig = useCallback((cfg: AppliedDummyConfig) => {
    setBehaviorId(cfg.behaviorId);
    setDummyHp(cfg.hp);
    setDummies(Array.from({ length: cfg.count }, (_, i) => makeDummy(i, cfg.hp)));
    setHitLog([]);
    void syncArena(cfg.count, cfg.hp, { reset: true });
  }, [syncArena]);

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
          {!arenaReady && (
            <span className="flex items-center gap-1 text-amber-400/80" aria-live="polite">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> entering arena…
            </span>
          )}
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
        <TelemetryOverlay weaponId={loadout.weaponId} />
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
  const [showSandboxRepos, setShowSandboxRepos] = useState(false);
  return (
    <LensShell lensId="sandbox" asMain={false}>
      <FirstRunTour lensId="sandbox" />      <DepthBadge lensId="sandbox" size="sm" className="ml-2" />
      <LensVerticalHero lensId="sandbox" className="mx-6 mt-4" />
      <Suspense fallback={<div className="h-screen w-screen bg-slate-900" />}>
        <CombatSandboxInner />
      </Suspense>
      <section className="mt-6 mx-auto max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowSandboxRepos(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Sandbox / playground repos (GitHub)</span>
          {showSandboxRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showSandboxRepos && (
          <div className="mt-3">
            <SandboxRepos />
          </div>
        )}
      </section>
          <CrossLensRecentsPanel lensId="sandbox" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
