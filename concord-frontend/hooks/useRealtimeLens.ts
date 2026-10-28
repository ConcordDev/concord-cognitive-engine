'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSocket } from './useSocket';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/**
 * Freshness of the snapshot loaded from GET /api/realtime/feed/:event on mount (the same
 * payload the socket event carries, plus metadata). `unavailable` is an honest "nothing
 * cached" (with `lastOkAt` when there was ever data) — never placeholder data.
 */
export interface RealtimeSnapshotMeta {
  event: string;
  status: 'fresh' | 'stale' | 'unavailable';
  stale: boolean;
  fetchedAt: string | null;
  reason?: string | null;
  lastOkAt?: string | null;
}

// Socket events that have a REST snapshot (server/emergent/realtime-feeds.js REALTIME_FEEDS).
// Other computed `${domain}:update` events (chat, graph, ...) have none, so the hook never asks.
const SNAPSHOT_EVENTS = new Set([
  'finance:ticker', 'crypto:ticker', 'news:update', 'weather:update', 'research:update',
  'economy:update', 'health:update', 'energy:update', 'legal:update', 'government:update',
  'realestate:update', 'aviation:update', 'insurance:update', 'manufacturing:update',
  'logistics:update', 'retail:update', 'fitness:update', 'agriculture:update', 'education:update',
]);

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
  /**
   * Socket-health claim: true whenever the realtime channel itself is
   * connected, independent of whether this specific domain has ever
   * pushed a payload. This is what badges (LiveIndicator et al.) should
   * render — see the note above `isLive` below for why.
   */
  isConnected: boolean;
  /**
   * Alias for `isConnected`, kept as the primary field name for
   * backward compatibility (~140 lens pages destructure `isLive` and
   * feed it straight into <LiveIndicator isLive={isLive} .../>).
   *
   * Semantics (fixed 2026-07-25 — was `isConnected && hasReceivedData`):
   * "connected" and "has received a domain event" are different claims.
   * The old definition meant any domain whose mapped event(s) legitimately
   * never fire (nothing to report, a slow cadence, a genuinely dead
   * server-side emitter) rendered a permanent "Disconnected" badge even
   * though the socket was healthy — reproduced live on the world lens
   * (keyed to `world:update`, which is emitted zero times anywhere in
   * server/). A lens keyed to an event nobody emits must not read as
   * broken. `isLive` now reflects socket health ONLY; use
   * `hasReceivedData` below for the separate, weaker "is this domain
   * actually streaming data" claim, which may legitimately be false with
   * no error (e.g. a domain on a 25–50 minute cadence between server
   * ticks). This can never lie in the dangerous direction — it is
   * `isConnected`, so it is false whenever the socket is actually down.
   */
  isLive: boolean;
  /**
   * The weaker, separate claim: at least one of this domain's mapped
   * events has actually fired this session. Distinct from `isLive` —
   * see the comment there. A domain can be honestly connected
   * (`isLive: true`) with `hasReceivedData: false` (nothing to report
   * yet, or a genuinely dead server-side event — see the invariant test
   * at server/tests/invariants/realtime-lens-event-liveness.test.js).
   */
  hasReceivedData: boolean;
  lastUpdated: string | null;
  /**
   * Metadata of the on-mount snapshot (null until it loads, or when this domain has no snapshot
   * endpoint). `snapshot.stale` / `status: 'unavailable'` let a consumer show "as of HH:MM",
   * a stale badge, or "source temporarily unavailable". A live socket push supersedes it
   * (`snapshot.status` becomes 'fresh').
   */
  snapshot: RealtimeSnapshotMeta | null;
  clearAlerts: () => void;
}

