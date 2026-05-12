/**
 * State Migration — Cross-Environment Civilization Transfer
 *
 * Civilizations are not tied to a single machine. They can be exported,
 * transferred, and imported across clouds, bare metal, and local dev.
 * This module provides the complete export/import pipeline:
 *
 *   Export: snapshot all state → serialize → checksum → package
 *   Import: validate → integrity check → conflict detect → merge → rebuild
 *
 * Supports three merge modes:
 *   - replace:             Wipe existing state, load import (destructive)
 *   - merge:               Add new items, skip existing (by ID)
 *   - merge_prefer_import: Add new, overwrite existing with imported
 *
 * Partial export/import allows transferring subsets of state —
 * specific entities, domains, or date ranges.
 *
 * All state in module-level Maps. Silent failure. No new dependencies.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "mig") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function _getSTATE() {
  try { return globalThis._concordSTATE || globalThis.STATE || null; }
  catch (err) { console.debug('[state-migration] _getSTATE failed', err?.message); return null; }
}

/**
 * Convert a Map to an array of its values.
 * Returns empty array for non-Map input.
 */
function mapToArray(map) {
  if (!(map instanceof Map)) return [];
  try { return Array.from(map.values()); } catch (err) { console.debug('[state-migration] mapToArray failed', err?.message); return []; }
}

/**
 * Convert a Map to an array of { _key, ...value } objects,
 * preserving the original keys for later reconstruction.
 */
function mapEntriesToArray(map) {
  if (!(map instanceof Map)) return [];
  try {
    return Array.from(map.entries()).map(([k, v]) => {
      if (v && typeof v === "object") return { _key: k, ...v };
      return { _key: k, _value: v };
    });
  } catch (err) { console.debug('[state-migration] mapEntriesToArray failed', err?.message); return []; }
}

/**
 * Safely invoke a listing function and normalize to array.
 * Handles both raw array returns and { items: [...] } patterns.
 */
function safeListResult(fn) {
  try {
    const r = fn();
    if (Array.isArray(r)) return r;
    // Module list functions return various shapes
    for (const key of ["bodies", "hypotheses", "jobs", "deaths", "bonds"]) {
      if (Array.isArray(r?.[key])) return r[key];
    }
    return [];
  } catch (err) { console.debug('[state-migration] safeListResult failed', err?.message); return []; }
}

// ── Constants ───────────────────────────────────────────────────────────────

const MIGRATION_FORMAT = "concordos-migration-v1";
const MIGRATION_VERSION = "1.0.0";
export const COMPATIBLE_VERSIONS = Object.freeze(["1.0.0"]);

const MERGE_MODES = Object.freeze(["replace", "merge", "merge_prefer_import"]);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ── Migration Registry ──────────────────────────────────────────────────────
// Every export/import operation is tracked for audit and debugging.

const _migrations = new LruMap(); // migrationId → migration record

function recordMigration(type, extra = {}) {
  const migrationId = uid("mig");
  const record = {
    migrationId,
    type,                              // "export" | "import" | "import_partial"
    status: "pending",                 // "pending" | "in_progress" | "completed" | "failed"
    mergeMode: extra.mergeMode || null,
    startedAt: nowISO(),
    completedAt: null,
    stats: {},
    errors: [],
    checksum: extra.checksum || "",
  };
  _migrations.set(migrationId, record);
  return record;
}

function completeMigration(record, stats, errors = []) {
  record.status = errors.length > 0 ? "failed" : "completed";
  record.completedAt = nowISO();
  record.stats = stats || {};
  record.errors = errors;
  return record;
}

// ── State Accessors ─────────────────────────────────────────────────────────
// Lazy access into STATE substores. Each accessor mirrors how the owning
// module reaches its own state. All wrapped in try/catch for resilience.

function _es(S)     { try { return S?.__emergent || null; } catch (err) { console.debug('[state-migration] _es failed', err?.message); return null; } }
function _atlas(S)  { try { return S?.__emergent?._atlas || null; } catch (err) { console.debug('[state-migration] _atlas failed', err?.message); return null; } }
function _trust(S)  { try { return S?.__emergent?._trustNetwork || null; } catch (err) { console.debug('[state-migration] _trust failed', err?.message); return null; } }
function _comms(S)  { try { return S?.__emergent?._emergentComms || null; } catch (err) { console.debug('[state-migration] _comms failed', err?.message); return null; } }
function _const(S)  { try { return S?.__emergent?._constitution || null; } catch (err) { console.debug('[state-migration] _const failed', err?.message); return null; } }
function _memory(S) { try { return S?.__emergent?._institutionalMemory || null; } catch (err) { console.debug('[state-migration] _memory failed', err?.message); return null; } }

