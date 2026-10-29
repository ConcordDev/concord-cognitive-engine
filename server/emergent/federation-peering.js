/**
 * Federation Peering Logic
 *
 * Upgrades the federation stub from loaf/federation.js with actual
 * peering protocol mechanics:
 *
 *   1. Peer discovery — register known peers, maintain heartbeat
 *   2. DTU sync — selective cross-lattice DTU exchange
 *   3. Distributed governance — cross-lattice proposal routing
 *   4. Trust propagation — peer trust influences import trust
 *
 * NOTE: This module is the protocol + state layer and makes no network
 * calls itself. The HTTP transport lives in
 * server/lib/federation-peering-transport.js (outbound, SSRF-guarded)
 * with inbound endpoints in server/routes/federation-peering.js
 * (mounted under /api/federation/v1).
 */

import { getEmergentState } from "./store.js";
import crypto from "crypto";

// ── Federation Security ──────────────────────────────────────────────────────

const MAX_SYNC_DTUS = 50;         // Hard cap on DTUs per sync package
const MAX_DTU_TITLE_LEN = 1000;   // Max title length per DTU
const MAX_DTU_TAGS = 50;          // Max tags per DTU
const HMAC_ALGO = "sha256";

/**
 * Compute HMAC signature for a sync package.
 * @param {string} secret - Per-peer shared secret
 * @param {Object} pkg - The package to sign
 * @returns {string} Hex-encoded HMAC
 */
export function signPackage(secret, pkg) {
  const payload = JSON.stringify({
    peerId: pkg.peerId,
    count: pkg.count,
    timestamp: pkg.timestamp,
    dtuIds: (pkg.dtus || []).map(d => d.id).sort(),
  });
  return crypto.createHmac(HMAC_ALGO, secret).update(payload).digest("hex");
}

/**
 * Verify HMAC signature on a received sync package.
 * @param {string} secret - Per-peer shared secret
 * @param {Object} pkg - The received package
 * @param {string} signature - The claimed signature
 * @returns {boolean}
 */
