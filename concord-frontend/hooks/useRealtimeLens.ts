'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSocket } from './useSocket';
import { useQueryClient } from '@tanstack/react-query';

interface RealtimeData {
  [key: string]: unknown;
  ok?: boolean;
  fetchedAt?: string;
}

interface RealtimeAlert {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
}

interface UseRealtimeLensResult {
  latestData: RealtimeData | null;
  alerts: RealtimeAlert[];
  insights: Array<{ domain: string; insight: string; confidence: number; timestamp: string }>;
  isLive: boolean;
  lastUpdated: string | null;
  clearAlerts: () => void;
}

// Maps lens domain to WebSocket event names
const DOMAIN_EVENTS: Record<string, string[]> = {
  finance: ['finance:ticker', 'finance:market_update', 'finance:alert'],
  crypto: ['crypto:ticker', 'finance:alert'],
  market: ['finance:ticker', 'finance:market_update'],
  news: ['news:update', 'news:breaking'],
  environment: ['weather:update', 'weather:alert'],
  eco: ['weather:update', 'agriculture:update'],
  healthcare: ['health:update'],
  education: ['education:update'],
  legal: ['legal:update'],
  government: ['government:update'],
  realestate: ['realestate:update'],
  aviation: ['aviation:update'],
  insurance: ['insurance:update'],
  manufacturing: ['manufacturing:update'],
  logistics: ['logistics:update'],
  energy: ['energy:update'],
  retail: ['retail:update'],
  research: ['research:update'],
  science: ['research:update'],
  paper: ['research:update'],
  bio: ['research:update'],
  chem: ['research:update'],
  physics: ['research:update'],
  fitness: ['fitness:update'],
  food: ['health:update'],
  accounting: ['economy:update'],
  agriculture: ['agriculture:update'],
};

export function useRealtimeLens(domain: string): UseRealtimeLensResult {
  const { socket, isConnected } = useSocket();
  const queryClient = useQueryClient();
  const [latestData, setLatestData] = useState<RealtimeData | null>(null);
  const [alerts, setAlerts] = useState<RealtimeAlert[]>([]);
  const [insights, setInsights] = useState<Array<{ domain: string; insight: string; confidence: number; timestamp: string }>>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [hasReceivedData, setHasReceivedData] = useState(false);
  const alertIdCounter = useRef(0);

  const events = useMemo(() => DOMAIN_EVENTS[domain] || [`${domain}:update`], [domain]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handlers: Array<{ event: string; handler: (data: RealtimeData) => void }> = [];

    for (const event of events) {
      const handler = (data: RealtimeData) => {
        setHasReceivedData(true);
        setLatestData(data);
        setLastUpdated(data.fetchedAt || new Date().toISOString());

        // Invalidate TanStack Query cache for this domain
        queryClient.invalidateQueries({ queryKey: [domain] });
        queryClient.invalidateQueries({ queryKey: ['lens', domain] });
      };
      socket.on(event, handler);
      handlers.push({ event, handler });
    }

    // Listen for alerts
    const alertEvents = events.filter(e => e.includes(':alert') || e.includes(':breaking'));
    for (const event of alertEvents) {
      const alertHandler = (data: RealtimeData) => {
        const alert: RealtimeAlert = {
          id: `alert-${++alertIdCounter.current}`,
          message: String((data as Record<string, unknown>).message || (data as Record<string, unknown>).title || 'New alert'),
          severity: String((data as Record<string, unknown>).severity || 'info') as RealtimeAlert['severity'],
          timestamp: new Date().toISOString(),
        };
        setAlerts(prev => [...prev.slice(-19), alert]);
      };
      socket.on(event, alertHandler);
      handlers.push({ event, handler: alertHandler });
    }

    // Listen for AI insights
    const insightHandler = (data: { domain: string; insight: string; confidence: number; timestamp: string }) => {
      if (data.domain === domain) {
        setInsights(prev => [...prev.slice(-9), data]);
      }
    };
    socket.on('agent:insights', insightHandler);
    handlers.push({ event: 'agent:insights', handler: insightHandler as (data: RealtimeData) => void });

    // Listen for domain-specific insights
    const domainInsightHandler = (data: { insight: string; confidence: number; timestamp: string }) => {
      setInsights(prev => [...prev.slice(-9), { domain, ...data }]);
    };
    socket.on(`${domain}:insight`, domainInsightHandler);
    handlers.push({ event: `${domain}:insight`, handler: domainInsightHandler as (data: RealtimeData) => void });

    return () => {
      for (const { event, handler } of handlers) {
        socket.off(event, handler);
      }
    };
  }, [socket, isConnected, domain, events, queryClient]);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  return {
    latestData,
    alerts,
    insights,
    isLive: isConnected && hasReceivedData,
    lastUpdated,
    clearAlerts,
  };
}