/**
 * Dynamic-import module-level list functions to avoid circular deps.
 * Each module stores state in its own Maps; we need their list functions
 * to read that state during export.
 */
async function _getModuleMaps() {
  const m = {};
  try {
    const mod = await import("./hypothesis-engine.js");
    if (typeof mod.listHypotheses === "function") m.hypotheses = mod.listHypotheses;
  } catch (_e) { logger.debug('emergent:state-migration', '', { error: _e?.message }); }
  try {
    const mod = await import("./research-jobs.js");
    if (typeof mod.listResearchJobs === "function") m.researchJobs = mod.listResearchJobs;
  } catch (_e) { logger.debug('emergent:state-migration', '', { error: _e?.message }); }
  try {
    const mod = await import("./body-instantiation.js");
    if (typeof mod.listBodies === "function") m.listBodies = mod.listBodies;
  } catch (_e) { logger.debug('emergent:state-migration', '', { error: _e?.message }); }
  try {
    const mod = await import("./death-protocol.js");
    if (typeof mod.listDeaths === "function") m.listDeaths = mod.listDeaths;
  } catch (_e) { logger.debug('emergent:state-migration', '', { error: _e?.message }); }
  try {
    const mod = await import("./microbond-governance.js");
    if (typeof mod.listBonds === "function") m.listBonds = mod.listBonds;
  } catch (_e) { logger.debug('emergent:state-migration', '', { error: _e?.message }); }
  return m;
}

// ── Checksum ────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 checksum of serialized data.
 * @param {*} data - Any JSON-serializable data
 * @returns {string} "sha256:<hex>"
 */
export function computeChecksum(data) {
  try {
    const json = typeof data === "string" ? data : JSON.stringify(data);
    const hash = crypto.createHash("sha256").update(json, "utf8").digest("hex");
    return `sha256:${hash}`;
  } catch {
    return "sha256:error";
  }
}

/**
 * Strip metadata fields (checksum, stats) to get the signable payload.
 */
function extractPayload(pkg) {
  const { checksum, stats, ...payload } = pkg;
  return payload;
}

// ── Validate Package ────────────────────────────────────────────────────────

