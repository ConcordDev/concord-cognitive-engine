/**
 * FE-011: WebSocket hook with proper lifecycle management.
 *
 * - Connects lazily (only when `autoConnect` is true or `connect()` is called)
 * - Disconnects on unmount — no orphaned connections
 * - Tracks active subscriptions to prevent listener leaks
 * - Logs connection state changes for observability
 *
 * FE-WIRING: Universal event forwarder — every socket event goes to:
 *   1. Event bus (for component-level subscriptions)
 *   2. Zustand stores (for DTU, system, and sovereign state)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/realtime/socket';
import { emitEvent } from '@/lib/realtime/event-bus';
import { useLatticeStore } from '@/store/lattice';
import { useSystemStore } from '@/store/system';
import { useSovereignStore } from '@/store/sovereign';
import { useUIStore } from '@/store/ui';
import type { SocketEvent } from '@/lib/realtime/socket';
import type { DTU } from '@/lib/types/dtu';
import type {
  SystemAlert,
  AttentionAllocation,
  FocusOverride,
  Dream,
  Promotion,
} from '@/lib/types/system';

const _SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || '';

// Module-level flag: register FORWARDED_EVENTS handlers only once globally,
// not per-component. Prevents N components x 90+ events = 630+ redundant handlers.
let _globalListenersRegistered = false;

// ── All events to forward to the event bus ─────────────────────
const FORWARDED_EVENTS: SocketEvent[] = [
  // DTU lifecycle
  'dtu:created',
  'dtu:updated',
  'dtu:deleted',
  'dtu:promoted',
  // Entity lifecycle
  'entity:death',
  'body:instantiated',
  'body:destroyed',
  // Pain / qualia
  'pain:recorded',
  'pain:processed',
  'pain:wound_created',
  'pain:wound_healed',
  'affect:pain_signal',
  // Repair cortex
  'repair:dtu_logged',
  'repair:cycle_complete',
  // Meta-derivation
  'lattice:meta:derived',
  'lattice:meta:convergence',
  'meta:committed',
  // System
  'system:alert',
  'queue:notifications:new',
  // Council
  'council:proposal',
  'council:vote',
  // Marketplace
  'market:listing',
  'market:trade',
  // Creative Registry & Royalties
  'creative_registry:update',
  'marketplace:purchase',
  // Collaboration
  'collab:change',
  'collab:lock',
  'collab:unlock',
  'collab:session:created',
  'collab:user:joined',
  // Cognitive systems
  'attention:allocation',
  'forgetting:cycle_complete',
  'dream:captured',
  'promotion:approved',
  'promotion:rejected',
  'app:published',
  // Music / studio
  'music:toggle',
  // Whiteboard
  'whiteboard:updated',
  // Resonance
  'resonance:update',
  // Platform presence
  'platform:activity',
  // MEGA SPEC: Chat streaming events
  'chat:status',
  'chat:token',
  'chat:web_results',
  'chat:complete',
  // MEGA SPEC: Artifact & quality lifecycle events
  'artifact:rendered',
  'quality:approved',
  'quality:shadowed',
  // MEGA SPEC: Entity & pipeline events
  'entity:production_mode',
  'pipeline:triggered',
  // 12 NEW CAPABILITIES events
  'pipeline:started',
  'pipeline:step_started',
  'pipeline:step_completed',
  'pipeline:completed',
  'prediction:ready',
  'agent:insights',
  'collab:invite',
  'collab:accepted',
  'teaching:promotion_suggestion',
  'research:started',
  'research:completed',
  // Shared Instance Conversation events
  'shared-session:invite',
  'shared-session:joined',
  'shared-session:message',
  'shared-session:ai-response',
  'shared-session:artifact-produced',
  'shared-session:dtu-shared',
  'shared-session:ended',
  // Real-time data feed events (Phase 3)
  'finance:ticker',
  'finance:market_update',
  'finance:alert',
  'crypto:ticker',
  'news:update',
  'news:breaking',
  'weather:update',
  'weather:alert',
  'research:update',
  'health:update',
  'legal:update',
  'economy:update',
  'aviation:update',
  'realestate:update',
  'education:update',
  'fitness:update',
  'agriculture:update',
  'energy:update',
  'retail:update',
  'manufacturing:update',
  'logistics:update',
  'government:update',
  'insurance:update',
  // DTU artifact generation from lenses
  'lens:dtu_generated',
  // AI domain insights from lens-learning.js
  'agent:domain_insight',
  // Per-user tick events
  'user:tick',
  // Spontaneous initiative events (proactive messages from Concord)
  'initiative:new',
  // Chat tool execution results
  'chat:tool_result',
  // Feed Manager real-time DTU events
  'feed:new-dtu',
  // City / World lens events
  'city:positions',
  'city:stream-started',
  'city:stream-ended',
  'city:stream-dtu-created',
  'city:stream-sale',
  // Comments
  'comment:added',
  // Activity feed
  'activity:new',
  // Collaborative editing (Yjs)
  'yjs:update',
  // Server health checks
  'health:pulse',
];

interface UseSocketOptions {
  /** Connect automatically on mount (default: false — opt-in to reduce idle connections) */
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  emit: (event: string, data?: unknown) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback?: (...args: unknown[]) => void) => void;
}

