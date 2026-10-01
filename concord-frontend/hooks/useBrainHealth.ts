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
  onlineCount: number;
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

export function useBrainHealth() {
  const [brainStatus, setBrainStatus] = useState<BrainHealthStatus>({
    mode: 'unknown',
    onlineCount: 0,
    conscious: null,
    subconscious: null,
    utility: null,
    repair: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/status', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const brains = data.brains || {};
        setBrainStatus({
          mode: data.mode || 'fallback',
          onlineCount: data.onlineCount || 0,
          conscious: brains.conscious ? { ...brains.conscious, online: brains.conscious.enabled } : offlineBrain,
          subconscious: brains.subconscious ? { ...brains.subconscious, online: brains.subconscious.enabled } : offlineBrain,
          utility: brains.utility ? { ...brains.utility, online: brains.utility.enabled } : offlineBrain,
          repair: brains.repair ? { ...brains.repair, online: brains.repair.enabled } : offlineBrain,
        });
      } else {
        // Transient admission/shed 503s are common under load. Do NOT sticky-mark
        // every brain offline — that painted a permanent yellow GracefulFallback
        // strip even while chat could still send. Keep last-known-good status.
        setBrainStatus((prev) => {
          if (prev.conscious || prev.utility || prev.subconscious || prev.repair) return prev;
          return {
            mode: 'unknown',
            onlineCount: 0,
            conscious: null,
            subconscious: null,
            utility: null,
            repair: null,
          };
        });
      }
    } catch {
      // Network blip / aborted poll — preserve last-known-good; never sticky all-offline.
      setBrainStatus((prev) => {
        if (prev.conscious || prev.utility || prev.subconscious || prev.repair) return prev;
        return {
          mode: 'unknown',
          onlineCount: 0,
          conscious: null,
          subconscious: null,
          utility: null,
          repair: null,
        };
      });
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
