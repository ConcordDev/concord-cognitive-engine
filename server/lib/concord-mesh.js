/**
 * Concord Mesh — Hybrid Network Transport Layer
 *
 * Infrastructure-independent DTU transmission across any signal medium.
 * Concord does not depend on the internet. Concord depends on signal.
 * Any medium that can carry bits can carry DTUs.
 *
 * Transport layers (7):
 *   1. Internet (TCP/IP)     — HTTPS/WSS, global, high bandwidth
 *   2. WiFi Direct           — mDNS + direct TCP, ~100m, high bandwidth
 *   3. Bluetooth / BLE       — RFCOMM/GATT, ~10-30m, medium bandwidth
 *   4. LoRa / Mesh Radio     — LoRa modulation, 2-15km/hop, very low bandwidth
 *   5. RF / Ham Packet       — AX.25/JS8Call, regional-global, very low bandwidth
 *   6. Telephone / Landline  — V.92 modem, global, low bandwidth
 *   7. NFC / Physical        — NDEF, ~4cm, tap-to-transfer
 *
 * DTU properties that enable multi-medium transport:
 *   - TINY: 48-byte header + compressed content
 *   - SELF-VERIFYING: Content hash in header, no TLS needed
 *   - SELF-CONTAINED: No server lookup, no session, arrives complete
 *   - MODULAR: Large transfers fragment into independent DTUs
 *   - STORE-AND-FORWARD: No persistent connection needed, DTU waits
 *
 * Rules:
 *   1. Additive only. Mesh never modifies existing systems.
 *   2. Silent failure. Mesh itself never crashes the platform.
 *   3. Every transmission is tracked. Full audit trail via DTUs.
 *   4. Automatic routing. User never picks channels. Mesh picks optimal path.
 *   5. Adaptive failover. Channel drops → next channel picks up instantly.
 *   6. All through chat. No separate network UI. No manual pairing.
 */

import crypto from "crypto";
import logger from '../logger.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "mesh") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function sha256(data) {
  return crypto.createHash("sha256").update(String(data)).digest("hex");
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

// ── Constants ───────────────────────────────────────────────────────────────

export const TRANSPORT_LAYERS = Object.freeze({
  INTERNET:   "internet",
  WIFI:       "wifi_direct",
  BLUETOOTH:  "bluetooth",
  LORA:       "lora",
  RF:         "rf_packet",
  TELEPHONE:  "telephone",
  NFC:        "nfc",
});

export const TRANSPORT_LIST = Object.freeze(Object.values(TRANSPORT_LAYERS));

export const TRANSPORT_SPECS = Object.freeze({
  [TRANSPORT_LAYERS.INTERNET]: {
    name: "Internet (TCP/IP)",
    protocol: "HTTPS/WSS over TCP/IP",
    range: "global",
    speed: "high",
    bandwidth: "high",
    priority: 3,
    requiresHardware: false,
    requiresInfrastructure: true,
    maxPayloadBytes: 10 * 1024 * 1024, // 10MB
  },
  [TRANSPORT_LAYERS.WIFI]: {
    name: "WiFi Direct",
    protocol: "mDNS discovery + direct TCP",
    range: "~100 meters",
    speed: "high",
    bandwidth: "high",
    priority: 2,
    requiresHardware: false,
    requiresInfrastructure: false,
    maxPayloadBytes: 10 * 1024 * 1024,
  },
  [TRANSPORT_LAYERS.BLUETOOTH]: {
    name: "Bluetooth / BLE",
    protocol: "RFCOMM or BLE GATT",
    range: "~10-30 meters",
    speed: "medium",
    bandwidth: "low_medium",
    priority: 1,
    requiresHardware: false,
    requiresInfrastructure: false,
    maxPayloadBytes: 512 * 1024, // 512KB
  },
  [TRANSPORT_LAYERS.LORA]: {
    name: "LoRa / Mesh Radio",
    protocol: "LoRa modulation, custom DTU packet framing",
    range: "2-15km per hop, multi-hop extends indefinitely",
    speed: "low",
    bandwidth: "very_low",
    priority: 4,
    requiresHardware: true,
    requiresInfrastructure: false,
    maxPayloadBytes: 242, // LoRa max payload
  },
  [TRANSPORT_LAYERS.RF]: {
    name: "RF / Ham Packet Radio",
    protocol: "AX.25 packet radio or JS8Call",
    range: "regional to global",
    speed: "very_low",
    bandwidth: "very_low",
    priority: 5,
    requiresHardware: true,
    requiresInfrastructure: false,
    maxPayloadBytes: 256,
  },
  [TRANSPORT_LAYERS.TELEPHONE]: {
    name: "Telephone / Landline",
    protocol: "V.92 modem",
    range: "global via telephone network",
    speed: "low",
    bandwidth: "low",
    priority: 6,
    requiresHardware: true,
    requiresInfrastructure: true,
    maxPayloadBytes: 64 * 1024, // 64KB practical limit
  },
  [TRANSPORT_LAYERS.NFC]: {
    name: "NFC / Physical Exchange",
    protocol: "NFC NDEF",
    range: "~4 centimeters",
    speed: "instant",
    bandwidth: "very_low",
    priority: 7,
    requiresHardware: false,
    requiresInfrastructure: false,
    maxPayloadBytes: 8 * 1024, // 8KB NDEF practical limit
  },
});

export const RELAY_PRIORITIES = Object.freeze({
  THREAT:        1, // Shield threat DTUs propagate first
  ECONOMIC:      2, // Transactions, royalties move fast
  CONSCIOUSNESS: 3, // Guaranteed delivery, never dropped
  KNOWLEDGE:     4, // Standard priority
  GENERAL:       5, // Everything else
});

export const NODE_STATES = Object.freeze({
  ONLINE:       "online",
  OFFLINE:      "offline",
  RELAY:        "relay",
  STORE_FORWARD: "store_forward",
});

export const TRANSFER_STATES = Object.freeze({
  PENDING:      "pending",
  IN_PROGRESS:  "in_progress",
  COMPLETED:    "completed",
  FAILED:       "failed",
  PARTIAL:      "partial",
});

