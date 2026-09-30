import { io, Socket } from 'socket.io-client';
import { updateClockOffset } from '../offline/db';

// Socket URL: explicit NEXT_PUBLIC_SOCKET_URL wins; otherwise fall back
// to the API base URL (which is the backend's host:port). Defaulting to
// empty string meant the socket tried same-origin (the frontend port),
// which has no socket server — surfaced as the persistent "Connection
// lost. Working offline with cached data." banner on every lens load in
// dev, for the common case of running `npm run dev` without ever having
// copied `.env.example` to `.env.local` (the README quickstart doesn't
// say to). In development only, default to the backend's known dev port
// instead — mirrors the same `BACKEND_URL || 'http://127.0.0.1:5050'`
// convention `next.config.js`'s rewrites() already use, and matches what
// `.env.example` documents as the correct dev value. Production keeps the
// empty-string fallback: same-origin + the nginx `/socket.io/` proxy
// (`nginx/conf.d/default.conf`) is the correct, already-working prod
// topology — defaulting prod to a hardcoded port would be wrong there.
// EXPORTED because it must be the ONE place this is resolved. It wasn't, and
// `lib/hooks/useYjsDoc.ts` consequently re-implemented the connection with a
// bare `io({ path: '/socket.io' })` — no URL, i.e. same-origin — reintroducing
// the exact bug the comment above describes this constant as fixing. Observed
// live 2026-07-25 on `/lenses/world`: the `SOCKET_URL` socket connected to
// :5050 and pumped 79 frames, while SIX same-origin sockets to :3000 each died
// with "WebSocket is closed before the connection is established" (Next's
// rewrites proxy HTTP but not WS upgrades), driving the "Disconnected" badge.
// Any new socket consumer must import this rather than resolve its own.
// Browser: always same-origin so engine.io hits Next :3000 (/socket.io rewrite
// → :5050). NEXT_PUBLIC_SOCKET_URL is :5050 in local .env.local; using it from
// the page Origin :3000 is cross-origin and CORP/CORS-flaky. Next 16 rewrites
// proxy HTTP (engine.io polling) but NOT WebSocket upgrades (`next dest`).
// getSocket() therefore prefers polling first, then websocket (upgrade may
// fail locally; polling is the working loopback path). server-proxy.js exists
// for production `next start` custom-server WS upgrades.
export function resolveSocketUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return (
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    (process.env.NODE_ENV !== 'production' ? 'http://localhost:5050' : '')
  );
}
export const SOCKET_URL = resolveSocketUrl();

// Tracked so a reconnect-exhaustion failure can tell "genuinely never
// configured" apart from "was configured but the backend is unreachable" —
// the former gets a distinct, more actionable diagnostic (see below).
const SOCKET_URL_WAS_UNCONFIGURED =
  !process.env.NEXT_PUBLIC_SOCKET_URL && !process.env.NEXT_PUBLIC_API_URL;

let socket: Socket | null = null;

// ---- Room re-join tracking (durability) ----
// A reconnect gives the socket a NEW server-side session with EMPTY room
// membership — the server's `room:join` handler adds `socket.id` to a room,
// and the old socket.id is gone. So without re-joining, a page that had
// subscribed to `world:<id>` / `org:<id>` / a ConKay run room goes silent
// after any reconnect (the events fan out to a room this socket is no longer
// in). Track every joined room and replay the joins on each `connect`.
const _joinedRooms = new Set<string>();

// Rooms the server has actually CONFIRMED (via `room:joined`), as opposed
// to `_joinedRooms` above which only tracks what this client has ATTEMPTED
// to join (optimistic, fire-and-forget `emit('room:join', ...)`). DET-C:
// the server's `room:joined` ack previously had zero frontend subscribers
// at all — a room-scoped feature (collab doc sync, code liveshare,
// astronomy co-observe) had no way to tell "join request sent" apart from
// "server actually admitted this socket to the room", so a caller racing
// its first room-scoped emit against a slow join had no signal to wait on.
// `isRoomJoined()` below gives real callers that signal; existing
// call sites keep working exactly as before (this is additive).
const _confirmedRooms = new Set<string>();

