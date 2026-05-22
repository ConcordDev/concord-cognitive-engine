'use client';

/**
 * useLiveStatus — drives the System Lens auto-refresh / live-polling loop.
 * Hits the lightweight `system.live-status` macro which captures a fresh
 * process sample and returns aggregate counts (sample, heartbeat health,
 * firing alerts, trace count) in one call. The boolean `live` flag is
 * shared down to every realtime panel so a single pause stops all of them.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface LiveStatus {
  sample: {
    cpuPct: number;
    heapUsedMB: number;
    heapPct: number;
    rssMB: number;
    requestRate: number;
    uptimeSec: number;
  };
  heartbeats: { total: number; ok: number; unhealthy: number };
  alerts: { firing: number; unacknowledgedFiring: number };
  traceCount: number;
  pollAt: string;
}

export function useLiveStatus(intervalMs = 15_000) {
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const poll = useCallback(async () => {
    const r = await lensRun<LiveStatus>('system', 'live-status', {});
    if (r.data.ok && r.data.result) {
      setStatus(r.data.result);
      setPollCount((c) => c + 1);
    }
  }, []);

  useEffect(() => {
    poll();
    if (!live) return;
    const t = setInterval(poll, intervalMs);
    return () => clearInterval(t);
  }, [live, intervalMs, poll]);

  return { live, setLive, status, pollCount, poll };
}