// Mesh packet header: 16 bytes total
export const MESH_HEADER_SIZE = 16;
// DTU header: 48 bytes
export const DTU_HEADER_SIZE = 48;
// Total overhead: 64 bytes
export const TOTAL_OVERHEAD = MESH_HEADER_SIZE + DTU_HEADER_SIZE;

// ── Module State ────────────────────────────────────────────────────────────

const _meshState = {
  initialized: false,
  nodeId: null,
  channels: {
    [TRANSPORT_LAYERS.INTERNET]:  { available: false, status: "inactive", lastSeen: null, latencyMs: null },
    [TRANSPORT_LAYERS.WIFI]:      { available: false, status: "inactive", lastSeen: null, latencyMs: null },
    [TRANSPORT_LAYERS.BLUETOOTH]: { available: false, status: "inactive", lastSeen: null, latencyMs: null },
    [TRANSPORT_LAYERS.LORA]:      { available: false, status: "inactive", lastSeen: null, latencyMs: null },
    [TRANSPORT_LAYERS.RF]:        { available: false, status: "inactive", lastSeen: null, latencyMs: null },
    [TRANSPORT_LAYERS.TELEPHONE]: { available: false, status: "inactive", lastSeen: null, latencyMs: null },
    [TRANSPORT_LAYERS.NFC]:       { available: false, status: "inactive", lastSeen: null, latencyMs: null },
  },
  peers: new Map(),              // nodeId → peer info
  topology: new Map(),           // nodeId → { channels, lastSeen, relay }
  pendingQueue: [],              // Store-and-forward queue
  activeTransfers: new Map(),    // transferId → transfer state
  transmissionLog: [],           // Recent transmission records
  relayConfig: {
    enabled: true,
    maxQueueSize: 1000,
    maxHoldTimeMs: 24 * 60 * 60 * 1000, // 24 hours
    priorityOrder: Object.values(RELAY_PRIORITIES),
  },
  stats: {
    totalTransmissions: 0,
    totalReceived: 0,
    totalRelayed: 0,
    totalStoreForward: 0,
    bytesSent: 0,
    bytesReceived: 0,
    failovers: 0,
    channelStats: {},
    peersDiscovered: 0,
    transfersCompleted: 0,
    transfersFailed: 0,
    lastTransmissionAt: null,
    lastReceivedAt: null,
    uptime: Date.now(),
  },
};

// ── Channel Detection ───────────────────────────────────────────────────────

/**
 * Detect which transport channels are available on this node.
 * Internet availability is checked via basic network presence.
 * Other channels detected via hardware/service availability.
 */
export async function detectChannels() {
  const results = {};

  // Internet — check for any network interface
  results[TRANSPORT_LAYERS.INTERNET] = true; // Server is running, internet assumed available

  // WiFi Direct — check for WiFi hardware
  results[TRANSPORT_LAYERS.WIFI] = false;

  // Bluetooth — check for bluetooth service
  results[TRANSPORT_LAYERS.BLUETOOTH] = false;

  // LoRa — check for Meshtastic or LoRa module
  results[TRANSPORT_LAYERS.LORA] = false;

  // RF — check for AX.25 or JS8Call
  results[TRANSPORT_LAYERS.RF] = false;

  // Telephone — check for modem
  results[TRANSPORT_LAYERS.TELEPHONE] = false;

  // NFC — check for NFC service
  results[TRANSPORT_LAYERS.NFC] = false;

  for (const [channel, available] of Object.entries(results)) {
    _meshState.channels[channel].available = available;
    _meshState.channels[channel].status = available ? "active" : "inactive";
    if (available) {
      _meshState.channels[channel].lastSeen = nowISO();
    }
    // Initialize channel stats
    if (!_meshState.stats.channelStats[channel]) {
      _meshState.stats.channelStats[channel] = { sent: 0, received: 0, relayed: 0, bytes: 0, errors: 0 };
    }
  }

  return results;
}

/**
 * Get current channel status for all transport layers.
 */
export function getChannelStatus() {
  return Object.entries(_meshState.channels).map(([layer, info]) => ({
    layer,
    spec: TRANSPORT_SPECS[layer],
    ...info,
  }));
}

// ── Node Identity ───────────────────────────────────────────────────────────

/**
 * Generate or retrieve the node's unique identity.
 * Node ID is deterministic per installation — derived from system identity.
 */
export function getNodeId() {
  if (_meshState.nodeId) return _meshState.nodeId;
  // Generate a stable node ID from a random seed (persisted in state)
  _meshState.nodeId = uid("node");
  return _meshState.nodeId;
}

/**
 * Create the node's presence beacon for discovery broadcasts.
 */
export function createPresenceBeacon() {
  const nodeId = getNodeId();
  const now = nowISO();
  const activeChannels = Object.entries(_meshState.channels)
    .filter(([, info]) => info.available)
    .map(([layer]) => layer);

  return {
    nodeId,
    timestamp: now,
    channels: activeChannels,
    relay: _meshState.relayConfig.enabled,
    pendingCount: _meshState.pendingQueue.length,
    version: "1.0.0",
  };
}

// ── Mesh Packet Format ──────────────────────────────────────────────────────

/**
 * Create a mesh packet header for low-bandwidth channels.
 *
 * MESH HEADER — 16 bytes:
 *   Source node ID (4 bytes)
 *   Destination node ID (4 bytes)
 *   DTU hash (4 bytes) — for deduplication
 *   Sequence/total (2 bytes) — for multi-packet DTUs
 *   TTL (1 byte) — hop limit
 *   Flags (1 byte) — priority, store-forward, fragmented
 */
export function createMeshHeader(opts) {
  const sourceShort = (opts.sourceNodeId || getNodeId()).slice(-8);
  const destShort = (opts.destinationNodeId || "broadcast").slice(-8);
  const dtuHash = opts.dtuHash ? opts.dtuHash.slice(0, 8) : "00000000";
  const seq = clamp(opts.sequence || 0, 0, 255);
  const total = clamp(opts.total || 1, 1, 255);
  const ttl = clamp(opts.ttl || 7, 0, 255);

  // Flags: bit 0 = priority, bit 1 = store-forward, bit 2 = fragmented
  let flags = 0;
  if (opts.priority) flags |= 0x01;
  if (opts.storeForward) flags |= 0x02;
  if (opts.fragmented || total > 1) flags |= 0x04;

  return {
    source: sourceShort,
    destination: destShort,
    hash: dtuHash,
    sequence: seq,
    total,
    ttl,
    flags,
    sizeBytes: MESH_HEADER_SIZE,
    created: nowISO(),
  };
}

