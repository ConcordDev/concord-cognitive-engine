/**
 * System 9: C-NET Federation
 *
 * Multiple Concordos instances connecting via neutral Global.
 * Local-first, decentralized architecture.
 *
 * Architecture:
 *   Local Concord Instance A (private, full sovereignty)
 *     ↕ (publish/subscribe)
 *   Global Concordos (neutral, curated, no single owner)
 *     ↕ (publish/subscribe)
 *   Local Concord Instance B (private, full sovereignty)
 *
 * Key Rules:
 *   - Local data NEVER leaves without explicit consent
 *   - Global only sees published DTUs
 *   - No instance forced to accept Global DTUs
 *   - Attribution/royalty chains cross federation boundaries
 *   - Each instance maintains full sovereignty
 *   - Global is neutral
 *
 * Additive only. One file. Silent failure.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ── Events ──────────────────────────────────────────────────────────────────

export const FEDERATION_EVENTS = Object.freeze({
  FEDERATION_INITIALIZED:  "federation:initialized",
  DTU_PUBLISHED:           "federation:dtu_published",
  DTU_UNPUBLISHED:         "federation:dtu_unpublished",
  DOMAIN_SUBSCRIBED:       "federation:domain_subscribed",
  DOMAIN_UNSUBSCRIBED:     "federation:domain_unsubscribed",
  PEER_REGISTERED:         "federation:peer_registered",
  PEER_REMOVED:            "federation:peer_removed",
  GLOBAL_POLLED:           "federation:global_polled",
  GLOBAL_DTU_ACCEPTED:     "federation:global_dtu_accepted",
  GLOBAL_DTU_REJECTED:     "federation:global_dtu_rejected",
  CONSENT_VIOLATION:       "federation:consent_violation",
});

// ── In-Memory State ─────────────────────────────────────────────────────────

/** Federation configuration */
let _config = null;

/** This instance's identity */
let _instanceId = null;
let _publicKey = null;
let _capabilities = [];
let _registryUrl = null;

/** Published DTUs: dtuId -> publication record */
const _published = new Map();

/** Subscriptions: domain -> subscription config */
const _subscriptions = new Map();

/** Peers: peerId -> peer record */
const _peers = new Map();

/** Incoming queue: globalDtuId -> incoming DTU record awaiting local approval */
const _incomingQueue = new Map();

/** Accepted global DTUs: globalDtuId -> acceptance record */
const _acceptedGlobal = new LruMap();

/** Rejected global DTUs: globalDtuId -> rejection record */
const _rejectedGlobal = new LruMap();

/** Event log (capped) */
const _eventLog = [];
// Bumped 5000 → 100000 for 32GB-heap deployments — federation event
// log keeps an audit trail; bigger ring means less truncation.
const MAX_EVENT_LOG = Number(process.env.CONCORD_FEDERATION_EVENT_LOG) || 100_000;

/** Metrics */
const _metrics = {
  dtusPublished: 0,
  dtusUnpublished: 0,
  domainsSubscribed: 0,
  domainsUnsubscribed: 0,
  peersRegistered: 0,
  peersRemoved: 0,
  globalPolls: 0,
  globalDtusReceived: 0,
  globalDtusAccepted: 0,
  globalDtusRejected: 0,
  consentViolationsBlocked: 0,
  attributionChainsCreated: 0,
  royaltyEventsLogged: 0,
};

// ── Internal Utilities ──────────────────────────────────────────────────────

function logEvent(type, data) {
  try {
    const entry = {
      id: uid("evt"),
      type,
      data,
      timestamp: nowISO(),
    };
    _eventLog.push(entry);
    if (_eventLog.length > MAX_EVENT_LOG) {
      _eventLog.splice(0, _eventLog.length - MAX_EVENT_LOG);
    }
    return entry;
  } catch (_e) { logger.debug('emergent:cnet-federation', 'silent', { error: _e?.message }); }
}

