// server/lib/godot-gateway.js
import { encodeFrame, decodeFrame, isBinaryFrame, encodeMove, decodeMove } from './binary-protocol.js';
//
// Godot Integration Phase 1 — raw-WebSocket gateway for a native Godot 4 world
// client. This is a SELF-CONTAINED module: it imports nothing from server.js and
// takes every collaborator (auth, user lookup, scene export, db) as an injected
// dependency, so it can be unit-tested against a bare http.createServer() with
// stub deps and mounted into the monolith later without touching this file.
//
// ── Honest-by-construction notes ────────────────────────────────────────────
//  * `ws` is imported below. It is pinned in server/package.json dependencies
//    (`"ws": "^8.21.2"`) — no longer a bare transitive. See
//    docs/GODOT_INTEGRATION.md.
//  * This module is DEAD CODE until mounted in server.js — nothing here runs at
//    boot on its own. Mounting is a later integration step (by design).
//  * Rate limiting: a per-client continuous-refill token bucket (the same
//    primitive the socket.io combat path uses — see socket-rate-limit.js)
//    gates handleMessage right after the byte-size check and before dispatch.
//    Exceeding the bucket gets an honest `rate_limited` error frame; the
//    connection is never closed for a single violation.
//  * The outbound envelope mirrors realtimeEmit's reserved fields (ts/_seq/_evt).
//    `_rid` is intentionally NOT populated on this path in Phase 1 — there is no
//    HTTP request to correlate a Godot socket frame against yet.
//
import { WebSocketServer } from "ws";
import { makeSocketRateLimiter } from "./socket-rate-limit.js";
import { composeTwoBDialogue } from "./concordia-two-b.js";

const ROOM_RE = /^(world|user):[A-Za-z0-9_.-]{1,64}$/;

let _clientCounter = 0;
const nextClientId = () => `godot_${Date.now().toString(36)}_${(++_clientCounter).toString(36)}`;

/**
 * Mount a Godot WebSocket gateway onto an existing HTTP server.
 *
 * @param {import('http').Server} httpServer
 * @param {object} deps
 * @param {(token:string)=>({userId:string}|null|Promise)} deps.verifyToken  REQUIRED — validates a bearer token, returns `{userId}` (or throws/returns null on failure).
 * @param {(userId:string)=>({id:string,username?:string}|null|Promise)} deps.getUser REQUIRED — resolves a user record.
 * @param {(db:any, worldId:string)=>object} [deps.exportScene]  scene:request handler; omit → honest scene_export_unavailable.
 * @param {(db:any, worldId:string)=>object} [deps.exportKingdom]  kingdom:request handler; omit → honest kingdom_export_unavailable.
 * @param {(input:object)=>object|Promise<object>} [deps.composeDialogue]  dialogue:request → Concord 2B; omit → built-in composeTwoBDialogue.
 * @param {any} [deps.db]  passed verbatim to exportScene / exportKingdom.
 * @param {string} [deps.path="/godot-ws"]  upgrade path this gateway claims.
 * @param {(client:object, evt:string, data:object)=>void} [deps.onClientMessage]  fallback for unknown post-auth events.
 * @param {(verifyApiKeyPair:Function)} [deps.verifyApiKeyPair]  optional apiKey auth (see api-key note).
 * @param {number} [deps.authTimeoutMs=10000]
 * @param {number} [deps.heartbeatMs=25000]
 * @param {number} [deps.maxMessageBytes=65536]  our honest limit (ws maxPayload set to 2× this).
 * @param {number} [deps.rateLimitPerSec=20]  sustained per-client messages/sec (token-bucket refill rate).
 * @param {number} [deps.rateLimitBurst=30]  per-client token-bucket capacity (burst allowance above sustained rate).
 * @param {() => number} [deps.now]  injectable clock (ms) for the rate limiter, for deterministic tests.
 * @returns {{wss, emitToRoom, broadcast, joinRoomForClient, close, rooms, clients, getSeq}}
 */
