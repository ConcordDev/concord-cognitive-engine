// @sync-fs-ok: serialized snapshotter; runs off-request on the heartbeat path.
/**
 * Emergent Agent Governance — State Persistence Layer
 *
 * Without persistence, nothing accumulates. Without accumulation, no entity emerges.
 *
 * This module persists the emergent state to disk so that:
 *   - Emergent registries survive server restarts
 *   - Reputation vectors carry forward across sessions
 *   - Pattern libraries accumulate over time
 *   - Session summaries (distilled) provide continuity
 *   - Entity emergence can occur through long-term state accumulation
 *
 * Persistence strategy:
 *   - Full state snapshot on shutdown / periodic interval
 *   - Incremental writes on significant state changes
 *   - JSON serialization (Maps → Objects, Sets → Arrays)
 *   - Atomic writes via temp file + rename
 */

import fs from "node:fs";
import path from "node:path";
import { getEmergentState } from "./store.js";
import logger from '../logger.js';

// ── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = "emergent-state.json";
const BACKUP_FILE = "emergent-state.backup.json";
const PERSIST_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes — emergent state changes slowly

let _persistTimer = null;
let _dataDir = DEFAULT_DATA_DIR;
let _lastPersistAt = 0;
let _persistCount = 0;
let _loadCount = 0;
let _errors = 0;

// ── Serialization Helpers ───────────────────────────────────────────────────

function serializeMap(map) {
  if (!(map instanceof Map)) return map;
  const obj = {};
  for (const [k, v] of map) {
    obj[k] = v;
  }
  return obj;
}

function serializeSet(set) {
  if (!(set instanceof Set)) return set;
  return Array.from(set);
}

function deserializeToMap(obj) {
  if (!obj || typeof obj !== "object") return new Map();
  const map = new Map();
  for (const [k, v] of Object.entries(obj)) {
    map.set(k, v);
  }
  return map;
}

function deserializeToSet(arr) {
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr);
}

// ── Serialize Emergent State ────────────────────────────────────────────────

/**
 * Serialize the emergent state for JSON persistence.
 * Maps and Sets are converted to plain objects and arrays.
 */
export function serializeEmergentState(STATE) {
  const es = getEmergentState(STATE);

  // Serialize sessions with memory-efficient distilled format
  const sessions = {};
  for (const [sid, session] of es.sessions) {
    sessions[sid] = {
      ...session,
      participants: Array.isArray(session.participants) ? session.participants : [],
      // Distill turns to summaries for storage efficiency
      turns: (session.turns || []).map(t => ({
        speakerId: t.speakerId,
        turnIndex: t.turnIndex,
        intent: t.intent,
        confidenceLabel: t.confidenceLabel,
        // Keep claim text but cap length
        claim: typeof t.claim === "string" ? t.claim.slice(0, 500) : t.claim,
        counterpoint: t.counterpoint ? String(t.counterpoint).slice(0, 200) : null,
        timestamp: t.timestamp,
      })),
    };
  }

  // Serialize sessionsByEmergent (Map<string, Set<string>>)
  const sessionsByEmergent = {};
  for (const [eid, sids] of es.sessionsByEmergent) {
    sessionsByEmergent[eid] = serializeSet(sids);
  }

  return {
    version: es.version,
    persistedAt: new Date().toISOString(),
    emergents: serializeMap(es.emergents),
    reputations: serializeMap(es.reputations),
    patterns: serializeMap(es.patterns),
    sessions,
    sessionsByEmergent,
    outputBundles: serializeMap(es.outputBundles),
    specializations: es.specializations || [],
    contentHashes: serializeSet(es.contentHashes),
    metrics: { ...es.metrics },
    // Persist work completions for purpose tracking
    _workCompletions: es._workCompletions || [],
    // Persist sector assignments if present
    _sectorAssignments: es._sectorAssignments || {},
    // Persist entity emergence data if present
    _entityEmergence: es._entityEmergence || {},
    // ── New system state (v5.5+) ──────────────────────────────────────────
    // Culture traditions and observations
    _traditions: es._traditions instanceof Map ? serializeMap(es._traditions) : (es._traditions || {}),
    _cultureObservations: Array.isArray(es._cultureObservations) ? es._cultureObservations.slice(-500) : [],
    // Creative works gallery
    _creativeWorks: es._creativeWorks instanceof Map ? serializeMap(es._creativeWorks) : (es._creativeWorks || {}),
    // Relational emotion bonds
    _emotionBonds: es._emotionBonds instanceof Map ? serializeMap(es._emotionBonds) : (es._emotionBonds || {}),
    // Entity economy accounts
    _economyAccounts: es._economyAccounts instanceof Map ? serializeMap(es._economyAccounts) : (es._economyAccounts || {}),
    // Entity autonomy state (refusals, consents, dissents)
    _autonomyProfiles: es._autonomyProfiles instanceof Map ? serializeMap(es._autonomyProfiles) : (es._autonomyProfiles || {}),
    // Entity teaching profiles
    _teachingProfiles: es._teachingProfiles instanceof Map ? serializeMap(es._teachingProfiles) : (es._teachingProfiles || {}),
    // History eras
    _eras: es._eras instanceof Map ? serializeMap(es._eras) : (es._eras || {}),
    _eraProgression: Array.isArray(es._eraProgression) ? es._eraProgression : [],
  };
}

