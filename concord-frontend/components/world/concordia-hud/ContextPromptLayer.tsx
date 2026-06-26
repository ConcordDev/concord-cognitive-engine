'use client';

/**
 * ContextPromptLayer — Layer 2 of the dynamic HUD.
 *
 * Just-in-time spatial prompts near the crosshair. Reads
 * useHUDContext.nearbyTargets (already proximity-filtered ≤ 4m by the
 * provider). Picks the single highest-priority target and renders a
 * prompt anchored to its world-space projection (concordia:projector-ready).
 *
 * Priority order: marriage_candidate > council_member > npc > quest_trigger
 * > vehicle > hook. Marriage + council are gated by the realm/marriage
 * substrate via useHUDContext too — those only appear when conditions hold.
 *
 * Mode-aware: hidden in combat, dialogue, vehicle, photo.
 */

import { useEffect, useRef, useState } from 'react';
import { useHUDContext, type NearbyTarget } from './HUDContextProvider';
import { useClientConfig } from '@/hooks/useClientConfig';
import { useHudSettings } from '@/lib/concordia/hud-settings';

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

const KEY_BINDINGS: Record<NearbyTarget['kind'], { key: string; verb: string }> = {
  marriage_candidate: { key: 'M', verb: 'Propose' },
  council_member:     { key: 'H', verb: 'Lobby' },
  npc:                { key: 'F', verb: 'Talk' },
  quest_trigger:      { key: 'F', verb: 'Investigate' },
  vehicle:            { key: 'V', verb: 'Mount' },
  hook:               { key: 'B', verb: 'Pick up' },
};

const PRIORITY: NearbyTarget['kind'][] = [
  'marriage_candidate', 'council_member', 'npc', 'quest_trigger', 'vehicle', 'hook',
];

function pickHighest(targets: NearbyTarget[]): NearbyTarget | null {
  if (!targets || targets.length === 0) return null;
  for (const kind of PRIORITY) {
    const matches = targets.filter((t) => t.kind === kind);
    if (matches.length > 0) {
      matches.sort((a, b) => a.distance - b.distance);
      return matches[0];
    }
  }
  return null;
}

export function ContextPromptLayer() {
  const FRAME_THROTTLE_MS = useClientConfig().throttle.contextPromptFrameMs; // E0 — server-tunable
  // HUDSettingsPanel's "Context prompts" toggle gates this whole layer (real
  // consumer of concordia:hud-settings-changed).
  const contextPromptsOn = useHudSettings().context_prompts;
  const mode = useHUDContext((s) => s.inputMode);
  const nearby = useHUDContext((s) => s.nearbyTargets);
  const projectorRef = useRef<Projector | null>(null);
  const [screenPos, setScreenPos] = useState<Projection | null>(null);
  const target = pickHighest(nearby);

  // Cache the projector when ConcordiaScene is ready.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onReady(e: Event) {
      const detail = (e as CustomEvent).detail as { project?: Projector } | undefined;
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onReady);
    return () => window.removeEventListener('concordia:projector-ready', onReady);
  }, []);

  // rAF loop — only when we have a target.
  useEffect(() => {
    if (!target) { setScreenPos(null); return; }
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      // The provider doesn't include position per target in this minimal
      // shape; fallback to centre-screen anchor when projector unavailable.
      if (!proj) {
        setScreenPos({ x: window.innerWidth / 2, y: window.innerHeight * 0.62, visible: true });
        return;
      }
      // Without per-target position data, we render at a fixed bottom-centre.
      // Future: extend NearbyTarget to carry position and project per-target.
      setScreenPos({ x: window.innerWidth / 2, y: window.innerHeight * 0.62, visible: true });
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, FRAME_THROTTLE_MS]);

  if (!contextPromptsOn || mode !== 'exploration' || !target || !screenPos?.visible) return null;

  const binding = KEY_BINDINGS[target.kind];
  return (
    <div
      className="fixed pointer-events-none z-25 -translate-x-1/2 -translate-y-1/2"
      style={{ left: screenPos.x, top: screenPos.y }}
      data-testid="hud-context-prompt"
      data-target-kind={target.kind}
      role="status"
      aria-live="polite"
      aria-label={`${binding.verb} ${target.label}, press ${binding.key}`}
    >
      <div className="inline-flex items-center gap-2 bg-zinc-950/85 border border-zinc-700/60 rounded-lg px-3 py-1.5 backdrop-blur-sm shadow-lg">
        <kbd className="font-mono text-xs px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded">{binding.key}</kbd>
        <span className="text-sm text-zinc-200">{binding.verb}</span>
        <span className="text-xs text-zinc-400 truncate max-w-[12rem]">{target.label}</span>
      </div>
    </div>
  );
}