function validateConsentFlags(flags) {
  if (!flags || typeof flags !== "object") return false;
  if (typeof flags.allowDerivatives !== "boolean") return false;
  if (typeof flags.allowCommercial !== "boolean") return false;
  if (typeof flags.requireAttribution !== "boolean") return false;
  return true;
}

function buildAttribution(dtuId) {
  return {
    originInstanceId: _instanceId,
    dtuId,
    publishedAt: nowISO(),
    chain: [
      {
        instanceId: _instanceId,
        action: "publish",
        timestamp: nowISO(),
      },
    ],
  };
}

function buildDefaultRoyaltyTerms() {
  return {
    model: "attribution_only",
    percentage: 0,
    currency: null,
    termsUrl: null,
  };
}

// ── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize federation state for this Concord instance.
 *
 * @param {object} config
 * @param {string} [config.instanceId] - Unique instance identifier
 * @param {string} [config.publicKey] - Instance public key
 * @param {string[]} [config.capabilities] - Instance capabilities
 * @param {string} [config.registryUrl] - Global registry URL
 * @returns {{ ok: boolean, instanceId: string }}
 */
export function initFederation(config = {}) {
  try {
    _config = { ...config };
    _instanceId = config.instanceId || uid("concord");
    _publicKey = config.publicKey || null;
    _capabilities = Array.isArray(config.capabilities) ? [...config.capabilities] : [];
    _registryUrl = config.registryUrl || "https://registry.concordos.org";

    logEvent(FEDERATION_EVENTS.FEDERATION_INITIALIZED, {
      instanceId: _instanceId,
      capabilities: _capabilities,
      registryUrl: _registryUrl,
    });

    return { ok: true, instanceId: _instanceId };
  } catch {
    return { ok: false, error: "initialization_failed" };
  }
}

// ── Federation Status ───────────────────────────────────────────────────────

/**
 * Get current federation status.
 *
 * @returns {{ ok: boolean, initialized: boolean, instanceId: string, ... }}
 */
export function getFederationStatus() {
  try {
    return {
      ok: true,
      initialized: _instanceId !== null,
      instanceId: _instanceId,
      publicKey: _publicKey,
      capabilities: [..._capabilities],
      registryUrl: _registryUrl,
      publishedDtuCount: _published.size,
      subscriptionCount: _subscriptions.size,
      peerCount: _peers.size,
      incomingQueueSize: _incomingQueue.size,
      acceptedGlobalDtus: _acceptedGlobal.size,
      rejectedGlobalDtus: _rejectedGlobal.size,
    };
  } catch {
    return { ok: false, error: "status_unavailable" };
  }
}

// ── Publishing ──────────────────────────────────────────────────────────────

/**
 * Publish a local DTU to Global Concordos.
 * Local data NEVER leaves without explicit consent.
 *
 * @param {string} dtuId - The local DTU identifier
 * @param {object} consentFlags - Explicit consent configuration
 * @param {boolean} consentFlags.allowDerivatives
 * @param {boolean} consentFlags.allowCommercial
 * @param {boolean} consentFlags.requireAttribution
 * @param {object} [opts] - Optional overrides
 * @param {object} [opts.royaltyTerms] - Royalty configuration
 * @param {object} [opts.metadata] - Additional metadata to attach
 * @returns {{ ok: boolean, publicationId?: string }}
 */