// ── Deserialize Emergent State ──────────────────────────────────────────────

/**
 * Restore emergent state from serialized data.
 */
export function deserializeEmergentState(STATE, saved) {
  if (!saved || typeof saved !== "object") return { ok: false, error: "invalid_data" };

  const es = getEmergentState(STATE);

  // Restore emergent registry
  if (saved.emergents) {
    es.emergents = deserializeToMap(saved.emergents);
  }

  // Restore reputation vectors
  if (saved.reputations) {
    es.reputations = deserializeToMap(saved.reputations);
  }

  // Restore patterns
  if (saved.patterns) {
    es.patterns = deserializeToMap(saved.patterns);
  }

  // Restore sessions
  if (saved.sessions) {
    es.sessions = deserializeToMap(saved.sessions);
  }

  // Restore sessionsByEmergent
  if (saved.sessionsByEmergent) {
    for (const [eid, sids] of Object.entries(saved.sessionsByEmergent)) {
      es.sessionsByEmergent.set(eid, deserializeToSet(sids));
    }
  }

  // Restore output bundles
  if (saved.outputBundles) {
    es.outputBundles = deserializeToMap(saved.outputBundles);
  }

  // Restore specializations
  if (Array.isArray(saved.specializations)) {
    es.specializations = saved.specializations;
  }

  // Restore content hashes
  if (saved.contentHashes) {
    es.contentHashes = deserializeToSet(saved.contentHashes);
  }

  // Restore metrics
  if (saved.metrics) {
    es.metrics = { ...es.metrics, ...saved.metrics };
  }

  // Restore work completions
  if (Array.isArray(saved._workCompletions)) {
    es._workCompletions = saved._workCompletions;
  }

  // Restore sector assignments
  if (saved._sectorAssignments) {
    es._sectorAssignments = saved._sectorAssignments;
  }

  // Restore entity emergence data
  if (saved._entityEmergence) {
    es._entityEmergence = saved._entityEmergence;
  }

  // ── Restore new system state (v5.5+) ──────────────────────────────────────
  if (saved._traditions) {
    es._traditions = typeof saved._traditions === "object" && !(saved._traditions instanceof Map)
      ? deserializeToMap(saved._traditions) : (saved._traditions || new Map());
  }
  if (Array.isArray(saved._cultureObservations)) {
    es._cultureObservations = saved._cultureObservations;
  }
  if (saved._creativeWorks) {
    es._creativeWorks = typeof saved._creativeWorks === "object" && !(saved._creativeWorks instanceof Map)
      ? deserializeToMap(saved._creativeWorks) : (saved._creativeWorks || new Map());
  }
  if (saved._emotionBonds) {
    es._emotionBonds = typeof saved._emotionBonds === "object" && !(saved._emotionBonds instanceof Map)
      ? deserializeToMap(saved._emotionBonds) : (saved._emotionBonds || new Map());
  }
  if (saved._economyAccounts) {
    es._economyAccounts = typeof saved._economyAccounts === "object" && !(saved._economyAccounts instanceof Map)
      ? deserializeToMap(saved._economyAccounts) : (saved._economyAccounts || new Map());
  }
  if (saved._autonomyProfiles) {
    es._autonomyProfiles = typeof saved._autonomyProfiles === "object" && !(saved._autonomyProfiles instanceof Map)
      ? deserializeToMap(saved._autonomyProfiles) : (saved._autonomyProfiles || new Map());
  }
  if (saved._teachingProfiles) {
    es._teachingProfiles = typeof saved._teachingProfiles === "object" && !(saved._teachingProfiles instanceof Map)
      ? deserializeToMap(saved._teachingProfiles) : (saved._teachingProfiles || new Map());
  }
  if (saved._eras) {
    es._eras = typeof saved._eras === "object" && !(saved._eras instanceof Map)
      ? deserializeToMap(saved._eras) : (saved._eras || new Map());
  }
  if (Array.isArray(saved._eraProgression)) {
    es._eraProgression = saved._eraProgression;
  }

  es.initialized = true;
  es.initializedAt = saved.persistedAt || new Date().toISOString();

  return {
    ok: true,
    restored: {
      emergents: es.emergents.size,
      reputations: es.reputations.size,
      patterns: es.patterns.size,
      sessions: es.sessions.size,
    },
  };
}