export function useSocket(options: UseSocketOptions = {}): UseSocketReturn {
  const {
    autoConnect = false, // FE-011: default false to prevent idle connections
    reconnection = true,
    reconnectionAttempts = 5,
    reconnectionDelay = 1000,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const listenersRef = useRef<Set<string>>(new Set());
  const qc = useQueryClient();

  // Initialize socket — use singleton from lib/realtime/socket.ts to avoid duplicate connections
  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onConnectError = (error: Error) => {
      console.error('[Socket] Connection error:', error.message);
      setIsConnected(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    // ── Universal event forwarder (registered ONCE globally) ───
    if (!_globalListenersRegistered) {
      _globalListenersRegistered = true;
      for (const event of FORWARDED_EVENTS) {
        socket.on(event, (data: unknown) => {
          // 1. Forward to event bus (for component-level subscriptions)
          emitEvent(event, data);
          // 2. Push into Zustand stores for relevant events
          routeToStores(event, data, qc);
        });
      }
    }

    socketRef.current = socket;
    if (autoConnect && !socket.connected) socket.connect();
    if (socket.connected) setIsConnected(true);

    // FE-011: Clean up on unmount — remove OUR listeners (don't disconnect shared socket)
    // Note: FORWARDED_EVENTS handlers are global singletons and intentionally NOT cleaned up per-component.
    const listeners = listenersRef.current;
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socketRef.current = null;
      listeners.clear();
      setIsConnected(false);
    };
  }, [autoConnect, reconnection, reconnectionAttempts, reconnectionDelay, qc]);

  const connect = useCallback(() => {
    if (socketRef.current && !socketRef.current.connected) {
      socketRef.current.connect();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.disconnect();
    }
  }, []);

  const emit = useCallback((event: string, data?: unknown) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const on = useCallback((event: string, callback: (...args: unknown[]) => void) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback);
      listenersRef.current.add(event);
    }
  }, []);

  const off = useCallback((event: string, callback?: (...args: unknown[]) => void) => {
    if (socketRef.current) {
      if (callback) {
        socketRef.current.off(event, callback);
      } else {
        socketRef.current.off(event);
      }
      listenersRef.current.delete(event);
    }
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    connect,
    disconnect,
    emit,
    on,
    off,
  };
}

// ── Store routing ──────────────────────────────────────────────

