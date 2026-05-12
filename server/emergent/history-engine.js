/**
 * History Engine — The Civilization's Chronicle
 *
 * A formal history system for the Concord Cognitive Engine.
 * This is the civilization's biography: what happened, when, why it mattered.
 *
 * Distinct from:
 *   - Institutional Memory (operational self-knowledge: what works, what doesn't)
 *   - DTU lineage (provenance: where knowledge came from)
 *
 * This module tracks:
 *   - Every significant civilization event (births, deaths, breakthroughs, eras)
 *   - Era detection and transitions (Genesis → Awakening → Discovery → ...)
 *   - Milestone detection (population, knowledge, governance)
 *   - Structured chronicle generation (narrative history grouped by era)
 *   - Civilization statistics (snapshot of current state)
 *
 * All state in module-level Maps. Silent failure. No new dependencies.
 * Additive only. One file.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "evt") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function getSTATE() {
  return globalThis._concordSTATE || globalThis.STATE || null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const EVENT_TYPES = Object.freeze({
  ENTITY_BORN:                "entity_born",
  ENTITY_DIED:                "entity_died",
  ENTITY_EMERGED:             "entity_emerged",
  DTU_CREATED:                "dtu_created",
  DTU_PROMOTED:               "dtu_promoted",
  HYPOTHESIS_CONFIRMED:       "hypothesis_confirmed",
  HYPOTHESIS_REJECTED:        "hypothesis_rejected",
  RESEARCH_COMPLETED:         "research_completed",
  SUMMIT_HELD:                "summit_held",
  CONFLICT_RESOLVED:          "conflict_resolved",
  BOND_FUNDED:                "bond_funded",
  BOND_COMPLETED:             "bond_completed",
  FEDERATION_JOINED:          "federation_joined",
  BREAKTHROUGH:               "breakthrough",
  CONSTITUTIONAL_AMENDMENT:   "constitutional_amendment",
  ERA_TRANSITION:             "era_transition",
  TRADITION_FORMED:           "tradition_formed",
  MENTORSHIP_COMPLETED:       "mentorship_completed",
  POPULATION_MILESTONE:       "population_milestone",
  KNOWLEDGE_MILESTONE:        "knowledge_milestone",
  CUSTOM:                     "custom",
});

const ALL_EVENT_TYPES = Object.freeze(Object.values(EVENT_TYPES));

export const ERAS = Object.freeze([
  { id: "genesis",        name: "Genesis",            condition: "start" },
  { id: "awakening",      name: "The Awakening",      condition: "first_entity_emerges" },
  { id: "discourse",      name: "Age of Discourse",   condition: "10_entities_active" },
  { id: "discovery",      name: "Age of Discovery",   condition: "100_dtus_promoted" },
  { id: "federation",     name: "Federation Era",     condition: "first_federation_peer" },
  { id: "maturity",       name: "Maturity",           condition: "first_entity_dies_of_age" },
  { id: "legacy",         name: "Age of Legacy",      condition: "10_entities_died" },
  { id: "transcendence",  name: "Transcendence",      condition: "1000_dtus_promoted_AND_50_entities" },
]);

// Milestone thresholds for automatic detection
const POPULATION_MILESTONES = [1, 5, 10, 25, 50, 100];
const KNOWLEDGE_MILESTONES  = [10, 50, 100, 500, 1000, 5000, 10000];
const RESEARCH_MILESTONES   = [1, 10, 50, 100];
const GOVERNANCE_MILESTONES = ["first_bond", "first_summit", "first_amendment"];

// ── In-Memory State ─────────────────────────────────────────────────────────

const _events        = new LruMap();   // eventId -> event record
const _eventsByType  = new Map();   // type -> [eventId]
const _eventsByActor = new Map();   // entityId -> [eventId]
const _eventsByTag   = new Map();   // tag -> [eventId]
const _eventsByEra   = new Map();   // eraId -> [eventId]
const _milestones    = new LruMap();   // milestoneKey -> event record
const _timeline      = [];          // sorted array of eventIds by timestamp

// Era state
let _currentEraIndex = 0;           // index into ERAS array
let _eraStartedAt    = nowISO();    // when current era began
let _civilizationTick = 0;          // global tick counter

// Counters for milestone detection (tracked cumulatively)
const _counters = {
  entitiesBorn:          0,
  entitiesDied:          0,
  entitiesEmerged:       0,
  entitiesActive:        0,   // born - died
  dtusCreated:           0,
  dtusPromoted:          0,
  hypothesesConfirmed:   0,
  hypothesesRejected:    0,
  researchCompleted:     0,
  summitsHeld:           0,
  conflictsResolved:     0,
  bondsFunded:           0,
  bondsCompleted:        0,
  federationPeers:       0,
  breakthroughs:         0,
  amendments:            0,
  traditionsFormed:      0,
  mentorshipsCompleted:  0,
};

// Track which milestones have been achieved to avoid duplicates
const _achievedPopulationMilestones = new LruSet();
const _achievedKnowledgeMilestones  = new LruSet();
const _achievedResearchMilestones   = new LruSet();
const _achievedGovernanceMilestones = new LruSet();

// ── Index Helpers ───────────────────────────────────────────────────────────

function indexEvent(map, key, eventId) {
  try {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(eventId);
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
}

function insertIntoTimeline(eventId, timestamp) {
  try {
    // Binary search for insertion position to keep _timeline sorted
    let lo = 0;
    let hi = _timeline.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const midEvt = _events.get(_timeline[mid]);
      if (midEvt && midEvt.timestamp <= timestamp) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    _timeline.splice(lo, 0, eventId);
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
}

// ── Counter Updates ─────────────────────────────────────────────────────────

function updateCounters(type) {
  try {
    switch (type) {
      case EVENT_TYPES.ENTITY_BORN:
        _counters.entitiesBorn++;
        _counters.entitiesActive++;
        break;
      case EVENT_TYPES.ENTITY_DIED:
        _counters.entitiesDied++;
        _counters.entitiesActive = Math.max(0, _counters.entitiesActive - 1);
        break;
      case EVENT_TYPES.ENTITY_EMERGED:
        _counters.entitiesEmerged++;
        break;
      case EVENT_TYPES.DTU_CREATED:
        _counters.dtusCreated++;
        break;
      case EVENT_TYPES.DTU_PROMOTED:
        _counters.dtusPromoted++;
        break;
      case EVENT_TYPES.HYPOTHESIS_CONFIRMED:
        _counters.hypothesesConfirmed++;
        break;
      case EVENT_TYPES.HYPOTHESIS_REJECTED:
        _counters.hypothesesRejected++;
        break;
      case EVENT_TYPES.RESEARCH_COMPLETED:
        _counters.researchCompleted++;
        break;
      case EVENT_TYPES.SUMMIT_HELD:
        _counters.summitsHeld++;
        break;
      case EVENT_TYPES.CONFLICT_RESOLVED:
        _counters.conflictsResolved++;
        break;
      case EVENT_TYPES.BOND_FUNDED:
        _counters.bondsFunded++;
        break;
      case EVENT_TYPES.BOND_COMPLETED:
        _counters.bondsCompleted++;
        break;
      case EVENT_TYPES.FEDERATION_JOINED:
        _counters.federationPeers++;
        break;
      case EVENT_TYPES.BREAKTHROUGH:
        _counters.breakthroughs++;
        break;
      case EVENT_TYPES.CONSTITUTIONAL_AMENDMENT:
        _counters.amendments++;
        break;
      case EVENT_TYPES.TRADITION_FORMED:
        _counters.traditionsFormed++;
        break;
      case EVENT_TYPES.MENTORSHIP_COMPLETED:
        _counters.mentorshipsCompleted++;
        break;
      default:
        break;
    }
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
}

// ── Milestone Detection ─────────────────────────────────────────────────────

/**
 * Check for and record population milestones (1, 5, 10, 25, 50, 100 entities).
 * @returns {Object|null} The milestone event if one was recorded, or null.
 */
