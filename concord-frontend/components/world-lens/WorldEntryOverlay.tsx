'use client';

/**
 * WorldEntryOverlay — the premium entry/loading sequence for the Concordia
 * world lens (Frontend Rebuild Program, Phase 2, Concordia flagship).
 *
 * HONEST BY CONSTRUCTION. This replaces a dead `<LoadingTransitions>` that was
 * mounted permanently with a hardcoded `progress={0}` and destination "Loading…"
 * — a fake progress bar that never reflected reality. Every element here is a
 * pure function of a REAL load signal the page already tracks:
 *
 *   1. `engineReady`  — the (heavy, three.js) ConcordiaScene chunk has finished
 *                        downloading + parsing (a real dynamic-import resolve).
 *   2. `dataState`    — the live world fetches (nodes/buildings/npcs/loot-bags)
 *                        have resolved: 'loading' → 'live' | 'offline'.
 *   3. `sceneReady`   — the 3D scene has built and painted its first frame
 *                        (ConcordiaScene's onSceneReady / concordia:scene-ready).
 *
 * The progress bar is DETERMINATE off the count of genuinely-completed stages
 * (0/3 → 3/3) — never a timed fill. A subtle indeterminate shimmer rides the
 * in-progress portion so the screen feels alive without claiming a false
 * percentage. When the scene is painted (`sceneReady`) the overlay fades out
 * (progressive reveal), handing off to the small honesty pill for any world
 * data still streaming in.
 *
 * The only setInterval here rotates an authored lore tip and animates the
 * trailing ellipsis — cosmetic text, making no claim about load state. No
 * animated element fabricates progress or data.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Database, Boxes, Check, ScrollText, Loader2 } from 'lucide-react';
import type { WorldDataState } from '@/lib/world-lens/world-data-state';
import { loreTips, gameplayTips } from './LoadingTransitions';

interface WorldEntryOverlayProps {
  /** Live destination name — the world/district the player is entering. */
  worldName: string;
  /** ConcordiaScene chunk (three.js) has finished loading. */
  engineReady: boolean;
  /** Live world-data fetch outcome ('loading' until at least one resolves). */
  dataState: WorldDataState;
  /** 3D scene has built + painted its first frame. Drives the fade-out. */
  sceneReady: boolean;
  /** Optional accent color for the ambient glow (theme-derived). */
  previewColor?: string;
}

type StageState = 'pending' | 'active' | 'done' | 'warn';

interface Stage {
  key: 'engine' | 'data' | 'scene';
  label: string;
  activeLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  state: StageState;
}

// Fade-out duration must match the CSS transition below.
const FADE_MS = 550;