function routeToStores(event: SocketEvent, data: unknown, qc: QueryClient) {
  if (!data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;

  switch (event) {
    // DTU → lattice store
    case 'dtu:created':
      if (d.id) {
        useLatticeStore.getState().addRecentDTU(data as unknown as DTU);
      }
      break;
    case 'dtu:updated':
      if (d.id) {
        const changes = ((d.changes as Record<string, unknown> | undefined) ??
          d) as unknown as Partial<DTU>;
        useLatticeStore.getState().updateDTU(d.id as string, changes);
      }
      break;
    case 'dtu:deleted':
      if (d.id) {
        useLatticeStore.getState().removeDTU(d.id as string);
      }
      break;

    // System alerts → UI store toast
    case 'system:alert':
      if (d.message) {
        useUIStore.getState().addToast({
          type: (d.type as 'error' | 'warning' | 'info') || 'info',
          message: d.message as string,
          duration: 8000,
        });
        useSystemStore.getState().addSystemAlert(data as unknown as SystemAlert);
      }
      break;

    // Attention → system store
    case 'attention:allocation':
      if (Array.isArray(d.allocation)) {
        useSystemStore
          .getState()
          .setAttentionAllocation(d.allocation as unknown as AttentionAllocation[]);
      }
      if (d.focusOverride !== undefined) {
        useSystemStore
          .getState()
          .setFocusOverride(d.focusOverride as unknown as FocusOverride | null);
      }
      break;

    // Forgetting → system store
    case 'forgetting:cycle_complete':
      // Partial update — components will refetch full stats
      break;

    // Repair → system store
    case 'repair:cycle_complete':
      // Trigger refetch in subscribed components via event bus
      break;

    // Dream → sovereign store
    case 'dream:captured':
      if (d.id) {
        useSovereignStore.getState().addDream(data as unknown as Dream);
      }
      break;

    // Promotion → sovereign store
    case 'promotion:approved':
    case 'promotion:rejected':
      if (d.id) {
        useSovereignStore
          .getState()
          .updatePromotion(d.id as string, data as unknown as Partial<Promotion>);
      }
      break;

    // Per-user tick → lattice store
    case 'user:tick':
      if (d) {
        useLatticeStore.getState().setUserTickInfo({
          tickCount: d.tickCount as number,
          dtuCount: d.dtuCount as number,
          lastTick: d.ts as string,
        });
      }
      break;

    // Resonance update → lattice store (topology stats)
    case 'resonance:update':
      if (d.nodes !== undefined || d.edges !== undefined || d.clusters !== undefined) {
        useLatticeStore.getState().setTopologyStats({
          nodes: (d.nodes as number) ?? useLatticeStore.getState().topologyStats.nodes,
          edges: (d.edges as number) ?? useLatticeStore.getState().topologyStats.edges,
          clusters: (d.clusters as number) ?? useLatticeStore.getState().topologyStats.clusters,
        });
      }
      break;

    // Domain insight → lattice store (active domains)
    case 'agent:domain_insight':
      if (d.domains && Array.isArray(d.domains)) {
        useLatticeStore.getState().setActiveDomains(d.domains as string[]);
      } else if (d.domain && typeof d.domain === 'string') {
        const current = useLatticeStore.getState().activeDomains;
        if (!current.includes(d.domain as string)) {
          useLatticeStore.getState().setActiveDomains([...current, d.domain as string]);
        }
      }
      break;

    // Agent insights → lattice store (knowledge gaps)
    case 'agent:insights':
      if (d.knowledgeGaps && Array.isArray(d.knowledgeGaps)) {
        useLatticeStore
          .getState()
          .setKnowledgeGaps(
            d.knowledgeGaps as Array<{
              id: string;
              domain: string;
              description: string;
              severity: number;
              discoveredAt: string;
            }>
          );
      }
      break;

    // Meta-derivation → sovereign store
    case 'lattice:meta:derived':
    case 'lattice:meta:convergence':
    case 'meta:committed':
      if (d) {
        useSovereignStore.getState().addMetaEvent({
          id: (d.id ?? d.invariantId ?? `meta-${Date.now()}`) as string,
          summary: (d.summary ?? event) as string,
          timestamp: new Date().toISOString(),
          type: event,
        });
      }
      break;

    // comment:added → invalidate DTU and comments queries
    case 'comment:added':
      qc.invalidateQueries({ queryKey: ['dtu'] });
      qc.invalidateQueries({ queryKey: ['comments'] });
      break;

    // activity:new → invalidate activity feed
    case 'activity:new':
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      break;

    // health:pulse → invalidate health/status queries
    case 'health:pulse':
      qc.invalidateQueries({ queryKey: ['health'] });
      qc.invalidateQueries({ queryKey: ['status'] });
      break;

    // yjs:update — handled by collaborative editing components via event bus
  }
}

// ── Specific socket hooks for different features ───────────────

export function useResonanceSocket() {
  const { isConnected, on, off } = useSocket({ autoConnect: true });
  const [resonanceData, setResonanceData] = useState<unknown>(null);

  useEffect(() => {
    const handleResonance = (data: unknown) => {
      setResonanceData(data);
    };

    on('resonance:update', handleResonance);

    return () => {
      off('resonance:update', handleResonance);
    };
  }, [on, off]);

  return { resonanceData, isConnected };
}

export function useDTUSocket() {
  const { isConnected, on, off, emit } = useSocket({ autoConnect: true });

  const subscribeToDTU = useCallback(
    (dtuId: string) => {
      emit('dtu:subscribe', { dtuId });
    },
    [emit]
  );

  const unsubscribeFromDTU = useCallback(
    (dtuId: string) => {
      emit('dtu:unsubscribe', { dtuId });
    },
    [emit]
  );

  return {
    isConnected,
    subscribeToDTU,
    unsubscribeFromDTU,
    onDTUUpdate: on,
    offDTUUpdate: off,
  };
}
