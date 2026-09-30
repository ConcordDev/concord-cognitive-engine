'use client';

/**
 * TickStreamProvider — shared /api/events → tickHistory derivation for
 * stream/stats/timeline/health panels. Extracted from lenses/tick/page.tsx.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { TickEvent } from '@/components/tick/tick-model';

export type TickStats = {
  avgSignal: number;
  avgStress: number;
  minSignal: number;
  maxSignal: number;
  minStress: number;
  maxStress: number;
  avgInterval: number;
  minInterval: number;
  maxInterval: number;
  missedTicks: number;
  totalTicks: number;
  typeBreakdown: Record<string, number>;
  organBreakdown: Record<string, number>;
};

export type TickHealth = {
  level: 'unknown' | 'healthy' | 'degraded' | 'critical';
  message: string;
  score: number;
};

type TickStreamValue = {
  isLive: boolean;
  setIsLive: (v: boolean | ((p: boolean) => boolean)) => void;
  tickHistory: TickEvent[];
  stats: TickStats;
  healthStatus: TickHealth;
  lastTickTime: number | null;
  formatMs: (ms: number) => string;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
};

const TickStreamContext = createContext<TickStreamValue | null>(null);

export function TickStreamProvider({ children }: { children: ReactNode }) {
  const [isLive, setIsLive] = useState(true);
  const [tickHistory, setTickHistory] = useState<TickEvent[]>([]);

  const { data: events, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/api/events').then((r) => r.data),
    refetchInterval: isLive ? 2000 : false,
  });

  const prevEventIdsRef = useRef<string>('');

  useEffect(() => {
    if (events?.events) {
      const eventIds = events.events
        .slice(0, 50)
        .map((e: Record<string, unknown>) => e.id || '')
        .join(',');
      if (eventIds === prevEventIdsRef.current) return;
      prevEventIdsRef.current = eventIds;

      const ticks: TickEvent[] = events.events.slice(0, 50).map((e: Record<string, unknown>, i: number) => ({
        id: (e.id as string) || `tick-${i}`,
        type: (e.type as string) || 'kernel',
        signal: Number(e.severity ?? e.priority ?? 0.5),
        stress: Number(e.stress ?? e.urgency ?? (e.type === 'error' ? 0.25 : 0.1)),
        timestamp: (e.at as string) || (e.timestamp as string) || new Date().toISOString(),
        organ: (e.source as string) || (e.domain as string) || 'unknown',
      }));
      setTickHistory(ticks);
    }
  }, [events]);

  const stats = useMemo(() => {
    if (tickHistory.length === 0) {
      return {
        avgSignal: 0, avgStress: 0, minSignal: 0, maxSignal: 0, minStress: 0, maxStress: 0,
        avgInterval: 0, minInterval: 0, maxInterval: 0, missedTicks: 0, totalTicks: 0,
        typeBreakdown: {} as Record<string, number>, organBreakdown: {} as Record<string, number>,
      };
    }
    const signals = tickHistory.map(t => t.signal);
    const stresses = tickHistory.map(t => t.stress);
    const avgSignal = signals.reduce((s, v) => s + v, 0) / signals.length;
    const avgStress = stresses.reduce((s, v) => s + v, 0) / stresses.length;
    const timestamps = tickHistory
      .map(t => new Date(t.timestamp).getTime())
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i] - timestamps[i - 1]);
    const avgInterval = intervals.length > 0 ? intervals.reduce((s, v) => s + v, 0) / intervals.length : 0;
    const minInterval = intervals.length > 0 ? Math.min(...intervals) : 0;
    const maxInterval = intervals.length > 0 ? Math.max(...intervals) : 0;
    const missedTicks = avgInterval > 0 ? intervals.filter(i => i > avgInterval * 3).length : 0;
    const typeBreakdown: Record<string, number> = {};
    const organBreakdown: Record<string, number> = {};
    tickHistory.forEach(t => {
      typeBreakdown[t.type] = (typeBreakdown[t.type] || 0) + 1;
      if (t.organ) organBreakdown[t.organ] = (organBreakdown[t.organ] || 0) + 1;
    });
    return {
      avgSignal, avgStress,
      minSignal: Math.min(...signals), maxSignal: Math.max(...signals),
      minStress: Math.min(...stresses), maxStress: Math.max(...stresses),
      avgInterval, minInterval, maxInterval, missedTicks,
      totalTicks: tickHistory.length, typeBreakdown, organBreakdown,
    };
  }, [tickHistory]);

  const healthStatus = useMemo(() => {
    if (tickHistory.length < 3) return { level: 'unknown' as const, message: 'Insufficient data', score: 0 };
    let score = 100;
    if (stats.avgStress > 0.3) score -= 20;
    else if (stats.avgStress > 0.15) score -= 10;
    if (stats.avgSignal < 0.2) score -= 15;
    score -= stats.missedTicks * 10;
    if (stats.maxInterval > 0 && stats.minInterval > 0) {
      const ratio = stats.maxInterval / stats.minInterval;
      if (ratio > 10) score -= 20;
      else if (ratio > 5) score -= 10;
    }
    const errorCount = stats.typeBreakdown['error'] || 0;
    score -= errorCount * 5;
    score = Math.max(0, Math.min(100, score));
    const level = score >= 80 ? 'healthy' as const : score >= 50 ? 'degraded' as const : 'critical' as const;
    const message = level === 'healthy' ? 'System operating normally'
      : level === 'degraded' ? 'Some irregularities detected'
      : 'Significant issues detected';
    return { level, message, score };
  }, [tickHistory.length, stats]);

  const lastTickTime = tickHistory.length > 0 ? new Date(tickHistory[0].timestamp).getTime() : null;

  const formatMs = useCallback((ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }, []);

  const value: TickStreamValue = {
    isLive, setIsLive, tickHistory, stats, healthStatus, lastTickTime, formatMs,
    isLoading, isError, error: (error as Error) || null, refetch,
  };

  return <TickStreamContext.Provider value={value}>{children}</TickStreamContext.Provider>;
}

export function useTickStream() {
  const ctx = useContext(TickStreamContext);
  if (!ctx) throw new Error('useTickStream must be used within TickStreamProvider');
  return ctx;
}
