import { io, Socket } from 'socket.io-client';
import { updateClockOffset } from '../offline/db';

// Socket URL: explicit NEXT_PUBLIC_SOCKET_URL wins; otherwise fall back
// to the API base URL (which is the backend's host:port). Defaulting
// to empty string meant the socket tried same-origin (the frontend
// port), which has no socket server — surfaced as the persistent
// "Connection lost. Working offline with cached data." banner on
// every lens load in dev.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || '';

let socket: Socket | null = null;

// ---- Event Ordering (Category 2: Concurrency) ----
// Track last-seen sequence number per event type for out-of-order detection
const _lastSeq: Record<string, number> = {};
const _eventBuffer: Map<
  string,
  Array<{ seq: number; data: unknown; timer: ReturnType<typeof setTimeout> }>
> = new Map();
const _EVENT_BUFFER_TIMEOUT_MS = 2000; // Max wait for out-of-order events

// Get authentication credentials
// SECURITY: Prefer cookies (handled automatically via withCredentials)
// API key from localStorage is fallback for programmatic access
function getAuthCredentials(): { apiKey?: string } {
  if (typeof window === 'undefined') return {};

  // Only use API key if explicitly set (for programmatic clients)
  const apiKey = localStorage.getItem('concord_api_key');

  return {
    ...(apiKey && { apiKey }),
  };
}

export function getSocket(): Socket {
  if (!socket) {
    const auth = getAuthCredentials();

    socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
      // SECURITY: Include cookies for httpOnly cookie auth
      withCredentials: true,
      // SECURITY: API key fallback for programmatic clients
      auth,
    });

    // Connection event handlers
    socket.on('connect', () => {
      console.debug('[Socket] Connected:', socket?.id);
      // Reset sequence tracking on reconnect
      Object.keys(_lastSeq).forEach((k) => delete _lastSeq[k]);
    });

    socket.on('disconnect', (reason) => {
      console.debug('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      // Expected/transient during reconnection, when offline, or in a dev
      // cross-port setup where the WS can't reach the backend — log at debug so
      // it doesn't spam console.error and read as "the backend keeps erroring".
      if (error.message === 'Authentication required') {
        console.warn('[Socket] Authentication required - please log in');
      } else {
        console.debug('[Socket] Connection error (will retry):', error.message);
      }
    });

    // Handle hello message from server
    socket.on('hello', (data) => {
      console.debug('[Socket] Server hello:', data);
      // ---- Clock Normalization (Category 4: Offline Sync) ----
      if (data?.ts) {
        updateClockOffset(data.ts);
      }
    });
  }

  return socket;
}

// Reconnect with fresh credentials (call after login)
// Debounced to prevent reconnect storms from rapid network flaps
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_DEBOUNCE_MS = 2000;

export function reconnectSocket(): void {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (socket) {
      socket.disconnect();
      socket.auth = getAuthCredentials();
      socket.connect();
    }
  }, RECONNECT_DEBOUNCE_MS);
}

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