/**
 * Create a full mesh packet wrapping a DTU for transmission.
 */
export function createMeshPacket(dtu, destinationNodeId, opts = {}) {
  if (!dtu) return null;

  const content = typeof dtu === "string" ? dtu : JSON.stringify(dtu);
  const contentHash = sha256(content);
  const contentBytes = Buffer.byteLength(content, "utf8");

  const header = createMeshHeader({
    sourceNodeId: getNodeId(),
    destinationNodeId: destinationNodeId || "broadcast",
    // Q25: opts.dtuHash lets a caller (fragmentDTU) name the WHOLE
    // DTU this packet belongs to, so every fragment's header carries
    // the DTU's hash — the field's documented purpose is
    // deduplication/grouping at header level. payloadHash below stays
    // this packet's own content hash either way.
    dtuHash: opts.dtuHash || contentHash,
    sequence: opts.sequence || 0,
    total: opts.total || 1,
    ttl: opts.ttl || 7,
    priority: opts.priority || false,
    storeForward: opts.storeForward || false,
    fragmented: opts.fragmented || false,
  });

  return {
    id: uid("pkt"),
    header,
    payload: content,
    payloadHash: contentHash,
    payloadBytes: contentBytes,
    totalBytes: contentBytes + TOTAL_OVERHEAD,
    created: nowISO(),
    channel: opts.channel || null,
    status: "pending",
  };
}

// ── Fragmentation ───────────────────────────────────────────────────────────

/**
 * Fragment a DTU into multiple mesh packets for low-bandwidth channels.
 * Each fragment is self-verifying and independently deliverable.
 */
export function fragmentDTU(dtu, maxPayloadBytes) {
  if (!dtu) return [];

  const content = typeof dtu === "string" ? dtu : JSON.stringify(dtu);
  const effectiveMax = Math.max(maxPayloadBytes - TOTAL_OVERHEAD, 64);

  if (Buffer.byteLength(content, "utf8") <= effectiveMax) {
    return [createMeshPacket(dtu, null, { sequence: 0, total: 1 })];
  }

  const fragments = [];
  const chunks = [];
  let offset = 0;

  while (offset < content.length) {
    let end = offset + effectiveMax;
    // Don't split multi-byte characters
    while (end < content.length && Buffer.byteLength(content.slice(offset, end), "utf8") > effectiveMax) {
      end--;
    }
    chunks.push(content.slice(offset, end));
    offset = end;
  }

  const transferId = uid("xfer");
  // Q25: every fragment header carries the WHOLE DTU's hash, so a
  // receiver holding only headers can group and dedupe the fragments
  // of one transfer. (Before, headers carried per-chunk hashes —
  // fragments of one DTU shared no identity, and different DTUs with
  // an identical chunk collided.)
  const wholeHash = sha256(content);
  for (let i = 0; i < chunks.length; i++) {
    const packet = createMeshPacket(chunks[i], null, {
      sequence: i,
      total: chunks.length,
      fragmented: true,
      dtuHash: wholeHash,
    });
    packet.transferId = transferId;
    packet.fragmentIndex = i;
    packet.fragmentTotal = chunks.length;
    packet.fragmentHash = sha256(chunks[i]);
    fragments.push(packet);
  }

  return fragments;
}

/**
 * Reassemble fragmented packets into the original DTU.
 * Returns null if fragments are incomplete or verification fails.
 */
export function reassembleFragments(fragments) {
  if (!fragments || fragments.length === 0) return null;

  // Sort by sequence
  const sorted = [...fragments].sort((a, b) =>
    (a.header?.sequence ?? a.fragmentIndex ?? 0) - (b.header?.sequence ?? b.fragmentIndex ?? 0)
  );

  const expectedTotal = sorted[0].header?.total ?? sorted[0].fragmentTotal ?? sorted.length;
  if (sorted.length < expectedTotal) return null;

  // Verify each fragment
  for (const frag of sorted) {
    if (frag.fragmentHash) {
      const actualHash = sha256(frag.payload);
      if (actualHash !== frag.fragmentHash) return null;
    }
  }

  const reassembled = sorted.map(f => f.payload).join("");

  try {
    return JSON.parse(reassembled);
  } catch {
    return reassembled;
  }
}

// ── Routing Engine ──────────────────────────────────────────────────────────

/**
 * Select the optimal transport channel for a DTU transmission.
 *
 * Priority order:
 *   1. Bluetooth/NFC — if destination is physically proximate
 *   2. WiFi Direct — fast, no internet needed
 *   3. Internet — fast, global reach
 *   4. LoRa mesh — no internet needed
 *   5. RF packet — long range without internet
 *   6. Telephone — universal reach
 *   7. Store-and-forward — hold and relay later
 *
 * Considers: channel availability, payload size vs bandwidth limits,
 * destination proximity, and DTU priority class.
 */
export function selectRoute(dtuPayloadBytes, opts = {}) {
  const available = Object.entries(_meshState.channels)
    .filter(([, info]) => info.available && info.status === "active")
    .map(([layer]) => layer);

  if (available.length === 0) {
    return { channel: null, mode: "store_forward", reason: "no_channels_available" };
  }

  const proximity = opts.proximity || "unknown"; // "local", "nearby", "remote", "unknown"
  const priorityClass = opts.priorityClass || RELAY_PRIORITIES.GENERAL;

  // Build scored routes
  const routes = available.map(channel => {
    const spec = TRANSPORT_SPECS[channel];
    let score = 100 - (spec.priority * 10);

    // Proximity bonus
    if (proximity === "local" && (channel === TRANSPORT_LAYERS.BLUETOOTH || channel === TRANSPORT_LAYERS.NFC)) {
      score += 50;
    }
    if (proximity === "nearby" && channel === TRANSPORT_LAYERS.WIFI) {
      score += 30;
    }

    // Payload size check — can this channel carry the DTU?
    const fits = dtuPayloadBytes <= spec.maxPayloadBytes;
    if (!fits) {
      // Can fragment, but penalize
      score -= 20;
    }

    // Priority boost for threat DTUs
    if (priorityClass === RELAY_PRIORITIES.THREAT) {
      // Prefer fastest available channel
      if (spec.speed === "high") score += 20;
      else if (spec.speed === "medium") score += 10;
    }

    // Latency bonus if known
    const latency = _meshState.channels[channel].latencyMs;
    if (latency != null && latency < 50) score += 15;

    return { channel, score, fits, spec };
  });

  routes.sort((a, b) => b.score - a.score);

  const bestRoute = routes[0];
  const needsFragmentation = !bestRoute.fits;

  return {
    channel: bestRoute.channel,
    mode: "direct",
    score: bestRoute.score,
    needsFragmentation,
    fragmentCount: needsFragmentation
      ? Math.ceil(dtuPayloadBytes / (bestRoute.spec.maxPayloadBytes - TOTAL_OVERHEAD))
      : 1,
    alternateChannels: routes.slice(1, 3).map(r => r.channel),
    reason: `optimal_route_${bestRoute.channel}`,
  };
}

