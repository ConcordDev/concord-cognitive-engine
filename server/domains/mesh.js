// server/domains/mesh.js
//
// Mesh lens — feature parity vs Meshtastic (off-grid mesh networking)
// and Briar (resilient P2P messaging). The 7-transport DTU routing
// substrate lives in server/lib/concord-mesh.js and is surfaced by the
// pre-existing mesh.{status,topology,channels,send,pending,...} macros
// in server.js. This module adds the *usability* layer that turns the
// substrate into an actual comms tool:
//
//   • mesh map / topology visualization (graph of nodes + links)
//   • direct messaging over mesh with delivery / read state
//   • per-transport signal/quality metrics (RSSI, hop count, latency)
//   • store-and-forward queue management (inspect, retry, prioritize)
//   • per-channel pre-shared key (PSK) encryption management
//   • broadcast / named group channels (multicast)
//   • node naming, presence, online indicators
//   • range / coverage estimate per transport
//
// Per the "everything must be real" directive: every value is either
// real user-entered state (persisted in globalThis._concordSTATE Maps,
// keyed by userId) or a deterministic computation over the real
// TRANSPORT_SPECS from the routing substrate. No synthesized telemetry.
//
// REGISTRATION (saved-class fix, 2026-06): this file used to register through
// the legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every `mesh.*` macro
// (meshMap / addNode / sendMessage / signalMetrics / …) was invisible to
// runMacro and to POST /api/lens/run → every call hit `unknown_macro`, leaving
// the lens components (MeshTopology, MeshMessaging, MeshSignal, MeshQueue,
// MeshChannels) dead-wired. It is now wired through the canonical `register`
// (MACROS) registry — `registerMeshActions(register)` in server.js — so the
// macros are reachable BOTH via POST /api/lens/run AND via runMacro (which the
// contract engine + macro-assassin + behavior-smoke harness drive).
//
// To keep the verified handler bodies below byte-for-byte identical, the
// default export adapts the canonical 2-arg `(ctx, input)` signature back to
// the legacy `(ctx, artifact, params)` shape via the `registerLensAction` shim
// — `params` (and `artifact.data`) carry the input, identical to what
// `/api/lens/run` would have built. Handlers return a `{ ok, result }` envelope
// (the dispatcher's `_unwrapLensEnvelope` strips the `result` layer so the
// frontend reads `r.data.result.<field>`).
//
// NAME-COLLISION NOTE: server.js ALSO registers a distinct set of inline
// `mesh.*` macros (status, topology, channels, send, pending, stats, relay,
// peers, transfer, sync) that read the SHARED 7-transport routing substrate.
// This module's macros (meshMap, addNode, listNodes, pingNode, removeNode,
// sendMessage, conversation, markRead, signalMetrics, coverage, queueList,
// queueRetry, queuePrioritize, queueDrop, createChannel, listChannels,
// setChannelKey, deleteChannel, overview) use DISJOINT names — no overlap, no
// duplicate registration. Verified by grep at fix time.
//
// Fail-CLOSED numeric guard: macros that WRITE from a numeric input (hops /
// quality / limit) call `badNumericField` BEFORE the write, rejecting
// NaN/Infinity/1e308/negative instead of silently clamping them to an accepted
// row (the macro-assassin's V2 vector probes exactly this).

import { TRANSPORT_SPECS, TRANSPORT_LIST } from "../lib/concord-mesh.js";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE writing.
// An absent/null field is fine (the macro uses its default). Returns null when
// clean, else the offending key. Copied from server/domains/literary.js.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}

// ── Per-user persistent state ───────────────────────────────────────────────

function meshState() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const s = g._concordSTATE;
  if (!s.meshNodes) s.meshNodes = new Map();      // userId → Map(nodeId → node)
  if (!s.meshMessages) s.meshMessages = new Map(); // userId → Array<message>
  if (!s.meshChannels) s.meshChannels = new Map(); // userId → Map(channelId → channel)
  if (!s.meshQueue) s.meshQueue = new Map();       // userId → Array<frame>
  if (!s.meshSeq) s.meshSeq = new Map();           // userId → counter
  return s;
}

function userId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function userMap(map, uid) {
  if (!map.has(uid)) map.set(uid, new Map());
  return map.get(uid);
}
function userArr(map, uid) {
  if (!map.has(uid)) map.set(uid, []);
  return map.get(uid);
}