/**
 * Validate an export package for structural integrity and checksum.
 * @param {object} pkg - Migration package
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePackage(pkg) {
  const errors = [];

  if (!pkg || typeof pkg !== "object") {
    return { ok: false, errors: ["Package is not an object"] };
  }

  // Format check
  if (pkg.format !== MIGRATION_FORMAT) {
    errors.push(`Invalid format: expected "${MIGRATION_FORMAT}", got "${pkg.format}"`);
  }

  // Version compatibility
  if (!COMPATIBLE_VERSIONS.includes(pkg.version)) {
    errors.push(`Incompatible version: "${pkg.version}". Compatible: ${COMPATIBLE_VERSIONS.join(", ")}`);
  }

  // Required metadata fields
  for (const f of ["exportedAt", "exportedBy", "checksum"]) {
    if (!pkg[f]) errors.push(`Missing required field: ${f}`);
  }

  // Checksum integrity
  if (pkg.checksum && pkg.checksum !== "sha256:error") {
    try {
      const computed = computeChecksum(extractPayload(pkg));
      if (computed !== pkg.checksum) {
        errors.push(`Checksum mismatch: expected ${pkg.checksum}, computed ${computed}`);
      }
    } catch (e) {
      errors.push(`Checksum verification failed: ${e.message}`);
    }
  }

  // Type-check data arrays
  const arrayFields = [
    "dtus", "entities", "bodies", "trustNetwork", "commsMessages",
    "hypotheses", "researchJobs", "constitution", "bonds", "disputes",
    "events", "deaths", "eras", "traditions", "creativeWorks", "accounts", "trades",
  ];
  for (const f of arrayFields) {
    if (pkg[f] !== undefined && !Array.isArray(pkg[f])) {
      errors.push(`Field "${f}" should be an array, got ${typeof pkg[f]}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Pre-flight Check ────────────────────────────────────────────────────────

function preflightCheck(STATE) {
  if (!STATE) return { ok: false, errors: ["STATE is null or undefined"] };
  const es = _es(STATE);
  if (!es) return { ok: false, errors: ["Emergent state not initialized"] };
  return {
    ok: true,
    errors: [],
    counts: {
      emergents: es.emergents?.size || 0,
      sessions: es.sessions?.size || 0,
      patterns: es.patterns?.size || 0,
    },
  };
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

async function snapshotState(STATE) {
  const es = _es(STATE), atlas = _atlas(STATE), trust = _trust(STATE);
  const comms = _comms(STATE), constitution = _const(STATE), memory = _memory(STATE);

  const dtus = atlas ? mapToArray(atlas.dtus) : [];
  const entities = es ? mapToArray(es.emergents) : [];

  let bodies = [], hypotheses = [], researchJobs = [], deaths = [], bonds = [];
  try {
    const mods = await _getModuleMaps();
    if (mods.listBodies) bodies = safeListResult(mods.listBodies);
    if (mods.hypotheses) hypotheses = safeListResult(mods.hypotheses);
    if (mods.researchJobs) researchJobs = safeListResult(mods.researchJobs);
    if (mods.listDeaths) deaths = safeListResult(mods.listDeaths);
    if (mods.listBonds) bonds = safeListResult(mods.listBonds);
  } catch (_e) { logger.debug('emergent:state-migration', 'modules may not be loaded yet', { error: _e?.message }); }

  const trustNetwork = trust ? mapEntriesToArray(trust.edges) : [];

  let commsMessages = [];
  if (comms?.messages) {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    commsMessages = mapToArray(comms.messages).filter(m => {
      try { return new Date(m.timestamp || m.sentAt || 0).getTime() >= cutoff; }
      catch (err) { console.debug('[state-migration] comms date filter failed', err?.message); return false; }
    });
  }

  const constitutionRules = constitution ? mapToArray(constitution.rules) : [];
  const disputes = constitution?.violations || [];
  const events = memory?.observations || [];
  const eras = es?._eras ? mapToArray(es._eras) : (es?._eraProgression || []);
  const traditions = es?._traditions instanceof Map ? mapToArray(es._traditions) : [];
  const creativeWorks = es?._creativeWorks instanceof Map ? mapToArray(es._creativeWorks) : [];
  const accounts = STATE?._social?.profiles ? mapToArray(STATE._social.profiles) : [];
  const trades = STATE?._social?.tradeHistory || [];

  return {
    dtus, entities, bodies, trustNetwork, commsMessages,
    hypotheses, researchJobs, constitution: constitutionRules, bonds,
    disputes, events, deaths, eras, traditions, creativeWorks,
    accounts, trades,
  };
}

function buildStats(snapshot, startTime, es) {
  return {
    totalDTUs: snapshot.dtus.length, totalEntities: snapshot.entities.length,
    totalEvents: snapshot.events.length, totalBodies: snapshot.bodies.length,
    totalHypotheses: snapshot.hypotheses.length, totalBonds: snapshot.bonds.length,
    totalDeaths: snapshot.deaths.length,
    currentEra: snapshot.eras.length > 0 ? snapshot.eras[snapshot.eras.length - 1] : null,
    civilizationAge: es?.initializedAt || null, exportDuration: `${Date.now() - startTime}ms`,
  };
}

function buildPayload(snapshot) {
  return {
    format: MIGRATION_FORMAT, version: MIGRATION_VERSION,
    exportedAt: nowISO(), exportedBy: "sovereign", checksum: "",
    dtus: snapshot.dtus, entities: snapshot.entities, bodies: snapshot.bodies,
    trustNetwork: snapshot.trustNetwork, commsMessages: snapshot.commsMessages,
    hypotheses: snapshot.hypotheses, researchJobs: snapshot.researchJobs,
    constitution: snapshot.constitution, bonds: snapshot.bonds, disputes: snapshot.disputes,
    events: snapshot.events, deaths: snapshot.deaths, eras: snapshot.eras,
    traditions: snapshot.traditions, creativeWorks: snapshot.creativeWorks,
    accounts: snapshot.accounts, trades: snapshot.trades,
  };
}

function signPayload(payload) {
  const { checksum: _, ...signable } = payload;
  payload.checksum = computeChecksum(signable);
  return payload;
}

// ── Export Full ──────────────────────────────────────────────────────────────

/**
 * Export the full civilization state as a portable migration package.
 *
 * Steps: pre-flight → snapshot → serialize → checksum → validate
 *
 * @param {object} [STATE] - Global state (auto-detected if omitted)
 * @returns {Promise<{ ok: boolean, package?: object, error?: string, migrationId: string }>}
 */