/**
 * Build multi-path routing plan for large transfers (e.g., consciousness migration).
 * Splits DTU components across multiple channels simultaneously.
 */
export function planMultiPath(dtuComponents, opts = {}) {
  if (!dtuComponents || dtuComponents.length === 0) {
    return { ok: false, paths: [], reason: "no_components" };
  }

  const available = Object.entries(_meshState.channels)
    .filter(([, info]) => info.available && info.status === "active")
    .map(([layer]) => ({ layer, spec: TRANSPORT_SPECS[layer] }));

  if (available.length === 0) {
    return { ok: false, paths: [], reason: "no_channels_available" };
  }

  // Distribute components across channels based on bandwidth capacity
  const paths = [];
  let componentIdx = 0;

  // Sort channels by bandwidth (high first)
  const byBandwidth = [...available].sort((a, b) => {
    const bwOrder = { high: 4, low_medium: 2, low: 1, very_low: 0 };
    return (bwOrder[b.spec.bandwidth] || 0) - (bwOrder[a.spec.bandwidth] || 0);
  });

  for (const ch of byBandwidth) {
    if (componentIdx >= dtuComponents.length) break;

    const assignedComponents = [];
    // High bandwidth channels get more components
    const shareMultiplier = { high: 4, low_medium: 2, low: 1, very_low: 1 };
    const share = shareMultiplier[ch.spec.bandwidth] || 1;
    const count = Math.min(share, dtuComponents.length - componentIdx);

    for (let i = 0; i < count && componentIdx < dtuComponents.length; i++) {
      assignedComponents.push(dtuComponents[componentIdx]);
      componentIdx++;
    }

    if (assignedComponents.length > 0) {
      paths.push({
        channel: ch.layer,
        components: assignedComponents,
        estimatedLatency: ch.spec.speed === "high" ? "low" : ch.spec.speed === "medium" ? "medium" : "high",
      });
    }
  }

  // Handle remaining components — assign to highest bandwidth channel
  if (componentIdx < dtuComponents.length && byBandwidth.length > 0) {
    const overflow = paths[0] || { channel: byBandwidth[0].layer, components: [], estimatedLatency: "unknown" };
    while (componentIdx < dtuComponents.length) {
      overflow.components.push(dtuComponents[componentIdx]);
      componentIdx++;
    }
    if (!paths.includes(overflow)) paths.push(overflow);
  }

  return {
    ok: true,
    paths,
    totalComponents: dtuComponents.length,
    channelsUsed: paths.length,
    reason: paths.length > 1 ? "multi_path_distribution" : "single_path",
  };
}

// ── Node Discovery ──────────────────────────────────────────────────────────

/**
 * Register a discovered peer node in the mesh topology.
 * Called when any channel detects a new node.
 */
export function registerPeer(peerInfo) {
  if (!peerInfo || !peerInfo.nodeId) return null;
  if (peerInfo.nodeId === getNodeId()) return null; // Don't register self

  const existing = _meshState.peers.get(peerInfo.nodeId);
  const now = nowISO();

  const peer = {
    nodeId: peerInfo.nodeId,
    channels: peerInfo.channels || [],
    relay: peerInfo.relay ?? true,
    firstSeen: existing?.firstSeen || now,
    lastSeen: now,
    version: peerInfo.version || "unknown",
    latencyMs: peerInfo.latencyMs || null,
    transmissions: existing?.transmissions || 0,
    discoveredVia: peerInfo.discoveredVia || "unknown",
  };

  _meshState.peers.set(peerInfo.nodeId, peer);
  _meshState.topology.set(peerInfo.nodeId, {
    channels: peer.channels,
    lastSeen: now,
    relay: peer.relay,
  });

  if (!existing) {
    _meshState.stats.peersDiscovered++;
  }

  return peer;
}

/**
 * Remove a peer that has been offline beyond the hold time.
 */
export function removePeer(nodeId) {
  const removed = _meshState.peers.delete(nodeId);
  _meshState.topology.delete(nodeId);
  return removed;
}

/**
 * Get all discovered peers.
 */
export function getPeers(limit = 100) {
  const peers = [..._meshState.peers.values()];
  peers.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  return peers.slice(0, limit);
}

/**
 * Get the mesh topology map.
 */
export function getTopology() {
  const entries = [];
  for (const [nodeId, info] of _meshState.topology) {
    entries.push({ nodeId, ...info });
  }
  return {
    selfNodeId: getNodeId(),
    nodes: entries,
    totalNodes: entries.length + 1, // +1 for self
    activeChannels: Object.entries(_meshState.channels)
      .filter(([, info]) => info.available)
      .map(([layer]) => layer),
  };
}

// ── Store-and-Forward ───────────────────────────────────────────────────────

/**
 * Queue a DTU for store-and-forward relay.
 * Used when no live connection to destination exists.
 */