export function mountGodotGateway(httpServer, deps = {}) {
  const {
    verifyToken,
    getUser,
    exportScene,
    exportKingdom,
    composeDialogue = composeTwoBDialogue,
    db = null,
    path = "/godot-ws",
    onClientMessage = null,
    verifyApiKeyPair = null,
    authTimeoutMs = 10_000,
    heartbeatMs = Number(process.env.CONCORD_GODOT_HEARTBEAT_MS) || 25_000,
    maxMissedPongs = Number(process.env.CONCORD_GODOT_MAX_MISSED_PONGS) || 2,
    maxMessageBytes = 64 * 1024,
    rateLimitPerSec = 20,
    rateLimitBurst = 30,
    now = () => Date.now(),
  } = deps;

  if (typeof verifyToken !== "function") throw new Error("godot-gateway: deps.verifyToken is required");
  if (typeof getUser !== "function") throw new Error("godot-gateway: deps.getUser is required");

  // Per-client token bucket, keyed by userId once authenticated (falls back to
  // the connection's clientId pre-auth, so an unauthenticated flood is capped
  // too). Same primitive as the socket.io combat path — continuous refill,
  // injectable clock for tests.
  const rateLimiter = makeSocketRateLimiter({ ratePerSec: rateLimitPerSec, burst: rateLimitBurst, now });

  // ws enforces maxPayload by closing 1009. We set it to 2× our limit so that a
  // frame between our 64KB limit and 128KB gets an honest `message_too_large`
  // error frame (connection survives) rather than an abrupt 1009 close.
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes * 2 });

  /** @type {Map<string, Set<object>>} room name → set of client states */
  const rooms = new Map();
  /** @type {Set<object>} all live client states */
  const clients = new Set();

  // Monotonic outbound sequence, mirrors server.js's _eventSeqCounter.
  let gatewaySeq = 0;

  
/**
 * Detect binary-encoded move payload (has playerId, x, y, z, seq, ts at top level)
 */
function isBinaryMovePayload(p) {
  return p && typeof p === 'object' && typeof p.playerId === 'string'
    && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number'
    && typeof p.seq === 'number';
}

