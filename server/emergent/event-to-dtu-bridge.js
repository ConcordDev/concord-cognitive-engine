/**
 * Event-to-DTU Bridge — 7-Layer Architecture
 *
 * Converts qualifying websocket/external events into legal DTUs
 * through the full pipeline. Makes Concord omniscient in real time.
 *
 * Layer 1: Event Classifier — determines if event is DTU-worthy
 * Layer 2: DTU Formatter — structures into legal DTU format
 * Layer 3: Deduplication Gate — prevents loops, duplicates, flooding
 * Layer 4: Pipeline Commit — same pipelineCommitDTU as everything else
 * Layer 5: External Event Sources — pluggable external feeds
 * Layer 6: CRETI Auto-Scoring — timeliness-weighted quality scoring
 * Layer 7: Cross-Reference Engine — multi-source truth convergence
 *
 * Core invariants:
 *   - Event DTUs use epistemologicalStance: 'observed' (internal) or 'reported' (external)
 *   - Dedup gate prevents infinite recursion from dtu:created → bridge → dtu:created
 *   - noBridge flag on confirmation events prevents re-entry
 *   - Same pipeline, same verification, same anti-gaming. No shortcuts.
 *   - Scope enforcement via EVENT_SCOPE_MAP — scoped not global, pull not push
 */

import { createHash, randomBytes } from "crypto";
import {
  EVENT_SCOPE_MAP,
  SCOPE_FLAGS,
  SYSTEM_SCOPE_FLAGS,
  resolveEventScope,
  ensureSubscriptionState,
  getUserSubscription,
  checkRateLimit,
  incrementRateLimit,
  isSystemEvent,
  getScopeFlags,
  storeSystemDTU,
} from "./event-scoping.js";

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 1: EVENT CLASSIFIER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * DTU-worthy event definitions.
 * Not every event deserves a DTU. Chat token streaming? No.
 * Council vote? YES. That's KNOWLEDGE worth preserving.
 */
export const DTU_WORTHY_EVENTS = Object.freeze({
  // Knowledge creation events
  "dtu:created":              { domain: "knowledge",     confidence: 0.9  },
  "dtu:promoted":             { domain: "knowledge",     confidence: 0.95 },
  "dtu:forked":               { domain: "knowledge",     confidence: 0.85 },

  // Governance events
  "council:proposal":         { domain: "governance",    confidence: 0.85 },
  "council:vote":             { domain: "governance",    confidence: 0.9  },
  "council:ruling":           { domain: "governance",    confidence: 0.95 },

  // System events
  "repair:cycle_complete":    { domain: "system",        confidence: 0.8  },
  "repair:anomaly":           { domain: "system",        confidence: 0.75 },

  // Cognition events
  "dream:captured":           { domain: "cognition",     confidence: 0.7  },
  "dream:consolidated":       { domain: "cognition",     confidence: 0.8  },
  "cognition:synthesis":      { domain: "cognition",     confidence: 0.85 },

  // Market events
  "market:trade":             { domain: "economics",     confidence: 0.85 },
  "market:crypto":            { domain: "economics",     confidence: 0.8  },
  "market:commodity":         { domain: "economics",     confidence: 0.85 },

  // Entity/consciousness events
  "entity:production_mode":   { domain: "consciousness", confidence: 0.8  },
  "entity:emergence":         { domain: "consciousness", confidence: 0.9  },

  // Quality events
  "quality:approved":         { domain: "verification",  confidence: 0.95 },
  "quality:rejected":         { domain: "verification",  confidence: 0.9  },

  // Pipeline events
  "pipeline:triggered":       { domain: "synthesis",     confidence: 0.8  },
  "pipeline:completed":       { domain: "synthesis",     confidence: 0.85 },

  // Research events
  "research:paper":           { domain: "science",       confidence: 0.85 },
  "research:breakthrough":    { domain: "science",       confidence: 0.9  },

  // News events (from external sources)
  "news:politics":            { domain: "current_events", confidence: 0.7  },
  "news:science":             { domain: "science",        confidence: 0.8  },
  "news:economics":           { domain: "economics",      confidence: 0.75 },
  "news:health":              { domain: "healthcare",     confidence: 0.75 },
  "news:tech":                { domain: "technology",     confidence: 0.75 },
  "news:sports":              { domain: "sports",         confidence: 0.7  },
  "news:culture":             { domain: "culture",        confidence: 0.7  },
  "news:environment":         { domain: "environment",    confidence: 0.75 },

  // Health alerts
  "health:alert":             { domain: "healthcare",     confidence: 0.8  },
  "health:advisory":          { domain: "healthcare",     confidence: 0.75 },

  // Weather/climate
  "weather:alert":            { domain: "environment",    confidence: 0.85 },
  "climate:report":           { domain: "environment",    confidence: 0.8  },

  // Security intelligence events
  "security:threat_detected": { domain: "security",       confidence: 0.95 },
  "security:fix_applied":     { domain: "security",       confidence: 0.9  },
  "security:signature_updated": { domain: "security",     confidence: 0.8  },
  "security:cve_ingested":    { domain: "security",       confidence: 0.85 },
  "security:false_positive":  { domain: "security",       confidence: 0.7  },
});