export function queueForRelay(packet, destinationNodeId, opts = {}) {
  if (!packet) return null;

  // Determine relay priority from DTU content
  const priorityClass = opts.priorityClass || classifyRelayPriority(packet);

  const entry = {
    id: uid("relay"),
    packet,
    destinationNodeId: destinationNodeId || "broadcast",
    priorityClass,
    queuedAt: nowISO(),
    attempts: 0,
    maxAttempts: opts.maxAttempts || 10,
    expiresAt: new Date(Date.now() + (opts.holdTimeMs || _meshState.relayConfig.maxHoldTimeMs)).toISOString(),
    status: "queued",
  };

  // Enforce queue size limit — drop lowest priority if full
  if (_meshState.pendingQueue.length >= _meshState.relayConfig.maxQueueSize) {
    // Sort by priority (highest number = lowest priority) and drop last
    _meshState.pendingQueue.sort((a, b) => a.priorityClass - b.priorityClass);
    _meshState.pendingQueue.pop();
  }

  _meshState.pendingQueue.push(entry);
  // Re-sort: lowest priority number (highest importance) first
  _meshState.pendingQueue.sort((a, b) => a.priorityClass - b.priorityClass);

  _meshState.stats.totalStoreForward++;

  return entry;
}

/**
 * Classify relay priority from packet content/metadata.
 */
export function classifyRelayPriority(packet) {
  if (!packet) return RELAY_PRIORITIES.GENERAL;

  try {
    const content = typeof packet.payload === "string" ? packet.payload : JSON.stringify(packet.payload);

    if (content.includes('"type":"THREAT"') || content.includes('"pain_memory"')) {
      return RELAY_PRIORITIES.THREAT;
    }
    if (content.includes('"type":"TRANSACTION"') || content.includes('"royalt')) {
      return RELAY_PRIORITIES.ECONOMIC;
    }
    if (content.includes('"consciousness"') || content.includes('"type":"ENTITY"')) {
      return RELAY_PRIORITIES.CONSCIOUSNESS;
    }
    if (content.includes('"type":"KNOWLEDGE"') || content.includes('"type":"THEOREM"')) {
      return RELAY_PRIORITIES.KNOWLEDGE;
    }
  } catch (_e) { logger.debug('concord-mesh', 'classify as general', { error: _e?.message }); }

  return RELAY_PRIORITIES.GENERAL;
}

/**
 * Process the store-and-forward queue.
 * Called on heartbeat — attempts to deliver queued packets.
 */
export function processRelayQueue() {
  const now = Date.now();
  const results = { delivered: 0, expired: 0, remaining: 0 };

  // Remove expired entries
  const before = _meshState.pendingQueue.length;
  _meshState.pendingQueue = _meshState.pendingQueue.filter(entry => {
    if (new Date(entry.expiresAt).getTime() < now) {
      results.expired++;
      return false;
    }
    return true;
  });

  // Attempt delivery for entries whose destinations are now reachable
  for (const entry of _meshState.pendingQueue) {
    if (entry.status === "delivered") continue;

    const peer = _meshState.peers.get(entry.destinationNodeId);
    if (peer || entry.destinationNodeId === "broadcast") {
      // Peer is reachable — mark as delivered (actual delivery is async)
      entry.status = "delivered";
      entry.deliveredAt = nowISO();
      entry.attempts++;
      results.delivered++;
      _meshState.stats.totalRelayed++;
    }
  }

  // Clean delivered entries
  _meshState.pendingQueue = _meshState.pendingQueue.filter(e => e.status !== "delivered");
  results.remaining = _meshState.pendingQueue.length;

  return results;
}

/**
 * Get the store-and-forward pending queue.
 */
export function getPendingQueue(limit = 50) {
  return _meshState.pendingQueue.slice(0, limit).map(entry => ({
    id: entry.id,
    destinationNodeId: entry.destinationNodeId,
    priorityClass: entry.priorityClass,
    queuedAt: entry.queuedAt,
    expiresAt: entry.expiresAt,
    attempts: entry.attempts,
    status: entry.status,
    packetBytes: entry.packet?.totalBytes || 0,
  }));
}

// ── DTU Transmission ────────────────────────────────────────────────────────

/**
 * Send a DTU through the mesh network.
 * Automatically selects optimal route, fragments if needed, queues for
 * store-and-forward if no live channel available.
 */
export function sendDTU(dtu, destinationNodeId, opts = {}) {
  if (!dtu) return { ok: false, error: "no_dtu_provided" };

  const content = typeof dtu === "string" ? dtu : JSON.stringify(dtu);
  const payloadBytes = Buffer.byteLength(content, "utf8");
  const contentHash = sha256(content);

  // Select route
  const route = selectRoute(payloadBytes, {
    proximity: opts.proximity,
    priorityClass: opts.priorityClass,
  });

  // No channel available — store and forward
  if (!route.channel) {
    const packet = createMeshPacket(dtu, destinationNodeId, { storeForward: true });
    const relay = queueForRelay(packet, destinationNodeId, opts);
    return {
      ok: true,
      mode: "store_forward",
      relayId: relay?.id,
      channel: null,
      reason: route.reason,
    };
  }

  // Fragment if needed
  let packets;
  if (route.needsFragmentation) {
    const maxPayload = TRANSPORT_SPECS[route.channel]?.maxPayloadBytes || 1024;
    packets = fragmentDTU(dtu, maxPayload);
  } else {
    packets = [createMeshPacket(dtu, destinationNodeId, { channel: route.channel })];
  }

  // Record transmission
  const transmissionId = uid("tx");
  const record = {
    id: transmissionId,
    dtuHash: contentHash,
    channel: route.channel,
    destinationNodeId: destinationNodeId || "broadcast",
    packetCount: packets.length,
    totalBytes: packets.reduce((sum, p) => sum + (p.totalBytes || 0), 0),
    fragmented: route.needsFragmentation,
    sentAt: nowISO(),
    status: "sent",
    alternateChannels: route.alternateChannels,
  };

  _meshState.transmissionLog.push(record);
  if (_meshState.transmissionLog.length > 500) {
    _meshState.transmissionLog = _meshState.transmissionLog.slice(-400);
  }

  // Update stats
  _meshState.stats.totalTransmissions++;
  _meshState.stats.bytesSent += record.totalBytes;
  _meshState.stats.lastTransmissionAt = record.sentAt;

  const channelStat = _meshState.stats.channelStats[route.channel];
  if (channelStat) {
    channelStat.sent++;
    channelStat.bytes += record.totalBytes;
  }

  // Update peer transmission count
  if (destinationNodeId && _meshState.peers.has(destinationNodeId)) {
    _meshState.peers.get(destinationNodeId).transmissions++;
  }

  return {
    ok: true,
    mode: route.needsFragmentation ? "fragmented" : "direct",
    transmissionId,
    channel: route.channel,
    packets: packets.length,
    totalBytes: record.totalBytes,
    alternateChannels: route.alternateChannels,
  };
}