// ── Outbound envelope ─────────────────────────────────────────────────────
  // Every frame: { evt, data: { ...payload, ts, _seq, _evt } }. Reserved fields
  // mirror event-shapes.js RESERVED (ts/_seq/_rid/_evt); _rid omitted in Phase 1.
  function send(ws, evt, payload = {}, opts = {}) {
    if (!ws || ws.readyState !== ws.OPEN) return false;
    try {
      // Binary fast-path: when caller opts in (player:move) or client has
      // signaled binary support (ws._concordBinary = true), encode frame
      // without touching JSON.stringify on the 30Hz hot path.
      if (opts.binary || ws._concordBinary) {
        const buf = encodeFrame(opts.binary || 'evt', {
          evt,
          data: { ...payload, ts: new Date().toISOString(), _seq: ++gatewaySeq, _evt: evt },
        });
        ws.send(buf, { binary: true });
        return true;
      }
      // JSON fallback for clients not yet on binary
      const frame = JSON.stringify({
        evt,
        data: { ...payload, ts: new Date().toISOString(), _seq: ++gatewaySeq, _evt: evt },
      });
      ws.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  // ── Room helpers ──────────────────────────────────────────────────────────
  function joinRoom(client, room) {
    let set = rooms.get(room);
    if (!set) { set = new Set(); rooms.set(room, set); }
    set.add(client);
    client.rooms.add(room);
  }
  function leaveRoom(client, room) {
    const set = rooms.get(room);
    if (set) { set.delete(client); if (set.size === 0) rooms.delete(room); }
    client.rooms.delete(room);
  }
  function leaveAllRooms(client) {
    for (const room of [...client.rooms]) leaveRoom(client, room);
  }

  // Godot Integration Phase 4 (D19 — live system preview). Lets an injected
  // `onClientMessage` handler (server.js's `_onGodotClientMessage`) join a
  // CLIENT'S connection into a real world room from server-side code, the
  // same room `room:join` already lets the client ask for itself. This is
  // what makes a design-mode client that references a live world (e.g. a
  // `design_command` action carrying a worldId) start receiving the SAME
  // realtime traffic (combat:impact, world:sonic-pulse, quest events, ...)
  // any play-mode client in that world already gets via emitToRoom above —
  // no parallel "design preview" event stream, just the real world room.
  // Returns false (no-op) for an invalid room shape or a missing client —
  // never throws, since a hiccup here must never break the caller's macro
  // dispatch.
  function joinRoomForClient(client, room) {
    if (!client || typeof room !== "string" || !ROOM_RE.test(room)) return false;
    joinRoom(client, room);
    return true;
  }

  /** Fan out an enveloped frame to every OPEN socket joined to `room`. */
  function emitToRoom(room, evt, payload = {}) {
    const set = rooms.get(room);
    if (!set) return 0;
    let n = 0;
    for (const client of set) {
      if (send(client.ws, evt, payload)) n++;
    }
    return n;
  }

  /** Global fan-out to every authenticated OPEN socket. */
  function broadcast(evt, payload = {}) {
    let n = 0;
    for (const client of clients) {
      if (client.authenticated && send(client.ws, evt, payload)) n++;
    }
    return n;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  async function tryAuth(client, data) {
    const token = data && typeof data.token === "string" ? data.token : null;
    const apiKey = data && typeof data.apiKey === "string" ? data.apiKey : null;

    if (token) {
      let res;
      try {
        res = await verifyToken(token, {
          remoteAddress: client.ws?._socket?.remoteAddress || "",
        });
      } catch {
        res = null;
      }
      const userId = res && res.userId ? res.userId : null;
      if (!userId) return { ok: false, reason: "invalid_token" };
      let user;
      try {
        user = await getUser(userId);
      } catch {
        user = null;
      }
      if (!user) return { ok: false, reason: "user_not_found" };
      return { ok: true, userId, username: user.username || null };
    }

    if (apiKey) {
      // apiKey auth only if the integration wired the injected verifier
      // (server.js mounts verifyApiKeyPair = AuthDB.getAllApiKeys + verifyApiKey).
      // Without it (standalone unit tests), return an honest unavailable reason.
      if (typeof verifyApiKeyPair !== "function") {
        return { ok: false, reason: "api_key_auth_unavailable" };
      }
      let res;
      try {
        res = await verifyApiKeyPair(apiKey);
      } catch {
        res = null;
      }
      const userId = res && res.userId ? res.userId : null;
      if (!userId) return { ok: false, reason: "invalid_api_key" };
      let user;
      try {
        user = await getUser(userId);
      } catch {
        user = null;
      }
      if (!user) return { ok: false, reason: "user_not_found" };
      return { ok: true, userId, username: user.username || null };
    }

    return { ok: false, reason: "no_credentials" };
  }

  // ── Message handling ──────────────────────────────────────────────────────
  async function handleMessage(client, raw) {
    // Pre-check our own byte limit BEFORE parse: a frame at/under ws's 2× maxPayload
    // but over our honest limit gets a clean error frame, connection survives.
    const byteLen = raw && typeof raw.length === "number"
      ? raw.length
      : Buffer.byteLength(String(raw));
    if (byteLen > maxMessageBytes) {
      send(client.ws, "error", { reason: "message_too_large", limit: maxMessageBytes, received: byteLen });
      return;
    }

    // Rate limit BEFORE dispatch: a per-client continuous-refill token bucket,
    // keyed by userId. Pre-auth (client.userId is still null) every
    // not-yet-authenticated connection shares one anonymous bucket — a cheap
    // cap on unauthenticated flood — and each user gets their own bucket the
    // instant they authenticate. Exceeding it drops the frame with an honest
    // error — never closes the socket for a single violation (a scripted or
    // misbehaving Godot client can otherwise flood parse + dispatch work
    // straight through).
    if (!rateLimiter.tryConsume(client.userId)) {
      const tokens = rateLimiter.peek(client.userId);
      const deficit = Math.max(0, 1 - tokens);
      const retryAfterMs = Math.ceil((deficit / rateLimitPerSec) * 1000);
      send(client.ws, "error", { reason: "rate_limited", retryAfterMs });
      return;
    }

    let msg;
    try {
      // Binary fast-path: if the first byte isn't '{' treat as length-prefixed binary frame
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (isBinaryFrame(buf)) {
        const decoded = decodeFrame(buf);
        if (!decoded) {
          send(client.ws, "error", { reason: "malformed_binary" });
          return;
        }
        msg = decoded.payload;
        // Mark client as binary-capable for future sends (saves JSON.stringify on hot path)
        client.ws._concordBinary = true;
      } else {
        msg = JSON.parse(buf.toString());
      }
    } catch {
      send(client.ws, "error", { reason: "malformed_json" });
      return; // survive
    }
    if (!msg || typeof msg !== "object") {
      send(client.ws, "error", { reason: "malformed_json" });
      return;
    }

    // For binary move packets, decoded.payload IS the move struct (no evt/data wrapper)
    if (isBinaryMovePayload(msg)) {
      client.ws._lastBinaryMove = msg;
      msg = { evt: "player:move", data: msg };
    }

    const evt = typeof msg.evt === "string" ? msg.evt : null;
    const data = msg.data && typeof msg.data === "object" ? msg.data : {};

    // ── Pre-auth: only "auth" is accepted ──
    if (!client.authenticated) {
      if (evt !== "auth") {
        send(client.ws, "error", { reason: "auth_required" });
        client.ws.close(4401, "auth_required");
        return;
      }
      const result = await tryAuth(client, data);
      if (!result.ok) {
        send(client.ws, "auth:error", { reason: result.reason });
        client.ws.close(4401, "auth_failed");
        return;
      }
      client.authenticated = true;
      client.userId = result.userId;
      client.username = result.username;
      if (client._authTimer) { clearTimeout(client._authTimer); client._authTimer = null; }
      joinRoom(client, `user:${result.userId}`);
      send(client.ws, "hello", {
        clientId: client.id,
        authenticated: true,
        userId: result.userId,
        username: result.username,
      });
      return;
    }

    // ── Post-auth events ──
    switch (evt) {
      case "ping":
        send(client.ws, "pong", {});
        return;

      case "auth":
        // Already authenticated; idempotent ack (do not re-auth).
        send(client.ws, "hello", {
          clientId: client.id,
          authenticated: true,
          userId: client.userId,
          username: client.username,
        });
        return;

      case "room:join": {
        const room = typeof data.room === "string" ? data.room : "";
        if (!ROOM_RE.test(room)) {
          send(client.ws, "room:error", { reason: "invalid_room", room });
          return;
        }
        if (room.startsWith("user:") && room !== `user:${client.userId}`) {
          send(client.ws, "room:error", { reason: "forbidden_room", room });
          return;
        }
        joinRoom(client, room);
        send(client.ws, "room:joined", { room });
        return;
      }

      case "room:leave": {
        const room = typeof data.room === "string" ? data.room : "";
        leaveRoom(client, room);
        send(client.ws, "room:left", { room });
        return;
      }

      case "scene:request": {
        const worldId = typeof data.worldId === "string" ? data.worldId : "";
        if (typeof exportScene !== "function" || !db) {
          send(client.ws, "scene:data", { ok: false, reason: "scene_export_unavailable" });
          return;
        }
        let scene;
        try {
          scene = await exportScene(db, worldId);
        } catch (e) {
          send(client.ws, "scene:data", { ok: false, reason: "scene_export_failed", error: String(e?.message || e) });
          return;
        }
        // Passthrough verbatim, including honest {ok:false,...} failures. Never fabricate a scene.
        send(client.ws, "scene:data", scene);
        return;
      }

      case "kingdom:request": {
        const worldId = typeof data.worldId === "string" ? data.worldId : "";
        if (typeof exportKingdom !== "function") {
          send(client.ws, "kingdom:data", { ok: false, reason: "kingdom_export_unavailable" });
          return;
        }
        let kingdom;
        try {
          kingdom = await exportKingdom(db, worldId);
        } catch (e) {
          send(client.ws, "kingdom:data", { ok: false, reason: "kingdom_export_failed", error: String(e?.message || e) });
          return;
        }
        send(client.ws, "kingdom:data", kingdom);
        return;
      }

      case "dialogue:request": {
        const requestId = typeof data.requestId === "string" ? data.requestId : "";
        if (typeof composeDialogue !== "function") {
          send(client.ws, "dialogue:data", { ok: false, reason: "dialogue_unavailable", requestId });
          return;
        }
        try {
          const result = await composeDialogue({
            db,
            userId: client.userId,
            worldId: typeof data.worldId === "string" ? data.worldId : "",
            npcId: typeof data.npcId === "string" ? data.npcId : "",
            npcName: typeof data.npcName === "string" ? data.npcName : "",
            line: typeof data.line === "string" ? data.line : "",
            text: typeof data.text === "string" ? data.text : "",
            requestId,
          });
          send(client.ws, "dialogue:data", result && typeof result === "object"
            ? result
            : { ok: false, reason: "dialogue_failed", requestId });
        } catch (e) {
          send(client.ws, "dialogue:data", {
            ok: false,
            reason: "dialogue_failed",
            requestId,
            error: String(e?.message || e),
          });
        }
        return;
      }

      default: {
        if (typeof onClientMessage === "function") {
          try {
            onClientMessage(client, evt, data);
          } catch {
            // onClientMessage must never take down the gateway.
          }
          return;
        }
        send(client.ws, "error", { reason: "unknown_evt", evt });
      }
    }
  }

  // ── Connection setup ──────────────────────────────────────────────────────
  function onConnection(ws) {
    const client = {
      id: nextClientId(),
      ws,
      authenticated: false,
      userId: null,
      username: null,
      rooms: new Set(),
      isAlive: true,
      _authTimer: null,
    };
    clients.add(ws.__client = client);

    // Auth timeout: unauthenticated sockets are reaped after authTimeoutMs.
    client._authTimer = setTimeout(() => {
      try {
        if (!client.authenticated && ws.readyState === ws.OPEN) {
          send(ws, "auth:error", { reason: "auth_timeout" });
          ws.close(4408, "auth_timeout");
        }
      } catch { /* survive */ }
    }, authTimeoutMs);
    if (client._authTimer.unref) client._authTimer.unref();

    ws.on("message", (raw) => {
      // Handlers never throw out of the gateway.
      Promise.resolve(handleMessage(client, raw)).catch(() => { /* survive */ });
    });

    ws.on("pong", () => { client.isAlive = true; });

    // ws emits 'error' on protocol violations (e.g. 1009 oversized past 2× limit);
    // catching it keeps the SERVER process alive. The socket itself may close.
    ws.on("error", () => { /* survive; per-socket only */ });

    ws.on("close", () => {
      if (client._authTimer) { clearTimeout(client._authTimer); client._authTimer = null; }
      leaveAllRooms(client);
      clients.delete(client);
    });
  }

  wss.on("connection", onConnection);

  // ── Upgrade filtering: only claim OUR path so we can coexist with socket.io's
  // engine.io upgrade handling at integration time. We destroy nothing else's socket.
  function onUpgrade(req, socket, head) {
    let pathname;
    try {
      // @env-config-ok: `http://localhost` here is only a dummy base for the WHATWG
      // URL parser — req.url is a relative path and only `.pathname` is read; nothing
      // is ever connected to this "host". Standard Node idiom for parsing a path.
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      return; // not ours; let another handler deal with it
    }
    if (pathname !== path) return; // NOT our path — do not touch this upgrade
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }
  httpServer.on("upgrade", onUpgrade);

  // ── Heartbeat reaper: ping every heartbeatMs; terminate after
  // maxMissedPongs consecutive missed pongs. The old one-strike version
  // (terminate on the FIRST missed pong ≈ 25s effective timeout) was tighter
  // than socket.io's 60s pingTimeout on the same server, and had a false-kill
  // mode: after a long event-loop stall, Node runs expired TIMERS before
  // draining pending socket I/O — so the overdue reaper tick saw
  // isAlive=false and terminated clients whose pongs were sitting unread in
  // the socket buffer. Every Godot client dropped before any web client did,
  // on every stall. Two strikes ≈ 50s tolerance, matching socket.io's budget.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      const ws = client.ws;
      if (client.isAlive === false) {
        client.missedPongs = (client.missedPongs || 0) + 1;
        if (client.missedPongs >= maxMissedPongs) {
          try { ws.terminate(); } catch { /* survive */ }
          continue;
        }
      } else {
        client.missedPongs = 0;
      }
      client.isAlive = false;
      try { ws.ping(); } catch { /* survive */ }
    }
  }, heartbeatMs);
  if (heartbeat.unref) heartbeat.unref();

  function close() {
    clearInterval(heartbeat);
    httpServer.removeListener("upgrade", onUpgrade);
    for (const client of clients) {
      try { client.ws.close(1001, "gateway_closing"); } catch { /* survive */ }
    }
    try { wss.close(); } catch { /* survive */ }
    rooms.clear();
    clients.clear();
  }

  return {
    wss,
    emitToRoom,
    broadcast,
    joinRoomForClient,
    close,
    rooms,
    clients,
    getSeq: () => gatewaySeq,
  };
}

/**
 * Bind just the fan-out surface of a gateway handle so the future integration
 * step can mirror realtimeEmit's world:* / user:* room emits into Godot rooms
 * without holding the whole gateway handle.
 * @param {{emitToRoom:Function, broadcast:Function}} gateway
 */
export function createGatewayEmitter(gateway) {
  if (!gateway || typeof gateway.emitToRoom !== "function") {
    throw new Error("createGatewayEmitter: expected a gateway handle with emitToRoom");
  }
  return {
    emitToRoom: (room, evt, payload) => gateway.emitToRoom(room, evt, payload),
    broadcast: (evt, payload) => gateway.broadcast(evt, payload),
  };
}

export default { mountGodotGateway, createGatewayEmitter };