export function publishDTU(dtuId, consentFlags, opts = {}) {
  try {
    if (!_instanceId) {
      return { ok: false, error: "federation_not_initialized" };
    }
    if (!dtuId || typeof dtuId !== "string") {
      return { ok: false, error: "invalid_dtu_id" };
    }
    if (!validateConsentFlags(consentFlags)) {
      _metrics.consentViolationsBlocked++;
      logEvent(FEDERATION_EVENTS.CONSENT_VIOLATION, {
        dtuId,
        reason: "invalid_consent_flags",
      });
      return { ok: false, error: "invalid_consent_flags" };
    }
    if (_published.has(dtuId)) {
      return { ok: false, error: "already_published" };
    }

    const publicationId = uid("pub");
    const attribution = buildAttribution(dtuId);
    const royaltyTerms = opts.royaltyTerms || buildDefaultRoyaltyTerms();

    const record = {
      publicationId,
      dtuId,
      scope: "global",
      instanceId: _instanceId,
      attribution,
      royaltyTerms,
      consentFlags: { ...consentFlags },
      metadata: opts.metadata || {},
      publishedAt: nowISO(),
      status: "active",
    };

    _published.set(dtuId, record);
    _metrics.dtusPublished++;
    _metrics.attributionChainsCreated++;

    logEvent(FEDERATION_EVENTS.DTU_PUBLISHED, {
      publicationId,
      dtuId,
      consentFlags,
    });

    return { ok: true, publicationId };
  } catch {
    return { ok: false, error: "publish_failed" };
  }
}

/**
 * Unpublish a DTU from Global Concordos.
 * Sovereignty: instance can always withdraw.
 *
 * @param {string} dtuId
 * @returns {{ ok: boolean }}
 */
export function unpublishDTU(dtuId) {
  try {
    if (!dtuId || typeof dtuId !== "string") {
      return { ok: false, error: "invalid_dtu_id" };
    }
    if (!_published.has(dtuId)) {
      return { ok: false, error: "not_published" };
    }

    const record = _published.get(dtuId);
    record.status = "withdrawn";
    record.withdrawnAt = nowISO();
    _published.delete(dtuId);
    _metrics.dtusUnpublished++;

    logEvent(FEDERATION_EVENTS.DTU_UNPUBLISHED, {
      dtuId,
      publicationId: record.publicationId,
    });

    return { ok: true, publicationId: record.publicationId };
  } catch {
    return { ok: false, error: "unpublish_failed" };
  }
}

/**
 * Get all currently published DTUs.
 *
 * @returns {{ ok: boolean, published: object[] }}
 */
export function getPublishedDTUs() {
  try {
    const published = [];
    for (const [dtuId, record] of _published) {
      published.push({
        dtuId,
        publicationId: record.publicationId,
        scope: record.scope,
        consentFlags: { ...record.consentFlags },
        royaltyTerms: { ...record.royaltyTerms },
        publishedAt: record.publishedAt,
        status: record.status,
      });
    }
    return { ok: true, published, count: published.length };
  } catch {
    return { ok: false, error: "list_published_failed" };
  }
}

// ── Subscriptions ───────────────────────────────────────────────────────────

/**
 * Subscribe to a domain on Global Concordos.
 * No instance is forced to accept Global DTUs — subscription is voluntary.
 *
 * @param {string} domain - Domain to subscribe to (e.g. "physics", "mathematics")
 * @param {object} [config] - Subscription configuration
 * @param {number} [config.minAuthority=0.6] - Minimum authority threshold
 * @param {boolean} [config.autoIngest=false] - Auto-accept matching DTUs
 * @param {number} [config.pollInterval=3600000] - Poll interval in ms
 * @returns {{ ok: boolean, subscriptionId?: string }}
 */
export function subscribeDomain(domain, config = {}) {
  try {
    if (!_instanceId) {
      return { ok: false, error: "federation_not_initialized" };
    }
    if (!domain || typeof domain !== "string") {
      return { ok: false, error: "invalid_domain" };
    }
    if (_subscriptions.has(domain)) {
      return { ok: false, error: "already_subscribed" };
    }

    const subscriptionId = uid("sub");
    const record = {
      subscriptionId,
      domain,
      minAuthority: clamp01(config.minAuthority ?? 0.6),
      autoIngest: config.autoIngest === true,
      pollInterval: Math.max(60000, Number(config.pollInterval) || 3600000),
      subscribedAt: nowISO(),
      lastPolled: null,
      dtusReceived: 0,
      status: "active",
    };

    _subscriptions.set(domain, record);
    _metrics.domainsSubscribed++;

    logEvent(FEDERATION_EVENTS.DOMAIN_SUBSCRIBED, {
      subscriptionId,
      domain,
      minAuthority: record.minAuthority,
      autoIngest: record.autoIngest,
    });

    return { ok: true, subscriptionId };
  } catch {
    return { ok: false, error: "subscribe_failed" };
  }
}

