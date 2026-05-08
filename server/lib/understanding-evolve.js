// server/lib/understanding-evolve.js
//
// The compounding loop for the Understanding Engine.
//
// Migration 120 shipped the artifact. Migration 121 added evolution
// columns. This module is what actually makes the substrate "develop a
// mind over time" — a primitive that gathers evidence, evaluates
// promotion, consolidates related understandings into higher-order
// ones, and exposes lineage so the trajectory of any one understanding
// is queryable.
//
// Mirrors `server/lib/evo-asset/scheduler.js`: candidate → version →
// gate verdict → promote (or dispute, or hold). Adds a consolidation
// path on top — the MEGA→HYPER analog for understandings, where N
// related understandings collapse into one.
//
// Royalty integration: `composer_user_id` lets citations of an
// understanding flow CC back to its author through the existing
// royalty cascade — understanding becomes economically rewarded.
//
// Heartbeat: `understanding-evolve` runs evaluatePromotion +
// consolidation passes on a clock; idempotent; safe to skip ticks.

import crypto from "crypto";

// ── Tunables (env-overridable) ────────────────────────────────────────────

export const PROMOTE_MIN_EVIDENCE     = Number(process.env.CONCORD_UND_PROMOTE_MIN_EVIDENCE) || 3;
export const PROMOTE_MIN_CONFIDENCE   = Number(process.env.CONCORD_UND_PROMOTE_MIN_CONFIDENCE) || 0.7;
export const DISPUTE_MAX_CONTRADICT   = Number(process.env.CONCORD_UND_DISPUTE_MAX_CONTRADICT) || 3;
export const CONSOLIDATE_MIN_CHILDREN = Number(process.env.CONCORD_UND_CONSOLIDATE_MIN) || 5;
export const CONSOLIDATE_MAX_CHILDREN = Number(process.env.CONCORD_UND_CONSOLIDATE_MAX) || 20;
export const ARCHIVE_AFTER_DAYS       = Number(process.env.CONCORD_UND_ARCHIVE_DAYS) || 90;

export const STATUS_CANDIDATE = "candidate";
export const STATUS_PROMOTED  = "promoted";
export const STATUS_DISPUTED  = "disputed";
export const STATUS_ARCHIVED  = "archived";

// ── Helpers ────────────────────────────────────────────────────────────────

function uid(prefix = "und") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function safeJSON(v, fallback) {
  try { return JSON.stringify(v); } catch { return JSON.stringify(fallback); }
}

