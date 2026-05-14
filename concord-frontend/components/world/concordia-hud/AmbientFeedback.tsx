'use client';

/**
 * AmbientFeedback — renders the two feedback channels that
 * WorldInteractionSink emits:
 *   - concordia:toast            → small fading text in lower-centre
 *   - concordia:ambient-sparkle  → brief CSS sparkle at click position
 *
 * Both are intentionally tiny + transient — they exist so no player
 * click feels like it went nowhere, not to add HUD noise.
 */

import { useEffect, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  kind: 'ambient' | 'info' | 'warn' | 'error';
  ttl_ms: number;
  bornAt: number;
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
  bornAt: number;
}

const TOAST_MAX = 3;
const SPARKLE_TTL_MS = 800;
const TOAST_TONE: Record<Toast['kind'], string> = {
  ambient: 'text-zinc-300/90',
  info:    'text-amber-200',
  warn:    'text-orange-300',
  error:   'text-red-300',
};

let _id = 0;
const nextId = () => ++_id;

export function AmbientFeedback() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onToast(e: Event) {
      const d = (e as CustomEvent).detail as { message?: string; kind?: Toast['kind']; ttl_ms?: number } | undefined;
      if (!d?.message) return;
      const t: Toast = {
        id: nextId(),
        message: d.message,
        kind: d.kind || 'ambient',
        ttl_ms: d.ttl_ms || 2200,
        bornAt: Date.now(),
      };
      setToasts((cur) => [...cur.slice(-TOAST_MAX + 1), t]);
    }
    function onSparkle(e: Event) {
      const d = (e as CustomEvent).detail as { x?: number; y?: number } | undefined;
      if (!d?.x || !d?.y) return;
      const s: Sparkle = { id: nextId(), x: d.x, y: d.y, bornAt: Date.now() };
      setSparkles((cur) => [...cur, s]);
    }
    window.addEventListener('concordia:toast', onToast);
    window.addEventListener('concordia:ambient-sparkle', onSparkle);
    return () => {
      window.removeEventListener('concordia:toast', onToast);
      window.removeEventListener('concordia:ambient-sparkle', onSparkle);
    };
  }, []);

  // GC expired toasts + sparkles.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setToasts((cur) => cur.filter((t) => now - t.bornAt < t.ttl_ms));
      setSparkles((cur) => cur.filter((s) => now - s.bornAt < SPARKLE_TTL_MS));
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      {/* Toast column */}
      <div className="fixed left-1/2 -translate-x-1/2 bottom-32 z-30 pointer-events-none flex flex-col items-center gap-1" data-testid="hud-ambient-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`text-xs px-3 py-1 bg-zinc-950/85 border border-zinc-700/60 rounded-full backdrop-blur-sm shadow ${TOAST_TONE[t.kind]} animate-fadeOut`}
            style={{ animationDuration: `${t.ttl_ms}ms` }}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Sparkle layer — anchored to click position, fades */}
      <div className="fixed inset-0 z-25 pointer-events-none" data-testid="hud-ambient-sparkles" aria-hidden="true">
        {sparkles.map((s) => (
          <span
            key={s.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-amber-200/80 text-xs animate-sparkle"
            style={{ left: s.x, top: s.y, animationDuration: `${SPARKLE_TTL_MS}ms` }}
          >
            ✦
          </span>
        ))}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeOut {
          0% { opacity: 0; transform: translateY(8px); }
          15% { opacity: 1; transform: translateY(0); }
          85% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        .animate-fadeOut { animation-name: fadeOut; animation-timing-function: ease-out; animation-fill-mode: forwards; }
        @keyframes sparkle {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          30% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.0); }
        }
        .animate-sparkle { animation-name: sparkle; animation-timing-function: ease-out; animation-fill-mode: forwards; }
      ` }} />
    </>
  );
}