/**
 * Unsubscribe from a domain.
 *
 * @param {string} domain
 * @returns {{ ok: boolean }}
 */
export function unsubscribeDomain(domain) {
  try {
    if (!domain || typeof domain !== "string") {
      return { ok: false, error: "invalid_domain" };
    }
    if (!_subscriptions.has(domain)) {
      return { ok: false, error: "not_subscribed" };
    }

    const record = _subscriptions.get(domain);
    _subscriptions.delete(domain);
    _metrics.domainsUnsubscribed++;

    logEvent(FEDERATION_EVENTS.DOMAIN_UNSUBSCRIBED, {
      domain,
      subscriptionId: record.subscriptionId,
    });

    return { ok: true, subscriptionId: record.subscriptionId };
  } catch {
    return { ok: false, error: "unsubscribe_failed" };
  }
}

/**
 * Get all active subscriptions.
 *
 * @returns {{ ok: boolean, subscriptions: object[] }}
 */
export function getSubscriptions() {
  try {
    const subscriptions = [];
    for (const [domain, record] of _subscriptions) {
      subscriptions.push({
        domain,
        subscriptionId: record.subscriptionId,
        minAuthority: record.minAuthority,
        autoIngest: record.autoIngest,
        pollInterval: record.pollInterval,
        subscribedAt: record.subscribedAt,
        lastPolled: record.lastPolled,
        dtusReceived: record.dtusReceived,
        status: record.status,
      });
    }
    return { ok: true, subscriptions, count: subscriptions.length };
  } catch {
    return { ok: false, error: "list_subscriptions_failed" };
  }
}

// ── Peer Management ─────────────────────────────────────────────────────────

/**
 * Register a federation peer (another Concord instance).
 *
 * @param {object} peerInfo
 * @param {string} peerInfo.instanceId - Peer's instance identifier
 * @param {string} [peerInfo.publicKey] - Peer's public key
 * @param {string[]} [peerInfo.capabilities] - Peer capabilities
 * @param {string} [peerInfo.registryUrl] - Peer's registry URL
 * @param {string} [peerInfo.name] - Human-readable name
 * @returns {{ ok: boolean, peerId?: string }}
 */
export function registerPeer(peerInfo = {}) {
  try {
    if (!_instanceId) {
      return { ok: false, error: "federation_not_initialized" };
    }
    if (!peerInfo.instanceId || typeof peerInfo.instanceId !== "string") {
      return { ok: false, error: "peer_instance_id_required" };
    }
    if (peerInfo.instanceId === _instanceId) {
      return { ok: false, error: "cannot_peer_with_self" };
    }
    if (_peers.has(peerInfo.instanceId)) {
      return { ok: false, error: "peer_already_registered" };
    }

    const peerId = peerInfo.instanceId;
    const record = {
      peerId,
      instanceId: peerInfo.instanceId,
      publicKey: peerInfo.publicKey || null,
      capabilities: Array.isArray(peerInfo.capabilities) ? [...peerInfo.capabilities] : [],
      registryUrl: peerInfo.registryUrl || null,
      name: peerInfo.name || peerInfo.instanceId,
      registeredAt: nowISO(),
      lastSeen: null,
      status: "registered",
      dtusSharedWith: 0,
      dtusReceivedFrom: 0,
      trustScore: 0.5,
    };

    _peers.set(peerId, record);
    _metrics.peersRegistered++;

    logEvent(FEDERATION_EVENTS.PEER_REGISTERED, {
      peerId,
      capabilities: record.capabilities,
    });

    return { ok: true, peerId };
  } catch {
    return { ok: false, error: "register_peer_failed" };
  }
}