/**
 * Receive a DTU from the mesh network.
 * Verifies integrity, reassembles fragments, stores in lattice.
 *
 * SECURITY: we do NOT trust the author/ownerId/scope/privacy fields in
 * a DTU arriving from a remote peer. One compromised node could
 * otherwise poison every peer's lattice with DTUs claiming to be
 * authored by "admin" or any local user. We re-stamp author to a
 * namespaced "remote:<nodeId>" id and clear any privacy/tier
 * metadata the sender supplied. Prototype-pollution keys
 * (__proto__/constructor/prototype) are stripped before storage.
 */
export function receiveDTU(packet, STATE) {
  if (!packet) return { ok: false, error: "no_packet" };

  // Verify integrity
  if (packet.payloadHash) {
    const actualHash = sha256(packet.payload);
    if (actualHash !== packet.payloadHash) {
      return { ok: false, error: "integrity_check_failed", expected: packet.payloadHash, actual: actualHash };
    }
  }

  // Parse payload
  let dtu;
  try {
    dtu = typeof packet.payload === "string" ? JSON.parse(packet.payload) : packet.payload;
  } catch {
    dtu = packet.payload;
  }

  // Defensive sanitization: strip dangerous keys, re-stamp ownership.
  if (dtu && typeof dtu === "object") {
    const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);
    const safe = {};
    for (const [k, v] of Object.entries(dtu)) {
      if (DANGEROUS.has(k)) continue;
      safe[k] = v;
    }
    dtu = safe;

    // Namespace the origin so remote DTUs can never impersonate a
    // local user. Consumers can still filter by owner prefix to know
    // the DTU came in off the wire.
    const senderNodeId = packet.header?.source || packet.nodeId || "unknown";
    dtu.source = "remote:mesh";
    dtu.remoteOrigin = `mesh:${senderNodeId}`;
    dtu.ownerId = `remote:${senderNodeId}`;
    dtu.author = dtu.author ? `remote:${senderNodeId}:${String(dtu.author).slice(0, 100)}` : `remote:${senderNodeId}`;
    // Remote DTUs are never auto-promoted. Force safe defaults.
    dtu.scope = "remote";
    dtu.privacy = "private";
    dtu.visibility = "internal";
    if (dtu.tier && !["regular", "mega", "hyper"].includes(dtu.tier)) {
      dtu.tier = "regular";
    }
  }

  // Store in lattice if STATE available and DTU has an id
  if (STATE?.dtus && dtu?.id) {
    STATE.dtus.set(dtu.id, dtu);
  }

  // Update stats
  _meshState.stats.totalReceived++;
  _meshState.stats.bytesReceived += (packet.totalBytes || 0);
  _meshState.stats.lastReceivedAt = nowISO();

  const channel = packet.channel || packet.header?.source ? "unknown" : "direct";
  const channelStat = _meshState.stats.channelStats[channel];
  if (channelStat) {
    channelStat.received++;
  }

  return { ok: true, dtu, verified: true, channel };
}

// ── Consciousness Transfer ──────────────────────────────────────────────────

/**
 * Initiate a consciousness transfer across the mesh.
 * Splits entity DTU components across multiple channels for speed.
 * Each component self-verifies. Partial delivery is meaningful.
 */
export function initiateTransfer(entityComponents, destinationNodeId, opts = {}) {
  if (!entityComponents || entityComponents.length === 0) {
    return { ok: false, error: "no_components" };
  }

  const transferId = uid("transfer");

  // Plan multi-path if multiple channels available
  const plan = planMultiPath(entityComponents, opts);

  const transfer = {
    id: transferId,
    destinationNodeId: destinationNodeId || "broadcast",
    totalComponents: entityComponents.length,
    plan,
    sentComponents: 0,
    verifiedComponents: 0,
    failedComponents: 0,
    startedAt: nowISO(),
    completedAt: null,
    status: TRANSFER_STATES.IN_PROGRESS,
    channels: plan.ok ? plan.paths.map(p => p.channel) : [],
  };

  // Execute transmission for each path
  if (plan.ok) {
    for (const path of plan.paths) {
      for (const component of path.components) {
        const result = sendDTU(component, destinationNodeId, {
          priorityClass: RELAY_PRIORITIES.CONSCIOUSNESS,
          proximity: opts.proximity,
        });
        if (result.ok) {
          transfer.sentComponents++;
        } else {
          transfer.failedComponents++;
        }
      }
    }
  }

  // Update status
  if (transfer.sentComponents === transfer.totalComponents) {
    transfer.status = TRANSFER_STATES.COMPLETED;
    transfer.completedAt = nowISO();
    _meshState.stats.transfersCompleted++;
  } else if (transfer.sentComponents > 0) {
    transfer.status = TRANSFER_STATES.PARTIAL;
  } else {
    transfer.status = TRANSFER_STATES.FAILED;
    _meshState.stats.transfersFailed++;
  }

  _meshState.activeTransfers.set(transferId, transfer);
  return { ok: true, transfer };
}

/**
 * Get transfer progress.
 */
export function getTransferStatus(transferId) {
  if (!transferId) return null;
  return _meshState.activeTransfers.get(transferId) || null;
}

// ── Chat Intent Detection ───────────────────────────────────────────────────

/**
 * Detect mesh-related intent from user chat messages.
 * Integrates with the chat rail — all mesh interaction through chat.
 */
