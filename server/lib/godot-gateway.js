// server/lib/godot-gateway.js
//
// Godot Integration Phase 1 — raw-WebSocket gateway for a native Godot 4 world
// client. This is a SELF-CONTAINED module: it imports nothing from server.js and
// takes every collaborator (auth, user lookup, scene export, db) as an injected
// dependency, so it can be unit-tested against a bare http.createServer() with
// stub deps and mounted into the monolith later without touching this file.
//
// ── Honest-by-construction notes ────────────────────────────────────────────
//  * `ws` is imported below. It is currently present at server/node_modules/ws
//    (v8.21.0) only as a TRANSITIVE dependency (pulled in via engine.io). This
//    module uses it, but does NOT install it. INTEGRATION TODO: the orchestrator
//    MUST declare `ws` in server/package.json "dependencies" before this module
//    is mounted, or a future `npm prune`/dedupe could remove it. See
//    docs/GODOT_INTEGRATION.md.
//  * This module is DEAD CODE until mounted in server.js — nothing here runs at
//    boot on its own. Mounting is a later integration step (by design).
//  * Rate limiting is DEFERRED to integration (see the marked comment in the
//    message handler). Phase 1 does not throttle per-client message volume.
//  * The outbound envelope mirrors realtimeEmit's reserved fields (ts/_seq/_evt).
//    `_rid` is intentionally NOT populated on this path in Phase 1 — there is no
//    HTTP request to correlate a Godot socket frame against yet.
//
import { WebSocketServer } from "ws";

const ROOM_RE = /^(world|user):[A-Za-z0-9_.\-]{1,64}$/;

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
 * @param {any} [deps.db]  passed verbatim to exportScene.
 * @param {string} [deps.path="/godot-ws"]  upgrade path this gateway claims.
 * @param {(client:object, evt:string, data:object)=>void} [deps.onClientMessage]  fallback for unknown post-auth events.
 * @param {(verifyApiKeyPair:Function)} [deps.verifyApiKeyPair]  optional apiKey auth (see api-key note).
 * @param {number} [deps.authTimeoutMs=10000]
 * @param {number} [deps.heartbeatMs=25000]
 * @param {number} [deps.maxMessageBytes=65536]  our honest limit (ws maxPayload set to 2× this).
 * @returns {{wss, emitToRoom, broadcast, close, rooms, clients, getSeq}}
 */
export function mountGodotGateway(httpServer, deps = {}) {
  const {
    verifyToken,
    getUser,
    exportScene,
    db = null,
    path = "/godot-ws",
    onClientMessage = null,
    verifyApiKeyPair = null,
    authTimeoutMs = 10_000,
    heartbeatMs = 25_000,
    maxMessageBytes = 64 * 1024,
  } = deps;

  if (typeof verifyToken !== "function") throw new Error("godot-gateway: deps.verifyToken is required");
  if (typeof getUser !== "function") throw new Error("godot-gateway: deps.getUser is required");

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

  // ── Outbound envelope ─────────────────────────────────────────────────────
  // Every frame: { evt, data: { ...payload, ts, _seq, _evt } }. Reserved fields
  // mirror event-shapes.js RESERVED (ts/_seq/_rid/_evt); _rid omitted in Phase 1.
  function send(ws, evt, payload = {}) {
    if (!ws || ws.readyState !== ws.OPEN) return false;
    let frame;
    try {
      frame = JSON.stringify({
        evt,
        data: { ...payload, ts: new Date().toISOString(), _seq: ++gatewaySeq, _evt: evt },
      });
    } catch {
      return false;
    }
    try {
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
        res = await verifyToken(token);
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
      // apiKey auth only if the integration wired the injected verifier.
      // INTEGRATION TODO: pass verifyApiKeyPair (AuthDB.getAllApiKeys + verifyApiKey).
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
    // RATE LIMITING: deferred to integration by design (Phase 1). A per-client
    // token bucket keyed on client.userId should gate this handler at mount time.

    // Pre-check our own byte limit BEFORE parse: a frame at/under ws's 2× maxPayload
    // but over our honest limit gets a clean error frame, connection survives.
    const byteLen = raw && typeof raw.length === "number"
      ? raw.length
      : Buffer.byteLength(String(raw));
    if (byteLen > maxMessageBytes) {
      send(client.ws, "error", { reason: "message_too_large", limit: maxMessageBytes, received: byteLen });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(client.ws, "error", { reason: "malformed_json" });
      return; // survive
    }
    if (!msg || typeof msg !== "object") {
      send(client.ws, "error", { reason: "malformed_json" });
      return;
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
        return;
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

  // ── Heartbeat reaper: ping every heartbeatMs; terminate sockets that never pong.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      const ws = client.ws;
      if (client.isAlive === false) {
        try { ws.terminate(); } catch { /* survive */ }
        continue;
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
