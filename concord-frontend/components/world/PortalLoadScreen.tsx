'use client';

/**
 * PortalLoadScreen — Phase J.
 *
 * Full-screen blocking overlay shown during scene swap. 5 phases:
 *   idle           — not visible.
 *   requesting     — "Reaching for [world]…"  (HTTP round-trip)
 *   spawning       — "Awakening [world]…"     (worker spawn, may be 2-3s)
 *   loading-assets — "Loading world geometry…" (scene teardown + spawn)
 *   complete       — fade out
 *   error          — "Could not reach [world]" + retry button
 *
 * Reads `flavor` (Phase G) when supplied so the wait reads as intentional
 * — climate band + voice tone chips so the player sees what they're
 * about to step into.
 */

import { useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, Globe } from 'lucide-react';
import type { TravelPhase } from '@/hooks/useWorldTravel';

interface PortalLoadScreenProps {
  phase: TravelPhase;
  targetWorldId: string | null;
  error?: string | null;
  flavor?: {
    description?: string;
    climate?: { baseTemp?: number; humidity?: number; weather?: string; illumination?: number };
    worldVoice?: { tone?: string };
    npcDensity?: { targetPerFaction?: number };
  } | null;
  onRetry?: () => void;
}

export function PortalLoadScreen({ phase, targetWorldId, error, flavor, onRetry }: PortalLoadScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (phase === 'complete') {
      const t = setTimeout(() => setFadeOut(true), 200);
      return () => clearTimeout(t);
    }
    setFadeOut(false);
  }, [phase]);

  if (phase === 'idle' || (phase === 'complete' && fadeOut)) return null;

  const worldName = targetWorldId ? targetWorldId.replace(/-/g, ' ') : 'the next world';
  const message =
    phase === 'requesting'     ? `Reaching for ${worldName}…` :
    phase === 'spawning'       ? `Awakening ${worldName}…` :
    phase === 'loading-assets' ? `Loading ${worldName} geometry…` :
    phase === 'complete'       ? `Welcome to ${worldName}` :
    phase === 'error'          ? `Could not reach ${worldName}` :
                                 '';

  const climateChip = flavor?.climate ? formatClimateChip(flavor.climate) : null;
  const voiceTone   = flavor?.worldVoice?.tone?.split(',')[0]?.trim() ?? null;
  const density     = flavor?.npcDensity?.targetPerFaction ?? null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-fuchsia-950/50 to-slate-950 transition-opacity duration-500 ${phase === 'complete' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      {phase !== 'error' ? (
        <>
          <Sparkles className="h-12 w-12 animate-pulse text-fuchsia-400" aria-hidden="true" />
          <h2 className="mt-6 text-2xl font-light tracking-wide text-slate-100 capitalize">{message}</h2>
          <Loader2 className="mt-4 h-6 w-6 animate-spin text-fuchsia-300" aria-hidden="true" />
        </>
      ) : (
        <>
          <AlertTriangle className="h-12 w-12 text-red-400" aria-hidden="true" />
          <h2 className="mt-6 text-2xl font-light tracking-wide text-red-100">{message}</h2>
          {error && <p className="mt-2 text-sm text-red-300/80">{error}</p>}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200 hover:bg-red-500/20"
            >
              Retry
            </button>
          )}
        </>
      )}

      {/* Flavor chips — give the wait a story */}
      {(flavor?.description || climateChip || voiceTone || density != null) && phase !== 'error' && (
        <div className="mt-10 max-w-xl text-center">
          {flavor?.description && (
            <p className="mb-4 text-sm italic text-fuchsia-200/80">{flavor.description}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {climateChip && <Chip icon={<Globe className="h-3 w-3" />}>{climateChip}</Chip>}
            {voiceTone && <Chip>{voiceTone}</Chip>}
            {density != null && <Chip>{density} per faction</Chip>}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-medium text-fuchsia-200">
      {icon}
      {children}
    </span>
  );
}

function formatClimateChip(c: { baseTemp?: number; humidity?: number; weather?: string; illumination?: number }) {
  const parts: string[] = [];
  if (c.weather) parts.push(c.weather.replace(/-/g, ' '));
  if (typeof c.baseTemp === 'number') parts.push(`${c.baseTemp}°C`);
  if (typeof c.illumination === 'number') {
    if (c.illumination < 0.5) parts.push('dim');
    else if (c.illumination > 1.1) parts.push('bright');
  }
  return parts.join(' · ') || 'climate';
}
