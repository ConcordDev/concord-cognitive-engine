'use client';

/**
 * useBrainHealth — Polls brain health status every 30s.
 * Returns online/offline state for each brain with full stats.
 */

import { useState, useEffect, useCallback } from 'react';

interface BrainStats {
  requests: number;
  totalMs: number;
  dtusGenerated: number;
  errors: number;
  lastCallAt: string | null;
}

interface BrainState {
  online: boolean;
  enabled: boolean;
  model: string;
  role: string;
  avgResponseMs: number;
  stats: BrainStats;
}

interface BrainHealthStatus {
  mode: string;
  /** Enabled brains in the payload's brain list. Meaningful only after hasSnapshot. */
  onlineCount: number;
  /** Keys in the payload's brain list. Null until a status payload has arrived. */
  totalCount: number | null;
  /** True only after GET /api/brain/status returned a body. The initial zeros are not a measurement. */
  hasSnapshot: boolean;
  /** Every brain the status payload listed. The online fraction is counted from this, not a fixed set of four. */
  fleet: Record<string, BrainState>;
  conscious: BrainState | null;
  subconscious: BrainState | null;
  utility: BrainState | null;
  repair: BrainState | null;
}

const POLL_INTERVAL = 30000; // 30s

const offlineBrain: BrainState = {
  online: false,
  enabled: false,
  model: '',
  role: '',
  avgResponseMs: 0,
  stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null },
};

function emptyStatus(): BrainHealthStatus {
  return {
    mode: 'unknown',
    onlineCount: 0,
    totalCount: null,
    hasSnapshot: false,
    fleet: {},
    conscious: null,
    subconscious: null,
    utility: null,
    repair: null,
  };
}

/** Brains actually present on a status payload. Enabled/online are copied from that entry, not assumed. */
export function projectBrainFleet(raw: unknown): Record<string, BrainState> {
  if (!raw || typeof raw !== 'object') return {};
  const fleet: Record<string, BrainState> = {};
  for (const [name, brain] of Object.entries(raw as Record<string, Partial<BrainState> & { stats?: Partial<BrainStats> }>)) {
    if (!brain || typeof brain !== 'object') continue;
    const enabled = Boolean(brain.enabled);
    const stats: Partial<BrainStats> =
      brain.stats && typeof brain.stats === 'object' ? brain.stats : {};
    fleet[name] = {
      online: enabled || Boolean(brain.online),
      enabled,
      model: typeof brain.model === 'string' ? brain.model : '',
      role: typeof brain.role === 'string' ? brain.role : '',
      avgResponseMs: Number(brain.avgResponseMs) || 0,
      stats: {
        requests: Number(stats.requests) || 0,
        totalMs: Number(stats.totalMs) || 0,
        dtusGenerated: Number(stats.dtusGenerated) || 0,
        errors: Number(stats.errors) || 0,
        lastCallAt: stats.lastCallAt ?? null,
      },
    };
  }
  return fleet;
}

function namedOrOffline(fleet: Record<string, BrainState>, name: string): BrainState {
  return fleet[name] ?? offlineBrain;
}

export function useBrainHealth() {
  const [brainStatus, setBrainStatus] = useState<BrainHealthStatus>(emptyStatus);
  const [isLoading, setIsLoading] = useState(true);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/status', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const fleet = projectBrainFleet(data?.brains);
        const names = Object.keys(fleet);
        setBrainStatus({
          mode: typeof data?.mode === 'string' && data.mode ? data.mode : 'fallback',
          onlineCount: names.filter((name) => fleet[name].enabled || fleet[name].online).length,
          totalCount: names.length,
          hasSnapshot: true,
          fleet,
          conscious: namedOrOffline(fleet, 'conscious'),
          subconscious: namedOrOffline(fleet, 'subconscious'),
          utility: namedOrOffline(fleet, 'utility'),
          repair: namedOrOffline(fleet, 'repair'),
        });
      } else {
        // Transient admission/shed 503s are common under load. Do NOT sticky-mark
        // every brain offline — that painted a permanent yellow GracefulFallback
        // strip even while chat could still send. Keep last-known-good status.
        setBrainStatus((prev) => (prev.hasSnapshot ? prev : emptyStatus()));
      }
    } catch {
      // Network blip / aborted poll — preserve last-known-good; never sticky all-offline.
      setBrainStatus((prev) => (prev.hasSnapshot ? prev : emptyStatus()));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [check]);

  return { brainStatus, isLoading, refresh: check };
}