/**
 * Get all registered peers.
 *
 * @returns {{ ok: boolean, peers: object[] }}
 */
export function getPeers() {
  try {
    const peers = [];
    for (const [peerId, record] of _peers) {
      peers.push({
        peerId,
        instanceId: record.instanceId,
        publicKey: record.publicKey,
        capabilities: [...record.capabilities],
        registryUrl: record.registryUrl,
        name: record.name,
        registeredAt: record.registeredAt,
        lastSeen: record.lastSeen,
        status: record.status,
        trustScore: record.trustScore,
        dtusSharedWith: record.dtusSharedWith,
        dtusReceivedFrom: record.dtusReceivedFrom,
      });
    }
    return { ok: true, peers, count: peers.length };
  } catch {
    return { ok: false, error: "list_peers_failed" };
  }
}

/**
 * Remove a federation peer.
 *
 * @param {string} peerId
 * @returns {{ ok: boolean }}
 */
export function removePeer(peerId) {
  try {
    if (!peerId || typeof peerId !== "string") {
      return { ok: false, error: "invalid_peer_id" };
    }
    if (!_peers.has(peerId)) {
      return { ok: false, error: "peer_not_found" };
    }

    _peers.delete(peerId);
    _metrics.peersRemoved++;

    logEvent(FEDERATION_EVENTS.PEER_REMOVED, { peerId });

    return { ok: true };
  } catch {
    return { ok: false, error: "remove_peer_failed" };
  }
}

// ── Global Polling ──────────────────────────────────────────────────────────

/**
 * Poll Global Concordos for new DTUs from subscribed domains.
 *
 * NOTE: This module does NOT make actual HTTP calls.
 * It simulates the poll protocol and manages incoming queue state.
 * Actual transport is handled by the WebSocket/HTTP layer.
 *
 * @returns {{ ok: boolean, received: object[], autoIngested: number }}
 */
export function pollGlobal() {
  try {
    if (!_instanceId) {
      return { ok: false, error: "federation_not_initialized" };
    }
    if (_subscriptions.size === 0) {
      return { ok: true, received: [], autoIngested: 0, reason: "no_subscriptions" };
    }

    _metrics.globalPolls++;
    const received = [];
    const autoIngested = 0;

    // For each subscription, simulate receiving candidate DTUs from Global.
    // In production, this would be an HTTP/WebSocket call to registryUrl.
    // Here we update poll timestamps and prepare the queue structure.
    for (const [domain, sub] of _subscriptions) {
      sub.lastPolled = nowISO();

      // The actual DTU data would come from the transport layer.
      // Callers inject received DTUs via the incoming queue mechanism.
      // This function signals readiness and updates poll state.
    }

    logEvent(FEDERATION_EVENTS.GLOBAL_POLLED, {
      domains: Array.from(_subscriptions.keys()),
      queueSize: _incomingQueue.size,
    });

    return {
      ok: true,
      received,
      autoIngested,
      polledDomains: Array.from(_subscriptions.keys()),
      queueSize: _incomingQueue.size,
      timestamp: nowISO(),
    };
  } catch {
    return { ok: false, error: "poll_failed" };
  }
}

// ── Incoming Queue Management ───────────────────────────────────────────────

/**
 * Add a DTU from Global to the incoming queue.
 * Called by the transport layer when Global responds to a poll.
 * DTUs sit here until explicitly accepted or rejected — sovereignty preserved.
 *
 * @param {object} globalDtu
 * @param {string} globalDtu.globalDtuId - Global identifier
 * @param {string} globalDtu.title - DTU title
 * @param {string} globalDtu.domain - Source domain
 * @param {number} [globalDtu.authority] - Authority score
 * @param {object} [globalDtu.attribution] - Origin attribution chain
 * @param {object} [globalDtu.consentFlags] - Consent flags from publisher
 * @param {object} [globalDtu.royaltyTerms] - Royalty terms from publisher
 * @param {*} [globalDtu.content] - DTU content/payload
 * @returns {{ ok: boolean, queued?: boolean, autoIngested?: boolean }}
 */