export async function exportFull(STATE) {
  const startTime = Date.now();
  const S = STATE || _getSTATE();
  const migration = recordMigration("export");

  try {
    migration.status = "in_progress";

    const preflight = preflightCheck(S);
    if (!preflight.ok) {
      completeMigration(migration, {}, preflight.errors);
      return { ok: false, error: preflight.errors.join("; "), migrationId: migration.migrationId };
    }

    const snapshot = await snapshotState(S);
    const payload = signPayload(buildPayload(snapshot));
    migration.checksum = payload.checksum;
    payload.stats = buildStats(snapshot, startTime, _es(S));

    // Validate the package we just built
    const validation = validatePackage(payload);
    if (!validation.ok) {
      completeMigration(migration, payload.stats, validation.errors);
      return { ok: false, error: "Post-export validation failed", details: validation.errors, migrationId: migration.migrationId };
    }

    completeMigration(migration, payload.stats);
    return { ok: true, package: payload, migrationId: migration.migrationId };
  } catch (e) {
    completeMigration(migration, {}, [e.message]);
    return { ok: false, error: e.message, migrationId: migration.migrationId };
  }
}

// ── Export Partial ───────────────────────────────────────────────────────────

/**
 * Export a subset of civilization state.
 *
 * @param {object} options
 * @param {string[]} [options.entities] - Specific entity IDs to include
 * @param {string[]} [options.domains] - DTU domains to include
 * @param {{ from?: string, to?: string }} [options.dateRange] - Event date range
 * @param {boolean} [options.includeRelationships=true] - Include trust/comms
 * @param {boolean} [options.includeHistory=true] - Include events
 * @param {object} [STATE] - Global state
 * @returns {Promise<{ ok: boolean, package?: object, migrationId: string }>}
 */
export async function exportPartial(options = {}, STATE) {
  const startTime = Date.now();
  const S = STATE || _getSTATE();
  const migration = recordMigration("export");

  try {
    migration.status = "in_progress";

    const preflight = preflightCheck(S);
    if (!preflight.ok) {
      completeMigration(migration, {}, preflight.errors);
      return { ok: false, error: preflight.errors.join("; "), migrationId: migration.migrationId };
    }

    const full = await snapshotState(S);
    const entF = options.entities ? new Set(options.entities) : null;
    const domF = options.domains ? new Set(options.domains) : null;
    const inclRel = options.includeRelationships !== false;
    const inclHist = options.includeHistory !== false;

    // Parse date range
    let dateFrom = 0, dateTo = Infinity;
    if (options.dateRange) {
      if (options.dateRange.from) dateFrom = new Date(options.dateRange.from).getTime() || 0;
      if (options.dateRange.to) dateTo = new Date(options.dateRange.to).getTime() || Infinity;
    }
    const inRange = (ts) => {
      try { const t = new Date(ts).getTime(); return t >= dateFrom && t <= dateTo; }
      catch (err) { console.debug('[state-migration] date range check failed', err?.message); return true; }
    };

    // Filter entities by ID
    let entities = full.entities;
    if (entF) entities = entities.filter(e => entF.has(e.id));
    const eids = new Set(entities.map(e => e.id));

    // Filter DTUs by domain and/or entity ownership
    let dtus = full.dtus;
    if (domF) dtus = dtus.filter(d => domF.has(d.domainType) || domF.has(d.domain));
    if (entF) dtus = dtus.filter(d => eids.has(d.authorId) || eids.has(d.createdBy) || eids.has(d.emergentId));

    // Filter bodies by entity
    let bodies = full.bodies;
    if (entF) bodies = bodies.filter(b => eids.has(b.entityId) || eids.has(b.emergentId));

    // Filter trust and comms by entity involvement
    const trustNetwork = inclRel
      ? full.trustNetwork.filter(e => !entF || eids.has(e.fromId) || eids.has(e.toId))
      : [];
    const commsMessages = inclRel
      ? full.commsMessages.filter(m => !entF || eids.has(m.fromId) || eids.has(m.toId))
      : [];

    // Filter events by date range and entity
    let events = full.events;
    if (options.dateRange) events = events.filter(e => inRange(e.timestamp || e.recordedAt));
    if (entF && inclHist) events = events.filter(e => !e.entityId || eids.has(e.entityId));

    // Filter hypotheses and deaths by entity authorship
    let hypotheses = full.hypotheses;
    if (entF) hypotheses = hypotheses.filter(h => eids.has(h.authorId) || eids.has(h.proposedBy));
    let deaths = full.deaths;
    if (entF) deaths = deaths.filter(d => eids.has(d.entityId));

    // Assemble filtered snapshot
    const snapshot = {
      dtus, entities, bodies, trustNetwork, commsMessages, hypotheses,
      researchJobs: full.researchJobs, constitution: full.constitution,
      bonds: full.bonds, disputes: full.disputes, events, deaths,
      eras: full.eras, traditions: full.traditions, creativeWorks: full.creativeWorks,
      accounts: full.accounts, trades: full.trades,
    };

    const payload = signPayload(buildPayload(snapshot));
    payload.partial = true;
    payload.partialOptions = {
      entities: options.entities || null,
      domains: options.domains || null,
      dateRange: options.dateRange || null,
      includeRelationships: inclRel,
      includeHistory: inclHist,
    };
    migration.checksum = payload.checksum;
    payload.stats = buildStats(snapshot, startTime, _es(S));

    completeMigration(migration, payload.stats);
    return { ok: true, package: payload, migrationId: migration.migrationId };
  } catch (e) {
    completeMigration(migration, {}, [e.message]);
    return { ok: false, error: e.message, migrationId: migration.migrationId };
  }
}