// Event types — every event the backend emits
export type SocketEvent =
  // Resonance
  | 'resonance:update'
  // DTU lifecycle
  | 'dtu:created'
  | 'dtu:updated'
  | 'dtu:deleted'
  | 'dtu:promoted'
  // Entity lifecycle
  | 'entity:death'
  | 'body:instantiated'
  | 'body:destroyed'
  // Pain / qualia
  | 'pain:recorded'
  | 'pain:processed'
  | 'pain:wound_created'
  | 'pain:wound_healed'
  | 'affect:pain_signal'
  // Repair cortex
  | 'repair:dtu_logged'
  | 'repair:cycle_complete'
  // Meta-derivation
  | 'lattice:meta:derived'
  | 'lattice:meta:convergence'
  | 'meta:committed'
  // System
  | 'system:alert'
  | 'queue:notifications:new'
  // Council
  | 'council:proposal'
  | 'council:vote'
  // Marketplace
  | 'market:listing'
  | 'market:trade'
  // Collaboration
  | 'collab:change'
  | 'collab:lock'
  | 'collab:unlock'
  | 'collab:session:created'
  | 'collab:user:joined'
  // Cognitive systems
  | 'attention:allocation'
  | 'forgetting:cycle_complete'
  | 'dream:captured'
  | 'promotion:approved'
  | 'promotion:rejected'
  | 'app:published'
  // Music / studio
  | 'music:toggle'
  // Whiteboard (legacy)
  | 'whiteboard:updated'
  // Whiteboard real-time multiplayer (server/domains/whiteboard.js broadcast-scene / broadcast-cursor / shared-vote-cast)
  | 'whiteboard:scene-update'
  | 'whiteboard:cursor'
  | 'whiteboard:vote-cast'
  // Message lens multi-device sync (server/domains/message.js, room user:${userId})
  | 'message:saved'
  | 'message:unsaved'
  | 'message:reacted'
  | 'message:voice-registered'
  // World spatial voice chat (server/domains/world.js, rooms voice:${worldId}:${cellKey} + user:${userId})
  | 'voice:peer-joined'
  | 'voice:peer-left'
  | 'voice:signal'
  // Spaces (live audio rooms) WebRTC signaling (server.js, rooms audio-room:${roomId})
  | 'audio-room:peer-joined'
  | 'audio-room:peer-left'
  | 'audio-room:room-state'
  | 'audio-room:offer'
  | 'audio-room:answer'
  | 'audio-room:ice-candidate'
  // Creative Registry & Royalties
  | 'creative_registry:update'
  | 'marketplace:purchase'
  // MEGA SPEC: Chat streaming events
  | 'chat:status'
  | 'chat:token'
  | 'chat:web_results'
  | 'chat:complete'
  // MEGA SPEC: Artifact & quality lifecycle events
  | 'artifact:rendered'
  | 'quality:approved'
  | 'quality:shadowed'
  // MEGA SPEC: Entity & pipeline events
  | 'entity:production_mode'
  | 'pipeline:triggered'
  // 12 NEW CAPABILITIES events
  | 'pipeline:started'
  | 'pipeline:step_started'
  | 'pipeline:step_completed'
  | 'pipeline:completed'
  | 'prediction:ready'
  | 'agent:insights'
  | 'collab:invite'
  | 'collab:accepted'
  | 'teaching:promotion_suggestion'
  | 'research:started'
  | 'research:completed'
  // Shared Instance Conversation events
  | 'shared-session:invite'
  | 'shared-session:joined'
  | 'shared-session:message'
  | 'shared-session:ai-response'
  | 'shared-session:artifact-produced'
  | 'shared-session:dtu-shared'
  | 'shared-session:ended'
  // Real-time data feed events (Phase 3)
  | 'finance:ticker'
  | 'finance:market_update'
  | 'finance:alert'
  | 'crypto:ticker'
  | 'news:update'
  | 'news:breaking'
  | 'weather:update'
  | 'weather:alert'
  | 'research:update'
  | 'health:update'
  | 'legal:update'
  | 'economy:update'
  | 'aviation:update'
  | 'realestate:update'
  | 'education:update'
  | 'fitness:update'
  | 'agriculture:update'
  | 'energy:update'
  | 'retail:update'
  | 'manufacturing:update'
  | 'logistics:update'
  | 'government:update'
  | 'insurance:update'
  | 'lens:dtu_generated'
  | 'agent:domain_insight'
  // Per-user tick events
  | 'user:tick'
  // Spontaneous initiative events (proactive messages from Concord)
  | 'initiative:new'
  // Chat tool execution results
  | 'chat:tool_result'
  // Feed Manager real-time DTU events
  | 'feed:new-dtu'
  // City / World lens events
  | 'city:positions'
  | 'city:stream-started'
  | 'city:stream-ended'
  | 'city:stream-dtu-created'
  | 'city:stream-sale'
  // Comments
  | 'comment:added'
  // Activity feed
  | 'activity:new'
  // Collaborative editing (Yjs)
  | 'yjs:update'
  // Server health checks
  | 'health:pulse'
  // Platform presence
  | 'platform:activity'
  // Quest realtime push (emergent quests)
  | 'quest:new'
  // Phase 8: player-to-player trade
  | 'trade:request'
  | 'trade:offer_updated'
  | 'trade:other_ready'
  | 'trade:complete'
  | 'trade:cancelled'
  // Phase 9: party / group system
  | 'party:invite'
  | 'party:invite_declined'
  | 'party:member_joined'
  | 'party:member_left'
  | 'party:leader_changed'
  | 'party:kicked'
  | 'party:chat'
  // Phase 19: retention hooks
  | 'daily:login_recorded'
  // Wave 1 deferral 3: level-up rank crossing
  | 'level:up'
  // GameJuice event mesh — fanfare/coin-clink/badge triggers from server
  | 'quest:completed'
  | 'quest:lineage-quest'
  | 'marketplace:purchase'
  | 'marketplace:sale'
  | 'skill:xp-awarded'
  | 'skill:evolved'
  | 'skill:evolution-available'
  | 'coop:raid:progress'
  | 'coop:raid:completed'
  | 'coop:build:edit'
  | 'coop:stash:withdraw'
  | 'reputation:badge-earned'
  | 'reputation:rank-up'
  // Refusal Field — Sovereign / quest beats / Mass Raid declare gates per world
  | 'world:refusal-field'
  // EvoAsset evolution scheduler — promoted version notification
  | 'evo:asset-promoted'
  // Council Live Theater stream
  | 'council:theater:scheduled'
  | 'council:theater:started'
  | 'council:theater:voice'
  | 'council:theater:complete'
  // Combat netcode
  | 'combat:dodge:ack'
  | 'combat:block:ack'
  // Flow Combat — procedural emergent combat
  | 'combat:combo-evolved'
  | 'combat:npc-combo-evolved'
  // PvP Training Match
  | 'training:challenge'
  | 'training:start'
  | 'training:safe-reset'
  | 'training:resume'
  | 'training:round-end'
  | 'training:end'
  // Faction wars (NPCs evolving in background; players can join either side)
  | 'faction-war:tick'
  | 'faction-war:kill'
  | 'faction-war:end'
  // WS5 — structural-strength faction clash outcome (living-world plan)
  | 'faction-war:clash'
  // WS4(b) — stress-triggered awakening opportunity (living-world plan)
  | 'player:awakening-available'
  // Realtime cleanup — events that exist server-side but were missing from the
  // union, so HUDs can subscribe instead of polling (push + slow backstop).
  | 'world:drift-alert'
  | 'brawl-invited'
  | 'climbing:route-completed'
  | 'player:corpse-dropped'
  // The System — diegetic push-driven status layer (players/NPCs/hostiles).
  | 'system:level-up'
  | 'system:skill-acquired'
  | 'system:skill-evolved'
  | 'system:danger-band'
  | 'system:notice'
  // Game-mode HUD realtime push (replacing per-mode polling).
  | 'horde:state'
  | 'party-combat:state'
  | 'party-combat:tick'
  | 'mahjong:state'
  | 'submarine:dive-state'
  | 'extraction:state'
  | 'extraction:zones'
  | 'time-loop:state'
  | 'climbing:stamina-state'
  | 'restaurant:state'
  | 'horror:state'
  | 'theme-park:state'
  | 'roguelite:run-state'
  | 'nemesis:nearby'
  | 'lfg:board-update'
  | 'tracking:footprints-updated'
  | 'courtship:affinity-update'
  | 'spectator:count-updated'
  // World scheduler
  | 'world:event:scheduled'
  // Tier 3 deferral 12: faction event scheduler
  | 'faction:event_started'
  | 'faction:event_ended'
  // The Concord Link cross-world messaging
  | 'concord-link:message'
  // World travel
  | 'world:traveled'
  // World crisis (world-crisis.js emits these from server-side governor tick)
  | 'world:crisis'
  | 'world:crisis-resolved'
  // Combat telegraph — fires immediately before applyAttack resolves so
  // clients can render anticipation pose / weapon glow / stance shift.
  | 'combat:telegraph'
  // Combat hit + kill — server broadcasts on damage applied.
  | 'combat:hit'
  | 'combat:kill'
  // Combat combo evolution — server emits when flow-engine derives a new branch.
  | 'combat:combo-evolved'
  // Gear durability — server emits to user:<id> on death (gear took decay,
  // possibly broke) and after a Repair All, so HUDs refresh + warn.
  | 'world:gear-damaged'
  | 'world:gear-repaired'
  // Companions (pet/tame system) — Phase A of pre-playtest sprint.
  | 'companion:tame-success'
  | 'companion:deployed'
  | 'companion:level-up'
  // Stealth perception (Phase B) — fires when high-perception observer
  // breaks a hidden actor's cover.
  | 'stealth:detected'
  // Kingdoms (Phase C)
  | 'kingdom:founded'
  | 'kingdom:decree-enacted'
  | 'kingdom:contested'
  | 'kingdom:fallen'
  // Fishing (Phase D)
  | 'fishing:cast'
  | 'fishing:bite'
  | 'fishing:caught'
  // Minigames (Phase E)
  | 'minigame:started'
  | 'minigame:scored'
  | 'minigame:complete'
  // Forge polyglot template engine
  | 'forge:template:created'
  | 'forge:template:generated'
  | 'forge:template:published'
  // Layer 13 — NPC ambient conversations
  | 'npc:conversation-bid'
  // Phase 11 (Item 4) — pan-social notification toast: server fires
  // this from createNotification (reactions / comments / follows /
  // shares / mentions / DMs) to the recipient's user:${userId} room.
  | 'social:notification'
  // Phase F3 (May 2026) — simulation surfacing
  | 'faction:war-declared'
  | 'faction:alliance-formed'
  | 'faction:truce-sought'
  | 'npc:scheme-resolved'
  | 'scheme:overheard'
  | 'scheme:intervened'
  | 'spouse:reaction'
  | 'dream:composed'
  | 'prediction:realised'
  | 'refusal:compound-threshold'
  // Phase G1 (May 2026) — batched + chain + bridge surfacing
  | 'combat:chain'
  | 'npc:activity-batch'
  | 'npc:economy-batch'
  | 'social:shadows-synced'
  // ConKay honest event spine (Track B / Phase 0) — the REAL lifecycle of an
  // /api/lens/run macro call, scoped to the caller's user:<id> room when the
  // request opts in with x-conkay-run-id. The ConKay HUD animates these 1:1.
  | 'macro:started'
  | 'macro:stage'
  | 'macro:completed';