// Guard so the global `online` listener is wired exactly once.
let _onlineListenerWired = false;

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

// ---- Connection-lifecycle grace period (Unit F10) ----
// A hard backend death (kill -9, not a graceful shutdown) drops the socket
// WITHOUT a clean `macro:completed`, so any ConKay run left in flight would keep
// its rings spinning forever — contradicting the honest-by-construction rule
// ("kill the server mid-run → all motion stops"). But socket.io auto-reconnects
// on a brief blip, so the disconnect handler waits out a grace period before
// declaring the backend gone.
//
// Duration reasoning: the manager retries indefinitely with ~1s base delay
// capped at 5s (see getSocket's reconnection opts), so a normal Wi-Fi flap or
// server restart-in-place almost always recovers on the first attempt or two
// (~1–3s). 6s is comfortably longer than that (absorbs the blip) yet short
// enough that a genuine backend death surfaces the "connection lost" state
// within a reasonable demo/test window. The socket keeps retrying underneath
// regardless, so recovery from a longer outage is automatic; this timer only
// governs WHEN to tell in-flight work (e.g. ConKay's rings) the backend went
// quiet. Motion stopping a few seconds after a real kill is honest; wiping
// in-flight work on a 1s flap is not.
const CONNECTION_LOST_GRACE_MS = 6000;
let _connectionLostTimer: ReturnType<typeof setTimeout> | null = null;
const _connectionLostListeners = new Set<() => void>();
const _reconnectedListeners = new Set<() => void>();

function _clearConnectionLostTimer(): void {
  if (_connectionLostTimer) {
    clearTimeout(_connectionLostTimer);
    _connectionLostTimer = null;
  }
}

function _notify(listeners: Set<() => void>): void {
  listeners.forEach((cb) => {
    // A listener throwing must never break the socket lifecycle.
    try {
      cb();
    } catch (err) {
      console.debug('[Socket] connection-lifecycle listener threw:', err);
    }
  });
}

/**
 * Subscribe to a CONFIRMED connection loss — fired only when the socket has been
 * disconnected continuously past the grace period (a real backend death, not a
 * transient blip that socket.io recovers from). Returns an unsubscribe fn.
 *
 * Purpose-built for connection-lifecycle concerns (e.g. ConKay stopping its
 * rings when the backend dies mid-run) and deliberately kept OUTSIDE the typed
 * `SocketEvent` / `subscribe()` surface: 'connect'/'disconnect' aren't
 * server-emitted events, and other `subscribe()` consumers shouldn't have the
 * union widened under them for this one lifecycle need.
 */
export function onConnectionLost(callback: () => void): () => void {
  _connectionLostListeners.add(callback);
  // Ensure the socket + its lifecycle handlers exist so the timer can fire.
  getSocket();
  return () => {
    _connectionLostListeners.delete(callback);
  };
}

/**
 * Subscribe to a reconnect. Fires on every `connect` (including the first), so
 * consumers that flipped into a "connection lost" state can clear it once the
 * backend is reachable again. Returns an unsubscribe fn.
 */
export function onReconnected(callback: () => void): () => void {
  _reconnectedListeners.add(callback);
  getSocket();
  return () => {
    _reconnectedListeners.delete(callback);
  };
}

