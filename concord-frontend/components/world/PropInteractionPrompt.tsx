'use client';
import { useEffect, useRef, useState } from 'react';
import { PROP_CLIENT_CATALOG, defaultVerbFor, labelFor } from '@/lib/world-lens/world-props';

// Wave G1 — floating "✦ Sit / Drink / Read / Light" prompt above an
// interactable prop when the player is within range. Click → dispatches
// `concordia:prop-interact` which the world page picks up to POST the
// interact endpoint + play the matching avatar clip.

const VISIBLE_RADIUS_M = 5;
const FRAME_THROTTLE_MS = 80;

export interface PropLite {
  id: string;
  kind: string;
  position: { x: number; y: number; z: number };
}

interface Props {
  props: PropLite[];
  playerPosition?: { x: number; y?: number; z: number };
  enabled?: boolean;
}

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

export function PropInteractionPrompt({ props, playerPosition, enabled = true }: Props) {
  const projectorRef = useRef<Projector | null>(null);
  const [screenPositions, setScreenPositions] = useState<Map<string, Projection>>(new Map());
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  useEffect(() => {
    if (!enabled || !props.length) {
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
      for (const p of props) {
        if (!PROP_CLIENT_CATALOG[p.kind]) continue;
        if (playerPosition) {
          const dx = p.position.x - playerPosition.x;
          const dz = p.position.z - playerPosition.z;
          if (Math.hypot(dx, dz) > VISIBLE_RADIUS_M) continue;
        }
        const out = proj({ x: p.position.x, y: (p.position.y ?? 0) + 1.4, z: p.position.z });
        if (out) next.set(p.id, out);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, props, playerPosition]);

  if (!enabled || screenPositions.size === 0) return null;

  return (
    <div className="fixed inset-0 z-[36]" data-testid="prop-prompt-layer" aria-hidden="false">
      {props.map((p) => {
        const pos = screenPositions.get(p.id);
        if (!pos?.visible) return null;
        const verb = defaultVerbFor(p.kind);
        if (!verb) return null;
        const label = labelFor(p.kind, verb);
        const isHover = hovered === p.id;
        return (
          <button
            key={p.id}
            className={`absolute -translate-x-1/2 -translate-y-full select-none
                        px-2 py-1 rounded-md border text-xs leading-none
                        ${isHover
                          ? 'bg-amber-300/95 border-amber-500 text-black shadow-lg'
                          : 'bg-black/65 border-white/25 text-white/90 backdrop-blur-sm shadow-md'}`}
            style={{ left: `${pos.x}px`, top: `${pos.y}px`, pointerEvents: 'auto' }}
            onMouseEnter={() => setHovered(p.id)}
            onMouseLeave={() => setHovered((cur) => (cur === p.id ? null : cur))}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('concordia:prop-interact', {
                detail: { propId: p.id, propKind: p.kind, verb, position: p.position },
              }));
            }}
            data-prop-id={p.id}
            data-prop-kind={p.kind}
            data-verb={verb}
          >
            <span aria-hidden>✦ </span>{label}
          </button>
        );
      })}
    </div>
  );
}
