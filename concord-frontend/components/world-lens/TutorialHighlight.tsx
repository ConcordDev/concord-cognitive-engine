'use client';

import { useEffect, useState } from 'react';

/**
 * TutorialHighlight — pulses a cyan ring around any element tagged with
 * `data-tutorial-target="<token>"` matching the active step's token.
 *
 * Listens to `concordia:tutorial-highlight` window events with detail
 * `{ token: string | null }`. Setting token to null clears the highlight.
 *
 * The ring is a position:fixed div that tracks the target's bounding rect
 * (re-measured every 200ms while active to handle layout shifts).
 */

interface Props {
  /** Optional initial token. */
  initialToken?: string | null;
}

export default function TutorialHighlight({ initialToken = null }: Props) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { token?: string | null } | undefined;
      setToken(detail?.token ?? null);
    };
    window.addEventListener('concordia:tutorial-highlight', handler);
    return () => window.removeEventListener('concordia:tutorial-highlight', handler);
  }, []);

  useEffect(() => {
    if (!token) {
      setRect(null);
      return;
    }
    function measure() {
      const el = document.querySelector(`[data-tutorial-target="${token}"]`) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      setRect(el.getBoundingClientRect());
    }
    measure();
    const id = setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [token]);

  if (!token || !rect) return null;

  // Inflate the ring by 8px so it sits clearly outside the element edge
  const pad = 8;

  return (
    <>
      <div
        className="fixed pointer-events-none z-[55] rounded-md"
        style={{
          left: rect.left - pad,
          top: rect.top - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          border: '2px solid rgba(34,211,238,0.85)',
          boxShadow: '0 0 0 6px rgba(34,211,238,0.15), 0 0 28px rgba(34,211,238,0.55), inset 0 0 18px rgba(34,211,238,0.2)',
          animation: 'tutorialRingPulse 1.4s ease-in-out infinite',
        }}
      />
      <style jsx>{`
        @keyframes tutorialRingPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.04); opacity: 0.78; }
        }
      `}</style>
    </>
  );
}