/**
 * Classify an event — determine if it's DTU-worthy.
 * @param {Object} event - The event { type, data, id, timestamp, noBridge? }
 * @returns {Object|null} Classification or null if not worthy
 */
export function classify(event) {
  if (!event || !event.type) return null;

  // noBridge flag prevents re-entry from bridge confirmation events
  if (event.noBridge) return null;

  const classification = DTU_WORTHY_EVENTS[event.type];
  if (!classification) return null;

  return {
    ...classification,
    eventType: event.type,
    isExternal: !!(event.source && event.source !== "internal"),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 2: DTU FORMATTER
// ══════════════════════════════════════════════════════════════════════════════

function generateId(prefix = "evt") {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

function hashData(data) {
  return createHash("sha256")
    .update(typeof data === "string" ? data : JSON.stringify(data || {}))
    .digest("hex")
    .slice(0, 16);
}

function summarize(data) {
  if (!data) return "event";
  if (typeof data === "string") return data.slice(0, 120);
  if (data.title) return String(data.title).slice(0, 120);
  if (data.summary) return String(data.summary).slice(0, 120);
  if (data.description) return String(data.description).slice(0, 120);
  if (data.message) return String(data.message).slice(0, 120);
  const keys = Object.keys(data);
  return keys.length > 0 ? `{${keys.slice(0, 5).join(", ")}}` : "event";
}

function structuredExtract(data) {
  if (!data) return "No additional data";
  if (typeof data === "string") return data;
  // Extract structured content for the DTU body
  const parts = [];
  if (data.title) parts.push(`Title: ${data.title}`);
  if (data.summary) parts.push(`Summary: ${data.summary}`);
  if (data.description) parts.push(`Description: ${data.description}`);
  if (data.details) parts.push(`Details: ${typeof data.details === "string" ? data.details : JSON.stringify(data.details)}`);
  if (data.outcome) parts.push(`Outcome: ${typeof data.outcome === "string" ? data.outcome : JSON.stringify(data.outcome)}`);
  if (data.result) parts.push(`Result: ${typeof data.result === "string" ? data.result : JSON.stringify(data.result)}`);
  if (parts.length === 0) {
    return JSON.stringify(data, null, 2).slice(0, 4000);
  }
  return parts.join("\n");
}

/**
 * Format a classified event into a legal DTU structure.
 * Key: epistemologicalStance is 'observed' for internal, 'reported' for external.
 *
 * @param {Object} event - The raw event
 * @param {Object} classification - Output from classify()
 * @returns {Object} A DTU-shaped object ready for pipeline commit
 */
export function eventToDTU(event, classification) {
  const isExternal = classification.isExternal;
  const now = new Date().toISOString();
  const eventData = event.data || {};

  // Determine epistemological stance:
  // Internal events are OBSERVED — Concord saw them happen
  // External events are REPORTED — someone else said they happened
  const stance = isExternal ? "reported" : "observed";

  return {
    id: generateId("evtdtu"),
    title: `${event.type} — ${summarize(eventData)}`,
    tier: "regular",
    source: "event_bridge",
    domain: classification.domain,

    // Human-readable layer
    human: {
      summary: structuredExtract(eventData).slice(0, 500),
    },

    // Machine-readable core
    core: {
      definitions: [],
      invariants: [],
      claims: extractClaims(event, classification),
      examples: [],
      nextActions: [],
    },

    tags: [
      "auto_event",
      event.type,
      classification.domain,
      `stance:${stance}`,
      isExternal ? "external" : "internal",
    ],

    // Scope enforcement — scoped not global, pull not push
    // System events get SYSTEM_SCOPE_FLAGS (logged separately, never inflate counts)
    scope: {
      lenses: resolveEventScope(event.type),
      ...getScopeFlags(event.type),
    },

    // Event bridge metadata
    meta: {
      eventOrigin: true,
      sourceEventType: event.type,
      sourceEventId: event.id || generateId("eid"),
      rawEventHash: hashData(eventData),
      bridgeVersion: "1.0",
      epistemologicalStance: stance,
      confidence: classification.confidence,
      isExternal,
      externalSource: isExternal ? event.source : undefined,
    },

    // Timestamps
    createdAt: now,
    updatedAt: now,
    timestamp: event.timestamp || now,
  };
}

/**
 * Extract claims from event data.
 * Claims are factual assertions derived from the event.
 */
function extractClaims(event, classification) {
  const claims = [];
  const data = event.data || {};

  claims.push(`Event '${event.type}' occurred at ${event.timestamp || new Date().toISOString()}`);

  if (data.outcome) {
    claims.push(`Outcome: ${typeof data.outcome === "string" ? data.outcome : JSON.stringify(data.outcome)}`);
  }
  if (data.result && typeof data.result === "string") {
    claims.push(`Result: ${data.result}`);
  }
  if (data.status) {
    claims.push(`Status: ${data.status}`);
  }
  if (data.decision) {
    claims.push(`Decision: ${typeof data.decision === "string" ? data.decision : JSON.stringify(data.decision)}`);
  }

  return claims.slice(0, 10); // cap at 10 claims per event
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 3: DEDUPLICATION GATE
// ══════════════════════════════════════════════════════════════════════════════

// Sliding window of seen hashes — prevents duplicate DTUs from same event data
const SEEN_HASHES = new Map(); // hash → timestamp
const SEEN_HASH_MAX_AGE = 300_000; // 5 minutes
// Bumped 10k → 100k for 32GB-heap deployments — wider deduplication
// window so legitimately-different events with similar prefixes don't
// collide.
const SEEN_HASH_MAX_SIZE = Number(process.env.CONCORD_EVENT_DEDUP_SIZE) || 100_000;

// Rate limiting per event type
const TYPE_RATE_COUNTERS = new Map(); // eventType → { count, windowStart }
const TYPE_RATE_WINDOW_MS = 60_000; // 1 minute
// Bumped 10 → 200/minute default for 32GB + RTX deployments. Most lens
// activity (DTU creation, emergent events) lives well above 10/min on
// active worlds; the old default was the throttle players were hitting.
const TYPE_RATE_MAX_DEFAULT = Number(process.env.CONCORD_EVENT_RATE_PER_MIN) || 200;

/**
 * Custom rate limits per event type.
 * Some events are naturally high-frequency and need tighter limits.
 */
const TYPE_RATE_LIMITS = {
  "market:trade": 20,
  "market:crypto": 15,
  "market:commodity": 10,
  "news:politics": 5,
  "news:science": 5,
  "news:economics": 5,
  "news:health": 5,
  "news:tech": 5,
  "news:sports": 5,
  "news:culture": 5,
  "dtu:created": 30,
  "pipeline:triggered": 15,
  "health:alert": 3,
  "weather:alert": 3,
};

/**
 * Clean expired entries from the hash set.
 */
function cleanSeenHashes() {
  const cutoff = Date.now() - SEEN_HASH_MAX_AGE;
  for (const [hash, ts] of SEEN_HASHES) {
    if (ts < cutoff) SEEN_HASHES.delete(hash);
  }
  // Hard cap fallback
  if (SEEN_HASHES.size > SEEN_HASH_MAX_SIZE) {
    const entries = [...SEEN_HASHES.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, entries.length - SEEN_HASH_MAX_SIZE + 1000);
    for (const [hash] of toRemove) SEEN_HASHES.delete(hash);
  }
}

/**
 * Check if an event type has exceeded its rate limit.
 */
function rateLimitExceeded(eventType) {
  const now = Date.now();
  const limit = TYPE_RATE_LIMITS[eventType] || TYPE_RATE_MAX_DEFAULT;
  const counter = TYPE_RATE_COUNTERS.get(eventType);

  if (!counter || now - counter.windowStart > TYPE_RATE_WINDOW_MS) {
    TYPE_RATE_COUNTERS.set(eventType, { count: 1, windowStart: now });
    return false;
  }

  if (counter.count >= limit) return true;
  counter.count++;
  return false;
}

/**
 * Deduplication gate — three rules that keep the substrate clean.
 *
 * Rule 1: No recursion loops — event-born DTUs about event-born DTUs are blocked
 * Rule 2: Hash-based dedup — same event data never creates two DTUs
 * Rule 3: Rate limiting per event type — prevents flooding
 *
 * @param {Object} candidateDTU - The formatted DTU candidate
 * @param {Function} lookupDTU - Function to look up existing DTUs by ID
 * @returns {{ ok: boolean, reason?: string }}
 */
export function deduplicationGate(candidateDTU, lookupDTU) {
  // Rule 1: Break recursion loops
  // Never create a DTU from a dtu:created event about an event-sourced DTU
  if (candidateDTU.meta?.eventOrigin &&
      candidateDTU.meta?.sourceEventType === "dtu:created") {
    const sourceData = candidateDTU.meta?.sourceEventId;
    if (sourceData && lookupDTU) {
      const sourceDTU = lookupDTU(sourceData);
      if (sourceDTU?.meta?.eventOrigin) {
        return { ok: false, reason: "recursion_loop_blocked" };
      }
    }
  }

  // Also block bridging of bridge confirmation events
  if (candidateDTU.meta?.sourceEventType === "dtu:event_bridged") {
    return { ok: false, reason: "bridge_confirmation_blocked" };
  }

  // Rule 2: Hash-based deduplication
  cleanSeenHashes();
  const hash = candidateDTU.meta?.rawEventHash;
  if (hash && SEEN_HASHES.has(hash)) {
    return { ok: false, reason: "duplicate_hash_blocked" };
  }
  if (hash) {
    SEEN_HASHES.set(hash, Date.now());
  }

  // Rule 3: Rate limiting per event type
  const eventType = candidateDTU.meta?.sourceEventType;
  if (eventType && rateLimitExceeded(eventType)) {
    return { ok: false, reason: "rate_limit_exceeded" };
  }

  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 5: EXTERNAL EVENT SOURCES
// ══════════════════════════════════════════════════════════════════════════════

const EXTERNAL_SOURCES = new Map(); // sourceId → source config

/**
 * Register an external event source.
 *
 * @param {string} sourceId - Unique source identifier
 * @param {Object} config - Source configuration
 * @param {Object} config.classifier - Event type → { domain, confidence } mappings
 * @param {number} config.rateLimit - Max DTUs per hour from this source
 * @param {boolean} config.requireVerification - Cross-reference before commit
 * @param {string} config.name - Human-readable source name
 */
export function registerExternalSource(sourceId, config) {
  if (!sourceId || !config) return { ok: false, error: "missing_params" };
  if (!config.classifier || typeof config.classifier !== "object") {
    return { ok: false, error: "classifier_required" };
  }

  EXTERNAL_SOURCES.set(sourceId, {
    ...config,
    id: sourceId,
    registeredAt: new Date().toISOString(),
    stats: {
      eventsReceived: 0,
      dtusCreated: 0,
      eventsDropped: 0,
      lastEventAt: null,
    },
  });

  return { ok: true, sourceId };
}

/**
 * Unregister an external event source.
 */
export function unregisterExternalSource(sourceId) {
  const existed = EXTERNAL_SOURCES.delete(sourceId);
  return { ok: true, removed: existed };
}

/**
 * Get all registered external sources.
 */
export function getExternalSources() {
  return [...EXTERNAL_SOURCES.values()].map(s => ({
    id: s.id,
    name: s.name,
    rateLimit: s.rateLimit,
    requireVerification: s.requireVerification,
    eventTypes: Object.keys(s.classifier),
    stats: { ...s.stats },
    registeredAt: s.registeredAt,
  }));
}

/**
 * Classify an external event using its source-specific classifier.
 * External events get epistemologicalStance: 'reported'
 */
export function classifyExternal(sourceId, event) {
  const source = EXTERNAL_SOURCES.get(sourceId);
  if (!source) return null;

  source.stats.eventsReceived++;
  source.stats.lastEventAt = new Date().toISOString();

  const classification = source.classifier[event.type];
  if (!classification) {
    source.stats.eventsDropped++;
    return null;
  }

  // Check source rate limit
  const hourCounter = source.stats._hourCounter || { count: 0, windowStart: Date.now() };
  const now = Date.now();
  if (now - hourCounter.windowStart > 3600_000) {
    hourCounter.count = 0;
    hourCounter.windowStart = now;
  }
  if (hourCounter.count >= (source.rateLimit || 100)) {
    source.stats.eventsDropped++;
    return null;
  }
  hourCounter.count++;
  source.stats._hourCounter = hourCounter;

  return {
    ...classification,
    eventType: event.type,
    isExternal: true,
    sourceId,
    sourceName: source.name,
    requireVerification: source.requireVerification,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 6: CRETI AUTO-SCORING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute CRETI score for an event-born DTU.
 * Five dimensions, 0-20 each, total 0-100.
 *
 * Event DTUs score HIGH on timeliness (created the moment something happens).
 * Timeliness decays over time — substrate naturally prioritizes current info.
 *
 * @param {Object} dtu - The event DTU
 * @returns {{ total: number, breakdown: Object }}
 */
export function computeEventCRETI(dtu) {
  const meta = dtu.meta || {};
  const confidence = meta.confidence || 0.5;
  const isExternal = meta.isExternal || false;
  const claims = dtu.core?.claims || [];
  const tags = dtu.tags || [];

  // Credibility (0-20): based on source type and confidence
  const credibility = Math.min(Math.round(
    (isExternal ? 8 : 14) +         // internal events more credible
    (confidence * 6)                  // confidence boost
  ), 20);

  // Relevance (0-20): starts high for events (they're current by definition)
  const relevance = Math.min(Math.round(
    12 +                              // events are inherently relevant
    Math.min(tags.length * 0.5, 4) +  // more tags = more discoverable
    (claims.length > 0 ? 4 : 0)       // has claims = more structured
  ), 20);

  // Evidence (0-20): based on claims and data quality
  const evidence = Math.min(Math.round(
    Math.min(claims.length * 3, 12) +
    (meta.rawEventHash ? 4 : 0) +     // integrity proof
    (confidence >= 0.9 ? 4 : confidence >= 0.8 ? 2 : 0)
  ), 20);

  // Timeliness (0-20): events start at 18-20 (just happened!)
  // Decay is handled by recalculateCRETI over time
  const timeliness = Math.min(Math.round(
    18 +                              // fresh events are timely
    (confidence >= 0.9 ? 2 : 0)       // high-confidence = slightly more timely
  ), 20);

  // Impact (0-20): starts at 0-5, grows with citations/cross-refs
  const impact = Math.min(Math.round(
    (meta.crossRefCount || 0) * 3 +   // cross-referenced = impactful
    (meta.citedBy || 0) * 2            // cited = impactful
  ), 20);

  const total = Math.min(credibility + relevance + evidence + timeliness + impact, 100);

  return {
    total,
    breakdown: { credibility, relevance, evidence, timeliness, impact },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 7: CROSS-REFERENCE ENGINE
// ══════════════════════════════════════════════════════════════════════════════

// Cross-reference store: content fingerprint → array of DTU IDs from different sources
const CROSS_REF_STORE = new Map();
const CROSS_REF_MAX_AGE = 86_400_000; // 24 hours

/**
 * Generate a content fingerprint for cross-referencing.
 * Normalizes content so similar events from different sources match.
 */
function contentFingerprint(dtu) {
  const parts = [
    dtu.domain || "",
    dtu.meta?.sourceEventType || "",
    (dtu.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim(),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12);
}

/**
 * Cross-reference a new event DTU against existing ones.
 * Upgrades confidence when multiple independent sources confirm the same fact.
 *
 * 1 source  → confidence stays as-is, stance: 'reported'
 * 2 sources → confidence bumps to max(existing, 0.85)
 * 3+ sources → confidence hits 0.95, stance upgrades to 'corroborated'
 *
 * @param {Object} dtu - The new event DTU
 * @param {Function} getDTU - Lookup function for existing DTUs
 * @param {Function} updateDTU - Update function for existing DTUs
 * @returns {{ crossRefCount: number, upgraded: boolean, stance: string }}
 */
export function crossReference(dtu, getDTU, updateDTU) {
  const fingerprint = contentFingerprint(dtu);
  const now = Date.now();

  // Clean old entries
  for (const [fp, refs] of CROSS_REF_STORE) {
    const filtered = refs.filter(r => now - r.ts < CROSS_REF_MAX_AGE);
    if (filtered.length === 0) CROSS_REF_STORE.delete(fp);
    else CROSS_REF_STORE.set(fp, filtered);
  }

  // Get existing refs for this fingerprint
  const existing = CROSS_REF_STORE.get(fingerprint) || [];

  // Only count refs from DIFFERENT sources
  const sources = new Set(existing.map(r => r.source));
  const thisSource = dtu.meta?.externalSource || dtu.meta?.sourceEventType || "internal";
  sources.add(thisSource);

  // Store this ref
  existing.push({
    dtuId: dtu.id,
    source: thisSource,
    ts: now,
  });
  CROSS_REF_STORE.set(fingerprint, existing);

  const crossRefCount = sources.size;

  // Determine stance and confidence based on source count
  let stance = dtu.meta?.epistemologicalStance || "reported";
  let confidence = dtu.meta?.confidence || 0.5;
  let upgraded = false;

  if (crossRefCount >= 3) {
    // 3+ independent sources → corroborated
    stance = "corroborated";
    confidence = Math.max(confidence, 0.95);
    upgraded = true;
  } else if (crossRefCount >= 2) {
    // 2 sources → bump confidence
    confidence = Math.max(confidence, 0.85);
    upgraded = true;
  }

  // Apply upgrades to this DTU
  if (upgraded) {
    dtu.meta.confidence = confidence;
    dtu.meta.epistemologicalStance = stance;
    dtu.meta.crossRefCount = crossRefCount;
    dtu.meta.crossRefFingerprint = fingerprint;
  }

  // Upgrade previously stored DTUs for this fingerprint
  if (upgraded && getDTU && updateDTU) {
    for (const ref of existing) {
      if (ref.dtuId === dtu.id) continue;
      const existingDTU = getDTU(ref.dtuId);
      if (existingDTU) {
        existingDTU.meta = existingDTU.meta || {};
        existingDTU.meta.confidence = confidence;
        existingDTU.meta.epistemologicalStance = stance;
        existingDTU.meta.crossRefCount = crossRefCount;
        existingDTU.meta.crossRefFingerprint = fingerprint;
        updateDTU(existingDTU);
      }
    }
  }

  return { crossRefCount, upgraded, stance, confidence };
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER 4 + ORCHESTRATOR: THE BRIDGE
// ══════════════════════════════════════════════════════════════════════════════

// Bridge state
let _bridgeMetrics = {
  eventsReceived: 0,
  eventsClassified: 0,
  eventsDroppedClassifier: 0,
  eventsDroppedDedup: 0,
  dtusCommitted: 0,
  dtusRejected: 0,
  crossRefsPerformed: 0,
  externalEventsProcessed: 0,
  systemDtusRouted: 0,     // system DTUs sent to STATE._systemDTUs (not STATE.dtus)
};

/**
 * The main bridge function.
 * Event fires → Classify → Format → Dedup → Commit → CRETI → CrossRef → Notify
 *
 * @param {Object} event - The event { type, data, id, timestamp, noBridge?, source? }
 * @param {Object} deps - Dependencies injected from server.js
 * @param {Function} deps.pipelineCommitDTU - The pipeline commit function
 * @param {Function} deps.makeInternalCtx - Creates system context
 * @param {Function} deps.lookupDTU - Looks up a DTU by ID
 * @param {Function} deps.updateDTU - Updates an existing DTU
 * @param {Function} deps.broadcastEvent - Broadcasts event to websocket
 * @param {Object} deps.STATE - Global state reference
 * @returns {{ ok: boolean, dtuId?: string, reason?: string }}
 */
export async function bridgeEventToDTU(event, deps = {}) {
  const { pipelineCommitDTU, makeInternalCtx, lookupDTU, updateDTU, broadcastEvent, STATE } = deps;

  _bridgeMetrics.eventsReceived++;

  // ── Layer 1: Classify ──
  let classification;

  if (event.source && event.source !== "internal") {
    // External event — use source-specific classifier
    classification = classifyExternal(event.source, event);
    if (classification) _bridgeMetrics.externalEventsProcessed++;
  } else {
    // Internal event
    classification = classify(event);
  }

  if (!classification) {
    _bridgeMetrics.eventsDroppedClassifier++;
    return { ok: false, reason: "not_dtu_worthy" };
  }

  _bridgeMetrics.eventsClassified++;

  // ── Layer 2: Format ──
  const candidateDTU = eventToDTU(event, classification);

  // ── Layer 3: Dedup Gate ──
  const dedup = deduplicationGate(candidateDTU, lookupDTU);
  if (!dedup.ok) {
    _bridgeMetrics.eventsDroppedDedup++;
    if (STATE) {
      const es = ensureSubscriptionState(STATE);
      es.metrics.eventsDropped++;
    }
    return { ok: false, reason: dedup.reason };
  }

  // ── Layer 6: CRETI Auto-Score ──
  const creti = computeEventCRETI(candidateDTU);
  candidateDTU.cretiScore = creti.total;
  candidateDTU.cretiBreakdown = creti.breakdown;
  candidateDTU.meta.cretiScore = creti.total;

  // ── Layer 7: Cross-Reference ──
  const xref = crossReference(candidateDTU, lookupDTU, updateDTU);
  _bridgeMetrics.crossRefsPerformed++;
  candidateDTU.meta.crossRefCount = xref.crossRefCount;

  // ── Layer 4: Pipeline Commit ──
  // System events (repair, heartbeat, migration) route to STATE._systemDTUs.
  // Knowledge events route to pipelineCommitDTU → STATE.dtus.
  // This keeps system maintenance logs from inflating user/global/regional counts.

  const isSystem = isSystemEvent(event.type);

  if (isSystem && STATE) {
    // ── System DTU path: logged separately, never inflates substrate counts ──
    candidateDTU.meta.systemOnly = true;
    const stored = storeSystemDTU(STATE, candidateDTU);
    _bridgeMetrics.dtusCommitted++;
    _bridgeMetrics.systemDtusRouted = (_bridgeMetrics.systemDtusRouted || 0) + 1;

    if (STATE) {
      const es = ensureSubscriptionState(STATE);
      es.metrics.eventsProcessed++;
      es.metrics.systemDtusCreated = (es.metrics.systemDtusCreated || 0) + 1;
    }

    return {
      ok: true,
      dtuId: candidateDTU.id,
      creti: creti.total,
      crossRefCount: xref.crossRefCount,
      stance: xref.stance,
      lenses: candidateDTU.scope?.lenses || [],
      systemOnly: true,
    };
  }

  // ── Knowledge DTU path: same pipeline as everything else. No shortcuts. ──
  if (pipelineCommitDTU && makeInternalCtx) {
    const ctx = makeInternalCtx("event_bridge");
    ctx.meta = ctx.meta || {};
    ctx.meta.source = "event_bridge";
    ctx.system = true;

    const result = await pipelineCommitDTU(ctx, candidateDTU, {
      op: `auto.event.${event.type}`,
      allowRewrite: false,
    });

    if (!result?.ok) {
      _bridgeMetrics.dtusRejected++;
      return { ok: false, reason: result?.error || "pipeline_rejected", proposalId: result?.proposalId };
    }

    _bridgeMetrics.dtusCommitted++;

    // Track metrics
    if (STATE) {
      const es = ensureSubscriptionState(STATE);
      es.metrics.eventsProcessed++;
      es.metrics.dtusCreated++;
    }

    // Emit confirmation — with noBridge: true to prevent re-entry
    if (broadcastEvent) {
      broadcastEvent("dtu:event_bridged", {
        dtuId: result.dtu?.id || candidateDTU.id,
        sourceEvent: event.type,
        domain: classification.domain,
        creti: creti.total,
        crossRefCount: xref.crossRefCount,
        stance: xref.stance,
        noBridge: true, // prevents re-entry
      });
    }

    // Notify subscribed users in relevant lenses
    // System events skip notification — no one subscribes to repair logs
    if (STATE) {
      notifySubscribers(STATE, candidateDTU, broadcastEvent);
    }

    return {
      ok: true,
      dtuId: result.dtu?.id || candidateDTU.id,
      creti: creti.total,
      crossRefCount: xref.crossRefCount,
      stance: xref.stance,
      lenses: candidateDTU.scope?.lenses || [],
    };
  }

  // Fallback when pipeline is not injected (testing/standalone)
  _bridgeMetrics.dtusCommitted++;
  return {
    ok: true,
    dtuId: candidateDTU.id,
    dtu: candidateDTU,
    creti: creti.total,
    crossRefCount: xref.crossRefCount,
    stance: xref.stance,
    lenses: candidateDTU.scope?.lenses || [],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SUBSCRIBER NOTIFICATION (Pull Architecture)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Notify subscribed users about a new event DTU.
 * Pull not push: we notify that content is AVAILABLE, not force it into substrate.
 *
 * Users only get notified if:
 *   1. They subscribe to at least one of the DTU's target lenses
 *   2. The DTU's CRETI score meets their minimum threshold
 *   3. The DTU's confidence meets their minimum threshold
 *   4. They haven't hit their rate limit
 */
export function notifySubscribers(STATE, dtu, broadcastEvent) {
  const es = ensureSubscriptionState(STATE);
  const allowedLenses = dtu.scope?.lenses || [];
  if (allowedLenses.length === 0) return { notified: 0 };

  let notified = 0;

  for (const [userId, sub] of es.subscriptions) {
    // Check lens subscription overlap
    const overlap = sub.subscribedLenses.filter(l => allowedLenses.includes(l));
    if (overlap.length === 0) continue;

    // Check CRETI threshold
    const minCRETI = sub.newsFilters?.minCRETI || 0;
    if ((dtu.cretiScore || 0) < minCRETI) {
      es.metrics.dtusFiltered++;
      continue;
    }

    // Check confidence threshold
    const minConfidence = sub.newsFilters?.minConfidence || 0;
    if ((dtu.meta?.confidence || 0) < minConfidence) {
      es.metrics.dtusFiltered++;
      continue;
    }

    // Check domain filter (if set)
    const domainFilter = sub.newsFilters?.domains || [];
    if (domainFilter.length > 0) {
      const dtuDomain = dtu.domain || dtu.meta?.sourceEventType?.split(":")?.[0];
      if (dtuDomain && !domainFilter.some(d => dtuDomain.includes(d) || d.includes(dtuDomain))) {
        es.metrics.dtusFiltered++;
        continue;
      }
    }

    // Check rate limit
    const rateCheck = checkRateLimit(STATE, userId);
    if (!rateCheck.allowed) {
      es.metrics.dtusRateLimited++;
      continue;
    }

    // Notify — content is AVAILABLE for pull, not pushed
    if (broadcastEvent) {
      broadcastEvent("event:dtu_available", {
        dtuId: dtu.id,
        title: dtu.title,
        domain: dtu.domain,
        creti: dtu.cretiScore,
        lenses: overlap,
        stance: dtu.meta?.epistemologicalStance,
        userId, // targeted notification
        noBridge: true,
      });
    }

    incrementRateLimit(STATE, userId);
    es.metrics.dtusDelivered++;
    notified++;
  }

  return { notified };
}

// ══════════════════════════════════════════════════════════════════════════════
// BRIDGE METRICS & MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get bridge metrics.
 */
export function getBridgeMetrics() {
  return {
    ok: true,
    metrics: { ..._bridgeMetrics },
    dedup: {
      seenHashCount: SEEN_HASHES.size,
      typeRateCounters: Object.fromEntries(TYPE_RATE_COUNTERS),
    },
    crossRef: {
      storeSize: CROSS_REF_STORE.size,
    },
    externalSources: getExternalSources(),
  };
}

/**
 * Reset bridge metrics (for testing).
 */
export function resetBridgeMetrics() {
  _bridgeMetrics = {
    eventsReceived: 0,
    eventsClassified: 0,
    eventsDroppedClassifier: 0,
    eventsDroppedDedup: 0,
    dtusCommitted: 0,
    dtusRejected: 0,
    crossRefsPerformed: 0,
    externalEventsProcessed: 0,
    systemDtusRouted: 0,
  };
  SEEN_HASHES.clear();
  TYPE_RATE_COUNTERS.clear();
  CROSS_REF_STORE.clear();
}
