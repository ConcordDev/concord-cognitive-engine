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
import {
  isDtuProtected,
  protectDtuInStore,
  unprotectDtuInStore,
} from '../lib/dtu-protection.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "forget") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function getSTATE() { return globalThis._concordSTATE || null; }

// ── Constants ───────────────────────────────────────────────────────────────

// Sprint 32 — DTU growth rate is ~1,429/hr in early operation; the
// previous defaults of 6h × 50/cycle = 200 tombstones/day could not
// keep up with that flow (170:1 deficit). New defaults are tunable via
// env so the operator can dial them without a rebuild:
//   FORGETTING_INTERVAL_MS     30 min  (was 6h)
//   MAX_FORGET_PER_CYCLE       500     (was 50)
//
// Math check at the new defaults: 48 cycles/day × 500 = 24,000
// tombstones/day vs ~34,000 created/day. Still a deficit, but the
// archive hook (lib/dtu-archive.js, runs every 30 min) handles the
// remainder by moving old DTUs out of RAM before forgetting ever has
// to look at them. The two systems are complementary, not redundant:
// archive protects MEMORY (offload cold rows), forgetting protects
// KNOWLEDGE (tombstone unimportant rows).
const FORGETTING_INTERVAL_MS = parseInt(
  process.env.FORGETTING_INTERVAL_MS || String(30 * 60 * 1000), 10,
);
const DEFAULT_THRESHOLD = 0.15;

// ── Hardware-Derived Constants ──────────────────────────────────────────────
// 2GB backend container, ~1.2-1.5GB available for DTU storage
// At 5-8KB/DTU: ceiling is 150,000-240,000 DTUs
// Target steady state: 60-70% of ceiling to leave headroom
const DTU_MEMORY_CEILING = parseInt(process.env.DTU_MEMORY_CEILING || "170000", 10);
const DTU_TARGET_RATIO = parseFloat(process.env.DTU_TARGET_RATIO || "0.65"); // 65% of ceiling
const DTU_TARGET_COUNT = Math.round(DTU_MEMORY_CEILING * DTU_TARGET_RATIO); // ~110,500
// Max DTUs to forget per cycle to prevent batch-delete lag.
const MAX_FORGET_PER_CYCLE = parseInt(process.env.MAX_FORGET_PER_CYCLE || "500", 10);
// Second-chance / CLOCK-style grace window: a DTU that crosses below the
// forget threshold isn't tombstoned in the same cycle it's first found low.
// It gets GRACE_CYCLES real (non-dry-run) cycles to recover (e.g. via a
// fresh citation/access bumping retentionScore back up) before it's
// actually forgotten.
const GRACE_CYCLES = parseInt(process.env.FORGETTING_GRACE_CYCLES || "3", 10);

// ── Module State ────────────────────────────────────────────────────────────

let _timer = null;
let _threshold = DEFAULT_THRESHOLD;
let _lastRun = null;
let _lastResult = null;
let _lifetimeForgotten = 0;
let _lifetimeTombstones = 0;
// Advances by 1 on every real (non-dry-run) runForgettingCycle call. Pure
// bookkeeping for the grace-window mechanism below — not a general clock.
let _cycleCount = 0;

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
  // Explicit "permanent record" assertion. `isDtuProtected` unions the flag
  // vocabularies that were previously incompatible: this file honored only
  // `_pinned`, while server.js#demoteToArchive honored only
  // `protected`/`immutable`/`seedOrigin`. A DTU protected through either one
  // (or through the archive tags, or the structured `dtu.protection` record)
  // is now honored by both. See lib/dtu-protection.js.
  (dtu) => isDtuProtected(dtu),
];

function isProtected(dtu) {
  return PROTECTION_RULES.some(rule => {
    try { return rule(dtu); } catch (err) { console.debug('[forgetting-engine] protection rule check failed', err?.message); return false; }
  });
}

// ── Retention Scoring ───────────────────────────────────────────────────────

