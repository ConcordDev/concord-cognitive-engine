'use client';

import { useEffect, useRef, useState } from 'react';

export interface LoadingScreenProps {
  /** 0..1 progress; -1 = indeterminate. */
  progress?: number;
  /** Label shown above the bar. */
  label?:    string;
  /** Optional secondary line (current asset / phase). */
  detail?:   string;
  /** Show / hide. */
  visible:   boolean;
  /** Compact inline mode (no full-screen overlay). */
  inline?:   boolean;
}

/**
 * Loading screen for world-lens hydration + heavy lens transitions.
 *
 * Renders a progress bar with neon-lattice gradient + the brand mark.
 * Use `progress = -1` for indeterminate (sweeping shimmer); a number
 * in [0, 1] shows the fill at that percentage.
 *
 * The shimmer is pure CSS so it works while React is still hydrating.
 */
export default function LoadingScreen({
  progress = -1,
  label = 'Loading world',
  detail,
  visible,
  inline = false,
}: LoadingScreenProps) {
  const [mounted, setMounted] = useState(visible);
  const [opacity, setOpacity] = useState(visible ? 1 : 0);
  const shimmerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const id = setTimeout(() => setOpacity(1), 16);
      return () => clearTimeout(id);
    }
    setOpacity(0);
    const id = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(id);
  }, [visible]);

  if (!mounted) return null;

  const isIndeterminate = progress < 0 || progress > 1;
  const fillPct = isIndeterminate ? 35 : Math.max(0, Math.min(1, progress)) * 100;

  const container: React.CSSProperties = inline
    ? {
        opacity,
        transition: 'opacity 300ms ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 16,
      }
    : {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background:
          'radial-gradient(circle at 50% 50%, rgba(95,191,255,0.05) 0%, transparent 60%),' +
          'linear-gradient(180deg, #060812 0%, #0a0f1e 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        opacity,
        transition: 'opacity 300ms ease',
      };

  return (
    <div role="status" aria-label={label} style={container}>
      {!inline && (
        <div style={{ width: 56, height: 56, opacity: 0.95 }}>
          <svg viewBox="0 0 64 64" width={56} height={56}>
            <defs>
              <linearGradient id="loading-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"  stopColor="#5fbfff" />
                <stop offset="50%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="22" fill="none" stroke="url(#loading-grad)" strokeWidth={2} strokeDasharray="4 6" opacity={0.7} />
            <circle cx="32" cy="32" r="11" fill="url(#loading-grad)" opacity={0.85} />
          </svg>
        </div>
      )}

      <div
        style={{
          color: '#cbd5e1',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: 13,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>

      <div
        style={{
          width: inline ? '100%' : 360,
          height: 6,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 99,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          ref={shimmerRef}
          style={{
            width: `${fillPct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #5fbfff 0%, #a78bfa 50%, #ec4899 100%)',
            borderRadius: 99,
            transition: isIndeterminate ? 'none' : 'width 280ms ease',
            animation: isIndeterminate ? 'concord-loading-sweep 1.6s ease-in-out infinite' : undefined,
            position: 'relative',
          }}
        />
      </div>

      {detail && (
        <div style={{ color: '#64748b', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 11 }}>
          {detail}
        </div>
      )}

      <style>{`
        @keyframes concord-loading-sweep {
          0%   { margin-left: -35%; }
          50%  { margin-left: 65%; }
          100% { margin-left: 105%; }
        }
      `}</style>
    </div>
  );
}