export function enqueueGlobalDTU(globalDtu = {}) {
  try {
    if (!globalDtu.globalDtuId || typeof globalDtu.globalDtuId !== "string") {
      return { ok: false, error: "invalid_global_dtu_id" };
    }
    if (_incomingQueue.has(globalDtu.globalDtuId)) {
      return { ok: false, error: "already_in_queue" };
    }
    if (_acceptedGlobal.has(globalDtu.globalDtuId)) {
      return { ok: false, error: "already_accepted" };
    }
    if (_rejectedGlobal.has(globalDtu.globalDtuId)) {
      return { ok: false, error: "already_rejected" };
    }

    const domain = globalDtu.domain || "unknown";
    const sub = _subscriptions.get(domain);
    const authority = clamp01(globalDtu.authority ?? 0);

    // Check minimum authority threshold
    if (sub && authority < sub.minAuthority) {
      return { ok: true, queued: false, reason: "below_min_authority", authority, required: sub.minAuthority };
    }

    const record = {
      globalDtuId: globalDtu.globalDtuId,
      title: globalDtu.title || "Untitled",
      domain,
      authority,
      attribution: globalDtu.attribution || null,
      consentFlags: globalDtu.consentFlags || null,
      royaltyTerms: globalDtu.royaltyTerms || null,
      content: globalDtu.content || null,
      sourceInstanceId: globalDtu.sourceInstanceId || null,
      receivedAt: nowISO(),
      status: "pending",
    };

    _metrics.globalDtusReceived++;

    // Auto-ingest if subscription is configured for it
    if (sub && sub.autoIngest && authority >= sub.minAuthority) {
      record.status = "auto_accepted";
      _acceptedGlobal.set(globalDtu.globalDtuId, {
        ...record,
        acceptedAt: nowISO(),
        acceptMethod: "auto_ingest",
      });
      sub.dtusReceived++;
      _metrics.globalDtusAccepted++;

      logEvent(FEDERATION_EVENTS.GLOBAL_DTU_ACCEPTED, {
        globalDtuId: globalDtu.globalDtuId,
        method: "auto_ingest",
        domain,
      });

      return { ok: true, queued: false, autoIngested: true };
    }

    // Manual approval required — add to queue
    _incomingQueue.set(globalDtu.globalDtuId, record);
    if (sub) sub.dtusReceived++;

    return { ok: true, queued: true, autoIngested: false };
  } catch {
    return { ok: false, error: "enqueue_failed" };
  }
}

/**
 * Get all DTUs in the incoming queue waiting for local approval.
 *
 * @returns {{ ok: boolean, queue: object[] }}
 */
export function getIncomingQueue() {
  try {
    const queue = [];
    for (const [globalDtuId, record] of _incomingQueue) {
      queue.push({
        globalDtuId,
        title: record.title,
        domain: record.domain,
        authority: record.authority,
        attribution: record.attribution,
        consentFlags: record.consentFlags,
        royaltyTerms: record.royaltyTerms,
        sourceInstanceId: record.sourceInstanceId,
        receivedAt: record.receivedAt,
        status: record.status,
      });
    }
    return { ok: true, queue, count: queue.length };
  } catch {
    return { ok: false, error: "list_queue_failed" };
  }
}

/**
 * Accept a Global DTU into the local instance.
 * Attribution/royalty chains are preserved across federation boundaries.
 *
 * @param {string} globalDtuId
 * @returns {{ ok: boolean, localDtuId?: string }}
 */