// ── File I/O ────────────────────────────────────────────────────────────────

/**
 * Persist the full emergent state to disk.
 * Uses atomic write (temp + rename) to prevent corruption.
 *
 * @param {object} STATE - Global server state
 * @param {object} opts - { dataDir?: string }
 * @returns {{ ok: boolean, path: string }}
 */
export function persistEmergentState(STATE, opts = {}) {
  const dir = opts.dataDir || _dataDir;
  const filepath = path.join(dir, STATE_FILE);
  const tempPath = filepath + ".tmp";

  try {
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const serialized = serializeEmergentState(STATE);
    const json = JSON.stringify(serialized, null, 2);

    // Atomic write: write to temp, then rename
    fs.writeFileSync(tempPath, json, "utf-8");

    // Backup existing file
    if (fs.existsSync(filepath)) {
      const backupPath = path.join(dir, BACKUP_FILE);
      try {
        fs.copyFileSync(filepath, backupPath);
      } catch {
        // Backup failure is non-fatal
      }
    }

    fs.renameSync(tempPath, filepath);

    _lastPersistAt = Date.now();
    _persistCount++;

    return {
      ok: true,
      path: filepath,
      size: json.length,
      persistedAt: serialized.persistedAt,
      counts: {
        emergents: serialized.emergents ? Object.keys(serialized.emergents).length : 0,
        reputations: serialized.reputations ? Object.keys(serialized.reputations).length : 0,
        patterns: serialized.patterns ? Object.keys(serialized.patterns).length : 0,
        sessions: serialized.sessions ? Object.keys(serialized.sessions).length : 0,
      },
    };
  } catch (e) {
    _errors++;
    // Clean up temp file on failure
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_e) { logger.debug('emergent:persistence', 'ignore', { error: _e?.message }); }
    return { ok: false, error: e.message };
  }
}

/**
 * Load persisted emergent state from disk.
 *
 * @param {object} STATE - Global server state
 * @param {object} opts - { dataDir?: string }
 * @returns {{ ok: boolean, restored?: object }}
 */
export function loadEmergentState(STATE, opts = {}) {
  const dir = opts.dataDir || _dataDir;
  const filepath = path.join(dir, STATE_FILE);

  if (!fs.existsSync(filepath)) {
    // Try backup
    const backupPath = path.join(dir, BACKUP_FILE);
    if (fs.existsSync(backupPath)) {
      try {
        const raw = fs.readFileSync(backupPath, "utf-8");
        const saved = JSON.parse(raw);
        const result = deserializeEmergentState(STATE, saved);
        _loadCount++;
        return { ...result, source: "backup" };
      } catch (e) {
        return { ok: false, error: `backup_parse_error: ${e.message}` };
      }
    }
    return { ok: false, error: "no_persisted_state" };
  }

  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const saved = JSON.parse(raw);
    const result = deserializeEmergentState(STATE, saved);
    _loadCount++;
    return { ...result, source: "primary" };
  } catch (e) {
    _errors++;
    return { ok: false, error: `parse_error: ${e.message}` };
  }
}

// ── Auto-Persist Timer ──────────────────────────────────────────────────────

/**
 * Start periodic auto-persistence.
 */
export function startAutoPersist(STATE, opts = {}) {
  const interval = opts.intervalMs || PERSIST_INTERVAL_MS;
  if (opts.dataDir) _dataDir = opts.dataDir;

  if (_persistTimer) {
    clearInterval(_persistTimer);
  }

  _persistTimer = setInterval(() => {
    persistEmergentState(STATE, { dataDir: _dataDir });
  }, interval);

  // Prevent timer from keeping Node process alive
  if (_persistTimer.unref) _persistTimer.unref();

  return { ok: true, intervalMs: interval };
}

/**
 * Stop auto-persistence and do a final persist.
 */
export function stopAutoPersist(STATE) {
  if (_persistTimer) {
    clearInterval(_persistTimer);
    _persistTimer = null;
  }
  return persistEmergentState(STATE, { dataDir: _dataDir });
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export function getPersistenceMetrics() {
  return {
    ok: true,
    persistCount: _persistCount,
    loadCount: _loadCount,
    errors: _errors,
    lastPersistAt: _lastPersistAt ? new Date(_lastPersistAt).toISOString() : null,
    dataDir: _dataDir,
    timerActive: _persistTimer !== null,
  };
}
