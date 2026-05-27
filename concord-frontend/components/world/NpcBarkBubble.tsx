'use client';
import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/hooks/useSocket';

// Wave G2 — floating speech bubble above an NPC when a bark fires.
// Listens for `npc:bark` socket events; each bubble fades in for 200ms
// + holds for 3.2s + fades out for 600ms (total visible 4s). Bubble
// position projects from NPC world coords via the existing projector.
//
// Tones map to colour: friendly = warm, neutral = white, wary = amber,
// hostile = red. LLM-personalised barks (composed.llm === true) get a
// subtle ✻ glyph so the player knows it was bespoke.
//
// Also fires `concordia:npc-look-at` on bark arrival so the speaking
// NPC visibly turns toward the player.

const BUBBLE_DURATION_MS = 4000;
const MAX_VISIBLE = 8; // never show more than this many at once
const FRAME_THROTTLE_MS = 60;

interface BarkPayload {
  worldId: string;
  npcId: string;
  npcName?: string;
  playerId: string;
  line: string;
  tone: 'friendly' | 'neutral' | 'wary' | 'hostile' | string;
  topic: string;
  llm?: boolean;
  position?: { x: number; z: number };
}

interface BarkVisible extends BarkPayload {
  appearedAt: number;
  bubbleId: string;
}

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

interface Props {
  playerPosition?: { x: number; z: number };
  enabled?: boolean;
}

const TONE_STYLE: Record<string, string> = {
  friendly: 'bg-amber-100/95 border-amber-400 text-amber-900',
  neutral:  'bg-white/95 border-white/60 text-black',
  wary:     'bg-orange-200/95 border-orange-500 text-orange-900',
  hostile:  'bg-red-300/95 border-red-600 text-red-950',
};

export function NpcBarkBubble({ playerPosition, enabled = true }: Props) {
  const { on, off } = useSocket({ autoConnect: true });
  const projectorRef = useRef<Projector | null>(null);
  const [visible, setVisible] = useState<BarkVisible[]>([]);
  const [screenPositions, setScreenPositions] = useState<Map<string, Projection>>(new Map());

  // Cache projector.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  // Listen for npc:bark + fire look-at toward player.
  useEffect(() => {
    if (!enabled) return;
    function onBark(...args: unknown[]) {
      const payload = args[0] as BarkPayload | undefined;
      if (!payload?.line || !payload?.npcId) return;
      const bubble: BarkVisible = {
        ...payload,
        appearedAt: performance.now(),
        bubbleId: `${payload.npcId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      setVisible((prev) => {
        const next = [...prev, bubble];
        // Cap concurrent bubbles.
        if (next.length > MAX_VISIBLE) next.splice(0, next.length - MAX_VISIBLE);
        return next;
      });
      // Fire look-at so the NPC turns toward the player.
      try {
        if (payload.position && playerPosition) {
          const dx = playerPosition.x - payload.position.x;
          const dz = playerPosition.z - payload.position.z;
          const targetRot = Math.atan2(dx, dz);
          window.dispatchEvent(new CustomEvent('concordia:npc-look-at', {
            detail: { npcId: payload.npcId, targetRot },
          }));
        }
      } catch { /* ok */ }
      // Auto-remove after BUBBLE_DURATION_MS.
      setTimeout(() => {
        setVisible((cur) => cur.filter((b) => b.bubbleId !== bubble.bubbleId));
      }, BUBBLE_DURATION_MS);
    }
    on?.('npc:bark', onBark);
    return () => { off?.('npc:bark', onBark); };
  }, [enabled, on, off, playerPosition]);

  // Project bubble positions every ~60ms.
  useEffect(() => {
    if (!enabled || visible.length === 0) {
      setScreenPositions(new Map());
      return;
    }
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const b of visible) {
        if (!b.position) continue;
        const p = proj({ x: b.position.x, y: 2.4, z: b.position.z });
        if (p) next.set(b.bubbleId, p);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, visible]);

  if (!enabled || visible.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[37]" data-testid="npc-bark-layer" aria-hidden="true">
      {visible.map((b) => {
        const pos = screenPositions.get(b.bubbleId);
        if (!pos?.visible) return null;
        const age = performance.now() - b.appearedAt;
        // fade in 0-200, hold 200-3400, fade out 3400-4000
        let opacity = 1;
        if (age < 200) opacity = age / 200;
        else if (age > 3400) opacity = Math.max(0, (BUBBLE_DURATION_MS - age) / 600);
        const tone = TONE_STYLE[b.tone] || TONE_STYLE.neutral;
        return (
          <div
            key={b.bubbleId}
            className={`absolute -translate-x-1/2 -translate-y-full select-none
                        px-2 py-1 rounded-lg border shadow-md text-xs leading-snug max-w-[16rem] ${tone}`}
            style={{
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              opacity,
              transition: 'opacity 80ms linear',
            }}
            data-npc-id={b.npcId}
            data-tone={b.tone}
            data-topic={b.topic}
            data-llm={b.llm ? 'true' : 'false'}
          >
            {b.llm ? <span aria-hidden className="text-purple-700 mr-0.5">✻</span> : null}
            {b.line}
          </div>
        );
      })}
    </div>
  );
}
