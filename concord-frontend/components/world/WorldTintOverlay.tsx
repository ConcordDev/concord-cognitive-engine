'use client';

/**
 * WorldTintOverlay — consumer for `concordia:world-tint`.
 *
 * TimeLoopHUD (and others) dispatch `concordia:world-tint` { source, color,
 * intensity } as a loop nears expiry — but NOTHING consumed it (the CLAUDE.md
 * "shader pipeline consumes these" note was aspirational; the wire was dead, so
 * the loop's red-warning tint never appeared). This renders that tint as a
 * full-screen DOM wash — no GPU/post-processing dependency, so it actually
 * shows. A self-decaying TTL means a source that stops emitting fades the tint
 * out instead of leaving it stuck on screen.
 */

import { useEffect, useRef, useState } from 'react';

interface TintState { color: string; intensity: number; }

const TTL_MS = 4000; // fade out if no update arrives within this window

export default function WorldTintOverlay() {
  const [tint, setTint] = useState<TintState>({ color: '#ff2a2a', intensity: 0 });
  const decayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onTint = (e: Event) => {
      const detail = (e as CustomEvent).detail as { color?: string; intensity?: number } | undefined;
      const intensity = Math.max(0, Math.min(1, Number(detail?.intensity ?? 0)));
      setTint({ color: detail?.color || '#ff2a2a', intensity });
      if (decayRef.current) clearTimeout(decayRef.current);
      if (intensity > 0) {
        // Auto-clear if the source goes quiet (no stuck tint).
        decayRef.current = setTimeout(() => setTint((t) => ({ ...t, intensity: 0 })), TTL_MS);
      }
    };
    window.addEventListener('concordia:world-tint', onTint);
    return () => {
      window.removeEventListener('concordia:world-tint', onTint);
      if (decayRef.current) clearTimeout(decayRef.current);
    };
  }, []);

  if (tint.intensity <= 0) return null;

  return (
    <div
      aria-hidden
      data-testid="world-tint-overlay"
      className="fixed inset-0 z-[12] pointer-events-none"
      style={{
        backgroundColor: tint.color,
        // Cap the wash so the world stays legible even at full intensity.
        opacity: tint.intensity * 0.45,
        mixBlendMode: 'multiply',
        transition: 'opacity 600ms ease-out',
      }}
    />
  );
}