export default function WorldEntryOverlay({
  worldName,
  engineReady,
  dataState,
  sceneReady,
  previewColor = '#0E7490',
}: WorldEntryOverlayProps) {
  // Mounted until the fade-out completes. If the scene is somehow already
  // ready on first render (warm chunk cache + fast rebuild), never show.
  const [mounted, setMounted] = useState(!sceneReady);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!sceneReady) return;
    setLeaving(true);
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [sceneReady]);

  // Derive each stage's state purely from the real signals.
  const stages: Stage[] = useMemo(() => {
    const engineDone = engineReady;
    const dataResolved = dataState !== 'loading';
    const dataWarn = dataState === 'offline';

    // The "current" active stage is the first not-yet-done one.
    const engineState: StageState = engineDone ? 'done' : 'active';
    const dataState_: StageState = !engineDone
      ? 'pending'
      : dataResolved
      ? (dataWarn ? 'warn' : 'done')
      : 'active';
    const sceneState: StageState = !dataResolved && !engineDone
      ? 'pending'
      : sceneReady
      ? 'done'
      : engineDone
      ? 'active'
      : 'pending';

    return [
      { key: 'engine', label: 'Renderer loaded', activeLabel: 'Loading renderer', icon: MapPin, state: engineState },
      { key: 'data', label: dataWarn ? 'Using local preview' : 'World data live', activeLabel: 'Fetching world data', icon: Database, state: dataState_ },
      { key: 'scene', label: 'Scene ready', activeLabel: 'Building the world', icon: Boxes, state: sceneState },
    ];
  }, [engineReady, dataState, sceneReady]);

  const doneCount = stages.filter((s) => s.state === 'done' || s.state === 'warn').length;
  const progressPct = (doneCount / stages.length) * 100;
  const currentStage = stages.find((s) => s.state === 'active') ?? stages[stages.length - 1];

  // ── Cosmetic-only: rotating authored lore tip (no load claim) ──────
  const tips = useMemo(() => [...loreTips, ...gameplayTips], []);
  const isLoreRef = useRef<boolean[]>([]);
  if (isLoreRef.current.length === 0) {
    isLoreRef.current = [...loreTips.map(() => true), ...gameplayTips.map(() => false)];
  }
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * (loreTips.length + gameplayTips.length)));
  useEffect(() => {
    const iv = setInterval(() => setTipIdx((p) => (p + 1) % tips.length), 4500);
    return () => clearInterval(iv);
  }, [tips.length]);
  const tipIsLore = isLoreRef.current[tipIdx];

  // ── Cosmetic-only: trailing ellipsis on the active stage label ─────
  const [dots, setDots] = useState('');
  useEffect(() => {
    const iv = setInterval(() => setDots((p) => (p.length >= 3 ? '' : p + '.')), 450);
    return () => clearInterval(iv);
  }, []);

  if (!mounted) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Entering ${worldName}`}
      data-testid="world-entry-overlay"
      data-leaving={leaving ? 'true' : undefined}
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm select-none"
      style={{ opacity: leaving ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-out` }}
    >
      {/* Ambient theme glow */}
      <div
        className="absolute inset-0 opacity-25 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at center, ${previewColor}44 0%, transparent 68%)` }}
      />

      <div className="relative z-10 flex flex-col items-center gap-7 w-full max-w-md px-6">
        {/* Destination */}
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-white/40 mb-1.5">
            Entering Concordia
          </div>
          <div className="text-2xl font-semibold text-white tracking-tight">{worldName}</div>
        </div>

        {/* Stage tracker — each row lights on its real completion signal */}
        <div className="w-full space-y-2.5">
          {stages.map((s) => {
            const Icon = s.state === 'done' ? Check : s.icon;
            const isActive = s.state === 'active';
            const isDone = s.state === 'done';
            const isWarn = s.state === 'warn';
            return (
              <div key={s.key} className="flex items-center gap-3">
                <div
                  className={
                    'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border transition-colors duration-300 ' +
                    (isDone
                      ? 'border-emerald-500/40 bg-emerald-500/15'
                      : isWarn
                      ? 'border-amber-500/40 bg-amber-500/15'
                      : isActive
                      ? 'border-cyan-400/40 bg-cyan-400/10'
                      : 'border-white/10 bg-white/[0.03]')
                  }
                >
                  <Icon
                    className={
                      'h-3.5 w-3.5 ' +
                      (isDone
                        ? 'text-emerald-400'
                        : isWarn
                        ? 'text-amber-400'
                        : isActive
                        ? 'text-cyan-300'
                        : 'text-white/25')
                    }
                  />
                </div>
                <span
                  className={
                    'text-xs transition-colors duration-300 ' +
                    (isDone
                      ? 'text-emerald-300/80'
                      : isWarn
                      ? 'text-amber-300/90'
                      : isActive
                      ? 'text-white'
                      : 'text-white/30')
                  }
                >
                  {isDone || isWarn ? s.label : s.activeLabel}
                  {isActive ? <span className="text-white/40">{dots}</span> : null}
                </span>
              </div>
            );
          })}
        </div>

        {/* Determinate progress off completed stages + indeterminate sheen */}
        <div className="w-full">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
            {/* Shimmer: pure animation, rides the whole bar — signals "alive",
                claims nothing about how far along we are. */}
            <div className="entry-shimmer absolute inset-y-0 left-0 w-1/3 rounded-full" />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-white/40">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-cyan-400/70" />
              {currentStage.activeLabel}
            </span>
            <span>{doneCount}/{stages.length}</span>
          </div>
        </div>

        {/* Authored lore / gameplay tip */}
        <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 px-3.5 py-2.5 backdrop-blur-sm" key={tipIdx}>
          <ScrollText className={'mt-0.5 h-3.5 w-3.5 flex-shrink-0 ' + (tipIsLore ? 'text-amber-300' : 'text-cyan-400')} />
          <p
            className={'text-[11px] leading-relaxed ' + (tipIsLore ? 'italic text-amber-100/80' : 'text-white/60')}
            style={{ animation: 'entryTipFade 600ms ease-out' }}
          >
            {tips[tipIdx]}
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes entryTipFade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .entry-shimmer {
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.18) 50%,
            transparent 100%
          );
          animation: entryShimmer 1.4s ease-in-out infinite;
        }
        @keyframes entryShimmer {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(420%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .entry-shimmer { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