export function verifyPackageSignature(secret, pkg, signature) {
  if (!secret || !signature) return false;
  const expected = signPackage(secret, pkg);
  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** Stable stringify (sorted object keys) for proposal signing payloads. */
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

/**
 * Compute the HMAC signature for a governance proposal from a peer.
 * Proposals are authenticated exactly like sync packages: the claimed
 * sender is only believable under its shared secret.
 * @param {string} secret - Per-peer shared secret
 * @param {string} fromPeerId - The sending peer's id
 * @param {Object} proposal - The proposal being sent
 * @returns {string} Hex-encoded HMAC
 */
export function signProposal(secret, fromPeerId, proposal) {
  const payload = stableStringify({ from: fromPeerId, proposal });
  return crypto.createHmac(HMAC_ALGO, secret).update(payload).digest("hex");
}

/**
 * Verify the HMAC signature on a received governance proposal.
 * @param {string} secret - Per-peer shared secret
 * @param {string} fromPeerId - The claimed sending peer
 * @param {Object} proposal - The received proposal
 * @param {string} signature - The claimed signature
 * @returns {boolean}
 */
export function verifyProposalSignature(secret, fromPeerId, proposal, signature) {
  if (!secret || !signature) return false;
  const expected = signProposal(secret, fromPeerId, proposal);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/**
 * Validate a single DTU in an inbound sync package.
 * @param {Object} dtu
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSyncDtu(dtu) {
  if (!dtu || typeof dtu !== "object") return { valid: false, reason: "not_an_object" };
  if (typeof dtu.id !== "string" || dtu.id.length === 0 || dtu.id.length > 128)
    {return { valid: false, reason: "invalid_id" };}
  if (typeof dtu.title !== "string" || dtu.title.length === 0 || dtu.title.length > MAX_DTU_TITLE_LEN)
    {return { valid: false, reason: "invalid_title" };}
  if (dtu.tags && (!Array.isArray(dtu.tags) || dtu.tags.length > MAX_DTU_TAGS))
    {return { valid: false, reason: "invalid_tags" };}
  if (dtu.tier && typeof dtu.tier !== "string")
    {return { valid: false, reason: "invalid_tier" };}
  return { valid: true };
}

/**
 * Look up a registered peer's record (endpoint, trust, shared secret).
 * The transport layer reads connection details through here rather than
 * reaching into the peering store. Returns null for unknown peers.
 */
export function getRegisteredPeer(STATE, peerId) {
  const store = getPeeringStore(STATE);
  return store.peers.get(peerId) || null;
}

// ── Peering State ────────────────────────────────────────────────────────────

function getPeeringStore(STATE) {
  const es = getEmergentState(STATE);
  if (!es._federation) {
    es._federation = {
      // Known peers: peerId → PeerRecord
      peers: new Map(),

      // Sync state: peerId → SyncState
      syncState: new Map(),

      // Inbound proposals from peers: proposalId → PeerProposal
      inboundProposals: new Map(),

      // Outbound sync queue: items we want to share
      outboundQueue: [],

      // Protocol version
      protocolVersion: "concord-federation-v1",

      metrics: {
        peersRegistered: 0,
        heartbeatsSent: 0,
        heartbeatsReceived: 0,
        dtusShared: 0,
        dtusReceived: 0,
        proposalsRouted: 0,
      },
    };
  }
  return es._federation;
}

// ── Peer Management ──────────────────────────────────────────────────────────

/**
 * Register or update a federation peer.
 *
 * @param {Object} STATE
 * @param {Object} peer
 * @param {string} peer.peerId - Unique peer identifier
 * @param {string} peer.endpoint - The peer's API endpoint
 * @param {string} [peer.name] - Human-readable name
 * @param {number} [peer.trust=0] - Initial trust level
 * @param {string[]} [peer.sharedSectors] - Sectors this peer shares
 * @param {string} [peer.sharedSecret] - HMAC shared secret for signing
 * @returns {{ ok, peerId }}
 */
export function registerPeer(STATE, peer = {}) {
  if (!peer.peerId || !peer.endpoint) {
    return { ok: false, error: "peerId_and_endpoint_required" };
  }

  const store = getPeeringStore(STATE);

  const record = {
    peerId: peer.peerId,
    endpoint: peer.endpoint,
    name: peer.name || peer.peerId,
    trust: Math.max(0, Math.min(1, peer.trust || 0)),
    sharedSectors: Array.isArray(peer.sharedSectors) ? peer.sharedSectors : [],
    sharedSecret: peer.sharedSecret || null,
    status: "registered",      // registered → active → stale → disconnected
    registeredAt: new Date().toISOString(),
    lastHeartbeat: null,
    lastSync: null,
    dtusShared: 0,
    dtusReceived: 0,
  };

  store.peers.set(peer.peerId, record);
  store.metrics.peersRegistered++;

  return { ok: true, peerId: peer.peerId };
}

/**
 * Process a heartbeat from a peer.
 * Heartbeats carry lattice state summaries for sync planning.
 *
 * @param {Object} STATE
 * @param {string} peerId
 * @param {Object} heartbeat
 * @param {number} heartbeat.dtuCount
 * @param {number} heartbeat.shadowCount
 * @param {string} heartbeat.latestDtuTimestamp
 * @param {string[]} heartbeat.recentDtuIds - Last 10 DTU IDs for sync diff
 * @returns {{ ok, syncNeeded }}
 */
export function receiveHeartbeat(STATE, peerId, heartbeat = {}) {
  const store = getPeeringStore(STATE);
  const peer = store.peers.get(peerId);
  if (!peer) return { ok: false, error: "unknown_peer" };

  peer.lastHeartbeat = new Date().toISOString();
  peer.status = "active";
  store.metrics.heartbeatsReceived++;

  // Update sync state
  const sync = store.syncState.get(peerId) || {
    lastRemoteDtuCount: 0,
    lastRemoteTimestamp: null,
    pendingSync: false,
  };

  // Determine if sync is needed (remote has new DTUs)
  sync.lastRemoteDtuCount = heartbeat.dtuCount || 0;
  sync.lastRemoteTimestamp = heartbeat.latestDtuTimestamp || null;
  sync.pendingSync = !!(
    heartbeat.recentDtuIds?.length &&
    heartbeat.recentDtuIds.some(id => !STATE.dtus?.has(id))
  );

  store.syncState.set(peerId, sync);

  return { ok: true, syncNeeded: sync.pendingSync };
}

/**
 * Build a heartbeat to send to peers.
 *
 * @param {Object} STATE
 * @returns {{ ok, heartbeat }}
 */
export function buildHeartbeat(STATE) {
  const store = getPeeringStore(STATE);

  // Get 10 most recent DTU IDs
  const recentDtus = STATE.dtus
    ? Array.from(STATE.dtus.values())
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, 10)
    : [];

  const heartbeat = {
    protocolVersion: store.protocolVersion,
    dtuCount: STATE.dtus?.size || 0,
    shadowCount: STATE.shadowDtus?.size || 0,
    latestDtuTimestamp: recentDtus[0]?.createdAt || null,
    recentDtuIds: recentDtus.map(d => d.id),
    timestamp: new Date().toISOString(),
  };

  store.metrics.heartbeatsSent++;
  return { ok: true, heartbeat };
}

// ── DTU Sync ─────────────────────────────────────────────────────────────────

/**
 * Build a DTU export package for a specific peer.
 * Only exports DTUs in shared sectors that the peer doesn't have.
 *
 * @param {Object} STATE
 * @param {string} peerId
 * @param {Object} [opts]
 * @param {string[]} [opts.dtuIds] - Specific DTU IDs to export
 * @param {number} [opts.limit=50]
 * @returns {{ ok, package }}
 */
export function buildSyncPackage(STATE, peerId, opts = {}) {
  const store = getPeeringStore(STATE);
  const peer = store.peers.get(peerId);
  if (!peer) return { ok: false, error: "unknown_peer" };
  if (peer.trust < 0.3) return { ok: false, error: "insufficient_trust" };

  const limit = opts.limit || 50;
  let dtusToExport = [];

  if (opts.dtuIds?.length) {
    dtusToExport = opts.dtuIds
      .map(id => STATE.dtus?.get(id))
      .filter(Boolean)
      // Consent enforcement: only export DTUs explicitly marked as published/federated
      .filter(d => d.meta?.published === true || d.meta?.federated === true || d.scope === "global");
  } else {
    // Export recent DTUs that haven't been shared.
    // Consent enforcement: local DTUs cannot appear in a sync package
    // unless explicitly published by the owner (scope: "global" or meta.published: true).
    dtusToExport = Array.from(STATE.dtus?.values() || [])
      .filter(d => !d.meta?.hidden && d.tier !== "shadow")
      .filter(d => d.meta?.published === true || d.meta?.federated === true || d.scope === "global")
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, limit);
  }

  const exported = dtusToExport.map(d => ({
    id: d.id,
    title: d.title,
    tier: d.tier,
    tags: d.tags,
    core: d.core,
    human: d.human,
    createdAt: d.createdAt,
    provenance: { source: "federation", originLattice: "local" },
  }));

  store.metrics.dtusShared += exported.length;
  peer.dtusShared += exported.length;

  const pkg = {
    protocolVersion: store.protocolVersion,
    peerId,
    dtus: exported,
    count: exported.length,
    timestamp: new Date().toISOString(),
  };

  // Sign with peer's shared secret if configured
  if (peer.sharedSecret) {
    pkg.signature = signPackage(peer.sharedSecret, pkg);
  }

  return { ok: true, package: pkg };
}

