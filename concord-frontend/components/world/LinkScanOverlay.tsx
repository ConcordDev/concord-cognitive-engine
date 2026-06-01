'use client';

/**
 * LinkScanOverlay — the Concord Link "scanner" (Starfield's one genuinely-good
 * idea, plus the isekai fiction). A CONTEXTUAL, on-demand overlay that reveals
 * the embodied-signal substrate (Layer 7) the player is standing in: temperature,
 * humidity, air quality, light, noise, pressure, structural stress, biome,
 * weather — "[System] reveals the hidden layers of the world."
 *
 * Discipline (the anti-Starfield "three spacings"):
 *  - Temporal: only on demand (toggle V), never auto-fires.
 *  - Spatial: edge-docked Glance panel — the 3D world keeps the screen.
 *  - Contextual: reads the player's *local* cell (signals_for_player), so it's
 *    about where you ARE, not a static menu.
 *
 * Backend is already wired (embodied.signals_for_player macro) — zero new server
 * surface. Kill-switch: NEXT_PUBLIC_CONCORD_LINK_SCAN=0.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Signals {
  temperature?: number; temp?: number;
  humidity?: number;
  airQuality?: number; air_quality?: number;
  light?: number;
  noise?: number;
  pressure?: number;
  structuralStress?: number; stress?: number;
  weatherKind?: string;
  biome?: string;
  hasData?: boolean;
}

interface Props {
  worldId: string;
  enabled?: boolean;
  pollMs?: number;
}

const ENV_ON = process.env.NEXT_PUBLIC_CONCORD_LINK_SCAN !== '0';

function fmt(n: number | undefined, digits = 0, unit = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${unit}`;
}

export default function LinkScanOverlay({ worldId, enabled = true, pollMs = 1500 }: Props) {
  const [open, setOpen] = useState(false);
  const [signals, setSignals] = useState<Signals | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Toggle on V (and a programmatic event so the radial/command-palette can open it).
  useEffect(() => {
    if (!enabled || !ENV_ON) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'v' || e.key === 'V') setOpen((o) => !o);
    };
    const onToggle = () => setOpen((o) => !o);
    window.addEventListener('keydown', onKey);
    window.addEventListener('concordia:link-scan-toggle', onToggle);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('concordia:link-scan-toggle', onToggle);
    };
  }, [enabled]);

  const fetchSignals = useCallback(async () => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'embodied', name: 'signals_for_player', input: { worldId } }),
      });
      if (!r.ok) return;
      const j = await r.json();
      const payload = (j.result || j) as { ok?: boolean; signals?: Signals };
      if (payload?.ok && payload.signals) setSignals(payload.signals);
    } catch { /* offline — keep last reading */ }
  }, [worldId]);

  // Poll only while open (no wasted network when the scanner is closed).
  useEffect(() => {
    if (!open) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    fetchSignals();
    timerRef.current = setInterval(fetchSignals, Math.max(600, pollMs));
    return () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
  }, [open, fetchSignals, pollMs]);

  if (!enabled || !ENV_ON || !open) return null;

  const s = signals || {};
  const temp = s.temperature ?? s.temp;
  const air = s.airQuality ?? s.air_quality;
  const stress = s.structuralStress ?? s.stress;
  const rows: Array<[string, string, string]> = [
    ['🌡', 'Temp', fmt(temp, 1, '°C')],
    ['💧', 'Humidity', fmt(s.humidity, 0, '%')],
    ['🜁', 'Air', fmt(air, 0, '%')],
    ['☀', 'Light', fmt(s.light, 0, ' lux')],
    ['🔊', 'Noise', fmt(s.noise, 0, ' dB')],
    ['◰', 'Pressure', fmt(s.pressure, 0, ' hPa')],
    ['⚠', 'Stress', fmt(stress, 2)],
  ];

  return (
    <div
      className="absolute top-1/2 right-4 -translate-y-1/2 z-[19] pointer-events-none select-none
                 w-56 rounded-lg border border-cyan-400/40 bg-slate-950/70 backdrop-blur-sm
                 text-cyan-100 font-mono text-xs shadow-[0_0_24px_rgba(74,210,255,0.25)]
                 animate-[fadeIn_180ms_ease-out]"
      data-testid="link-scan-overlay"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-400/30">
        <span className="tracking-widest text-cyan-300">LINK · SCAN</span>
        <span className="text-[10px] text-cyan-400/70">{s.biome || 'unknown'}</span>
      </div>
      {s.hasData === false ? (
        <div className="px-3 py-4 text-cyan-400/60">No ambient signal in this cell.</div>
      ) : (
        <div className="px-3 py-2 space-y-1">
          {rows.map(([glyph, label, val]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-cyan-400/80"><span className="mr-2">{glyph}</span>{label}</span>
              <span className="tabular-nums">{val}</span>
            </div>
          ))}
          {s.weatherKind && (
            <div className="pt-1 mt-1 border-t border-cyan-400/20 text-cyan-300/80">
              weather · {s.weatherKind}
            </div>
          )}
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-cyan-400/20 text-[10px] text-cyan-400/50">V to close</div>
    </div>
  );
}