// ── Migration Plan (Dry Run) ────────────────────────────────────────────────

/**
 * Analyze an import package without applying changes.
 * Returns collision counts, missing references, and a merge recommendation.
 *
 * @param {object} pkg - Migration package
 * @param {object} [STATE] - Global state
 * @returns {Promise<{ ok: boolean, plan?: object, errors?: string[] }>}
 */
export async function createMigrationPlan(pkg, STATE) {
  const S = STATE || _getSTATE();

  try {
    const v = validatePackage(pkg);
    if (!v.ok) return { ok: false, errors: v.errors };

    const es = _es(S);
    const atlas = _atlas(S);
    const existEnt = es ? new Set(es.emergents.keys()) : new Set();
    const existDtu = atlas ? new Set(atlas.dtus.keys()) : new Set();

    // Entity collision analysis
    const impEntIds = (pkg.entities || []).map(e => e.id).filter(Boolean);
    let newEnt = 0, confEnt = 0;
    for (const id of impEntIds) { if (existEnt.has(id)) confEnt++; else newEnt++; }

    // DTU collision analysis
    const impDtuIds = (pkg.dtus || []).map(d => d.id).filter(Boolean);
    let newDtu = 0, confDtu = 0;
    for (const id of impDtuIds) { if (existDtu.has(id)) confDtu++; else newDtu++; }

    // Reference integrity: find trust edges pointing to nonexistent entities
    const pkgEnt = new Set(impEntIds);
    const missing = [];
    const broken = [];

    for (const edge of (pkg.trustNetwork || [])) {
      const from = edge.fromId || edge._key?.split("\u2192")[0];
      const to = edge.toId || edge._key?.split("\u2192")[1];
      if (from && !pkgEnt.has(from) && !existEnt.has(from)) missing.push(from);
      if (to && !pkgEnt.has(to) && !existEnt.has(to)) missing.push(to);
      if (from && to && (!pkgEnt.has(from) || !pkgEnt.has(to))) {
        broken.push({ from, to, reason: "endpoint_missing" });
      }
    }

    // Estimate import duration
    const totalItems = (pkg.dtus?.length || 0) + (pkg.entities?.length || 0)
      + (pkg.events?.length || 0) + (pkg.trustNetwork?.length || 0)
      + (pkg.bodies?.length || 0) + (pkg.hypotheses?.length || 0);
    const ms = Math.max(100, Math.ceil(totalItems * 0.1));
    const estimatedDuration = ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

    // Collect warnings
    const warnings = [];
    if (confEnt > 0) warnings.push(`${confEnt} entity ID collision(s)`);
    if (confDtu > 0) warnings.push(`${confDtu} DTU ID collision(s)`);
    if (missing.length > 0) warnings.push(`${missing.length} missing reference(s)`);
    if (broken.length > 0) warnings.push(`${broken.length} broken relationship(s)`);
    if (pkg.partial) warnings.push("Package is a partial export — some state may be missing");

    // Recommend merge strategy
    const recommendation = (confEnt > newEnt || confDtu > newDtu) ? "replace" : "merge";

    return {
      ok: true,
      plan: {
        newEntities: newEnt, conflictingEntities: confEnt,
        newDTUs: newDtu, conflictingDTUs: confDtu,
        newEvents: (pkg.events || []).length,
        missingReferences: [...new Set(missing)],
        brokenRelationships: broken,
        estimatedDuration, warnings, recommendation,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Import Helpers ──────────────────────────────────────────────────────────

/**
 * Merge an array of objects into a Map, respecting merge mode.
 * Objects carry a _key field (from mapEntriesToArray) or use keyField.
 */
function mergeIntoMap(map, arr, keyField, mode) {
  if (!map || !Array.isArray(arr)) return { added: 0, overwritten: 0, skipped: 0 };
  let added = 0, overwritten = 0, skipped = 0;

  for (const item of arr) {
    const key = item?._key || item?.[keyField];
    if (key == null) { skipped++; continue; }

    const exists = map.has(key);
    const cleaned = { ...item };
    delete cleaned._key;

    if (!exists) {
      map.set(key, cleaned);
      added++;
    } else if (mode === "merge_prefer_import" || mode === "replace") {
      map.set(key, cleaned);
      overwritten++;
    } else {
      // mode === "merge" — skip existing
      skipped++;
    }
  }
  return { added, overwritten, skipped };
}

/**
 * Append incoming items to an existing array.
 */
function mergeIntoArray(existing, incoming) {
  if (!Array.isArray(incoming) || !Array.isArray(existing)) return { added: 0 };
  existing.push(...incoming);
  return { added: incoming.length };
}

// ── Import Full ─────────────────────────────────────────────────────────────

/**
 * Import a full migration package into the current civilization.
 *
 * Steps: validate → merge-mode check → wipe (if replace) →
 *        import each domain → post-validation → report
 *
 * @param {object} pkg - Migration package from exportFull/exportPartial
 * @param {string} [mergeMode="merge"] - "replace" | "merge" | "merge_prefer_import"
 * @param {object} [STATE] - Global state
 * @returns {Promise<{ ok: boolean, summary?: object, migrationId: string }>}
 */
export async function importFull(pkg, mergeMode = "merge", STATE) {
  const startTime = Date.now();
  const S = STATE || _getSTATE();
  const migration = recordMigration("import", { mergeMode, checksum: pkg?.checksum });

  try {
    migration.status = "in_progress";

    // Validate
    const v = validatePackage(pkg);
    if (!v.ok) {
      completeMigration(migration, {}, v.errors);
      return { ok: false, errors: v.errors, migrationId: migration.migrationId };
    }
    if (!MERGE_MODES.includes(mergeMode)) {
      const err = `Invalid merge mode: "${mergeMode}". Use: ${MERGE_MODES.join(", ")}`;
      completeMigration(migration, {}, [err]);
      return { ok: false, error: err, migrationId: migration.migrationId };
    }

    const es = _es(S);
    if (!es) {
      completeMigration(migration, {}, ["Emergent state not initialized"]);
      return { ok: false, error: "Emergent state not initialized", migrationId: migration.migrationId };
    }

    const z3 = { added: 0, overwritten: 0, skipped: 0 };
    const z1 = { added: 0 };
    const sum = {
      mergeMode, entities: { ...z3 }, dtus: { ...z3 }, bodies: { ...z3 },
      trustEdges: { ...z3 }, commsMessages: { ...z1 }, hypotheses: { ...z1 },
      researchJobs: { ...z1 }, constitution: { ...z3 }, bonds: { ...z1 },
      disputes: { ...z1 }, events: { ...z1 }, deaths: { ...z1 }, eras: { ...z1 },
      traditions: { ...z1 }, creativeWorks: { ...z1 }, accounts: { ...z3 },
      trades: { ...z1 }, errors: [],
    };

    // ── Replace mode: wipe existing state ──────────────────────────────────
    if (mergeMode === "replace") {
      try {
        for (const m of [es.emergents, es.reputations, es.patterns, es.sessions, es.outputBundles, es.sessionsByEmergent]) {
          m?.clear?.();
        }
        es.contentHashes?.clear?.();
        if (es._atlas) {
          for (const k of ["dtus", "claims", "sources", "entities", "about"]) es._atlas[k]?.clear?.();
          es._atlas.links = [];
          es._atlas.audit = [];
        }
        if (es._trustNetwork) {
          es._trustNetwork.edges?.clear?.();
          es._trustNetwork.aggregates?.clear?.();
        }
        if (es._emergentComms) {
          for (const k of ["messages", "inbox", "channels"]) es._emergentComms[k]?.clear?.();
        }
        if (es._constitution) {
          es._constitution.rules?.clear?.();
          es._constitution.amendments = [];
          es._constitution.violations = [];
        }
        if (es._institutionalMemory) {
          es._institutionalMemory.observations = [];
          es._institutionalMemory.advisories?.clear?.();
        }
      } catch (e) {
        sum.errors.push(`State wipe error: ${e.message}`);
      }
    }

    // ── Import each domain (silent failure per-domain) ─────────────────────
    try { sum.entities = mergeIntoMap(es.emergents, pkg.entities || [], "id", mergeMode); }
    catch (e) { sum.errors.push(`Entity import: ${e.message}`); }

    try { const a = _atlas(S); if (a?.dtus) sum.dtus = mergeIntoMap(a.dtus, pkg.dtus || [], "id", mergeMode); }
    catch (e) { sum.errors.push(`DTU import: ${e.message}`); }

    try { const t = _trust(S); if (t?.edges) sum.trustEdges = mergeIntoMap(t.edges, pkg.trustNetwork || [], "_key", mergeMode); }
    catch (e) { sum.errors.push(`Trust import: ${e.message}`); }

    try { const c = _comms(S); if (c?.messages) { const r = mergeIntoMap(c.messages, pkg.commsMessages || [], "messageId", mergeMode); sum.commsMessages = { added: r.added + r.overwritten }; } }
    catch (e) { sum.errors.push(`Comms import: ${e.message}`); }

    try { const c = _const(S); if (c?.rules) sum.constitution = mergeIntoMap(c.rules, pkg.constitution || [], "ruleId", mergeMode); }
    catch (e) { sum.errors.push(`Constitution import: ${e.message}`); }

    try { const c = _const(S); if (c && Array.isArray(pkg.disputes)) { if (!Array.isArray(c.violations)) c.violations = []; sum.disputes = mergeIntoArray(c.violations, pkg.disputes); } }
    catch (e) { sum.errors.push(`Dispute import: ${e.message}`); }

    try { const m = _memory(S); if (m && Array.isArray(pkg.events)) { if (!Array.isArray(m.observations)) m.observations = []; sum.events = mergeIntoArray(m.observations, pkg.events); } }
    catch (e) { sum.errors.push(`Event import: ${e.message}`); }

    try { if (Array.isArray(pkg.eras) && pkg.eras.length > 0) { if (!es._eraProgression) es._eraProgression = []; if (mergeMode === "replace") es._eraProgression = []; sum.eras = mergeIntoArray(es._eraProgression, pkg.eras); } }
    catch (e) { sum.errors.push(`Era import: ${e.message}`); }

    try { if (Array.isArray(pkg.traditions) && pkg.traditions.length > 0) { if (!es._traditions) es._traditions = new Map(); if (mergeMode === "replace") es._traditions.clear(); sum.traditions = { added: mergeIntoMap(es._traditions, pkg.traditions, "id", mergeMode).added }; } }
    catch (e) { sum.errors.push(`Tradition import: ${e.message}`); }

    try { if (Array.isArray(pkg.creativeWorks) && pkg.creativeWorks.length > 0) { if (!es._creativeWorks) es._creativeWorks = new Map(); if (mergeMode === "replace") es._creativeWorks.clear(); sum.creativeWorks = { added: mergeIntoMap(es._creativeWorks, pkg.creativeWorks, "id", mergeMode).added }; } }
    catch (e) { sum.errors.push(`Creative works import: ${e.message}`); }

    try { if (Array.isArray(pkg.accounts) && pkg.accounts.length > 0) { if (!S._social) S._social = { profiles: new Map() }; if (!S._social.profiles) S._social.profiles = new Map(); if (mergeMode === "replace") S._social.profiles.clear(); sum.accounts = mergeIntoMap(S._social.profiles, pkg.accounts, "userId", mergeMode); } }
    catch (e) { sum.errors.push(`Account import: ${e.message}`); }

    try { if (Array.isArray(pkg.trades) && pkg.trades.length > 0) { if (!S._social) S._social = {}; if (!Array.isArray(S._social.tradeHistory)) S._social.tradeHistory = []; if (mergeMode === "replace") S._social.tradeHistory = []; sum.trades = mergeIntoArray(S._social.tradeHistory, pkg.trades); } }
    catch (e) { sum.errors.push(`Trade import: ${e.message}`); }

    // ── Post-import validation ──────────────────────────────────────────────
    const postVal = postImportValidation(S, sum);
    if (postVal.warnings.length > 0) sum.warnings = postVal.warnings;
    sum.duration = `${Date.now() - startTime}ms`;
    sum.importedAt = nowISO();

    completeMigration(migration, sum, sum.errors);
    return {
      ok: sum.errors.length === 0,
      summary: sum,
      migrationId: migration.migrationId,
      warnings: postVal.warnings,
    };
  } catch (e) {
    completeMigration(migration, {}, [e.message]);
    return { ok: false, error: e.message, migrationId: migration.migrationId };
  }
}

// ── Import Partial ──────────────────────────────────────────────────────────

/**
 * Import a partial migration package.
 * Prevents destructive replace mode (downgrades to merge).
 *
 * @param {object} pkg - Partial migration package
 * @param {string} [mergeMode="merge"] - Merge strategy
 * @param {object} [STATE] - Global state
 * @returns {Promise<{ ok: boolean, summary?: object }>}
 */
export async function importPartial(pkg, mergeMode = "merge", STATE) {
  // Partial imports never wipe — downgrade replace to merge
  const safeMerge = mergeMode === "replace" ? "merge" : mergeMode;
  const result = await importFull(pkg, safeMerge, STATE);

  // Tag the migration record as partial
  if (result.migrationId) {
    const rec = _migrations.get(result.migrationId);
    if (rec) {
      rec.type = "import_partial";
      rec.stats.partial = true;
      rec.stats.partialOptions = pkg?.partialOptions || null;
    }
  }
  return result;
}

// ── Post-Import Validation ──────────────────────────────────────────────────

function postImportValidation(STATE, summary) {
  const warnings = [];

  try {
    const es = _es(STATE);
    if (!es) {
      warnings.push("Emergent state is null after import");
      return { warnings };
    }

    // Check referential integrity: trust edges should reference existing entities
    const trust = _trust(STATE);
    if (trust?.edges) {
      let orphaned = 0;
      for (const [key] of trust.edges) {
        try {
          const [fromId, toId] = key.split("\u2192");
          if (!es.emergents.has(fromId) && !es.emergents.has(toId)) orphaned++;
        } catch (_e) { logger.debug('emergent:state-migration', '', { error: _e?.message }); }
      }
      if (orphaned > 0) {
        warnings.push(`${orphaned} trust edge(s) reference non-existent entities`);
      }
    }

    // Verify imports actually landed in state
    if (es.emergents.size === 0 && summary.entities?.added > 0) {
      warnings.push("Entity map empty despite importing entities — possible state init issue");
    }
    const atlas = _atlas(STATE);
    if (atlas?.dtus?.size === 0 && summary.dtus?.added > 0) {
      warnings.push("DTU map empty despite importing DTUs — possible atlas init issue");
    }
  } catch (e) {
    warnings.push(`Post-import validation error: ${e.message}`);
  }

  return { warnings };
}

// ── Migration History & Metrics ─────────────────────────────────────────────

/**
 * List all past migration records, most recent first.
 * @returns {{ ok: boolean, migrations: object[], total: number }}
 */
export function getMigrationHistory() {
  try {
    const all = Array.from(_migrations.values()).sort((a, b) => {
      try { return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(); }
      catch (err) { console.debug('[state-migration] sort date parse failed', err?.message); return 0; }
    });
    return { ok: true, migrations: all, total: all.length };
  } catch (err) {
    console.warn('[state-migration] getMigrationHistory failed', err?.message);
    return { ok: true, migrations: [], total: 0 };
  }
}

/**
 * Get a specific migration record by ID.
 * @param {string} migrationId
 * @returns {{ ok: boolean, migration?: object }}
 */
export function getMigration(migrationId) {
  try {
    const rec = _migrations.get(migrationId);
    if (!rec) return { ok: false, error: "Migration not found" };
    return { ok: true, migration: rec };
  } catch {
    return { ok: false, error: "Lookup failed" };
  }
}

/**
 * Aggregate metrics across all migrations.
 * @returns {{ ok: boolean, metrics: object }}
 */
export function getMigrationMetrics() {
  try {
    const all = Array.from(_migrations.values());
    const exp = all.filter(m => m.type === "export");
    const imp = all.filter(m => m.type === "import" || m.type === "import_partial");

    let entExp = 0, entImp = 0, dtuExp = 0, dtuImp = 0;
    for (const m of exp) {
      entExp += m.stats?.totalEntities || 0;
      dtuExp += m.stats?.totalDTUs || 0;
    }
    for (const m of imp) {
      entImp += m.stats?.entities?.added || 0;
      dtuImp += m.stats?.dtus?.added || 0;
    }

    const sorted = all.sort((a, b) => {
      try { return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(); }
      catch (err) { console.debug('[state-migration] sort date parse failed', err?.message); return 0; }
    });
    const last = sorted.length > 0 ? sorted[0] : null;

    return {
      ok: true,
      metrics: {
        totalMigrations: all.length,
        totalExports: exp.length,
        totalImports: imp.length,
        completedMigrations: all.filter(m => m.status === "completed").length,
        failedMigrations: all.filter(m => m.status === "failed").length,
        totalEntitiesExported: entExp,
        totalEntitiesImported: entImp,
        totalDTUsExported: dtuExp,
        totalDTUsImported: dtuImp,
        lastMigrationId: last?.migrationId || null,
        lastMigrationAt: last?.startedAt || null,
        lastMigrationStatus: last?.status || null,
      },
    };
  } catch {
    return { ok: true, metrics: { totalMigrations: 0, totalExports: 0, totalImports: 0,
      completedMigrations: 0, failedMigrations: 0, totalEntitiesExported: 0,
      totalEntitiesImported: 0, totalDTUsExported: 0, totalDTUsImported: 0,
      lastMigrationId: null, lastMigrationAt: null, lastMigrationStatus: null } };
  }
}