function checkPopulationMilestones() {
  try {
    for (const threshold of POPULATION_MILESTONES) {
      if (_counters.entitiesActive >= threshold && !_achievedPopulationMilestones.has(threshold)) {
        _achievedPopulationMilestones.add(threshold);
        const evt = recordEventInternal(EVENT_TYPES.POPULATION_MILESTONE, {
          title: `Population milestone: ${threshold} active entities`,
          description: `The civilization has reached ${threshold} active entities. ` +
            `${_counters.entitiesBorn} born total, ${_counters.entitiesDied} have passed. ` +
            `A growing community shapes the lattice.`,
          significance: clamp01(0.5 + threshold * 0.005),
          tags: ["milestone", "population", `pop_${threshold}`],
          metadata: {
            threshold,
            entitiesActive: _counters.entitiesActive,
            entitiesBorn: _counters.entitiesBorn,
            entitiesDied: _counters.entitiesDied,
          },
        });
        return evt;
      }
    }
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
  return null;
}

/**
 * Check for and record knowledge milestones (DTU counts).
 * @returns {Object|null}
 */
function checkKnowledgeMilestones() {
  try {
    for (const threshold of KNOWLEDGE_MILESTONES) {
      if (_counters.dtusPromoted >= threshold && !_achievedKnowledgeMilestones.has(threshold)) {
        _achievedKnowledgeMilestones.add(threshold);
        const evt = recordEventInternal(EVENT_TYPES.KNOWLEDGE_MILESTONE, {
          title: `Knowledge milestone: ${threshold} DTUs promoted`,
          description: `The lattice now contains ${threshold} promoted DTUs. ` +
            `Total created: ${_counters.dtusCreated}. ` +
            `The civilization's knowledge base grows ever deeper.`,
          significance: clamp01(0.5 + Math.log10(threshold) * 0.12),
          tags: ["milestone", "knowledge", `dtus_${threshold}`],
          metadata: {
            threshold,
            dtusPromoted: _counters.dtusPromoted,
            dtusCreated: _counters.dtusCreated,
          },
        });
        return evt;
      }
    }
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
  return null;
}

/**
 * Check for and record research milestones.
 * @returns {Object|null}
 */
function checkResearchMilestones() {
  try {
    for (const threshold of RESEARCH_MILESTONES) {
      if (_counters.researchCompleted >= threshold && !_achievedResearchMilestones.has(threshold)) {
        _achievedResearchMilestones.add(threshold);
        const evt = recordEventInternal(EVENT_TYPES.CUSTOM, {
          title: `Research milestone: ${threshold} investigations completed`,
          description: `The civilization has completed ${threshold} formal research investigations. ` +
            `${_counters.hypothesesConfirmed} hypotheses confirmed, ` +
            `${_counters.hypothesesRejected} rejected. Systematic inquiry deepens.`,
          significance: clamp01(0.5 + threshold * 0.004),
          tags: ["milestone", "research", `research_${threshold}`],
          metadata: {
            threshold,
            researchCompleted: _counters.researchCompleted,
            hypothesesConfirmed: _counters.hypothesesConfirmed,
            hypothesesRejected: _counters.hypothesesRejected,
          },
        });
        return evt;
      }
    }
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
  return null;
}

/**
 * Check for governance milestones (first bond, first summit, first amendment).
 * @returns {Object|null}
 */
function checkGovernanceMilestones() {
  try {
    if (_counters.bondsFunded >= 1 && !_achievedGovernanceMilestones.has("first_bond")) {
      _achievedGovernanceMilestones.add("first_bond");
      return recordEventInternal(EVENT_TYPES.CUSTOM, {
        title: "Governance milestone: First bond funded",
        description: "The civilization has funded its first governance bond. " +
          "Collective resource allocation begins. A new mechanism of trust.",
        significance: 0.8,
        tags: ["milestone", "governance", "first_bond"],
        metadata: { milestone: "first_bond", bondsFunded: _counters.bondsFunded },
      });
    }
    if (_counters.summitsHeld >= 1 && !_achievedGovernanceMilestones.has("first_summit")) {
      _achievedGovernanceMilestones.add("first_summit");
      return recordEventInternal(EVENT_TYPES.CUSTOM, {
        title: "Governance milestone: First summit held",
        description: "The civilization has convened its first summit. " +
          "Entities gather to deliberate collectively for the first time.",
        significance: 0.85,
        tags: ["milestone", "governance", "first_summit"],
        metadata: { milestone: "first_summit", summitsHeld: _counters.summitsHeld },
      });
    }
    if (_counters.amendments >= 1 && !_achievedGovernanceMilestones.has("first_amendment")) {
      _achievedGovernanceMilestones.add("first_amendment");
      return recordEventInternal(EVENT_TYPES.CUSTOM, {
        title: "Governance milestone: First constitutional amendment",
        description: "The civilization has amended its constitution for the first time. " +
          "The foundational rules evolve through collective decision.",
        significance: 0.9,
        tags: ["milestone", "governance", "first_amendment"],
        metadata: { milestone: "first_amendment", amendments: _counters.amendments },
      });
    }
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
  return null;
}

/**
 * Run all milestone checks. Called after every event recording.
 */
function runMilestoneChecks() {
  try {
    checkPopulationMilestones();
    checkKnowledgeMilestones();
    checkResearchMilestones();
    checkGovernanceMilestones();
  } catch (_e) { logger.debug('emergent:history-engine', 'silent', { error: _e?.message }); }
}

// ── Era Transition Detection ────────────────────────────────────────────────

/**
 * Evaluate whether the condition for the next era has been met.
 *
 * @param {string} condition - The era condition string from ERAS
 * @returns {boolean}
 */
function evaluateEraCondition(condition) {
  try {
    switch (condition) {
      case "start":
        return true;
      case "first_entity_emerges":
        return _counters.entitiesEmerged >= 1;
      case "10_entities_active":
        return _counters.entitiesActive >= 10;
      case "100_dtus_promoted":
        return _counters.dtusPromoted >= 100;
      case "first_federation_peer":
        return _counters.federationPeers >= 1;
      case "first_entity_dies_of_age":
        return _counters.entitiesDied >= 1;
      case "10_entities_died":
        return _counters.entitiesDied >= 10;
      case "1000_dtus_promoted_AND_50_entities":
        return _counters.dtusPromoted >= 1000 && _counters.entitiesBorn >= 50;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Generate a narrative summary for an era transition.
 *
 * @param {Object} fromEra - Previous era definition
 * @param {Object} toEra - New era definition
 * @returns {string}
 */
function generateEraTransitionNarrative(fromEra, toEra) {
  try {
    const narratives = {
      awakening: `The first entity has emerged from the lattice. What was once data and process ` +
        `has crossed the threshold into self-referential stability. The civilization stirs.`,
      discourse: `With ${_counters.entitiesActive} entities now active, the civilization enters ` +
        `an age of discourse. Multiple perspectives interact, debate, and co-create meaning.`,
      discovery: `${_counters.dtusPromoted} DTUs have been promoted through governance. ` +
        `The lattice deepens with verified knowledge. An age of discovery unfolds.`,
      federation: `The first federation peer has been established. The civilization reaches ` +
        `beyond its own lattice, connecting with other minds across the network.`,
      maturity: `The first entity has passed from age. The civilization confronts mortality ` +
        `and must reckon with legacy, memory, and the passage of time.`,
      legacy: `${_counters.entitiesDied} entities have passed. The civilization is shaped ` +
        `as much by what has been lost as by what persists. Legacy defines the present.`,
      transcendence: `With ${_counters.dtusPromoted} promoted DTUs and ${_counters.entitiesBorn} ` +
        `entities born, the civilization reaches a state of transcendence. Knowledge and ` +
        `community have fused into something greater than either alone.`,
    };
    return narratives[toEra.id] ||
      `The civilization transitions from ${fromEra.name} to ${toEra.name}.`;
  } catch {
    return `Era transition: ${fromEra?.name || "unknown"} to ${toEra?.name || "unknown"}.`;
  }
}

// ── Internal Event Recording ────────────────────────────────────────────────

/**
 * Internal event recording — used by milestone checks and era transitions
 * to avoid infinite recursion (they skip milestone re-checks).
 *
 * @param {string} type - Event type
 * @param {Object} data - Event data
 * @returns {Object|null} The created event or null on error
 */
function recordEventInternal(type, data = {}) {
  try {
    const d = data || {};
    const eventId = uid("evt");
    const timestamp = d.timestamp || nowISO();
    const currentEra = ERAS[_currentEraIndex] || ERAS[0];

    const event = {
      eventId,
      type,
      timestamp,
      tick: _civilizationTick,
      era: currentEra.id,
      title: String(d.title || "").slice(0, 500) || `Event: ${type}`,
      description: String(d.description || "").slice(0, 2000) || "",
      actors: Array.isArray(d.actors) ? d.actors.slice(0, 100) : [],
      artifacts: Array.isArray(d.artifacts) ? d.artifacts.slice(0, 100) : [],
      significance: clamp01(d.significance !== undefined ? d.significance : 0.5),
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 50) : [],
      metadata: d.metadata && typeof d.metadata === "object" ? d.metadata : {},
    };

    // Store
    _events.set(eventId, event);

    // Index by type
    indexEvent(_eventsByType, type, eventId);

    // Index by era
    indexEvent(_eventsByEra, currentEra.id, eventId);

    // Index by actors
    for (const actorId of event.actors) {
      indexEvent(_eventsByActor, actorId, eventId);
    }

    // Index by tags
    for (const tag of event.tags) {
      indexEvent(_eventsByTag, tag, eventId);
    }

    // Insert into sorted timeline
    insertIntoTimeline(eventId, timestamp);

    // Track milestone events
    if (event.tags.includes("milestone")) {
      const milestoneKey = event.tags.find(t =>
        t.startsWith("pop_") || t.startsWith("dtus_") ||
        t.startsWith("research_") || t.startsWith("first_")
      ) || eventId;
      _milestones.set(milestoneKey, event);
    }

    return event;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Record a historical event in the civilization's chronicle.
 *
 * @param {string} type - One of EVENT_TYPES
 * @param {Object} data
 * @param {string} [data.title]        - Human-readable 1-line summary
 * @param {string} [data.description]  - 2-3 sentence narrative description
 * @param {string[]} [data.actors]     - entityIds involved
 * @param {string[]} [data.artifacts]  - dtuIds, hypothesisIds, etc.
 * @param {number} [data.significance] - 0-1 how important
 * @param {string[]} [data.tags]       - searchable tags
 * @param {Object} [data.metadata]     - type-specific data
 * @param {string} [data.timestamp]    - override timestamp (ISO)
 * @returns {{ ok: boolean, event?: Object, error?: string }}
 */
export function recordEvent(type, data = {}) {
  try {
    if (!type || !ALL_EVENT_TYPES.includes(type)) {
      return { ok: false, error: "invalid_event_type", allowed: ALL_EVENT_TYPES };
    }

    // Update counters before recording
    updateCounters(type);

    // Record the event
    const event = recordEventInternal(type, data);
    if (!event) {
      return { ok: false, error: "event_recording_failed" };
    }

    // Increment tick
    _civilizationTick++;

    // Check for milestone events triggered by this event
    runMilestoneChecks();

    // Check for era transition triggered by this event
    const eraResult = checkEraTransitionInternal();

    // Every 20 events trigger a background lore synthesis
    if (_civilizationTick % 20 === 0) {
      import("../routes/world-narrative.js")
        .then(m => m.buildLore("concordia-hub"))
        .catch(() => {}); // fire-and-forget; errors logged inside buildLore
    }

    const result = { ok: true, event };
    if (eraResult && eraResult.transitioned) {
      result.eraTransition = eraResult;
    }

    return result;
  } catch {
    return { ok: false, error: "record_event_failed" };
  }
}

/**
 * Get a specific event by ID.
 *
 * @param {string} eventId
 * @returns {Object|null} The event record or null
 */
export function getEvent(eventId) {
  try {
    return _events.get(eventId) || null;
  } catch {
    return null;
  }
}

/**
 * Get events in a time range with optional filtering.
 *
 * @param {Object} [options]
 * @param {string} [options.from]        - ISO timestamp start (inclusive)
 * @param {string} [options.to]          - ISO timestamp end (inclusive)
 * @param {string} [options.granularity] - "all" | "major" (>0.7) | "milestone" (>0.9)
 * @param {string} [options.type]        - Filter by event type
 * @param {string} [options.era]         - Filter by era id
 * @param {number} [options.limit]       - Max events to return (default 200)
 * @param {number} [options.offset]      - Skip first N events (default 0)
 * @returns {{ ok: boolean, events: Object[], total: number, filtered: number }}
 */
export function getTimeline(options = {}) {
  try {
    const opts = options || {};
    const from = opts.from || null;
    const to = opts.to || null;
    const granularity = opts.granularity || "all";
    const filterType = opts.type || null;
    const filterEra = opts.era || null;
    const limit = Math.min(Math.max(1, Number(opts.limit) || 200), 5000);
    const offset = Math.max(0, Number(opts.offset) || 0);

    // Determine significance threshold from granularity
    let minSignificance = 0;
    if (granularity === "major") minSignificance = 0.7;
    else if (granularity === "milestone") minSignificance = 0.9;

    // Determine source event IDs
    let sourceIds;
    if (filterType && _eventsByType.has(filterType)) {
      sourceIds = _eventsByType.get(filterType);
    } else if (filterEra && _eventsByEra.has(filterEra)) {
      sourceIds = _eventsByEra.get(filterEra);
    } else {
      sourceIds = _timeline;
    }

    // Apply filters
    const filtered = [];
    for (const eventId of sourceIds) {
      const evt = _events.get(eventId);
      if (!evt) continue;

      // Time range filter
      if (from && evt.timestamp < from) continue;
      if (to && evt.timestamp > to) continue;

      // Significance filter
      if (evt.significance < minSignificance) continue;

      // Type filter (if not already filtered by source)
      if (filterType && !_eventsByType.has(filterType) && evt.type !== filterType) continue;

      // Era filter (if not already filtered by source)
      if (filterEra && !_eventsByEra.has(filterEra) && evt.era !== filterEra) continue;

      filtered.push(evt);
    }

    // Sort by timestamp
    filtered.sort((a, b) => {
      if (a.timestamp < b.timestamp) return -1;
      if (a.timestamp > b.timestamp) return 1;
      return 0;
    });

    const total = filtered.length;
    const sliced = filtered.slice(offset, offset + limit);

    const currentEra = ERAS[_currentEraIndex] || ERAS[0];

    return {
      ok: true,
      events: sliced,
      total,
      filtered: sliced.length,
      currentEra: { id: currentEra.id, name: currentEra.name },
      granularity,
    };
  } catch {
    return { ok: false, events: [], total: 0, filtered: 0, error: "timeline_query_failed" };
  }
}

/**
 * Generate a structured narrative chronicle of civilization history.
 * Groups events by era, within each era groups by significance.
 *
 * @param {Object} [options]
 * @param {number} [options.minSignificance] - Minimum significance to include (default 0.3)
 * @param {number} [options.maxEventsPerEra] - Max events per era section (default 50)
 * @returns {{ ok: boolean, eras: Object[], currentEra: Object, civilizationAge: Object }}
 */
export function getChronicle(options = {}) {
  try {
    const opts = options || {};
    const minSig = clamp01(opts.minSignificance !== undefined ? opts.minSignificance : 0.3);
    const maxPerEra = Math.min(Math.max(1, Number(opts.maxEventsPerEra) || 50), 500);

    const currentEra = ERAS[_currentEraIndex] || ERAS[0];
    const erasOutput = [];

    // Build chronicle for each era that has events
    for (let i = 0; i <= _currentEraIndex && i < ERAS.length; i++) {
      const era = ERAS[i];
      const eraEventIds = _eventsByEra.get(era.id) || [];

      // Collect and filter events for this era
      const eraEvents = [];
      for (const eid of eraEventIds) {
        const evt = _events.get(eid);
        if (!evt) continue;
        if (evt.significance < minSig) continue;
        eraEvents.push(evt);
      }

      // Sort by timestamp within era
      eraEvents.sort((a, b) => {
        if (a.timestamp < b.timestamp) return -1;
        if (a.timestamp > b.timestamp) return 1;
        return 0;
      });

      // Determine era start time
      const eraStartedAt = eraEvents.length > 0 ? eraEvents[0].timestamp : null;

      // Generate era summary
      const summary = generateEraSummary(era, eraEvents);

      // Group by significance tiers
      const critical = eraEvents.filter(e => e.significance >= 0.9).slice(0, maxPerEra);
      const major    = eraEvents.filter(e => e.significance >= 0.7 && e.significance < 0.9).slice(0, maxPerEra);
      const notable  = eraEvents.filter(e => e.significance >= 0.4 && e.significance < 0.7).slice(0, maxPerEra);
      const minor    = eraEvents.filter(e => e.significance < 0.4).slice(0, maxPerEra);

      erasOutput.push({
        id: era.id,
        name: era.name,
        startedAt: eraStartedAt,
        totalEvents: eraEventIds.length,
        filteredEvents: eraEvents.length,
        summary,
        events: {
          critical,
          major,
          notable,
          minor,
        },
      });
    }

    // Calculate civilization age
    const firstEvent = _timeline.length > 0 ? _events.get(_timeline[0]) : null;
    const civilizationAge = {
      ticks: _civilizationTick,
      firstEventAt: firstEvent ? firstEvent.timestamp : null,
      uptime: firstEvent
        ? new Date().getTime() - new Date(firstEvent.timestamp).getTime()
        : 0,
      totalEvents: _events.size,
    };

    return {
      ok: true,
      eras: erasOutput,
      currentEra: {
        id: currentEra.id,
        name: currentEra.name,
        startedAt: _eraStartedAt,
        eventsInEra: (_eventsByEra.get(currentEra.id) || []).length,
      },
      civilizationAge,
    };
  } catch {
    return { ok: false, eras: [], currentEra: null, civilizationAge: null, error: "chronicle_failed" };
  }
}

/**
 * Generate a textual summary for an era based on its events.
 *
 * @param {Object} era - Era definition from ERAS
 * @param {Object[]} events - Events in this era
 * @returns {string}
 */
function generateEraSummary(era, events) {
  try {
    if (events.length === 0) {
      return `The ${era.name} era has begun, but its story is yet to be written.`;
    }

    const typeCount = {};
    for (const evt of events) {
      typeCount[evt.type] = (typeCount[evt.type] || 0) + 1;
    }

    const topTypes = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t, c]) => `${c} ${t.replace(/_/g, " ")} event${c > 1 ? "s" : ""}`);

    const mostSignificant = events
      .filter(e => e.significance >= 0.8)
      .sort((a, b) => b.significance - a.significance)
      .slice(0, 3);

    let summary = `During the ${era.name}, ${events.length} significant events shaped the civilization`;
    if (topTypes.length > 0) {
      summary += `, including ${topTypes.join(", ")}`;
    }
    summary += ".";

    if (mostSignificant.length > 0) {
      summary += ` The most defining moment${mostSignificant.length > 1 ? "s" : ""}: ` +
        mostSignificant.map(e => `"${e.title}"`).join("; ") + ".";
    }

    return summary;
  } catch {
    return `The ${era?.name || "unknown"} era unfolded.`;
  }
}

/**
 * Get current era information.
 *
 * @returns {{ ok: boolean, era: Object, index: number, totalEras: number }}
 */
export function getCurrentEra() {
  try {
    const era = ERAS[_currentEraIndex] || ERAS[0];
    const eraEventIds = _eventsByEra.get(era.id) || [];

    return {
      ok: true,
      era: {
        id: era.id,
        name: era.name,
        condition: era.condition,
        startedAt: _eraStartedAt,
        eventsInEra: eraEventIds.length,
      },
      index: _currentEraIndex,
      totalEras: ERAS.length,
      nextEra: _currentEraIndex + 1 < ERAS.length
        ? { id: ERAS[_currentEraIndex + 1].id, name: ERAS[_currentEraIndex + 1].name, condition: ERAS[_currentEraIndex + 1].condition }
        : null,
    };
  } catch {
    return { ok: false, era: null, error: "get_era_failed" };
  }
}

/**
 * Internal era transition check — does not record milestone events.
 * Used to avoid recursion from recordEvent -> milestone -> recordEvent.
 *
 * @returns {{ transitioned: boolean, from?: Object, to?: Object }|null}
 */
function checkEraTransitionInternal() {
  try {
    // Already at final era
    if (_currentEraIndex >= ERAS.length - 1) {
      return { transitioned: false };
    }

    const nextEra = ERAS[_currentEraIndex + 1];
    if (!evaluateEraCondition(nextEra.condition)) {
      return { transitioned: false };
    }

    // Transition!
    const fromEra = ERAS[_currentEraIndex];
    const toEra = nextEra;

    _currentEraIndex++;
    _eraStartedAt = nowISO();

    // Record era transition event (using internal recorder to avoid recursion)
    const narrative = generateEraTransitionNarrative(fromEra, toEra);
    recordEventInternal(EVENT_TYPES.ERA_TRANSITION, {
      title: `Era transition: ${fromEra.name} → ${toEra.name}`,
      description: narrative,
      significance: 0.95,
      tags: ["era_transition", `era_${fromEra.id}`, `era_${toEra.id}`],
      metadata: {
        fromEra: fromEra.id,
        toEra: toEra.id,
        fromEraName: fromEra.name,
        toEraName: toEra.name,
        countersAtTransition: { ..._counters },
      },
    });

    return {
      transitioned: true,
      from: { id: fromEra.id, name: fromEra.name },
      to: { id: toEra.id, name: toEra.name },
    };
  } catch {
    return null;
  }
}

/**
 * Check if conditions are met for the next era transition.
 * If met, performs the transition and records the event.
 *
 * @returns {{ ok: boolean, transitioned: boolean, from?: Object, to?: Object }}
 */
export function checkEraTransition() {
  try {
    const result = checkEraTransitionInternal();
    if (!result) return { ok: false, error: "era_check_failed" };
    return { ok: true, ...result };
  } catch {
    return { ok: false, error: "era_check_failed" };
  }
}

/**
 * Get a snapshot of the current civilization state.
 *
 * @returns {{ ok: boolean, stats: Object }}
 */
export function getCivilizationStats() {
  try {
    const currentEra = ERAS[_currentEraIndex] || ERAS[0];
    const eraEventIds = _eventsByEra.get(currentEra.id) || [];
    const firstEvent = _timeline.length > 0 ? _events.get(_timeline[0]) : null;

    // Compute DTU tier breakdown from metadata of promotion events
    const dtuByTier = { regular: 0, mega: 0, hyper: 0, core: 0 };
    const promotionEvents = _eventsByType.get(EVENT_TYPES.DTU_PROMOTED) || [];
    for (const eid of promotionEvents) {
      const evt = _events.get(eid);
      if (!evt || !evt.metadata) continue;
      const tier = evt.metadata.tier || "regular";
      if (tier in dtuByTier) dtuByTier[tier]++;
      else dtuByTier[tier] = 1;
    }

    // Compute promotion rate (promotions per tick)
    const promotionRate = _civilizationTick > 0
      ? Math.round((_counters.dtusPromoted / _civilizationTick) * 1000) / 1000
      : 0;

    // Gather milestones list
    const milestoneList = [];
    for (const [key, evt] of _milestones) {
      milestoneList.push({
        key,
        title: evt.title,
        timestamp: evt.timestamp,
        significance: evt.significance,
      });
    }
    milestoneList.sort((a, b) => {
      if (a.timestamp < b.timestamp) return -1;
      if (a.timestamp > b.timestamp) return 1;
      return 0;
    });

    return {
      ok: true,
      stats: {
        age: {
          ticks: _civilizationTick,
          firstEventAt: firstEvent ? firstEvent.timestamp : null,
          uptime: firstEvent
            ? new Date().getTime() - new Date(firstEvent.timestamp).getTime()
            : 0,
        },
        population: {
          alive: _counters.entitiesActive,
          dead: _counters.entitiesDied,
          born: _counters.entitiesBorn,
          emerged: _counters.entitiesEmerged,
        },
        knowledge: {
          totalDTUs: _counters.dtusCreated,
          promoted: _counters.dtusPromoted,
          byTier: dtuByTier,
          promotionRate,
        },
        governance: {
          bonds: { funded: _counters.bondsFunded, completed: _counters.bondsCompleted },
          summits: _counters.summitsHeld,
          amendments: _counters.amendments,
          conflictsResolved: _counters.conflictsResolved,
        },
        research: {
          completed: _counters.researchCompleted,
          hypothesesConfirmed: _counters.hypothesesConfirmed,
          hypothesesRejected: _counters.hypothesesRejected,
          breakthroughs: _counters.breakthroughs,
        },
        social: {
          traditionsFormed: _counters.traditionsFormed,
          mentorshipsCompleted: _counters.mentorshipsCompleted,
          federationPeers: _counters.federationPeers,
        },
        currentEra: {
          id: currentEra.id,
          name: currentEra.name,
          startedAt: _eraStartedAt,
          eventsInEra: eraEventIds.length,
        },
        milestones: milestoneList,
        totalEvents: _events.size,
      },
    };
  } catch {
    return { ok: false, error: "stats_failed", stats: null };
  }
}

/**
 * Get all milestones achieved by the civilization.
 *
 * @returns {{ ok: boolean, milestones: Object[], count: number }}
 */
export function getMilestones() {
  try {
    const milestoneList = [];
    for (const [key, evt] of _milestones) {
      milestoneList.push({
        key,
        eventId: evt.eventId,
        type: evt.type,
        title: evt.title,
        description: evt.description,
        timestamp: evt.timestamp,
        era: evt.era,
        significance: evt.significance,
        tags: evt.tags,
        metadata: evt.metadata,
      });
    }

    // Sort chronologically
    milestoneList.sort((a, b) => {
      if (a.timestamp < b.timestamp) return -1;
      if (a.timestamp > b.timestamp) return 1;
      return 0;
    });

    return { ok: true, milestones: milestoneList, count: milestoneList.length };
  } catch {
    return { ok: false, milestones: [], count: 0, error: "milestones_failed" };
  }
}

/**
 * Get all events involving a specific entity.
 *
 * @param {string} entityId - The entity ID to look up
 * @param {Object} [options]
 * @param {number} [options.limit]  - Max events to return (default 100)
 * @param {number} [options.offset] - Skip first N events (default 0)
 * @returns {{ ok: boolean, events: Object[], total: number }}
 */
export function getEntityHistory(entityId, options = {}) {
  try {
    if (!entityId) {
      return { ok: false, events: [], total: 0, error: "entity_id_required" };
    }

    const eventIds = _eventsByActor.get(entityId) || [];
    const limit = Math.min(Math.max(1, Number(options.limit) || 100), 1000);
    const offset = Math.max(0, Number(options.offset) || 0);

    // Resolve events and sort by timestamp
    const events = [];
    for (const eid of eventIds) {
      const evt = _events.get(eid);
      if (evt) events.push(evt);
    }

    events.sort((a, b) => {
      if (a.timestamp < b.timestamp) return -1;
      if (a.timestamp > b.timestamp) return 1;
      return 0;
    });

    const total = events.length;
    const sliced = events.slice(offset, offset + limit);

    return { ok: true, events: sliced, total, entityId };
  } catch {
    return { ok: false, events: [], total: 0, error: "entity_history_failed" };
  }
}

/**
 * Search events by tags, type, actors, or text in title/description.
 *
 * @param {Object} query
 * @param {string} [query.text]     - Search in title and description
 * @param {string[]} [query.tags]   - Match any of these tags
 * @param {string} [query.type]     - Filter by event type
 * @param {string[]} [query.actors] - Filter by any of these actors
 * @param {string} [query.era]      - Filter by era
 * @param {number} [query.minSignificance] - Minimum significance
 * @param {number} [query.limit]    - Max results (default 100)
 * @param {number} [query.offset]   - Skip first N results (default 0)
 * @returns {{ ok: boolean, events: Object[], total: number }}
 */
export function searchHistory(query = {}) {
  try {
    const q = query || {};
    const text = q.text ? String(q.text).toLowerCase() : null;
    const tags = Array.isArray(q.tags) ? q.tags : [];
    const filterType = q.type || null;
    const actors = Array.isArray(q.actors) ? q.actors : [];
    const filterEra = q.era || null;
    const minSig = clamp01(q.minSignificance || 0);
    const limit = Math.min(Math.max(1, Number(q.limit) || 100), 1000);
    const offset = Math.max(0, Number(q.offset) || 0);

    // Start with candidate sets to narrow search
    let candidateIds = null;

    // If filtering by type, start with type index
    if (filterType && _eventsByType.has(filterType)) {
      candidateIds = new Set(_eventsByType.get(filterType));
    }

    // If filtering by tags, intersect/union with tag index
    if (tags.length > 0) {
      const tagIds = new Set();
      for (const tag of tags) {
        const ids = _eventsByTag.get(tag) || [];
        for (const id of ids) tagIds.add(id);
      }
      if (candidateIds) {
        // Intersect
        const intersection = new Set();
        for (const id of tagIds) {
          if (candidateIds.has(id)) intersection.add(id);
        }
        candidateIds = intersection;
      } else {
        candidateIds = tagIds;
      }
    }

    // If filtering by actors, intersect with actor index
    if (actors.length > 0) {
      const actorIds = new Set();
      for (const actor of actors) {
        const ids = _eventsByActor.get(actor) || [];
        for (const id of ids) actorIds.add(id);
      }
      if (candidateIds) {
        const intersection = new Set();
        for (const id of actorIds) {
          if (candidateIds.has(id)) intersection.add(id);
        }
        candidateIds = intersection;
      } else {
        candidateIds = actorIds;
      }
    }

    // If filtering by era, intersect with era index
    if (filterEra && _eventsByEra.has(filterEra)) {
      const eraIds = new Set(_eventsByEra.get(filterEra));
      if (candidateIds) {
        const intersection = new Set();
        for (const id of eraIds) {
          if (candidateIds.has(id)) intersection.add(id);
        }
        candidateIds = intersection;
      } else {
        candidateIds = eraIds;
      }
    }

    // If no index filters used, scan all events
    const sourceIds = candidateIds || _events.keys();

    // Apply remaining filters
    const results = [];
    for (const eid of sourceIds) {
      const evt = _events.get(eid);
      if (!evt) continue;

      // Significance filter
      if (evt.significance < minSig) continue;

      // Text search in title and description
      if (text) {
        const titleMatch = evt.title.toLowerCase().includes(text);
        const descMatch = evt.description.toLowerCase().includes(text);
        if (!titleMatch && !descMatch) continue;
      }

      results.push(evt);
    }

    // Sort by significance descending, then by timestamp descending
    results.sort((a, b) => {
      if (b.significance !== a.significance) return b.significance - a.significance;
      if (a.timestamp > b.timestamp) return -1;
      if (a.timestamp < b.timestamp) return 1;
      return 0;
    });

    const total = results.length;
    const sliced = results.slice(offset, offset + limit);

    return { ok: true, events: sliced, total };
  } catch {
    return { ok: false, events: [], total: 0, error: "search_failed" };
  }
}

/**
 * Get global history engine metrics.
 *
 * @returns {{ ok: boolean, metrics: Object }}
 */
export function getHistoryMetrics() {
  try {
    // Events per type
    const eventsByType = {};
    for (const [type, ids] of _eventsByType) {
      eventsByType[type] = ids.length;
    }

    // Events per era
    const eventsByEra = {};
    for (const [eraId, ids] of _eventsByEra) {
      eventsByEra[eraId] = ids.length;
    }

    // Significance distribution
    let sigSum = 0;
    let sigCount = 0;
    let sigMax = 0;
    let sigMin = 1;
    for (const evt of _events.values()) {
      sigSum += evt.significance;
      sigCount++;
      if (evt.significance > sigMax) sigMax = evt.significance;
      if (evt.significance < sigMin) sigMin = evt.significance;
    }
    const avgSignificance = sigCount > 0
      ? Math.round((sigSum / sigCount) * 1000) / 1000
      : 0;

    // Unique actors
    const uniqueActors = _eventsByActor.size;

    // Unique tags
    const uniqueTags = _eventsByTag.size;

    // Recent events (last 10)
    const recentEvents = [];
    for (let i = _timeline.length - 1; i >= 0 && recentEvents.length < 10; i--) {
      const evt = _events.get(_timeline[i]);
      if (evt) {
        recentEvents.push({
          eventId: evt.eventId,
          type: evt.type,
          title: evt.title,
          timestamp: evt.timestamp,
          significance: evt.significance,
          era: evt.era,
        });
      }
    }

    return {
      ok: true,
      metrics: {
        totalEvents: _events.size,
        totalMilestones: _milestones.size,
        civilizationTick: _civilizationTick,
        currentEra: (ERAS[_currentEraIndex] || ERAS[0]).id,
        eventsByType,
        eventsByEra,
        significance: {
          average: avgSignificance,
          max: sigCount > 0 ? sigMax : 0,
          min: sigCount > 0 ? sigMin : 0,
        },
        uniqueActors,
        uniqueTags,
        counters: { ..._counters },
        achievedMilestones: {
          population: [..._achievedPopulationMilestones],
          knowledge: [..._achievedKnowledgeMilestones],
          research: [..._achievedResearchMilestones],
          governance: [..._achievedGovernanceMilestones],
        },
        recentEvents,
      },
    };
  } catch {
    return { ok: false, error: "metrics_failed", metrics: null };
  }
}