// ---- Enriched Event Payload (Category 2+5: Concurrency + Observability) ----
interface EnrichedPayload {
  _seq?: number; // Monotonic sequence number from server
  _rid?: string; // Correlation ID from originating request
  _evt?: string; // Event name for reordering
  ts?: string; // Server timestamp
  [key: string]: unknown;
}

// Subscribe to events with ordering protection
export function subscribe<T>(event: SocketEvent, callback: (data: T) => void): () => void {
  const s = getSocket();

  const orderedCallback = (data: EnrichedPayload) => {
    // ---- Clock Sync from every event (Category 4: Offline Sync) ----
    if (data.ts) {
      updateClockOffset(data.ts);
    }

    // ---- Event Ordering Guard (Category 2: Concurrency) ----
    const seq = data._seq;
    if (typeof seq === 'number') {
      const lastSeen = _lastSeq[event] || 0;
      if (seq <= lastSeen) {
        // Stale/duplicate event - discard
        console.debug(`[Socket] Discarding stale event ${event} seq=${seq} (last=${lastSeen})`);
        return;
      }
      _lastSeq[event] = seq;
    }

    callback(data as T);
  };

  s.on(event, orderedCallback);

  return () => {
    s.off(event, orderedCallback);
  };
}

// Emit events
export function emit(event: string, data?: unknown): void {
  const s = getSocket();
  if (s.connected) {
    s.emit(event, data);
  } else {
    console.warn('[Socket] Cannot emit - not connected');
  }
}

// Room management
export function joinRoom(room: string): void {
  emit('room:join', { room });
}

export function leaveRoom(room: string): void {
  emit('room:leave', { room });
}

// ---- Correlation ID Helper (Category 5: Observability) ----
// Returns the correlation ID from the most recent event for a given type
export function getLastCorrelationId(_event: SocketEvent): string | undefined {
  // This is tracked implicitly via _rid in enriched payloads
  return undefined; // Consumers should extract _rid from the event data directly
}

// ---- Last Sequence Number (Category 2: Concurrency) ----
export function getLastSequence(event?: SocketEvent): Record<string, number> | number {
  if (event) return _lastSeq[event] || 0;
  return { ..._lastSeq };
}
