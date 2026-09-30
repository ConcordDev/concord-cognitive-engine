'use client';

/**
 * SovereignHealthRibbon — the "metabolic status" strip pinned in the header.
 *
 * Honest by construction: every value is read straight from GET
 * /api/system/health (public). Nothing is fabricated — if the fetch fails
 * the chips go gray/"—", they never invent a green "all systems go".
 *
 * States per chip:
 *   green + pulse  — live / healthy
 *   amber          — degraded (partial brains, stale heartbeat)
 *   zinc           — unreachable / unknown
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Brain, Activity, Boxes } from 'lucide-react';

interface HealthPayload {
  ok?: boolean;
  health?: {
    uptime?: number;
    brains?: {
      mode?: 'five_brain' | 'partial' | 'fallback';
      onlineCount?: number;
      brains?: Record<string, { enabled?: boolean; model?: string; provider?: string; avgResponseMs?: number }>;
    };
    heartbeat?: { tick?: number; lastTickAgoMs?: number | null; alive?: boolean };
    substrate?: { total?: number; compacted?: number };
  };
}

function fmtUptime(s?: number): string {
  if (!s || s < 0) return '—';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${(s / 3600).toFixed(1)}h`;
  return `${Math.round(s / 86400)}d`;
}

type Tone = 'live' | 'warn' | 'dim';
const dot: Record<Tone, string> = {
  live: 'bg-emerald-400',
  warn: 'bg-amber-400',
  dim: 'bg-zinc-500',
};
const text: Record<Tone, string> = {
  live: 'text-emerald-300/90',
  warn: 'text-amber-300/90',
  dim: 'text-zinc-500',
};

function Chip({
  icon: Icon,
  tone,
  label,
  title,
}: {
  icon: typeof Brain;
  tone: Tone;
  label: string;
  title: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md"
      title={title}
    >
      <span className="relative flex h-1.5 w-1.5">
        {tone === 'live' && (
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${dot[tone]}`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      </span>
      <Icon className={`w-3.5 h-3.5 ${text[tone]}`} />
      <span className={`hidden xl:inline text-[11px] font-mono tracking-tight ${text[tone]}`}>{label}</span>
    </div>
  );
}

export function SovereignHealthRibbon() {
  const { data, isError } = useQuery<HealthPayload>({
    queryKey: ['sovereign-health'],
    queryFn: () => api.get('/api/system/health').then((r) => r.data),
    refetchInterval: 12_000,
    staleTime: 12_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const h = data?.health;
  const reachable = !isError && !!h;

  // Brain
  const mode = h?.brains?.mode;
  const online = h?.brains?.onlineCount ?? 0;
  const brainTone: Tone = !reachable ? 'dim' : mode === 'five_brain' ? 'live' : online > 0 ? 'warn' : 'dim';
  const consciousMs = h?.brains?.brains?.conscious?.avgResponseMs;
  const brainLabel = !reachable ? '—' : `${online} brain${online === 1 ? '' : 's'}`;
  const brainTitle = !reachable
    ? 'Brain status unavailable'
    : `${online}/5 cognitive brains online (${mode})` +
      (consciousMs ? ` · conscious avg ${(consciousMs / 1000).toFixed(1)}s` : '');

  // Heartbeat — the governorTick loop only starts ~50s after boot, so a
  // fresh process legitimately has no tick yet: that's "warming", not "stalled".
  const hb = h?.heartbeat;
  const hbAlive = !!hb?.alive;
  const warming = (h?.uptime ?? 0) < 90;
  const hbTone: Tone = !reachable ? 'dim' : hbAlive ? 'live' : warming ? 'dim' : 'warn';
  const hbLabel = !reachable ? '—' : hbAlive ? `tick ${hb?.tick ?? 0}` : warming ? 'warming' : 'stalled';
  const hbTitle = !reachable
    ? 'Heartbeat status unavailable'
    : hbAlive
      ? `governorTick alive — tick ${hb?.tick ?? 0}, ${Math.round((hb?.lastTickAgoMs ?? 0) / 1000)}s ago`
      : warming
        ? 'Heartbeat loop starting (boot + ~50s)'
        : `Heartbeat stale (last tick ${Math.round((hb?.lastTickAgoMs ?? 0) / 1000)}s ago)`;

  // Substrate
  const sub = h?.substrate;
  const subTone: Tone = !reachable ? 'dim' : 'live';
  const subLabel = !reachable ? '—' : `${sub?.total ?? 0} DTU`;
  const subTitle = !reachable
    ? 'Substrate status unavailable'
    : `${sub?.total ?? 0} DTUs in the substrate · ${sub?.compacted ?? 0} consolidated into MEGA/HYPER · up ${fmtUptime(h?.uptime)}`;

  return (
    <div
      role="status"
      aria-label="System health"
      className="hidden sm:flex items-center gap-0.5 rounded-lg border border-lattice-border/60 bg-lattice-deep/50 px-1"
    >
      <Chip icon={Brain} tone={brainTone} label={brainLabel} title={brainTitle} />
      <Chip icon={Activity} tone={hbTone} label={hbLabel} title={hbTitle} />
      <Chip icon={Boxes} tone={subTone} label={subLabel} title={subTitle} />
    </div>
  );
}

export default SovereignHealthRibbon;