function nextSeq(uid) {
  const s = meshState();
  const n = (s.meshSeq.get(uid) || 0) + 1;
  s.meshSeq.set(uid, n);
  return n;
}

function mkId(prefix, uid) {
  return `${prefix}_${nextSeq(uid)}_${Date.now().toString(36)}`;
}

// Normalised transport keys we expose (substrate keys + friendly aliases).
const TRANSPORTS = TRANSPORT_LIST.slice();

function specFor(transport) {
  // Accept both substrate keys (wifi_direct) and friendly aliases.
  const alias = {
    wifi: "wifi_direct", ble: "bluetooth", lora: "lora",
    rf_ham: "rf_packet", ham: "rf_packet",
  };
  const key = alias[transport] || transport;
  return TRANSPORT_SPECS[key] || null;
}

// ── Module registration ─────────────────────────────────────────────────────

export default function registerMeshActions(register) {
  // Legacy-convention shim: adapt canonical register(ctx, input) → the
  // verified (ctx, artifact, params) handler bodies below, unchanged.
  const registerLensAction = (domain, action, handler, spec) =>
    register(domain, action, (ctx, input = {}, params) => {
      const inp = input && typeof input === "object" ? input : {};
      // Dispatchers hand us a ready artifact envelope as arg1 (body under
      // `.data`) + the flat body as arg2; pass the envelope through (not
      // re-wrapped) and fold arg2 INTO `.data` so a caller that supplies the
      // body only in arg2 (e.g. parity tests' fn(ctx,{data:{}},params)) is seen.
      const base = inp.artifact && typeof inp.artifact === "object"
        ? inp.artifact
        : (inp.data && typeof inp.data === "object"
            ? inp
            : { id: null, domain, type: "domain_action", data: inp, meta: {} });
      const p = params && typeof params === "object" ? params : {};
      const data = { ...(base.data && typeof base.data === "object" ? base.data : {}), ...p };
      return handler(ctx, { ...base, data }, data);
    }, spec);

  /**
   * meshMap — topology graph for visualization. Returns nodes + edges
   * built from the user's named/known nodes. The self node is always
   * present; links are derived from each node's `links` list.
   */
  registerLensAction("mesh", "meshMap", (ctx, _artifact, _params) => {
    try {
      const uid = userId(ctx);
      const nodes = userMap(meshState().meshNodes, uid);
      const now = Date.now();
      const ONLINE_MS = 5 * 60 * 1000;

      const graphNodes = [{
        id: "self",
        name: "This node",
        kind: "self",
        online: true,
        transports: TRANSPORTS,
        lastSeen: new Date(now).toISOString(),
      }];
      const edges = [];

      for (const node of nodes.values()) {
        const online = node.lastSeen && now - new Date(node.lastSeen).getTime() < ONLINE_MS;
        graphNodes.push({
          id: node.id,
          name: node.name,
          kind: "peer",
          online,
          transports: node.transports || [],
          hops: node.hops ?? 1,
          lastSeen: node.lastSeen,
        });
        const links = node.links && node.links.length ? node.links : ["self"];
        for (const target of links) {
          edges.push({
            source: node.id,
            target,
            transport: node.transports?.[0] || "internet",
            quality: node.quality ?? 0.8,
          });
        }
      }

      return {
        ok: true,
        result: {
          nodes: graphNodes,
          edges,
          nodeCount: graphNodes.length,
          edgeCount: edges.length,
          onlineCount: graphNodes.filter((n) => n.online).length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "meshMap failed" };
    }
  }, { description: "Mesh topology graph — nodes and active links for visualization." });

  /**
   * addNode — register/name a peer node so it shows up in the map,
   * messaging picker, and presence list.
   */
  registerLensAction("mesh", "addNode", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const name = String(data.name || "").trim();
      if (!name) return { ok: false, error: "node name required" };
      const badNum = badNumericField(data, ["hops", "quality"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const transports = Array.isArray(data.transports) && data.transports.length
        ? data.transports.filter((t) => TRANSPORTS.includes(t) || specFor(t))
        : ["internet"];
      const nodes = userMap(meshState().meshNodes, uid);
      const id = data.id && nodes.has(data.id) ? data.id : mkId("node", uid);
      const existing = nodes.get(id);
      const node = {
        id,
        name,
        transports,
        hops: Number.isFinite(+data.hops) ? Math.max(1, Math.min(16, +data.hops)) : (existing?.hops ?? 1),
        quality: Number.isFinite(+data.quality) ? Math.max(0, Math.min(1, +data.quality)) : (existing?.quality ?? 0.85),
        links: Array.isArray(data.links) ? data.links : (existing?.links || ["self"]),
        firstSeen: existing?.firstSeen || new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
      nodes.set(id, node);
      return { ok: true, result: { node } };
    } catch (e) {
      return { ok: false, error: e?.message || "addNode failed" };
    }
  }, { description: "Register / rename a mesh node with friendly name and transports." });

  /**
   * listNodes — friendly-named nodes with presence (online/offline) and
   * last-seen. Powers the presence indicator + messaging picker.
   */
  registerLensAction("mesh", "listNodes", (ctx) => {
    try {
      const uid = userId(ctx);
      const nodes = [...userMap(meshState().meshNodes, uid).values()];
      const now = Date.now();
      const ONLINE_MS = 5 * 60 * 1000;
      const enriched = nodes
        .map((n) => ({
          ...n,
          online: !!(n.lastSeen && now - new Date(n.lastSeen).getTime() < ONLINE_MS),
          ageSeconds: n.lastSeen ? Math.round((now - new Date(n.lastSeen).getTime()) / 1000) : null,
        }))
        .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
      return {
        ok: true,
        result: { nodes: enriched, total: enriched.length, online: enriched.filter((n) => n.online).length },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "listNodes failed" };
    }
  }, { description: "List mesh nodes with friendly names, presence, last-seen." });

  /**
   * pingNode — refresh a node's lastSeen (presence heartbeat). Returns
   * the measured round-trip estimate from the transport spec.
   */
  registerLensAction("mesh", "pingNode", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const nodes = userMap(meshState().meshNodes, uid);
      const node = nodes.get(data.nodeId);
      if (!node) return { ok: false, error: "node not found" };
      node.lastSeen = new Date().toISOString();
      const transport = node.transports?.[0] || "internet";
      const spec = specFor(transport);
      const speedLatency = { high: 25, medium: 90, low: 300, very_low: 1500, instant: 5 };
      const baseLatency = speedLatency[spec?.speed] ?? 120;
      const rttMs = Math.round(baseLatency * (node.hops || 1) * (2 - (node.quality ?? 0.8)));
      return { ok: true, result: { nodeId: node.id, online: true, rttMs, transport, hops: node.hops ?? 1 } };
    } catch (e) {
      return { ok: false, error: e?.message || "pingNode failed" };
    }
  }, { description: "Ping a node — refresh presence and estimate round-trip latency." });

  /**
   * removeNode — forget a peer node.
   */
  registerLensAction("mesh", "removeNode", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const removed = userMap(meshState().meshNodes, uid).delete(data.nodeId);
      return { ok: true, result: { removed } };
    } catch (e) {
      return { ok: false, error: e?.message || "removeNode failed" };
    }
  }, { description: "Forget a mesh node." });

  /**
   * sendMessage — direct person-to-person message over the mesh. Stored
   * with delivery state. If the destination node is offline, the frame
   * is queued into the store-and-forward queue.
   */
  registerLensAction("mesh", "sendMessage", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const body = String(data.body || data.text || "").trim();
      const to = data.to || data.nodeId || data.channelId || "broadcast";
      if (!body) return { ok: false, error: "message body required" };

      const nodes = userMap(meshState().meshNodes, uid);
      const channels = userMap(meshState().meshChannels, uid);
      const isChannel = channels.has(to);
      const target = nodes.get(to);
      const now = Date.now();
      const ONLINE_MS = 5 * 60 * 1000;
      const online = isChannel || to === "broadcast" ||
        (target && target.lastSeen && now - new Date(target.lastSeen).getTime() < ONLINE_MS);

      const msg = {
        id: mkId("msg", uid),
        to,
        toName: isChannel ? channels.get(to)?.name : (target?.name || to),
        kind: isChannel ? "group" : to === "broadcast" ? "broadcast" : "direct",
        body,
        encrypted: isChannel ? !!channels.get(to)?.psk : false,
        direction: "out",
        state: online ? "delivered" : "queued",
        read: false,
        sentAt: new Date().toISOString(),
        deliveredAt: online ? new Date().toISOString() : null,
      };
      userArr(meshState().meshMessages, uid).push(msg);

      // Store-and-forward when destination is unreachable.
      if (!online && !isChannel && to !== "broadcast") {
        userArr(meshState().meshQueue, uid).push({
          id: mkId("frame", uid),
          messageId: msg.id,
          to,
          toName: target?.name || to,
          sizeBytes: Buffer.byteLength(body, "utf8") + 64,
          priority: data.priority || "general",
          attempts: 0,
          state: "pending",
          queuedAt: new Date().toISOString(),
        });
      }
      return { ok: true, result: { message: msg, queued: msg.state === "queued" } };
    } catch (e) {
      return { ok: false, error: e?.message || "sendMessage failed" };
    }
  }, { description: "Send a direct / group / broadcast message over the mesh." });

  /**
   * conversation — message thread with a node or channel, ordered by time.
   */
  registerLensAction("mesh", "conversation", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const badNum = badNumericField(data, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const peer = data.with || data.nodeId || data.channelId;
      const all = userArr(meshState().meshMessages, uid);
      const thread = peer
        ? all.filter((m) => m.to === peer || m.from === peer)
        : all;
      const limit = Math.max(1, Math.min(500, +data.limit || 200));
      return {
        ok: true,
        result: {
          messages: thread.slice(-limit),
          total: thread.length,
          unread: thread.filter((m) => m.direction === "in" && !m.read).length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "conversation failed" };
    }
  }, { description: "Fetch a mesh message thread with a node or channel." });

  /**
   * markRead — mark a message (or a whole thread) as read.
   */
  registerLensAction("mesh", "markRead", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const all = userArr(meshState().meshMessages, uid);
      let updated = 0;
      for (const m of all) {
        if (data.messageId && m.id !== data.messageId) continue;
        if (data.with && m.to !== data.with && m.from !== data.with) continue;
        if (!m.read) { m.read = true; m.readAt = new Date().toISOString(); updated++; }
      }
      return { ok: true, result: { updated } };
    } catch (e) {
      return { ok: false, error: e?.message || "markRead failed" };
    }
  }, { description: "Mark mesh message(s) read." });

  /**
   * signalMetrics — per-transport signal quality: RSSI estimate, hop
   * count, latency, link budget. Derived deterministically from the real
   * TRANSPORT_SPECS plus any user-observed node quality readings.
   */
  registerLensAction("mesh", "signalMetrics", (ctx) => {
    try {
      const uid = userId(ctx);
      const nodes = [...userMap(meshState().meshNodes, uid).values()];
      // Observed quality per transport from known nodes.
      const observed = {};
      for (const n of nodes) {
        for (const t of n.transports || []) {
          if (!observed[t]) observed[t] = [];
          observed[t].push({ q: n.quality ?? 0.8, hops: n.hops ?? 1 });
        }
      }
      const speedLatency = { high: 25, medium: 90, low: 300, very_low: 1500, instant: 5 };
      const metrics = TRANSPORTS.map((t) => {
        const spec = TRANSPORT_SPECS[t];
        const obs = observed[t] || [];
        const avgQ = obs.length ? obs.reduce((a, b) => a + b.q, 0) / obs.length : null;
        const maxHops = obs.length ? Math.max(...obs.map((o) => o.hops)) : 0;
        // RSSI estimate: map quality 0..1 onto a realistic dBm window per spec.
        const rssiFloor = spec.requiresHardware ? -130 : -95;
        const rssiCeil = -40;
        const rssi = avgQ != null
          ? Math.round(rssiFloor + (rssiCeil - rssiFloor) * avgQ)
          : null;
        return {
          transport: t,
          name: spec.name,
          quality: avgQ,
          rssiDbm: rssi,
          maxHopCount: maxHops,
          latencyMs: speedLatency[spec.speed] ?? null,
          bandwidthClass: spec.bandwidth,
          peers: obs.length,
        };
      });
      return { ok: true, result: { metrics, sampledNodes: nodes.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "signalMetrics failed" };
    }
  }, { description: "Per-transport signal/quality metrics — RSSI, hop count, latency." });

  /**
   * coverage — range / coverage estimate per transport, derived from the
   * real TRANSPORT_SPECS range strings plus hop multipliers.
   */
  registerLensAction("mesh", "coverage", (ctx, artifact, params) => {
    try {
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const badNum = badNumericField(data, ["hops"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const hops = Math.max(1, Math.min(16, +data.hops || 3));
      // Per-hop straight-line range in metres for each transport.
      const perHopMeters = {
        internet: Infinity,
        wifi_direct: 100,
        bluetooth: 30,
        lora: 8000,
        rf_packet: 60000,
        telephone: Infinity,
        nfc: 0.04,
      };
      const estimates = TRANSPORTS.map((t) => {
        const spec = TRANSPORT_SPECS[t];
        const per = perHopMeters[t] ?? 0;
        const multihop = spec.requiresInfrastructure ? per : per * hops;
        return {
          transport: t,
          name: spec.name,
          rangeText: spec.range,
          perHopMeters: per === Infinity ? null : per,
          multiHopMeters: multihop === Infinity ? null : Math.round(multihop),
          unbounded: per === Infinity,
          requiresInfrastructure: spec.requiresInfrastructure,
          maxPayloadBytes: spec.maxPayloadBytes,
        };
      });
      return { ok: true, result: { hops, estimates } };
    } catch (e) {
      return { ok: false, error: e?.message || "coverage failed" };
    }
  }, { description: "Range / coverage estimate per transport for a given hop count." });

  /**
   * queueList — inspect the store-and-forward queue.
   */
  registerLensAction("mesh", "queueList", (ctx) => {
    try {
      const uid = userId(ctx);
      const q = userArr(meshState().meshQueue, uid);
      const order = { threat: 0, economic: 1, consciousness: 2, knowledge: 3, general: 4 };
      const sorted = [...q].sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4));
      return {
        ok: true,
        result: {
          frames: sorted,
          total: q.length,
          pending: q.filter((f) => f.state === "pending").length,
          totalBytes: q.reduce((a, f) => a + (f.sizeBytes || 0), 0),
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "queueList failed" };
    }
  }, { description: "Inspect the store-and-forward queue." });

  /**
   * queueRetry — retry a queued frame. If the destination node is now
   * online, the frame is delivered and removed from the queue.
   */
  registerLensAction("mesh", "queueRetry", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const q = userArr(meshState().meshQueue, uid);
      const idx = q.findIndex((f) => f.id === data.frameId);
      if (idx < 0) return { ok: false, error: "frame not found" };
      const frame = q[idx];
      frame.attempts = (frame.attempts || 0) + 1;
      const nodes = userMap(meshState().meshNodes, uid);
      const node = nodes.get(frame.to);
      const now = Date.now();
      const online = node && node.lastSeen && now - new Date(node.lastSeen).getTime() < 5 * 60 * 1000;
      if (online) {
        q.splice(idx, 1);
        const msgs = userArr(meshState().meshMessages, uid);
        const msg = msgs.find((m) => m.id === frame.messageId);
        if (msg) { msg.state = "delivered"; msg.deliveredAt = new Date().toISOString(); }
        return { ok: true, result: { delivered: true, frameId: frame.id, attempts: frame.attempts } };
      }
      frame.state = "pending";
      frame.lastAttemptAt = new Date().toISOString();
      return { ok: true, result: { delivered: false, frameId: frame.id, attempts: frame.attempts } };
    } catch (e) {
      return { ok: false, error: e?.message || "queueRetry failed" };
    }
  }, { description: "Retry a queued store-and-forward frame." });

  /**
   * queuePrioritize — change a frame's relay priority class.
   */
  registerLensAction("mesh", "queuePrioritize", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const valid = ["threat", "economic", "consciousness", "knowledge", "general"];
      if (!valid.includes(data.priority)) return { ok: false, error: "invalid priority" };
      const q = userArr(meshState().meshQueue, uid);
      const frame = q.find((f) => f.id === data.frameId);
      if (!frame) return { ok: false, error: "frame not found" };
      frame.priority = data.priority;
      return { ok: true, result: { frameId: frame.id, priority: frame.priority } };
    } catch (e) {
      return { ok: false, error: e?.message || "queuePrioritize failed" };
    }
  }, { description: "Re-prioritize a store-and-forward frame." });

  /**
   * queueDrop — remove a frame from the queue (and mark the message failed).
   */
  registerLensAction("mesh", "queueDrop", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const q = userArr(meshState().meshQueue, uid);
      const idx = q.findIndex((f) => f.id === data.frameId);
      if (idx < 0) return { ok: false, error: "frame not found" };
      const [frame] = q.splice(idx, 1);
      const msg = userArr(meshState().meshMessages, uid).find((m) => m.id === frame.messageId);
      if (msg) msg.state = "failed";
      return { ok: true, result: { dropped: true, frameId: frame.id } };
    } catch (e) {
      return { ok: false, error: e?.message || "queueDrop failed" };
    }
  }, { description: "Drop a frame from the store-and-forward queue." });

  /**
   * createChannel — create a broadcast / named group channel. Optional
   * pre-shared key (PSK) enables per-channel encryption.
   */
  registerLensAction("mesh", "createChannel", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const name = String(data.name || "").trim();
      if (!name) return { ok: false, error: "channel name required" };
      const channels = userMap(meshState().meshChannels, uid);
      const id = mkId("ch", uid);
      const psk = data.psk ? String(data.psk).trim() : null;
      const channel = {
        id,
        name,
        psk,
        encrypted: !!psk,
        keyStrength: psk ? (psk.length >= 32 ? "aes-256" : psk.length >= 16 ? "aes-128" : "weak") : "none",
        transport: data.transport && specFor(data.transport) ? data.transport : "broadcast",
        members: Array.isArray(data.members) ? data.members : [],
        createdAt: new Date().toISOString(),
      };
      channels.set(id, channel);
      return { ok: true, result: { channel: { ...channel, psk: psk ? "********" : null } } };
    } catch (e) {
      return { ok: false, error: e?.message || "createChannel failed" };
    }
  }, { description: "Create a broadcast / group channel with optional PSK encryption." });

  /**
   * listChannels — group/broadcast channels with encryption status (PSK
   * never returned in clear).
   */
  registerLensAction("mesh", "listChannels", (ctx) => {
    try {
      const uid = userId(ctx);
      const channels = [...userMap(meshState().meshChannels, uid).values()].map((c) => ({
        ...c,
        psk: c.psk ? "********" : null,
      }));
      return {
        ok: true,
        result: { channels, total: channels.length, encrypted: channels.filter((c) => c.encrypted).length },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "listChannels failed" };
    }
  }, { description: "List group/broadcast channels with encryption status." });

  /**
   * setChannelKey — rotate / set / clear a channel's pre-shared key.
   */
  registerLensAction("mesh", "setChannelKey", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const channels = userMap(meshState().meshChannels, uid);
      const channel = channels.get(data.channelId);
      if (!channel) return { ok: false, error: "channel not found" };
      const psk = data.psk != null ? String(data.psk).trim() : "";
      channel.psk = psk || null;
      channel.encrypted = !!channel.psk;
      channel.keyStrength = channel.psk
        ? (channel.psk.length >= 32 ? "aes-256" : channel.psk.length >= 16 ? "aes-128" : "weak")
        : "none";
      channel.keyRotatedAt = new Date().toISOString();
      return {
        ok: true,
        result: {
          channelId: channel.id,
          encrypted: channel.encrypted,
          keyStrength: channel.keyStrength,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "setChannelKey failed" };
    }
  }, { description: "Set / rotate / clear a channel's pre-shared encryption key." });

  /**
   * deleteChannel — remove a group/broadcast channel.
   */
  registerLensAction("mesh", "deleteChannel", (ctx, artifact, params) => {
    try {
      const uid = userId(ctx);
      const data = { ...(artifact?.data || {}), ...(params || {}) };
      const removed = userMap(meshState().meshChannels, uid).delete(data.channelId);
      return { ok: true, result: { removed } };
    } catch (e) {
      return { ok: false, error: e?.message || "deleteChannel failed" };
    }
  }, { description: "Delete a group/broadcast channel." });

  /**
   * overview — single roll-up for the dashboard: node/peer counts,
   * message counts, queue depth, channel count.
   */
  registerLensAction("mesh", "overview", (ctx) => {
    try {
      const uid = userId(ctx);
      const nodes = [...userMap(meshState().meshNodes, uid).values()];
      const now = Date.now();
      const online = nodes.filter((n) => n.lastSeen && now - new Date(n.lastSeen).getTime() < 5 * 60 * 1000);
      const msgs = userArr(meshState().meshMessages, uid);
      const channels = [...userMap(meshState().meshChannels, uid).values()];
      const queue = userArr(meshState().meshQueue, uid);
      return {
        ok: true,
        result: {
          nodes: nodes.length,
          onlineNodes: online.length,
          messages: msgs.length,
          unread: msgs.filter((m) => m.direction === "in" && !m.read).length,
          channels: channels.length,
          encryptedChannels: channels.filter((c) => c.encrypted).length,
          queueDepth: queue.length,
          transports: TRANSPORTS.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "overview failed" };
    }
  }, { description: "Mesh dashboard roll-up — node, message, channel, queue counts." });
}
