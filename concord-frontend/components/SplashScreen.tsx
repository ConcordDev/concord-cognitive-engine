'use client';

import { useEffect, useState } from 'react';

export interface SplashScreenProps {
  /** Show the splash. Caller flips to false when ready. */
  visible: boolean;
  /** Override the displayed tagline. Default: "Cognitive operating system" */
  tagline?: string;
  /** Show the brand mark + wordmark. Default true. */
  showLogo?: boolean;
  /** Auto-hide after this many ms. Optional. */
  autoHideMs?: number;
  /** Fired when the splash transitions to hidden. */
  onHidden?: () => void;
}

/**
 * Branded splash overlay used on first paint + cold start.
 *
 * Renders an animated gradient mesh background + the brand mark + the
 * "CONCORD" wordmark + a tagline. Fades out in 600ms when `visible`
 * flips to false; `onHidden` fires after the fade.
 *
 * The animation is pure CSS — no JS RAF — so the splash works even
 * before the React tree has hydrated.
 */
export default function SplashScreen({
  visible,
  tagline = 'Cognitive operating system',
  showLogo = true,
  autoHideMs,
  onHidden,
}: SplashScreenProps) {
  const [mounted, setMounted] = useState(visible);
  const [opacity, setOpacity] = useState(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // Allow the element to mount before bumping opacity to 1
      const id = setTimeout(() => setOpacity(1), 16);
      return () => clearTimeout(id);
    }
    setOpacity(0);
    const id = setTimeout(() => {
      setMounted(false);
      onHidden?.();
    }, 620);
    return () => clearTimeout(id);
  }, [visible, onHidden]);

  useEffect(() => {
    if (!visible || !autoHideMs) return;
    const id = setTimeout(() => setOpacity(0), autoHideMs);
    return () => clearTimeout(id);
  }, [visible, autoHideMs]);

  if (!mounted) return null;

  return (
    <div
      role="status"
      aria-label="Loading Concord"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background:
          'radial-gradient(circle at 30% 20%, rgba(95,191,255,0.16) 0%, transparent 60%),' +
          'radial-gradient(circle at 70% 80%, rgba(236,72,153,0.14) 0%, transparent 55%),' +
          'linear-gradient(180deg, #060812 0%, #0a0f1e 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        opacity,
        transition: 'opacity 600ms cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: opacity > 0.05 ? 'auto' : 'none',
      }}
    >
      {showLogo && (
        <div
          style={{
            width: 96,
            height: 96,
            position: 'relative',
            animation: 'concord-splash-spin 14s linear infinite',
          }}
        >
          <svg viewBox="0 0 64 64" width={96} height={96}>
            <defs>
              <linearGradient id="splash-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"  stopColor="#5fbfff" />
                <stop offset="50%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="30" fill="none" stroke="url(#splash-grad)" strokeWidth={2.4} opacity={0.65} />
            <circle cx="32" cy="32" r="19" fill="none" stroke="url(#splash-grad)" strokeWidth={2}    opacity={0.82} />
            <circle cx="32" cy="32" r="8.5" fill="url(#splash-grad)" opacity={0.95} />
            <circle cx="32" cy="32" r="3.4" fill="#fff" />
            <g opacity={0.75} stroke="url(#splash-grad)" strokeWidth={2} strokeLinecap="round">
              <line x1="32" y1="2"  x2="32" y2="11" />
              <line x1="32" y1="53" x2="32" y2="62" />
              <line x1="2"  y1="32" x2="11" y2="32" />
              <line x1="53" y1="32" x2="62" y2="32" />
              <line x1="9"  y1="9"  x2="16" y2="16" />
              <line x1="48" y1="48" x2="55" y2="55" />
              <line x1="55" y1="9"  x2="48" y2="16" />
              <line x1="16" y1="48" x2="9"  y2="55" />
            </g>
          </svg>
        </div>
      )}
      <div
        style={{
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          fontSize: 38,
          fontWeight: 600,
          letterSpacing: '0.16em',
          background: 'linear-gradient(90deg, #5fbfff 0%, #a78bfa 50%, #ec4899 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        CONCORD
      </div>
      <div
        style={{
          color: '#94a3b8',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          fontSize: 13,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        {tagline}
      </div>
      <style>{`
        @keyframes concord-splash-spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