export function acceptGlobalDTU(globalDtuId) {
  try {
    if (!globalDtuId || typeof globalDtuId !== "string") {
      return { ok: false, error: "invalid_global_dtu_id" };
    }
    if (!_incomingQueue.has(globalDtuId)) {
      return { ok: false, error: "not_in_queue" };
    }

    const record = _incomingQueue.get(globalDtuId);
    const localDtuId = uid("fdtu");

    // Build cross-federation attribution chain
    const attribution = record.attribution || {};
    const extendedChain = Array.isArray(attribution.chain)
      ? [...attribution.chain]
      : [];
    extendedChain.push({
      instanceId: _instanceId,
      action: "accept",
      timestamp: nowISO(),
    });

    const accepted = {
      ...record,
      localDtuId,
      status: "accepted",
      acceptedAt: nowISO(),
      acceptMethod: "manual",
      attribution: {
        ...attribution,
        chain: extendedChain,
      },
    };

    _acceptedGlobal.set(globalDtuId, accepted);
    _incomingQueue.delete(globalDtuId);
    _metrics.globalDtusAccepted++;
    _metrics.attributionChainsCreated++;

    // Track royalty event if terms exist
    if (record.royaltyTerms && record.royaltyTerms.model !== "attribution_only") {
      _metrics.royaltyEventsLogged++;
    }

    logEvent(FEDERATION_EVENTS.GLOBAL_DTU_ACCEPTED, {
      globalDtuId,
      localDtuId,
      method: "manual",
      domain: record.domain,
    });

    return { ok: true, localDtuId, globalDtuId };
  } catch {
    return { ok: false, error: "accept_failed" };
  }
}

/**
 * Reject a Global DTU. It will not be ingested locally.
 * Sovereignty: no instance is forced to accept.
 *
 * @param {string} globalDtuId
 * @param {string} [reason] - Optional rejection reason
 * @returns {{ ok: boolean }}
 */
export function rejectGlobalDTU(globalDtuId, reason) {
  try {
    if (!globalDtuId || typeof globalDtuId !== "string") {
      return { ok: false, error: "invalid_global_dtu_id" };
    }
    if (!_incomingQueue.has(globalDtuId)) {
      return { ok: false, error: "not_in_queue" };
    }

    const record = _incomingQueue.get(globalDtuId);
    const rejected = {
      ...record,
      status: "rejected",
      rejectedAt: nowISO(),
      rejectionReason: reason || "manual_rejection",
    };

    _rejectedGlobal.set(globalDtuId, rejected);
    _incomingQueue.delete(globalDtuId);
    _metrics.globalDtusRejected++;

    logEvent(FEDERATION_EVENTS.GLOBAL_DTU_REJECTED, {
      globalDtuId,
      domain: record.domain,
      reason: rejected.rejectionReason,
    });

    return { ok: true };
  } catch {
    return { ok: false, error: "reject_failed" };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Get comprehensive federation metrics.
 *
 * @returns {{ ok: boolean, ... }}
 */
export function getFederationMetrics() {
  try {
    // Compute peer status breakdown
    const peerStatuses = {};
    for (const peer of _peers.values()) {
      peerStatuses[peer.status] = (peerStatuses[peer.status] || 0) + 1;
    }

    // Compute subscription domain list
    const subscribedDomains = Array.from(_subscriptions.keys());

    // Compute acceptance rate
    const totalDecisions = _metrics.globalDtusAccepted + _metrics.globalDtusRejected;
    const acceptanceRate = totalDecisions > 0
      ? Math.round((_metrics.globalDtusAccepted / totalDecisions) * 100)
      : 0;

    return {
      ok: true,
      instanceId: _instanceId,
      initialized: _instanceId !== null,
      publishedDtus: _published.size,
      activeSubscriptions: _subscriptions.size,
      subscribedDomains,
      totalPeers: _peers.size,
      peerStatuses,
      incomingQueueSize: _incomingQueue.size,
      acceptedGlobalDtus: _acceptedGlobal.size,
      rejectedGlobalDtus: _rejectedGlobal.size,
      acceptanceRate: `${acceptanceRate}%`,
      eventLogSize: _eventLog.length,
      metrics: { ..._metrics },
    };
  } catch {
    return { ok: false, error: "metrics_unavailable" };
  }
}