// Maps lens domain to WebSocket event names. A domain with no entry here
// falls back to a single computed `${domain}:update` event (see the
// `useMemo` below) — that's how 'chat' and 'graph' get wired without an
// explicit map line: app/lenses/chat/page.tsx and app/lenses/graph/page.tsx
// call useRealtimeLens('chat') / useRealtimeLens('graph'), which resolves
// to socket.on('chat:update', ...) / socket.on('graph:update', ...) at
// runtime. Both are real, server-emitted events (server/routes/chat.js,
// server/server.js) — but because the event name here is a template
// literal, not a string constant, static scanners (dead-event-listener-
// detector.js, server/tests/invariants/emit-subscribe-pairing.test.js)
// can't trace the pairing and flag both as dead. Confirmed false positive,
// not a real gap — DET-C batch 10 (2026-07-24).
//
// Every literal event name below is cross-checked against real server
// emit sites by server/tests/invariants/realtime-lens-event-liveness.test.js
// — that test fails if a new entry here has no corresponding
// realtimeEmit/socket-emit call anywhere in server/, which is exactly how
// 4 dead names (finance:market_update, finance:alert, news:breaking,
// weather:alert — verified 2026-07-25 via direct read of
// server/emergent/realtime-feeds.js and server/lib/event-shapes.js's
// LENIENT_EVENTS registry: no emitter for any of the four, anywhere)
// were caught and removed from this map. The remaining events ARE real:
// finance:ticker/crypto:ticker/news:update/weather:update/research:update/
// economy:update/health:update/energy:update emit via direct literal
// `realtimeEmit("name", ...)` calls, and the 11 RSS-domain events
// (legal/government/realestate/aviation/insurance/manufacturing/
// logistics/retail/fitness/agriculture/education `:update`) emit via
// `_tickRssDomain(domain, feeds, eventName, ...)` — an indirection where
// the literal name is the 3rd call argument, not the first arg to
// `realtimeEmit` itself (a naive literal-string scan of `realtimeEmit(`
// misses these; the invariant test resolves this specific indirection —
// see its own header comment).
const DOMAIN_EVENTS: Record<string, string[]> = {
  finance: ['finance:ticker'],
  // Construction trades, not stock trading: producer prices / industrial
  // production (BLS PPI + Fed G.17) are the honest market signal for materials.
  trades: ['manufacturing:update'],
  crypto: ['crypto:ticker'],
  market: ['finance:ticker'],
  news: ['news:update'],
  environment: ['weather:update'],
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
  const [snapshot, setSnapshot] = useState<RealtimeSnapshotMeta | null>(null);
  // Set once any live socket payload lands, so a slower snapshot response can't overwrite newer data.
  const gotLive = useRef(false);

  // Snapshot on mount: a fresh page shows the latest cached payload immediately instead of
  // waiting up to several minutes for the next heartbeat push. One request per snapshot-capable
  // event, once per mount/domain; the socket listeners below keep it live afterwards.
  useEffect(() => {
    gotLive.current = false;
    setSnapshot(null);
    const wanted = events.filter(e => SNAPSHOT_EVENTS.has(e));
    if (!wanted.length) return;
    let cancelled = false;
    (async () => {
      for (const event of wanted) {
        try {
          const r = await api.get(`/api/realtime/feed/${encodeURIComponent(event)}`);
          if (cancelled) return;
          const body = r.data as {
            status?: RealtimeSnapshotMeta['status']; stale?: boolean; fetchedAt?: string;
            reason?: string; lastOkAt?: string | null; data?: RealtimeData | null;
          };
          const status = body.status ?? 'unavailable';
          const meta: RealtimeSnapshotMeta = {
            event, status, stale: !!body.stale, fetchedAt: body.fetchedAt ?? null,
            reason: body.reason ?? null, lastOkAt: body.lastOkAt ?? null,
          };
          if (gotLive.current) continue; // a socket push already delivered something newer
          if ((status === 'fresh' || status === 'stale') && body.data) {
            setLatestData(body.data);
            setLastUpdated(body.fetchedAt || body.data.fetchedAt || null);
            setSnapshot(meta);
            break; // first event with data wins (same precedence as socket order)
          }
          setSnapshot(prev => prev ?? meta);
        } catch {
          // Snapshot is best-effort: the socket path is unchanged, and no data is invented.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [domain, events]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handlers: Array<{ event: string; handler: (data: RealtimeData) => void }> = [];

    for (const event of events) {
      const handler = (data: RealtimeData) => {
        gotLive.current = true;
        setHasReceivedData(true);
        setLatestData(data);
        setLastUpdated(data.fetchedAt || new Date().toISOString());
        setSnapshot({ event, status: 'fresh', stale: false, fetchedAt: data.fetchedAt || null });

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
    // Socket-health claim — see the interface comment above `isLive` for
    // why this is no longer gated on `hasReceivedData`.
    isConnected,
    isLive: isConnected,
    // The separate, weaker "has this domain actually streamed data"
    // claim — may be honestly false with no error.
    hasReceivedData,
    lastUpdated,
    snapshot,
    clearAlerts,
  };
}
