'use client';

/**
 * DriftMoodboard — listens for `world:drift-alert` socket events from the
 * lattice-orchestrator and tints the world atmosphere accordingly.
 *
 * Implementation: a CSS overlay div that goes from fully-transparent to a
 * tinted gradient based on drift level. Renders behind everything (z-index
 * negative) so it's atmospheric, not blocking.
 *
 * Drift kinds → palette:
 *   goodhart        → sickly yellow-green
 *   memetic_drift   → magenta haze
 *   capability_creep → cool steel blue
 *   self_reference  → recursive purple
 *   echo_chamber    → muted grey-pink
 *   metric_divergence → orange-red
 *
 * Severity bumps the opacity. Effect fades after 90 s if no new alert
 * arrives.
 */

import { useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

const PALETTE: Record<string, string> = {
  goodhart: 'radial-gradient(circle at 50% 50%, rgba(180,200,40,0.35), transparent 75%)',
  memetic_drift: 'radial-gradient(circle at 50% 50%, rgba(220,40,180,0.30), transparent 70%)',
  capability_creep: 'radial-gradient(circle at 50% 50%, rgba(60,90,160,0.40), transparent 75%)',
  self_reference: 'radial-gradient(circle at 50% 50%, rgba(140,60,200,0.35), transparent 75%)',
  echo_chamber: 'radial-gradient(circle at 50% 50%, rgba(170,140,150,0.25), transparent 75%)',
  metric_divergence: 'radial-gradient(circle at 50% 50%, rgba(230,90,40,0.30), transparent 70%)',
  unknown: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.10), transparent 70%)',
};

interface Alert {
  kind: string;
  severity: string;
  summary?: string;
  detectedAt?: number;
}

export default function DriftMoodboard() {
  const [activeAlert, setActiveAlert] = useState<Alert | null>(null);

  useEffect(() => {
    const off = subscribe(
      'world:drift-alert' as Parameters<typeof subscribe>[0],
      (payload: unknown) => {
        const a = payload as Alert;
        if (!a?.kind) return;
        setActiveAlert(a);
      },
    );
    return () => off?.();
  }, []);

  useEffect(() => {
    if (!activeAlert) return;
    const t = window.setTimeout(() => setActiveAlert(null), 90_000);
    return () => window.clearTimeout(t);
  }, [activeAlert]);

  if (!activeAlert) return null;
  const palette = PALETTE[activeAlert.kind] || PALETTE.unknown;
  const severityScale = activeAlert.severity === 'critical' ? 1.5 : 1.0;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 transition-opacity duration-1000"
      style={{
        background: palette,
        opacity: severityScale * 0.7,
        mixBlendMode: 'multiply',
      }}
    />
  );
}