function parseJSON(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// ── Evidence intake ────────────────────────────────────────────────────────

/**
 * Record a piece of evidence against an understanding. `kind='confirm'`
 * bumps evidence_count; `kind='contradict'` bumps contradiction_count.
 *
 * Idempotency: pass an `evidenceRefId` to dedupe — passing the same
 * refId twice is a no-op. (Useful when evidence comes from a webhook
 * or an event stream that may replay.)
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.understandingId
 * @param {'confirm'|'contradict'} opts.kind
 * @param {string} [opts.evidenceRefId] — idempotency key
 * @param {object} [opts.payload]       — claim / source / reasoning to attach
 */
export function recordEvidence(db, { understandingId, kind, evidenceRefId, payload } = {}) {
  if (!db || !understandingId || !["confirm", "contradict"].includes(kind)) {
    return { ok: false, error: "invalid_args" };
  }

  // Idempotency: tag the bump with refId in the model_json.evidenceLog
  // so we don't double-count replays.
  try {
    const row = db.prepare(`SELECT model_json, evidence_count, contradiction_count FROM understandings WHERE id = ?`).get(understandingId);
    if (!row) return { ok: false, error: "not_found" };

    const model = parseJSON(row.model_json, {});
    const log = Array.isArray(model.evidenceLog) ? model.evidenceLog : [];
    if (evidenceRefId && log.some((e) => e.refId === evidenceRefId)) {
      return { ok: true, idempotent: true, skipped: "duplicate_refId" };
    }
    log.push({
      refId: evidenceRefId || null,
      kind,
      payload: payload || null,
      at: nowISO(),
    });
    model.evidenceLog = log;

    const updateSql = kind === "confirm"
      ? `UPDATE understandings
         SET evidence_count = evidence_count + 1,
             last_evidence_at = ?,
             model_json = ?
         WHERE id = ?`
      : `UPDATE understandings
         SET contradiction_count = contradiction_count + 1,
             last_evidence_at = ?,
             model_json = ?
         WHERE id = ?`;
    db.prepare(updateSql).run(nowISO(), safeJSON(model, {}), understandingId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "record_failed" };
  }
}

// ── Promotion gate ─────────────────────────────────────────────────────────

/**
 * Evaluate one understanding for promotion / dispute / hold.
 *
 * Returns the decision but DOES NOT apply it — caller (the heartbeat or
 * the macro) flips status with `applyPromotion`. Splitting decision
 * from action makes the gate easier to test and lets a future "human
 * review" path intercept high-confidence promotions before they land.
 */
export function evaluatePromotion(db, understandingId) {
  if (!db || !understandingId) return { ok: false, error: "invalid_args" };
  const row = db.prepare(`
    SELECT id, status, confidence, evidence_count, contradiction_count, consistency
    FROM understandings WHERE id = ?
  `).get(understandingId);
  if (!row) return { ok: false, error: "not_found" };

  // Already in a terminal-ish state: no auto-flip.
  if (row.status === STATUS_PROMOTED) return { ok: true, decision: "hold", reason: "already_promoted" };
  if (row.status === STATUS_ARCHIVED) return { ok: true, decision: "hold", reason: "archived" };

  // Dispute: too many contradictions, regardless of evidence.
  if (row.contradiction_count >= DISPUTE_MAX_CONTRADICT) {
    return { ok: true, decision: "dispute", reason: "contradiction_count_exceeded" };
  }

  // Inconsistent at the model level → can't promote, but not yet disputed.
  if (row.consistency === "inconsistent") {
    return { ok: true, decision: "hold", reason: "model_inconsistent" };
  }

  // Promote: enough confirming evidence, confidence floor met, and the
  // contradiction-to-evidence ratio is sane.
  const evidenceOk = row.evidence_count >= PROMOTE_MIN_EVIDENCE;
  const confidenceOk = row.confidence >= PROMOTE_MIN_CONFIDENCE;
  const ratioOk = row.contradiction_count === 0
    || row.evidence_count / row.contradiction_count >= 3;

  if (evidenceOk && confidenceOk && ratioOk) {
    return { ok: true, decision: "promote", reason: "thresholds_met" };
  }

  return {
    ok: true,
    decision: "hold",
    reason: !evidenceOk ? "insufficient_evidence"
          : !confidenceOk ? "confidence_below_floor"
          : "contradiction_ratio_unhealthy",
  };
}

/**
 * Apply a promotion decision returned by `evaluatePromotion`. Idempotent.
 */
export function applyPromotion(db, understandingId, decision) {
  if (!db || !understandingId) return { ok: false, error: "invalid_args" };
  if (!["promote", "dispute"].includes(decision)) {
    return { ok: true, applied: false, reason: "no_action" };
  }
  try {
    if (decision === "promote") {
      const r = db.prepare(`
        UPDATE understandings
        SET status = ?, promoted_at = ?, generation = generation + 1
        WHERE id = ? AND status != ?
      `).run(STATUS_PROMOTED, nowISO(), understandingId, STATUS_PROMOTED);
      return { ok: true, applied: r.changes > 0, decision };
    }
    const r = db.prepare(`
      UPDATE understandings
      SET status = ?
      WHERE id = ? AND status NOT IN (?, ?)
    `).run(STATUS_DISPUTED, understandingId, STATUS_DISPUTED, STATUS_ARCHIVED);
    return { ok: true, applied: r.changes > 0, decision };
  } catch (e) {
    return { ok: false, error: e?.message || "apply_failed" };
  }
}

// ── Consolidation (the MEGA→HYPER analog for understandings) ──────────────

/**
 * Consolidate N related understandings into a single meta-understanding.
 * The children get `consolidated_into_id` set to the new parent's id.
 *
 * Children are selected by the caller (typically clustering on shared
 * subject_id, or shared entities, or shared lineage). This function
 * just does the bookkeeping — the cluster picker is a separate concern.
 *
 * The resulting parent's model is the union of children's claims,
 * relations, and entities, with duplicates collapsed by text/id.
 *
 * Returns { ok, parentId, childCount }.
 */
export function consolidateUnderstandings(db, childIds, opts = {}) {
  if (!db || !Array.isArray(childIds) || childIds.length < CONSOLIDATE_MIN_CHILDREN) {
    return { ok: false, error: "insufficient_children" };
  }
  if (childIds.length > CONSOLIDATE_MAX_CHILDREN) childIds = childIds.slice(0, CONSOLIDATE_MAX_CHILDREN);

  const placeholders = childIds.map(() => "?").join(",");
  const children = db.prepare(`
    SELECT id, subject_id, subject_kind, model_json, consistency, confidence,
           generation, evidence_count, contradiction_count, composer_user_id
    FROM understandings WHERE id IN (${placeholders})
  `).all(...childIds);
  if (children.length === 0) return { ok: false, error: "no_children_found" };

  // Union the models. Cheap dedupe by stable string keys.
  const entityMap = new Map();
  const claimMap  = new Map();
  const relationMap = new Map();
  const constraintMap = new Map();
  let evidenceTotal = 0;
  let contradictionTotal = 0;
  let confidenceSum = 0;
  let maxGeneration = 0;
  const composers = new Set();

  for (const c of children) {
    const model = parseJSON(c.model_json, {});
    for (const e of (model.entities || [])) {
      if (e?.id && !entityMap.has(e.id)) entityMap.set(e.id, e);
    }
    for (const cl of (model.claims || [])) {
      const key = (cl.text || "").toLowerCase().trim();
      if (key && !claimMap.has(key)) claimMap.set(key, { ...cl, id: `cl_consol_${claimMap.size}` });
    }
    for (const r of (model.relations || [])) {
      const key = `${r.from}|${r.kind}|${r.to}`;
      if (!relationMap.has(key)) relationMap.set(key, r);
    }
    for (const ct of (model.constraints || [])) {
      const key = (ct.statement || "").toLowerCase().trim();
      if (key && !constraintMap.has(key)) constraintMap.set(key, ct);
    }
    evidenceTotal += c.evidence_count || 0;
    contradictionTotal += c.contradiction_count || 0;
    confidenceSum += c.confidence || 0;
    if ((c.generation || 0) > maxGeneration) maxGeneration = c.generation;
    if (c.composer_user_id) composers.add(c.composer_user_id);
  }

  const parentId = uid("und");
  const composedAt = nowISO();
  const subjectKind = opts.subjectKind || children[0].subject_kind || "claims";
  const subjectId = opts.subjectId ?? null;
  const consistency = contradictionTotal === 0 ? "consistent"
                    : contradictionTotal > evidenceTotal ? "inconsistent"
                    : "partial";
  const confidence = Math.max(0, Math.min(1, (confidenceSum / children.length) || 0));

  const parentModel = {
    entities: [...entityMap.values()],
    claims: [...claimMap.values()],
    relations: [...relationMap.values()],
    constraints: [...constraintMap.values()],
    consolidatedFrom: children.map((c) => c.id),
    composers: [...composers],
    reasoningTrace: { method: "consolidation", childCount: children.length },
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO understandings (
        id, subject_id, subject_kind, model_json, consistency,
        contradictions_json, gaps_json, predictions_json,
        confidence, composer, composed_at, expires_at,
        generation, evidence_count, contradiction_count, status,
        composer_user_id
      ) VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', ?, 'deterministic', ?,
                datetime('now', '+90 days'), ?, ?, ?, ?, ?)
    `).run(
      parentId, subjectId, subjectKind, safeJSON(parentModel, {}),
      consistency, confidence, composedAt,
      maxGeneration + 1, evidenceTotal, contradictionTotal,
      STATUS_CANDIDATE,
      composers.size === 1 ? [...composers][0] : null,
    );
    db.prepare(`
      UPDATE understandings SET consolidated_into_id = ?
      WHERE id IN (${placeholders})
    `).run(parentId, ...childIds);
  });

  try {
    tx();
    return { ok: true, parentId, childCount: children.length };
  } catch (e) {
    return { ok: false, error: e?.message || "consolidate_failed" };
  }
}

/**
 * Discover candidate cluster groups for consolidation: understandings
 * that share a subject_id, are still candidates, not yet consolidated,
 * and have enough siblings to meet CONSOLIDATE_MIN_CHILDREN.
 */
export function findConsolidationCandidates(db, { subjectKind, limit = 5 } = {}) {
  if (!db) return [];
  const rows = db.prepare(`
    SELECT subject_id, subject_kind, COUNT(*) AS n
    FROM understandings
    WHERE subject_id IS NOT NULL
      AND consolidated_into_id IS NULL
      AND status = 'candidate'
      ${subjectKind ? "AND subject_kind = ?" : ""}
    GROUP BY subject_id, subject_kind
    HAVING n >= ?
    ORDER BY n DESC
    LIMIT ?
  `).all(...(subjectKind ? [subjectKind, CONSOLIDATE_MIN_CHILDREN, limit] : [CONSOLIDATE_MIN_CHILDREN, limit]));
  return rows.map((r) => ({ subjectId: r.subject_id, subjectKind: r.subject_kind, count: r.n }));
}

// ── Lineage ────────────────────────────────────────────────────────────────

/**
 * Walk the parent_understanding_id chain from the given id to the root.
 * Each row represents an "earlier draft" of the current mind on this
 * subject. Useful for audit + the "how did this understanding develop?"
 * surface in the UI.
 */
export function getUnderstandingLineage(db, id, maxDepth = 50) {
  if (!db || !id) return [];
  const out = [];
  let current = id;
  let depth = 0;
  while (current && depth < maxDepth) {
    const row = db.prepare(`
      SELECT id, parent_understanding_id, generation, status,
             evidence_count, contradiction_count, confidence, composed_at, promoted_at
      FROM understandings WHERE id = ?
    `).get(current);
    if (!row) break;
    out.push(row);
    current = row.parent_understanding_id;
    depth++;
  }
  return out;
}

// ── Heartbeat tick handler ────────────────────────────────────────────────

/**
 * One pass of the evolution cycle. Idempotent. Safe to skip ticks.
 *
 * - Sweeps `candidate` understandings; calls `evaluatePromotion`;
 *   applies decisions.
 * - Picks the top consolidation cluster (if any) and consolidates it.
 * - Archives understandings older than ARCHIVE_AFTER_DAYS that never
 *   reached `promoted` (housekeeping).
 *
 * Returns a summary; never throws.
 */
export function runUnderstandingEvolutionTick(db, opts = {}) {
  if (!db) return { ok: false, error: "no_db" };
  const summary = { promoted: 0, disputed: 0, consolidated: 0, archived: 0 };

  // 1. Promotion sweep — candidates with at least 1 evidence beat,
  //    cap so a single tick doesn't process the whole table.
  const PROMO_BATCH = opts.promoBatch || 50;
  let candidates = [];
  try {
    candidates = db.prepare(`
      SELECT id FROM understandings
      WHERE status = 'candidate'
        AND (evidence_count > 0 OR contradiction_count > 0)
      ORDER BY last_evidence_at DESC
      LIMIT ?
    `).all(PROMO_BATCH);
  } catch { candidates = []; }

  for (const c of candidates) {
    try {
      const dec = evaluatePromotion(db, c.id);
      if (!dec.ok) continue;
      if (dec.decision === "promote" || dec.decision === "dispute") {
        const a = applyPromotion(db, c.id, dec.decision);
        if (a.applied) summary[dec.decision === "promote" ? "promoted" : "disputed"]++;
      }
    } catch { /* per-row tolerance */ }
  }

  // 2. Consolidation — at most one cluster per tick to keep work bounded.
  try {
    const cands = findConsolidationCandidates(db, { limit: 1 });
    if (cands.length > 0) {
      const { subjectId, subjectKind } = cands[0];
      const ids = db.prepare(`
        SELECT id FROM understandings
        WHERE subject_id = ? AND subject_kind = ?
          AND consolidated_into_id IS NULL
          AND status = 'candidate'
        ORDER BY composed_at ASC
        LIMIT ?
      `).all(subjectId, subjectKind, CONSOLIDATE_MAX_CHILDREN).map((r) => r.id);
      if (ids.length >= CONSOLIDATE_MIN_CHILDREN) {
        const r = consolidateUnderstandings(db, ids, { subjectId, subjectKind });
        if (r.ok) summary.consolidated = r.childCount;
      }
    }
  } catch { /* tolerance */ }

  // 3. Archive housekeeping.
  try {
    const r = db.prepare(`
      UPDATE understandings
      SET status = 'archived'
      WHERE status = 'candidate'
        AND composed_at < datetime('now', '-' || ? || ' days')
    `).run(ARCHIVE_AFTER_DAYS);
    summary.archived = r.changes || 0;
  } catch { /* tolerance */ }

  return { ok: true, ...summary };
}

// ── Convenience read paths ─────────────────────────────────────────────────

/**
 * List the user's promoted understandings (the "mind portfolio").
 * Closes the royalty loop conceptually: these are the artifacts whose
 * citations should pay this user.
 */
export function listPromotedByComposer(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, subject_id, subject_kind, generation, evidence_count,
             contradiction_count, confidence, promoted_at
      FROM understandings
      WHERE composer_user_id = ? AND status = 'promoted'
      ORDER BY promoted_at DESC
      LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}

export function getEvolutionStats(db) {
  if (!db) return null;
  try {
    return db.prepare(`
      SELECT
        SUM(CASE WHEN status='candidate' THEN 1 ELSE 0 END) AS candidates,
        SUM(CASE WHEN status='promoted'  THEN 1 ELSE 0 END) AS promoted,
        SUM(CASE WHEN status='disputed'  THEN 1 ELSE 0 END) AS disputed,
        SUM(CASE WHEN status='archived'  THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN consolidated_into_id IS NOT NULL THEN 1 ELSE 0 END) AS consolidated_children,
        MAX(generation) AS max_generation,
        AVG(confidence) AS avg_confidence
      FROM understandings
    `).get();
  } catch { return null; }
}