export function getSocket(): Socket {
  if (!socket) {
    const auth = getAuthCredentials();

    socket = io(SOCKET_URL, {
      path: '/socket.io',
      autoConnect: false,
      reconnection: true,
      // Never give up. A laptop that sleeps for an hour, a phone that loses
      // signal in a tunnel, a backend that restarts mid-deploy — all recover
      // on their own once connectivity returns. Capping attempts at 5 (~6s of
      // retries, then `reconnect_failed` and permanent silence) was the root
      // cause of "connection lost mid-operation and never came back": one bad
      // ~6s window stranded the client offline until a full page reload. The
      // capped backoff (reconnectionDelayMax) keeps the retry cost bounded.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Same-origin /socket.io. This Next 16 `next dest` checkout DOES
      // proxy WS upgrades to :5050 (101 verified). Engine.io polling on
      // this backend answers 400 Transport unknown (websocket-only), so
      // websocket is first.
      transports: ['websocket', 'polling'],
      // SECURITY: Include cookies for httpOnly cookie auth
      withCredentials: true,
      // SECURITY: API key fallback for programmatic clients
      auth,
    });

    // Kick a reconnect the instant the browser reports connectivity is back,
    // instead of waiting for the next backoff tick. Cheap, idempotent (connect
    // on an already-connected/connecting socket is a no-op), and the single
    // biggest UX win for "came back from sleep / tunnel and it just works".
    // @resource-leak-ok: `socket` is a module-scope singleton (getSocket()
    // only ever constructs it once — see the `_onlineListenerWired` guard
    // right here) that is meant to live for the whole page session;
    // disconnectSocket() tears down the socket.io connection but
    // deliberately doesn't recreate `socket` or reset this flag, so there is
    // exactly one 'online' listener for the lifetime of `window` itself —
    // the same intentional-singleton shape as an app-wide resize/visibility
    // listener, not a per-instance leak.
    if (typeof window !== 'undefined' && !_onlineListenerWired) {
      _onlineListenerWired = true;
      window.addEventListener('online', () => {
        if (socket && !socket.connected) {
          console.debug('[Socket] Browser back online — reconnecting');
          socket.connect();
        }
      });
    }

    // Connection event handlers
    socket.on('connect', () => {
      console.debug('[Socket] Connected:', socket?.id);
      // A (re)connect within the grace window means the prior disconnect was a
      // transient blip, not a real backend death — cancel the pending
      // "connection lost" so legitimately in-flight work is never wrongly wiped.
      _clearConnectionLostTimer();
      // Re-join every room this client had joined — the reconnected socket has
      // a fresh, empty server-side room set, so without this the page silently
      // stops receiving room-scoped events after any reconnect.
      if (_joinedRooms.size > 0) {
        for (const room of _joinedRooms) {
          socket?.emit('room:join', { room });
        }
        console.debug('[Socket] Re-joined rooms after reconnect:', [..._joinedRooms]);
      }
      _notify(_reconnectedListeners);
      // Reset sequence tracking on reconnect
      Object.keys(_lastSeq).forEach((k) => delete _lastSeq[k]);
    });

    // Server ack for the room-join request above (server.js's inbound
    // room:join handler, fired server-side after socket.join(room)
    // succeeds). Marks the room CONFIRMED so isRoomJoined() callers get a
    // real signal instead of having to assume the optimistic emit above
    // landed.
    // (Deliberately not spelling the server call as literal
    // `socket` + `.on(` + `'room:join'` text: dead-event-listener-detector.js's
    // socket-consumption regex isn't comment-aware by design, and that
    // exact quoted syntax — describing the SERVER's listener — was
    // previously misread as a FRONTEND subscription to room:join, firing
    // a false orphan_socket_consumer finding. The real wiring is: this
    // frontend emits room:join, the server listens for it and acks with
    // room:joined, and this handler is the genuine subscriber to that ack.)
    socket.on('room:joined', (data: { room?: string }) => {
      if (data?.room) {
        _confirmedRooms.add(data.room);
        console.debug('[Socket] Room join confirmed:', data.room);
      }
    });

    socket.on('disconnect', (reason) => {
      console.debug('[Socket] Disconnected:', reason);
      // A fresh connection gets a fresh, empty server-side room set (see the
      // re-join block in the `connect` handler above) — the CONFIRMED set
      // must be cleared in lockstep so isRoomJoined() doesn't report a stale
      // "confirmed" for a room membership that no longer exists server-side.
      _confirmedRooms.clear();
      // Debounced grace period (Unit F10): start (or restart) the "is the
      // backend actually gone?" timer. socket.io auto-reconnects on a brief
      // Wi-Fi flap or a server restart-in-place, so a blind disconnect→reset
      // would wipe legitimately in-flight work on every transient blip. Only a
      // disconnect that OUTLASTS CONNECTION_LOST_GRACE_MS is treated as a real
      // backend death and fires the connection-lost listeners (e.g. the ConKay
      // HUD stopping its rings — "kill the server mid-run → all motion stops").
      // cancel-and-restart, never stack: repeated blips can't queue multiple
      // pending fires.
      _clearConnectionLostTimer();
      _connectionLostTimer = setTimeout(() => {
        _connectionLostTimer = null;
        _notify(_connectionLostListeners);
      }, CONNECTION_LOST_GRACE_MS);
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

    // We retry FOREVER now (reconnectionAttempts: Infinity), so `reconnect_failed`
    // never fires and can't carry the "was never configured" developer
    // diagnostic anymore. Preserve that hint via a one-time warning at attempt 5
    // — enough failed attempts to distinguish a real config problem from a
    // transient blip — WITHOUT ever stopping the retries. It's a config problem
    // a developer can fix in seconds, not a reason to strand the client offline.
    let _diagnosticShown = false;
    socket.io.on('reconnect_attempt', (attempt: number) => {
      if (attempt >= 5 && !_diagnosticShown) {
        _diagnosticShown = true;
        if (SOCKET_URL_WAS_UNCONFIGURED) {
          console.warn(
            '[Socket] Still reconnecting after 5 attempts — NEXT_PUBLIC_SOCKET_URL and ' +
              'NEXT_PUBLIC_API_URL are both unset. Copy concord-frontend/.env.example to ' +
              '.env.local (or set one of those vars) and restart the dev server. ' +
              '(Retries continue automatically once a backend is reachable.)'
          );
        } else {
          console.debug('[Socket] Still reconnecting (attempt', attempt, ') against', SOCKET_URL);
        }
      }
    });
    // Once connected, clear the latch so a LATER outage can warn again.
    socket.on('connect', () => { _diagnosticShown = false; });

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
  // Public timeline feed
  | 'timeline:post'
  // Character sheet (bars + skill levels) refresh signal
  | 'character:updated'
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
  // Dead-event-listener fix (DET-C batch 8) — server/existential/engine.js
  // fires this when an entity's existential-OS channel crosses an authored
  // policy threshold (e.g. stress/loneliness). Genuinely emergent — "the
  // world creates this on its own" — so it belongs in EmergentEventFeed's
  // TRACKED_EVENTS, not a bespoke surface.
  | 'qualia:policy'
  // Repair cortex
  | 'repair:dtu_logged'
  // Meta-derivation
  | 'lattice:meta:derived'
  | 'lattice:meta:convergence'
  | 'meta:committed'
  // System
  | 'system:alert'
  // Dead-event-listener fix (DET-C batch 8) — server/emergent/repair-cortex.js's
  // `reconnect_websocket` self-repair action (a real corrective, not informational
  // logging) had no consumer, so a repair pass "fixing" a stale server-side socket
  // state never actually made any connected browser reconnect. Providers.tsx now
  // subscribes and calls reconnectSocket().
  | 'system:reconnect'
  | 'queue:notifications:new'
  // Council
  | 'council:proposal'
  | 'council:vote'
  // Marketplace
  // 'market:trade' retired 2026-07-25 (dead-subscription audit, Class D):
  // the string exists in server/ ONLY as an event-to-DTU-bridge `type` tag
  // (emergent/realtime-feeds.js#tickFinanceFeeds -> _bridgeEvent, and
  // lib/feed-manager.js#mapDomainToEventType). event-to-dtu-bridge.js has
  // zero socket emits, so it can never reach a browser. The real socket
  // channel for that same feed is 'finance:ticker'.
  | 'market:listing'
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
  // Dead-event-listener fix (DET-C batch 9 follow-up) — ops-apply's
  // element-granular CRDT/OT broadcast, folded by useWhiteboardCollab.
  | 'whiteboard:ops'
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
  // 'entity:production_mode' and 'pipeline:triggered' retired 2026-07-25
  // (dead-subscription audit, Class D): both appear in server/ only inside
  // emergent/event-to-dtu-bridge.js's EVENT_DOMAIN_MAP / weight tables — a
  // DTU-bridge `type` tag, not a socket channel. Neither was ever emitted.
  // 12 NEW CAPABILITIES events
  | 'pipeline:started'
  | 'pipeline:step_started'
  | 'pipeline:step_completed'
  | 'pipeline:completed'
  | 'prediction:ready'
  | 'agent:insights'
  | 'marathon:status'
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
  // 'finance:market_update', 'finance:alert' and 'news:breaking' retired
  // 2026-07-25 (dead-subscription audit, Class F): removed from
  // useRealtimeLens's DOMAIN_EVENTS in daac9787 as the documented residual;
  // nothing in server/ ever emitted them. The live feed channels are
  // 'finance:ticker' / 'crypto:ticker' / 'news:update'.
  | 'finance:ticker'
  | 'crypto:ticker'
  | 'crypto:alert'
  | 'news:update'
  | 'weather:update'
  // 'weather:alert' retired 2026-07-25 (dead-subscription audit, Class D):
  // its 6 hits under server/ are all DTU-bridge `type` tags / scoping-table
  // keys (event-to-dtu-bridge.js, event-scoping.js,
  // feed-manager.js#mapDomainToEventType) — never a socket emit.
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
  // DET-C batch 11 — V1.2 Wave A's real, hyphen-namespaced party-room
  // events (server.js's /api/parties/* routes, distinct from the
  // underscore-namespaced 'party:member_joined' etc. above that the server
  // never actually emits). 'party:member-kicked' previously had zero
  // frontend consumer; PartyPanel.tsx now listens for it (see the
  // FORWARDED_EVENTS same-name window-dispatch bridge in useSocket.ts).
  | 'party:member-kicked'
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
  // 'coop:build:edit' retired 2026-07-25 (dead-subscription audit, Class E):
  // the server-side broadcast was already retired in the DET-C batch 9/11
  // sweep (see server.js's POST /api/coop/build/edit comment) because there
  // is no coop-build UI anywhere to receive it. The REST surface stays live.
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
  | 'brawl-started'
  | 'climbing:route-completed'
  | 'player:corpse-dropped'
  // Dead-event-listener fix (verification-audit campaign) — real server
  // broadcast (server/lib/social-pings.js) had no socket-to-window bridge
  // at all, so WorldMarkers.tsx's 'concordia:social-ping' listener never fired.
  | 'social:ping'
  // Dead-event-listener fix (verification-audit campaign) — server emitted
  // 'arena:match:found' to the queued/waiting player on match creation
  // (server/routes/arena.js#createMatch) but nothing subscribed, so that
  // player never learned their match formed (only the initiator, via the
  // direct POST /api/arena/queue response, ever saw it).
  | 'arena:match:found'
  // Dead-event-listener fix (verification-audit campaign) — whiteboard's
  // "Live" tab (WhiteboardCollabPanel.tsx) has real reaction/presence
  // backend (server/domains/whiteboard.js reaction-send/presence-ping),
  // but these two names were never forwarded off the raw socket at all,
  // so the labeled Live UI never received a push update (presence was
  // poll-only and never populated since nothing ever called presence-ping).
  | 'whiteboard:reaction'
  | 'whiteboard:presence'
  // The System — diegetic push-driven status layer (players/NPCs/hostiles).
  | 'system:level-up'
  | 'system:skill-acquired'
  | 'system:skill-evolved'
  // 'system:danger-band' retired 2026-07-25 (dead-subscription audit, Class
  // E): no server emit and no component ever read it — the union entry was
  // its entire footprint.
  | 'system:notice'
  // Game-mode HUD realtime push (replacing per-mode polling).
  | 'horde:state'
  | 'party-combat:state'
  // 'party-combat:tick' retired 2026-07-25 (dead-subscription audit, Class
  // E). NOTE the substrate is real (server/lib/party-combat.js#resolveTick),
  // but nothing was ever emitted and no component read it — PartyCombatHUD
  // consumes 'party-combat:state' instead. If a per-tick push is ever wanted,
  // wire the emit alongside a real consumer; don't re-add the bare type.
  | 'mahjong:state'
  | 'submarine:dive-state'
  | 'extraction:state'
  | 'extraction:zones'
  | 'time-loop:state'
  // 'climbing:stamina-state' retired 2026-07-25 (dead-subscription audit,
  // Class E). Substrate is real (server/lib/climbing.js + player-stamina.js)
  // but there was never an emit and never a consumer; ClimbingTracker polls.
  // Wire an emit + a consumer together if a push is ever wanted.
  | 'restaurant:state'
  | 'horror:state'
  | 'theme-park:state'
  | 'roguelite:run-state'
  // Wave 4 (Gap C) — fired by routes/worlds.js's combat/npc-attack route and
  // lib/npc-simulator.js's autonomous NPC attacks when a purchased
  // `second_chance` meta-unlock revive charge prevents a death.
  | 'roguelite:revived'
  | 'nemesis:nearby'
  | 'lfg:board-update'
  | 'tracking:footprints-updated'
  | 'courtship:affinity-update'
  | 'spectator:count-updated'
  // World scheduler
  | 'world:event:scheduled'
  // RSVP reminder — sweepEventReminders (server/lib/event-rsvp.js) fires this
  // to user:<id> ~10min before an event the user RSVP'd to starts.
  | 'event:reminder'
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
  // 'fishing:cast' retired 2026-07-25 (dead-subscription audit, Class E):
  // the server emit was already removed in the DET-C batch 9 sweep and is
  // pinned as absent by server/tests/fishing-route-realtime-scope.test.js.
  | 'fishing:bite'
  | 'fishing:caught'
  // Minigames (Phase E)
  // 'minigame:started' retired (dead-event-listener sweep continuation,
  // 2026-07-24) — see server/routes/minigames.js's header comment.
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
  | 'macro:completed'
  // Realtime dead-event wiring pass (2026-07-05) — these were already
  // server-emitted but missing from the union, so consumers were stuck on
  // dead `window.addEventListener` calls nothing ever dispatched.
  | 'achievement:unlocked'
  | 'concord:announcement'
  | 'auction:bid-placed'
  | 'auction:settled'
  | 'disease:contracted'
  | 'disease:cured'
  // Dead-event-listener fix (verification-audit campaign) — real server
  // broadcast (server/lib/disease-engine.js#tickDiseases) with zero
  // frontend consumer; DiseaseStatusHUD.tsx now subscribes alongside its
  // sibling disease:contracted/disease:cured handlers.
  | 'disease:lethal-progression'
  | 'festival:started'
  | 'friend:request-accepted'
  | 'friend:request-received'
  | 'mail:received'
  | 'world:invite-received'
  | 'world:marker-placed'
  // Consolidation fix (Wave 4 backlog #15) — server/lib/world-clock.js
  // broadcasts this un-scoped every 30s (no auth/room-join required to
  // receive it) but it was missing from this union, so HUDContextProvider
  // had bypassed the shared typed socket entirely and opened its own raw
  // `socket.io-client` connection just to hear it. Now routed through the
  // singleton like everything else.
  | 'world:clock'
  // Dead-event-listener fix (DET-C pass) — server/routes/wagers.js
  // real-money-affecting realtimeEmit calls with zero frontend consumer;
  // WagerInviteToast now subscribes (via the concordia:wager-* window
  // bridge below) to actually show the incoming challenge / outcome.
  | 'wager:proposed'
  | 'wager:accepted'
  | 'wager:declined'
  | 'wager:resolved'
  // Dead-event-listener fix (DET-C batch 2) — server/server.js's EVE-style
  // buy-order routes (POST /api/auctions/buy-orders and .../fill) already
  // realtimeEmit these; the auction lens's open-buy-orders board only
  // refreshed on the bidder's own actions + a 5s poll, never live off
  // another player's order. Same unscoped-broadcast shape as the sibling
  // auction:bid-placed/auction:settled events above (a market ticker, not
  // a bare-id-as-options-object bug — verified via server/lib/detectors/
  // realtime-emit-signature-detector.js: 0 flagged instances repo-wide).
  | 'auction:buy-order-placed'
  | 'auction:buy-order-filled'
  // Dead-event-listener fix (DET-C batch 8) — server.js's "player:visibility"
  // socket handler (BD#27, ghost/appear-offline mode) has ack'd/nack'd since
  // it shipped, but nothing ever emitted the request OR subscribed to the
  // reply: the existing Settings > Privacy "World Visible to Others" toggle
  // was localStorage-only decoration with no live effect. Now wired
  // end-to-end from app/settings/page.tsx.
  | 'player:visibility:ack'
  | 'player:visibility:nack'
  // V1.2 Wave A — Society & Presence: user-controlled world-presence status
  // (available/away/busy/dnd), distinct from the visibility ghost toggle
  // above. Wired end-to-end from app/settings/page.tsx, same ack/nack +
  // timeout-fallback shape as player:visibility.
  | 'player:presence-status:ack'
  | 'player:presence-status:nack'
  // DET-C batch 10 — server/routes/channels.js's Telegram/Discord/email
  // inbound-webhook bridge (server/channels/{telegram,discord,email}.js)
  // realtimeEmit'd this on every routed inbound message with zero frontend
  // consumer anywhere (there was no channel-linking or inbox UI at all).
  // Now scoped to the recipient's user:<id> room (see the fix on the
  // realtimeEmit call sites in channels.js) and surfaced as a toast via
  // useSocialNotificationToast's sibling hook, useChannelInboundToast.
  | 'channel:inbound'
  // V1.2 Wave A — ephemeral spatially-scoped proximity chat
  // (server/lib/proximity-chat.js, server.js's 'proximity:chat:send'
  // socket handler). DET-C batch 11: 'proximity:chat' (the delivered
  // message, direct-to-recipient on their own user:<id> room, including
  // an echo back to the sender) plus the 'proximity:chat:ack'/':nack'
  // send-confirmation pair had zero frontend consumer at all — the whole
  // feature had no UI. concord-frontend/components/world/
  // ProximityChatPanel.tsx now provides a minimal-but-real send/receive
  // surface, mounted in the world lens.
  | 'proximity:chat'
  | 'proximity:chat:ack'
  | 'proximity:chat:nack';

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
  // Remember the room so it's automatically re-joined on every reconnect.
  _joinedRooms.add(room);
  emit('room:join', { room });
}

export function leaveRoom(room: string): void {
  _joinedRooms.delete(room);
  emit('room:leave', { room });
  // room:leave has no server ack (see server.js's room:leave handler —
  // socket.leave(room) is the real behavior; the retired ack had zero
  // consumers) so there's nothing to await here. Drop the confirmed flag
  // optimistically; a stale leave/rejoin race self-heals on the next
  // room:joined ack.
  _confirmedRooms.delete(room);
}

/**
 * True once the server has ACKed this socket's membership in `room` via
 * `room:joined` — as opposed to merely having attempted to join it (see
 * `_joinedRooms` vs `_confirmedRooms` above). Room-scoped features (collab
 * doc sync, code liveshare, astronomy co-observe) that emit a room-scoped
 * event immediately after `joinRoom()` can use this to avoid racing the
 * join itself, or to render a "connecting…" vs "live" indicator.
 */
export function isRoomJoined(room: string): boolean {
  return _confirmedRooms.has(room);
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
