/**
 * System: Selective Forgetting Engine
 *
 * The immune system for knowledge bloat. Prunes the DTU lattice on a 6-hour
 * cycle using retention scoring. Low-value DTUs are gracefully compressed into
 * tombstones (never deleted). Children are reparented. The system remembers
 * what it forgot and why.
 *
 * Protection rules ensure core axioms, mega syntheses, sovereign-created,
 * constitutional, breakthrough, pain memory, repair, highly-referenced, and
 * pinned DTUs are never forgotten.
 *
 * All state in module-level structures. Silent failure. Additive only.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { feltPeakBonus } from '../lib/felt-per.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "forget") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function getSTATE() { return globalThis._concordSTATE || null; }

// ── Constants ───────────────────────────────────────────────────────────────

const FORGETTING_INTERVAL_MS = parseInt(process.env.FORGETTING_INTERVAL_MS || String(6 * 3600000), 10);
const DEFAULT_THRESHOLD = 0.15;

// ── Hardware-Derived Constants ──────────────────────────────────────────────
// 2GB backend container, ~1.2-1.5GB available for DTU storage
// At 5-8KB/DTU: ceiling is 150,000-240,000 DTUs
// Target steady state: 60-70% of ceiling to leave headroom
const DTU_MEMORY_CEILING = parseInt(process.env.DTU_MEMORY_CEILING || "170000", 10);
const DTU_TARGET_RATIO = parseFloat(process.env.DTU_TARGET_RATIO || "0.65"); // 65% of ceiling
const DTU_TARGET_COUNT = Math.round(DTU_MEMORY_CEILING * DTU_TARGET_RATIO); // ~110,500
// Max DTUs to forget per cycle to prevent batch-delete lag
const MAX_FORGET_PER_CYCLE = parseInt(process.env.MAX_FORGET_PER_CYCLE || "50", 10);

// ── Module State ────────────────────────────────────────────────────────────

let _timer = null;
let _threshold = DEFAULT_THRESHOLD;
let _lastRun = null;
let _lastResult = null;
let _lifetimeForgotten = 0;
let _lifetimeTombstones = 0;

// ── Protection Rules ────────────────────────────────────────────────────────

const PROTECTION_RULES = [
  (dtu) => dtu.tier === "core",
  (dtu) => dtu.tier === "mega",
  (dtu) => dtu.source === "sovereign" || dtu.source === "user",
  (dtu) => dtu.tags?.includes("constitutional"),
  (dtu) => dtu.tags?.includes("breakthrough"),
  (dtu) => dtu.tags?.includes("pain_memory"),
  (dtu) => dtu.tags?.includes("repair_cortex"),
  (dtu) => (dtu.lineage?.children?.length || 0) > 5,
  (dtu) => dtu._pinned === true,
];

function isProtected(dtu) {
  return PROTECTION_RULES.some(rule => {
    try { return rule(dtu); } catch (err) { console.debug('[forgetting-engine] protection rule check failed', err?.message); return false; }
  });
}

// ── Retention Scoring ───────────────────────────────────────────────────────

function countChildren(dtuId, STATE) {
  let count = 0;
  for (const d of STATE.dtus.values()) {
    if (d.lineage?.parents?.includes(dtuId)) count++;
  }
  return count;
}

function findChildDTUs(dtuId, STATE) {
  const children = [];
  for (const d of STATE.dtus.values()) {
    if (d.lineage?.parents?.includes(dtuId)) children.push(d);
  }
  return children;
}

export function retentionScore(dtu, STATE) {
  const now = Date.now();
  const age = now - new Date(dtu.createdAt || now).getTime();
  const ageDecay = Math.exp(-age / (90 * 86400000)); // 90-day half-life

  const childCount = countChildren(dtu.id, STATE);
  const lineageScore = Math.min(childCount / 10, 1.0);

  const lastAccessed = dtu._lastAccessed || dtu.updatedAt || dtu.createdAt;
  const recency = Math.exp(-(now - new Date(lastAccessed || now).getTime()) / (30 * 86400000));

  const authority = dtu.authority?.score || 0.5;

  const tierWeight = { core: 999, mega: 999, hyper: 0.9, regular: 0.5, shadow: 0.2 }[dtu.tier] || 0.3;

  const hypothesisBonus = dtu.tags?.includes("hypothesis_confirmed") ? 0.5 : 0;
  const sovereignBonus = (dtu.source === "sovereign" || dtu.source === "user") ? 0.3 : 0;

  // Wave 7 / A6 — emotional retention: a felt PEAK (a trauma, a triumph) outlives a
  // dull memory (duration neglect). Reads the felt-per stamped at the experience site.
  const emotionalBonus = feltPeakBonus(dtu.machine?.feltPer || dtu.feltPer);

  return (
    0.20 * ageDecay +
    0.25 * lineageScore +
    0.20 * recency +
    0.10 * authority +
    0.15 * tierWeight +
    0.05 * hypothesisBonus +
    0.05 * sovereignBonus +
    0.10 * emotionalBonus
  );
}

// ── Graceful Removal ────────────────────────────────────────────────────────

async function forgetDTU(dtu, STATE, reason) {
  const tombstone = {
    id: `tomb_${dtu.id}`,
    type: "tombstone",
    title: `Forgotten: ${dtu.human?.summary?.slice(0, 80) || dtu.id}`,
    human: { summary: `This DTU was gracefully forgotten. Reason: ${reason}` },
    machine: {
      originalId: dtu.id,
      originalTier: dtu.tier,
      originalTags: dtu.tags,
      retentionScore: dtu._retentionScore,
      forgottenAt: nowISO(),
      reason,
    },
    tags: ["tombstone", "forgetting_engine", ...(dtu.tags || []).slice(0, 5)],
    tier: "shadow",
    source: "forgetting_engine",
    authority: { model: "forgetting_engine", score: 0.3 },
    lineage: { parents: [], children: [] },
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  // Reparent children to grandparents
  const children = findChildDTUs(dtu.id, STATE);
  const parents = dtu.lineage?.parents || [];
  for (const child of children) {
    if (child.lineage?.parents) {
      child.lineage.parents = child.lineage.parents.filter(p => p !== dtu.id);
      child.lineage.parents.push(...parents);
    }
  }

  // Remove original, add tombstone
  STATE.dtus.delete(dtu.id);
  STATE.dtus.set(tombstone.id, tombstone);

  // Log as pain event
  if (typeof globalThis._concordAvoidanceLearning?.recordPain === "function") {
    try {
      globalThis._concordAvoidanceLearning.recordPain({
        trigger: "knowledge_loss",
        severity: 0.1,
        context: { dtuId: dtu.id, reason },
      });
    } catch (_e) { logger.debug('emergent:forgetting-engine', 'silent', { error: _e?.message }); }
  }

  return tombstone;
}

// ── Forgetting Cycle ────────────────────────────────────────────────────────

let _cycleRunning = false;

export async function runForgettingCycle(dryRun = false) {
  if (_cycleRunning) return { ok: false, error: "Cycle already running" };
  _cycleRunning = true;

  try {
    const STATE = getSTATE();
    if (!STATE?.dtus || !(STATE.dtus instanceof Map)) {
      return { ok: false, error: "STATE not available" };
    }

    const candidates = [];
    const allDTUs = Array.from(STATE.dtus.values());

    // Adaptive threshold: raise when over capacity to forget more aggressively
    const liveDTUs = allDTUs.filter(d => d.type !== "tombstone").length;
    const effectiveThreshold = liveDTUs > DTU_TARGET_COUNT
      ? Math.min(_threshold * (1 + (liveDTUs - DTU_TARGET_COUNT) / DTU_TARGET_COUNT), 0.5)
      : _threshold;

    // Score all DTUs
    for (const dtu of allDTUs) {
      if (dtu.type === "tombstone") continue;
      const score = retentionScore(dtu, STATE);
      dtu._retentionScore = score;

      if (score < effectiveThreshold && !isProtected(dtu)) {
        candidates.push({ dtu, score });
      }
    }

    candidates.sort((a, b) => a.score - b.score);

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        totalDTUs: allDTUs.length,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 50).map(c => ({
          id: c.dtu.id,
          title: c.dtu.human?.summary?.slice(0, 80) || c.dtu.id,
          tier: c.dtu.tier,
          score: c.score.toFixed(4),
        })),
        threshold: effectiveThreshold,
        baseThreshold: _threshold,
        liveDTUs,
        targetCount: DTU_TARGET_COUNT,
      };
    }

    // Execute forgetting
    const forgotten = [];
    for (const { dtu, score } of candidates.slice(0, MAX_FORGET_PER_CYCLE)) {
      try {
        const tombstone = await forgetDTU(dtu, STATE, `retention_score=${score.toFixed(4)}_below_threshold=${_threshold}`);
        forgotten.push({ id: dtu.id, tombstoneId: tombstone.id, score });
      } catch (_e) { logger.debug('emergent:forgetting-engine', 'skip on error', { error: _e?.message }); }
    }

    _lifetimeForgotten += forgotten.length;
    _lifetimeTombstones += forgotten.length;

    const result = {
      ok: true,
      timestamp: nowISO(),
      totalDTUs: allDTUs.length,
      candidateCount: candidates.length,
      forgottenCount: forgotten.length,
      forgotten: forgotten.slice(0, 20).map(f => ({ id: f.id, score: f.score.toFixed(4) })),
      threshold: effectiveThreshold,
      baseThreshold: _threshold,
      liveDTUs,
      targetCount: DTU_TARGET_COUNT,
    };

    _lastRun = nowISO();
    _lastResult = result;

    // Emit for dashboard
    if (typeof globalThis.realtimeEmit === "function") {
      globalThis.realtimeEmit("forgetting:cycle_complete", {
        forgottenCount: forgotten.length,
        totalDTUs: allDTUs.length - forgotten.length,
        tombstones: countTombstones(STATE),
        timestamp: nowISO(),
      });
    }

    return result;
  } finally {
    _cycleRunning = false;
  }
}

// ── Query Helpers ───────────────────────────────────────────────────────────

function countTombstones(STATE) {
  if (!STATE?.dtus) return 0;
  let count = 0;
  for (const d of STATE.dtus.values()) {
    if (d.type === "tombstone") count++;
  }
  return count;
}

export function getStatus() {
  const STATE = getSTATE();
  return {
    ok: true,
    running: !!_timer,
    threshold: _threshold,
    lastRun: _lastRun,
    nextRun: _lastRun ? new Date(new Date(_lastRun).getTime() + FORGETTING_INTERVAL_MS).toISOString() : null,
    lifetimeForgotten: _lifetimeForgotten,
    lifetimeTombstones: _lifetimeTombstones,
    tombstones: STATE ? countTombstones(STATE) : 0,
    interval: FORGETTING_INTERVAL_MS,
  };
}

export function getCandidates() {
  return runForgettingCycle(true);
}

export function protectDTU(dtuId) {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: false, error: "STATE not available" };
  const dtu = STATE.dtus.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };
  dtu._pinned = true;
  return { ok: true, dtuId, pinned: true };
}

export function unprotectDTU(dtuId) {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: false, error: "STATE not available" };
  const dtu = STATE.dtus.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };
  dtu._pinned = false;
  return { ok: true, dtuId, pinned: false };
}

export function setThreshold(value) {
  const v = parseFloat(value);
  if (isNaN(v) || v < 0 || v > 1) return { ok: false, error: "Threshold must be 0-1" };
  const old = _threshold;
  _threshold = v;
  return { ok: true, old, new: _threshold };
}

export function getHistory(limit = 20) {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: true, tombstones: [] };

  const tombstones = [];
  for (const d of STATE.dtus.values()) {
    if (d.type === "tombstone") tombstones.push(d);
  }

  tombstones.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    ok: true,
    tombstones: tombstones.slice(0, limit).map(t => ({
      id: t.id,
      originalId: t.machine?.originalId,
      title: t.title,
      tier: t.machine?.originalTier,
      score: t.machine?.retentionScore,
      forgottenAt: t.machine?.forgottenAt,
      reason: t.machine?.reason,
    })),
  };
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handleForgettingCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "forget-status":
      return getStatus();
    case "forget-candidates":
      return getCandidates();
    case "forget-protect":
      return protectDTU(parts[1]);
    case "forget-unprotect":
      return unprotectDTU(parts[1]);
    case "forget-threshold":
      return setThreshold(parts[1]);
    case "forget-run":
      return runForgettingCycle(false);
    case "forget-history":
      return getHistory(parseInt(parts[1] || "20", 10));
    default:
      return { ok: false, error: `Unknown forgetting command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

export function init({ STATE, helpers } = {}) {
  if (STATE) globalThis._concordSTATE = STATE;

  setTimeout(() => {
    _timer = setInterval(() => {
      runForgettingCycle().catch(e => logger.warn?.('[forgetting] cycle failed:', e?.message));
    }, FORGETTING_INTERVAL_MS);
    if (_timer.unref) _timer.unref();
  }, 120000); // 2 min after boot

  return { ok: true, interval: FORGETTING_INTERVAL_MS };
}

export function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