/**
 * Receive a sync package from a peer.
 * Imported DTUs go into shadow layer until trusted.
 *
 * @param {Object} STATE
 * @param {string} peerId
 * @param {Object} pkg - The sync package
 * @returns {{ ok, received, shadowed }}
 */
export function receiveSyncPackage(STATE, peerId, pkg = {}) {
  const store = getPeeringStore(STATE);
  const peer = store.peers.get(peerId);
  if (!peer) return { ok: false, error: "unknown_peer" };

  // ── Size limit ──
  const inboundDtus = pkg.dtus || [];
  if (inboundDtus.length > MAX_SYNC_DTUS) {
    return { ok: false, error: "package_too_large", limit: MAX_SYNC_DTUS, received: inboundDtus.length };
  }

  // ── HMAC verification (mandatory) ──
  // The shared secret is what authenticates the claimed peerId: a peer
  // without one cannot sync at all, and an unsigned or badly signed
  // package is indistinguishable from a spoofed one. Fail closed.
  if (!peer.sharedSecret || !pkg.signature) {
    return { ok: false, error: "signature_required" };
  }
  if (!verifyPackageSignature(peer.sharedSecret, pkg, pkg.signature)) {
    return { ok: false, error: "signature_invalid" };
  }

  // ── Schema validation per DTU ──
  let received = 0;
  let shadowed = 0;
  let rejected = 0;

  for (const dtu of inboundDtus) {
    const check = validateSyncDtu(dtu);
    if (!check.valid) { rejected++; continue; }
    if (STATE.dtus?.has(dtu.id) || STATE.shadowDtus?.has(dtu.id)) continue;

    // Import into shadow layer with federation provenance
    const shadowDtu = {
      id: `fed_${peerId}_${dtu.id}`.slice(0, 64),
      title: String(dtu.title).slice(0, MAX_DTU_TITLE_LEN),
      tier: "shadow",
      tags: [...(dtu.tags || []).slice(0, MAX_DTU_TAGS), "shadow", "federated", `peer:${peerId}`],
      core: dtu.core || null,
      human: dtu.human || null,
      machine: { kind: "federated_import", sourcePeer: peerId, sourceId: dtu.id },
      meta: { hidden: true, federated: true },
      source: "federation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    STATE.shadowDtus?.set(shadowDtu.id, shadowDtu);
    received++;
    shadowed++;
  }

  store.metrics.dtusReceived += received;
  peer.dtusReceived += received;
  peer.lastSync = new Date().toISOString();

  return { ok: true, received, shadowed, rejected };
}

// ── Cross-Lattice Proposals ──────────────────────────────────────────────────

/**
 * Route a governance proposal to a peer.
 *
 * @param {Object} STATE
 * @param {string} peerId
 * @param {Object} proposal
 * @returns {{ ok, proposalId }}
 */
export function routeProposalToPeer(STATE, peerId, proposal = {}) {
  const store = getPeeringStore(STATE);
  const peer = store.peers.get(peerId);
  if (!peer) return { ok: false, error: "unknown_peer" };
  if (peer.trust < 0.5) return { ok: false, error: "insufficient_trust_for_proposals" };

  store.metrics.proposalsRouted++;
  return {
    ok: true,
    proposalId: proposal.proposalId,
    routedTo: peerId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Receive a governance proposal from a peer (the inbound half of
 * routeProposalToPeer — the store's inboundProposals map existed for
 * this and was never written). The trust gate mirrors the outbound
 * one: proposals only flow between peers at trust >= 0.5. The claimed
 * sender is authenticated like a sync package: the proposal must carry
 * a valid HMAC under the peer's shared secret, and a peer without one
 * cannot propose at all — otherwise the trust gate would be checking
 * an unverified claim.
 *
 * @param {Object} STATE
 * @param {string} peerId - The sending peer (must be registered)
 * @param {Object} proposal - Must carry a proposalId
 * @param {string} signature - HMAC over the proposal (signProposal)
 * @returns {{ ok, proposalId }}
 */
export function receiveProposal(STATE, peerId, proposal = {}, signature = null) {
  const store = getPeeringStore(STATE);
  const peer = store.peers.get(peerId);
  if (!peer) return { ok: false, error: "unknown_peer" };
  if (peer.trust < 0.5) return { ok: false, error: "insufficient_trust_for_proposals" };
  if (!proposal.proposalId || typeof proposal.proposalId !== "string") {
    return { ok: false, error: "proposal_id_required" };
  }
  if (!peer.sharedSecret || !signature) {
    return { ok: false, error: "signature_required" };
  }
  if (!verifyProposalSignature(peer.sharedSecret, peerId, proposal, signature)) {
    return { ok: false, error: "signature_invalid" };
  }

  store.inboundProposals.set(proposal.proposalId, {
    fromPeer: peerId,
    receivedAt: new Date().toISOString(),
    proposal,
  });

  return { ok: true, proposalId: proposal.proposalId };
}

// ── Stale Peer Detection ─────────────────────────────────────────────────────

/**
 * Mark peers as stale if no heartbeat in 24 hours.
 */
export function detectStalePeers(STATE) {
  const store = getPeeringStore(STATE);
  const now = Date.now();
  let staleCount = 0;

  for (const [, peer] of store.peers) {
    if (peer.status === "disconnected") continue;
    if (!peer.lastHeartbeat) continue;

    const age = now - new Date(peer.lastHeartbeat).getTime();
    if (age > 24 * 3600_000) {
      peer.status = "stale";
      staleCount++;
    }
  }

  return { ok: true, staleCount };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export function getFederationPeeringMetrics(STATE) {
  const store = getPeeringStore(STATE);

  const peerStatuses = {};
  for (const peer of store.peers.values()) {
    peerStatuses[peer.status] = (peerStatuses[peer.status] || 0) + 1;
  }

  return {
    ok: true,
    totalPeers: store.peers.size,
    peerStatuses,
    syncStateTracked: store.syncState.size,
    inboundProposals: store.inboundProposals.size,
    outboundQueueSize: store.outboundQueue.length,
    ...store.metrics,
  };
}