function countChildren(dtuId, STATE) {
  // Fast path: the runForgettingCycle hoists a child-index map into
  // globalThis._forgettingChildIndex for the duration of one cycle. Outside
  // a cycle this falls back to the O(N) scan (preserves test behavior).
  const pre = globalThis._forgettingChildIndex;
  if (pre && pre.has(dtuId)) return pre.get(dtuId);
  if (pre) return 0; // cycle is running for some other purpose; treat as 0
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

export async function runForgettingCycle(dryRun = false, opts = {}) {
  if (_cycleRunning) return { ok: false, error: "Cycle already running" };
  _cycleRunning = true;

  try {
    const STATE = getSTATE();
    // Duck-type, not `instanceof Map`: STATE.dtus is a write-through store
    // object (server.js createDTUStore) once wired, not a literal Map — this
    // guard used to make the forgetting cycle silently inert at runtime
    // (only tests, which install a real Map, ever reached the body below).
    // Activating this cycle for real — i.e. fixing this guard — was an
    // explicit, separate, owner-authorized decision (not a side effect of a
    // mechanical type-check fix): the retention scoring, hard protections
    // (axioms/mega/sovereign/constitutional/breakthrough/pain/repair/
    // highly-cited/pinned), 3-cycle grace window, and 50-per-cycle rate cap
    // above are the real safety rails this now runs under.
    if (!STATE?.dtus || typeof STATE.dtus.get !== "function") {
      return { ok: false, error: "STATE not available" };
    }

    const candidates = [];
    const allDTUs = Array.from(STATE.dtus.values());

    // Sprint 32 — child-index hoist. Previously countChildren() walked the
    // entire DTU list for every DTU (O(N^2) total per cycle). With N=1000
    // the cycle was blocking the event loop for 25-55s and tripping
    // heartbeat_block_slow on every run. Hoist the link scan up here so
    // retentionScore() (still called per-DTU) just reads from the map.
    const _childCounts = new Map();
    for (const d of allDTUs) {
      const parents = d.lineage?.parents;
      if (!Array.isArray(parents)) continue;
      for (const pId of parents) {
        _childCounts.set(pId, (_childCounts.get(pId) || 0) + 1);
      }
    }

    // Adaptive threshold: raise when over capacity to forget more aggressively
    const liveDTUs = allDTUs.filter(d => d.type !== "tombstone").length;
    const effectiveThreshold = liveDTUs > DTU_TARGET_COUNT
      ? Math.min(_threshold * (1 + (liveDTUs - DTU_TARGET_COUNT) / DTU_TARGET_COUNT), 0.5)
      : _threshold;

    // Grace-window bookkeeping only advances on real cycles — a dry-run
    // preview must never move a DTU closer to being forgotten.
    if (!dryRun) _cycleCount++;

    // Score all DTUs. Unprotected DTUs that drop below threshold don't go
    // straight to `candidates` (immediate tombstone) — they get a
    // second-chance grace window first (CLOCK/second-chance-eviction
    // style): the first cycle a DTU is found below threshold, it's given
    // `_graceUntil = _cycleCount + GRACE_CYCLES` and spared this cycle. If
    // it recovers above threshold on a later cycle (e.g. a fresh citation),
    // `_graceUntil` is cleared — clean slate, no partial credit. If it's
    // still below threshold once `_cycleCount` reaches `_graceUntil`, THEN
    // it's added to `candidates` for the existing forgetDTU path below.
    // Dry runs report every currently-below-threshold DTU (independent of
    // grace state) since they're a preview, not a mutation.
    globalThis._forgettingChildIndex = _childCounts;
    try {
      for (const dtu of allDTUs) {
        if (dtu.type === "tombstone") continue;
        const score = retentionScore(dtu, STATE);
        dtu._retentionScore = score;

      if (isProtected(dtu)) continue; // protected DTUs never enter the grace mechanism

      const belowThreshold = score < effectiveThreshold;

      if (dryRun) {
        if (belowThreshold) candidates.push({ dtu, score });
        continue;
      }

      if (belowThreshold) {
        if (dtu._graceUntil == null) {
          // First time crossing below threshold — start the grace window.
          dtu._graceUntil = _cycleCount + GRACE_CYCLES;
        } else if (_cycleCount >= dtu._graceUntil) {
          // Still below threshold once the grace window has elapsed.
          candidates.push({ dtu, score });
        }
        // else: still within its grace window — wait for a later cycle.
      } else if (dtu._graceUntil != null) {
        // Recovered above threshold during grace — clear it.
        delete dtu._graceUntil;
      }
      }
    } finally {
      globalThis._forgettingChildIndex = null;
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
    // Sprint 32 — yield to the event loop every YIELD_EVERY tombstones so
    // a 500-tombstone cycle doesn't block the loop for ~30s straight
    // (pre-fix: heartbeat_block_slow module=forgetting ms=47733 at the
    // OLD 50/cycle; at 500/cycle that would scale to ~8 minutes of pure
    // main-loop block). Each forgetDTU is mostly a SQLite write plus a
    // small in-memory mutation, so 25 per batch is plenty small for the
    // event loop to handle a few HTTP requests between batches.
    const YIELD_EVERY = 25;
    const _targets = candidates.slice(0, MAX_FORGET_PER_CYCLE);
    for (let i = 0; i < _targets.length; i++) {
      const { dtu, score } = _targets[i];
      try {
        const tombstone = await forgetDTU(dtu, STATE, `retention_score=${score.toFixed(4)}_below_threshold=${_threshold}`);
        forgotten.push({ id: dtu.id, tombstoneId: tombstone.id, score });
      } catch (_e) { logger.debug('emergent:forgetting-engine', 'skip on error', { error: _e?.message }); }
      if ((i + 1) % YIELD_EVERY === 0) {
        await new Promise((r) => {
          setImmediate(r);
        });
      }
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

    // Additive spaced-repetition scheduling pass (SM-2-inspired, see the
    // "Review Scheduling" section below). Pure bookkeeping — it never
    // changes the forget/keep decision made above. Only runs when a db
    // handle is supplied; legacy/dry-run/no-db callers silently skip it.
    if (opts?.db) {
      try {
        result.reviewScheduling = await runReviewSchedulingPass(opts.db, { now: Date.now() });
      } catch (_e) { logger.debug('emergent:forgetting-engine', 'review_scheduling_pass_failed', { error: _e?.message }); }
    }

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

// ── Review Scheduling (SM-2-inspired) ──────────────────────────────────────
//
// A spaced-repetition SCHEDULING layer on top of retentionScore above. It
// does NOT reimplement the decay math — it decides WHEN a DTU is next
// re-scored and widens/narrows that interval using SM-2's real update rules
// (SuperMemo-2 / Anki). This is additive bookkeeping, backed by migration
// 353's `dtu_review_schedule` table; it never changes what runForgettingCycle
// decides to forget or keep.
//
// "Successful recall" signal: retentionScore (called unmodified, below)
// still clears the module's current forgetting threshold (`_threshold`) —
// i.e. the same score/threshold pairing runForgettingCycle already trusts to
// decide forget-vs-keep, reused here rather than inventing a second signal
// (e.g. a separate citation/access log). "Failed recall" is the inverse —
// the DTU has faded below the line and gets re-checked sooner.
//
// SM-2's real ease-factor update is
//   EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02))
// for a 0-5 quality grade q. Because the signal above is a binary pass/fail
// (not a graded 0-5 recall quality), this is deliberately simplified to a
// flat +0.1 nudge on success / -0.2 on failure — clamped to SM-2's real
// canonical bounds [1.3, 3.0]. Interval growth on success is SM-2's exact
// formula (interval *= easeFactor); failure resets to SM-2's canonical
// short relearn interval (1 day).

const REVIEW_EASE_START = 2.5;          // SM-2 canonical starting ease factor
const REVIEW_EASE_FLOOR = 1.3;          // SM-2 canonical floor
const REVIEW_EASE_CEILING = 3.0;        // ceiling for the simplified binary variant
const REVIEW_EASE_SUCCESS_DELTA = 0.1;
const REVIEW_EASE_FAILURE_DELTA = -0.2;
const REVIEW_INTERVAL_START_DAYS = 1;   // SM-2 canonical starting interval
const REVIEW_INTERVAL_RELEARN_DAYS = 1; // SM-2 canonical relearn interval on failure
const MAX_REVIEW_PER_PASS = parseInt(process.env.MAX_REVIEW_PER_PASS || "200", 10);

// Idempotent: inserts the default row only if `dtuId` has none yet. A brand
// new schedule row is immediately due (next_review_due = now).
export function ensureReviewScheduled(db, dtuId) {
  if (!db || !dtuId) return { ok: false, error: "db and dtuId required" };
  try {
    const now = Date.now();
    db.prepare(`
      INSERT OR IGNORE INTO dtu_review_schedule
        (dtu_id, ease_factor, interval_days, next_review_due, last_reviewed_at, review_count)
      VALUES (?, ?, ?, ?, NULL, 0)
    `).run(dtuId, REVIEW_EASE_START, REVIEW_INTERVAL_START_DAYS, now);
    return { ok: true, dtuId };
  } catch (_e) {
    logger.debug('emergent:forgetting-engine', 'ensure_review_scheduled_failed', { dtuId, error: _e?.message });
    return { ok: false, error: _e?.message };
  }
}

export function dueDtuIds(db, now = Date.now()) {
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT dtu_id FROM dtu_review_schedule WHERE next_review_due <= ? ORDER BY next_review_due ASC
    `).all(now);
    return rows.map(r => r.dtu_id);
  } catch (_e) {
    logger.debug('emergent:forgetting-engine', 'due_dtu_ids_failed', { error: _e?.message });
    return [];
  }
}

// The core scheduling step. Reuses retentionScore unmodified, then applies
// the SM-2-inspired update above to grow/shrink this DTU's review interval.
export function reviewDtu(db, dtuId, now = Date.now()) {
  if (!db || !dtuId) return { ok: false, error: "db and dtuId required" };

  try {
    const STATE = getSTATE();
    const dtu = STATE?.dtus?.get(dtuId);
    if (!dtu) return { ok: false, error: "DTU not found", dtuId };

    ensureReviewScheduled(db, dtuId);
    const row = db.prepare(`SELECT * FROM dtu_review_schedule WHERE dtu_id = ?`).get(dtuId);
    if (!row) return { ok: false, error: "schedule row missing after ensure", dtuId };

    // The existing, unmodified decay math is the sole source of the score.
    const score = retentionScore(dtu, STATE);
    const success = score >= _threshold;

    let easeFactor = row.ease_factor;
    let intervalDays = row.interval_days;

    if (success) {
      intervalDays = intervalDays * easeFactor;
      easeFactor = Math.min(REVIEW_EASE_CEILING, easeFactor + REVIEW_EASE_SUCCESS_DELTA);
    } else {
      intervalDays = REVIEW_INTERVAL_RELEARN_DAYS;
      easeFactor = Math.max(REVIEW_EASE_FLOOR, easeFactor + REVIEW_EASE_FAILURE_DELTA);
    }

    const nextReviewDue = now + intervalDays * 86400000;
    const reviewCount = row.review_count + 1;

    db.prepare(`
      UPDATE dtu_review_schedule
      SET ease_factor = ?, interval_days = ?, next_review_due = ?, last_reviewed_at = ?, review_count = ?
      WHERE dtu_id = ?
    `).run(easeFactor, intervalDays, nextReviewDue, now, reviewCount, dtuId);

    return { ok: true, dtuId, score, success, easeFactor, intervalDays, nextReviewDue, reviewCount };
  } catch (_e) {
    logger.debug('emergent:forgetting-engine', 'review_dtu_failed', { dtuId, error: _e?.message });
    return { ok: false, error: _e?.message, dtuId };
  }
}

// Additive pass: ensures every live DTU has a schedule row, then reviews
// whichever ones are currently due (capped at MAX_REVIEW_PER_PASS per pass
// to bound cost, mirroring MAX_FORGET_PER_CYCLE's role above). Never throws.
export async function runReviewSchedulingPass(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const STATE = getSTATE();
  // Duck-type, matching runForgettingCycle's guard fix above.
  if (!STATE?.dtus || typeof STATE.dtus.get !== "function") return { ok: false, reason: "state_not_available" };

  const now = opts.now ?? Date.now();

  try {
    // Sprint 32 - batched row-ensure. Pre-fix: a per-DTU
    // db.prepare(INSERT OR IGNORE).run() in a loop over every live DTU
    // (20k+ DTUs) was the dominant cost of the forgetting cycle
    // (heartbeat_block_slow module=forgetting ms=47733). At 0.5-2ms per
    // sync SQLite write, 20k inserts = 10-40s of main-loop block. The
    // new path: collect missing dtus, then a SINGLE INSERT OR IGNORE
    // VALUES (?,...), (?,...), ... with placeholders for all of them in
    // one transaction. SQLite turns that into one fsync and one WAL
    // append instead of 20k. Total cost: ms range, not tens of seconds.
    const liveIds = [];
    for (const dtu of STATE.dtus.values()) {
      if (dtu.type === "tombstone") continue;
      liveIds.push(dtu.id);
    }
    if (liveIds.length > 0) {
      const placeholders = liveIds.map(() => "(?, ?, ?, ?, NULL, 0)").join(", ");
      const params = [];
      for (const id of liveIds) {
        params.push(id, REVIEW_EASE_START, REVIEW_INTERVAL_START_DAYS, now);
      }
      db.prepare(`INSERT OR IGNORE INTO dtu_review_schedule (dtu_id, ease_factor, interval_days, next_review_due, last_reviewed_at, review_count) VALUES ${placeholders}`).run(...params);
    }

    const due = dueDtuIds(db, now).slice(0, MAX_REVIEW_PER_PASS);
    let reviewed = 0;
    let succeeded = 0;
    for (const dtuId of due) {
      const outcome = reviewDtu(db, dtuId, now);
      if (outcome.ok) {
        reviewed++;
        if (outcome.success) succeeded++;
      }
    }

    return { ok: true, dueCount: due.length, reviewedCount: reviewed, succeededCount: succeeded };
  } catch (_e) {
    logger.debug('emergent:forgetting-engine', 'review_scheduling_pass_failed', { error: _e?.message });
    return { ok: false, reason: "pass_failed", error: _e?.message };
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

// Pin a DTU so no retention/consolidation/dedupe path may remove it.
//
// This used to mutate `dtu._pinned` on the in-memory object and stop there.
// `STATE.dtus` is a write-through store whose `set()` is the ONLY code path
// that writes SQLite (lib/dtu-store.js), so a pin made that way was lost on
// the next restart — the exact opposite of what "pinned" claims. It now goes
// through `protectDtuInStore`, which writes both legacy flags plus a
// full-payload SHA-256 integrity anchor and then persists via `set()`.
export function protectDTU(dtuId, opts = {}) {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: false, error: "STATE not available" };
  const r = protectDtuInStore(STATE.dtus, dtuId, {
    reason: opts.reason || "pinned",
    source: opts.source || "forgetting-engine",
    ...opts,
  });
  if (!r.ok) {
    return { ok: false, error: r.reason === "dtu_not_found" ? "DTU not found" : "STATE not available" };
  }
  return { ok: true, dtuId, pinned: true, contentSha256: r.contentSha256, persisted: true };
}

export function unprotectDTU(dtuId) {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: false, error: "STATE not available" };
  const r = unprotectDtuInStore(STATE.dtus, dtuId);
  if (!r.ok) {
    return { ok: false, error: r.reason === "dtu_not_found" ? "DTU not found" : "STATE not available" };
  }
  // `r.protected` stays true for a DTU that is ALSO immutable/seed-origin —
  // releasing an explicit pin never overrides those.
  return { ok: true, dtuId, pinned: false, stillProtected: r.protected, persisted: true };
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

// `helpers` was destructured here and never referenced — the signature
// implied a dependency this module does not have. STATE is genuinely used
// below. Callers still pass both; extra arguments are ignored.
export function init({ STATE } = {}) {
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