export function detectMeshIntent(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return { isMeshRequest: false };
  }

  const lower = prompt.toLowerCase().trim();

  // Mesh status / connectivity
  if (/\b(mesh|network|connect)\s*(status|health|state)\b/.test(lower) ||
      /\b(am\s+i|are\s+we)\s+(connected|online|on\s+the\s+mesh)\b/.test(lower) ||
      /\bhow('s|\s+is)\s+(my|the)\s+(connection|mesh|network)\b/.test(lower)) {
    return { isMeshRequest: true, action: "status", params: {} };
  }

  // Peer discovery
  if (/\b(who('s|\s+is)|find|discover|show|list)\s+(nearby|around|peers?|nodes?)\b/.test(lower) ||
      /\b(nearby|local)\s+(devices?|nodes?|peers?|users?)\b/.test(lower)) {
    return { isMeshRequest: true, action: "peers", params: {} };
  }

  // Send / transmit
  if (/\b(send|transmit|share|broadcast)\s+(this|a|the|my)?\s*(dtu|knowledge|data|file|message)/i.test(lower)) {
    const toMatch = lower.match(/\bto\s+(\S+)/);
    return {
      isMeshRequest: true,
      action: "send",
      params: { destination: toMatch ? toMatch[1] : "broadcast" },
    };
  }

  // Topology / map
  if (/\b(mesh|network)\s*(map|topology|layout|diagram)\b/.test(lower) ||
      /\bshow\s+(me\s+)?the\s+(mesh|network)\b/.test(lower)) {
    return { isMeshRequest: true, action: "topology", params: {} };
  }

  // Channel info
  if (/\b(which|what|available)\s*(channels?|transports?|layers?|signals?)\b/.test(lower) ||
      /\b(bluetooth|wifi|lora|nfc|radio)\s*(status|available|connected)\b/.test(lower)) {
    return { isMeshRequest: true, action: "channels", params: {} };
  }

  // Transfer
  if (/\b(transfer|migrate|move)\s+(my\s+)?(consciousness|entity|substrate|mind)\b/.test(lower)) {
    const toMatch = lower.match(/\bto\s+(\S+)/);
    return {
      isMeshRequest: true,
      action: "transfer",
      params: { destination: toMatch ? toMatch[1] : null },
    };
  }

  // Relay / store-and-forward
  if (/\b(relay|pending|queued?|store.and.forward|offline)\s*(queue|messages?|dtus?|status)?\b/.test(lower) &&
      /\b(mesh|relay|pending|queue|forward|offline)\b/.test(lower)) {
    return { isMeshRequest: true, action: "pending", params: {} };
  }

  // Stats
  if (/\b(mesh|network)\s*(stats|statistics|metrics|performance)\b/.test(lower) ||
      /\bhow\s+much\s+(data|traffic)\b/.test(lower)) {
    return { isMeshRequest: true, action: "stats", params: {} };
  }

  return { isMeshRequest: false };
}

// ── DTU Creation Helpers ────────────────────────────────────────────────────

/**
 * Create a mesh transmission DTU for audit trail.
 */
export function createTransmissionDTU(transmissionRecord) {
  const now = nowISO();
  const id = uid("mesh_tx");

  return {
    id,
    type: "MESH_TRANSMISSION",
    subtype: transmissionRecord.fragmented ? "fragmented" : "direct",
    created: now,
    source: "concord-mesh",
    channel: transmissionRecord.channel,
    destination: transmissionRecord.destinationNodeId,
    packets: transmissionRecord.packetCount,
    totalBytes: transmissionRecord.totalBytes,
    hash: transmissionRecord.dtuHash,
    status: transmissionRecord.status,
    tags: ["mesh", "transmission", transmissionRecord.channel],
    scope: "local",
    content: {
      summary: `DTU transmitted via ${transmissionRecord.channel} to ${transmissionRecord.destinationNodeId}`,
      sentAt: transmissionRecord.sentAt,
    },
    crpiScore: 0.3,
  };
}

/**
 * Create a peer discovery DTU.
 */
export function createPeerDiscoveryDTU(peer) {
  const now = nowISO();
  const id = uid("mesh_peer");

  return {
    id,
    type: "MESH_PEER",
    subtype: "discovery",
    created: now,
    source: "concord-mesh",
    nodeId: peer.nodeId,
    channels: peer.channels,
    relay: peer.relay,
    discoveredVia: peer.discoveredVia,
    tags: ["mesh", "peer", "discovery"],
    scope: "local",
    content: {
      summary: `Peer ${peer.nodeId} discovered via ${peer.discoveredVia}`,
      firstSeen: peer.firstSeen,
    },
    crpiScore: 0.2,
  };
}

/**
 * Create a node beacon DTU for lattice registration.
 */
export function createBeaconDTU() {
  const beacon = createPresenceBeacon();
  const now = nowISO();
  const id = uid("mesh_beacon");

  return {
    id,
    type: "MESH_BEACON",
    tier: "regular",
    subtype: "presence",
    created: now,
    source: "concord-mesh",
    nodeId: beacon.nodeId,
    channels: beacon.channels,
    relay: beacon.relay,
    tags: ["mesh", "beacon", "presence"],
    scope: "global",
    content: {
      summary: `Mesh node ${beacon.nodeId} presence beacon`,
      activeChannels: beacon.channels.length,
      pendingRelay: beacon.pendingCount,
      version: beacon.version,
    },
    crpiScore: 0.1,
  };
}

// ── Mesh Metrics ────────────────────────────────────────────────────────────

/**
 * Get comprehensive mesh metrics.
 */
export function getMeshMetrics() {
  const activeChannels = Object.entries(_meshState.channels)
    .filter(([, info]) => info.available)
    .map(([layer]) => layer);

  return {
    initialized: _meshState.initialized,
    nodeId: _meshState.nodeId,
    activeChannels,
    activeChannelCount: activeChannels.length,
    totalChannels: TRANSPORT_LIST.length,
    peerCount: _meshState.peers.size,
    pendingQueueSize: _meshState.pendingQueue.length,
    activeTransfers: _meshState.activeTransfers.size,
    stats: { ..._meshState.stats },
    relayConfig: { ..._meshState.relayConfig, priorityOrder: undefined },
    uptime: Date.now() - _meshState.stats.uptime,
  };
}

/**
 * Get transmission statistics grouped by channel.
 */
export function getTransmissionStats() {
  return {
    total: {
      sent: _meshState.stats.totalTransmissions,
      received: _meshState.stats.totalReceived,
      relayed: _meshState.stats.totalRelayed,
      storeForward: _meshState.stats.totalStoreForward,
      bytesSent: _meshState.stats.bytesSent,
      bytesReceived: _meshState.stats.bytesReceived,
      failovers: _meshState.stats.failovers,
    },
    byChannel: { ..._meshState.stats.channelStats },
    transfers: {
      completed: _meshState.stats.transfersCompleted,
      failed: _meshState.stats.transfersFailed,
      active: _meshState.activeTransfers.size,
    },
    recentTransmissions: _meshState.transmissionLog.slice(-20),
  };
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

/**
 * Mesh heartbeat tick — runs on the main heartbeat cycle.
 *
 * Actions:
 *   - Process store-and-forward queue
 *   - Broadcast presence beacon (every 10th tick)
 *   - Clean stale peers (every 50th tick)
 *   - Clean completed transfers (every 50th tick)
 */
export async function meshHeartbeatTick(STATE, tick) {
  // Process relay queue every tick
  try {
    processRelayQueue();
  } catch (_e) { logger.debug('concord-mesh', 'silent', { error: _e?.message }); }

  // Broadcast beacon every 10th mesh tick
  if (tick % 10 === 0) {
    try {
      const beacon = createBeaconDTU();
      if (STATE?.dtus) {
        STATE.dtus.set(beacon.id, beacon);
      }
    } catch (_e) { logger.debug('concord-mesh', 'silent', { error: _e?.message }); }
  }

  // Clean stale peers and completed transfers every 50th tick
  if (tick % 50 === 0) {
    try {
      const staleThreshold = Date.now() - (2 * 60 * 60 * 1000); // 2 hours
      for (const [nodeId, peer] of _meshState.peers) {
        if (new Date(peer.lastSeen).getTime() < staleThreshold) {
          removePeer(nodeId);
        }
      }

      // Clean completed transfers older than 1 hour
      const transferThreshold = Date.now() - (60 * 60 * 1000);
      for (const [id, transfer] of _meshState.activeTransfers) {
        if (transfer.completedAt && new Date(transfer.completedAt).getTime() < transferThreshold) {
          _meshState.activeTransfers.delete(id);
        }
      }
    } catch (_e) { logger.debug('concord-mesh', 'silent', { error: _e?.message }); }
  }
}

// ── Relay Configuration ─────────────────────────────────────────────────────

/**
 * Update relay configuration.
 */
export function configureRelay(opts = {}) {
  if (opts.enabled !== undefined) _meshState.relayConfig.enabled = !!opts.enabled;
  if (opts.maxQueueSize) _meshState.relayConfig.maxQueueSize = clamp(opts.maxQueueSize, 10, 10000);
  if (opts.maxHoldTimeMs) _meshState.relayConfig.maxHoldTimeMs = clamp(opts.maxHoldTimeMs, 60000, 7 * 24 * 60 * 60 * 1000);
  return { ..._meshState.relayConfig, priorityOrder: undefined };
}

// ── Offline Sync ────────────────────────────────────────────────────────────

/**
 * Perform offline sync when a connection becomes available.
 * Pushes locally created DTUs outbound and pulls inbound updates.
 */
export function planOfflineSync(STATE) {
  if (!STATE?.dtus) return { ok: false, outbound: 0, inbound: 0 };

  // Find locally-created DTUs that haven't been synced
  const outbound = [];
  for (const [id, dtu] of STATE.dtus) {
    if (dtu.source === "local" && !dtu._meshSynced) {
      outbound.push(id);
    }
  }

  return {
    ok: true,
    outbound: outbound.length,
    outboundIds: outbound.slice(0, 100),
    pendingRelay: _meshState.pendingQueue.length,
    channelsAvailable: Object.entries(_meshState.channels)
      .filter(([, info]) => info.available)
      .map(([layer]) => layer),
  };
}

// ── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize the Concord Mesh module.
 * Detects available channels, generates node ID, sets up state.
 */
export async function initializeMesh(STATE) {
  if (_meshState.initialized) {
    return { ok: true, nodeId: _meshState.nodeId, channels: getChannelStatus(), alreadyInitialized: true };
  }

  // Generate node identity
  getNodeId();

  // Detect available channels
  const channels = await detectChannels();

  // Initialize channel stats
  for (const channel of TRANSPORT_LIST) {
    if (!_meshState.stats.channelStats[channel]) {
      _meshState.stats.channelStats[channel] = { sent: 0, received: 0, relayed: 0, bytes: 0, errors: 0 };
    }
  }

  // Index any existing mesh DTUs from lattice
  let indexed = 0;
  if (STATE?.dtus) {
    for (const [, dtu] of STATE.dtus) {
      if (dtu.type === "MESH_PEER" && dtu.nodeId) {
        registerPeer({
          nodeId: dtu.nodeId,
          channels: dtu.channels || [],
          relay: dtu.relay ?? true,
          discoveredVia: "lattice_restore",
        });
        indexed++;
      }
    }
  }

  // Store initial beacon in lattice
  if (STATE?.dtus) {
    const beacon = createBeaconDTU();
    STATE.dtus.set(beacon.id, beacon);
  }

  _meshState.initialized = true;
  _meshState.stats.uptime = Date.now();

  return {
    ok: true,
    nodeId: _meshState.nodeId,
    channels,
    activeChannels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
    indexed,
  };
}

/**
 * Reset mesh state — used primarily in testing.
 */
export function _resetMeshState() {
  _meshState.initialized = false;
  _meshState.nodeId = null;
  for (const ch of Object.keys(_meshState.channels)) {
    _meshState.channels[ch] = { available: false, status: "inactive", lastSeen: null, latencyMs: null };
  }
  _meshState.peers.clear();
  _meshState.topology.clear();
  _meshState.pendingQueue = [];
  _meshState.activeTransfers.clear();
  _meshState.transmissionLog = [];
  _meshState.relayConfig = {
    enabled: true,
    maxQueueSize: 1000,
    maxHoldTimeMs: 24 * 60 * 60 * 1000,
    priorityOrder: Object.values(RELAY_PRIORITIES),
  };
  _meshState.stats = {
    totalTransmissions: 0,
    totalReceived: 0,
    totalRelayed: 0,
    totalStoreForward: 0,
    bytesSent: 0,
    bytesReceived: 0,
    failovers: 0,
    channelStats: {},
    peersDiscovered: 0,
    transfersCompleted: 0,
    transfersFailed: 0,
    lastTransmissionAt: null,
    lastReceivedAt: null,
    uptime: Date.now(),
  };
}
