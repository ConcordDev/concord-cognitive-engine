// server/lib/dtu-cognitive-schema.js
//
// Cognitive enrichment layer on DTUs: causal graph, outcomes, applicability,
// invalidation, and usage history. Backed by dtu_cognitive_meta (mig 440).

// Per-db caches. Every DTU write goes through enrichDtuOnWrite, and a CPU
// profile of the CI load test (2026-09-30) put ~6s of main-thread time in a
// sqlite_master lookup + fresh prepare per call. Only a positive "table
// exists" is cached, so a table a later migration creates is still found.
const _tableReady = new WeakMap();
const _stmts = new WeakMap();

function tableReady(db) {
  if (!db) return false;
  if (_tableReady.get(db)) return true;
  try {
    const ok = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dtu_cognitive_meta'`).get();
    if (ok) _tableReady.set(db, true);
    return ok;
  } catch {
    return false;
  }
}

function stmt(db, sql) {
  let m = _stmts.get(db);
  if (!m) { m = new Map(); _stmts.set(db, m); }
  let st = m.get(sql);
  if (!st) { st = db.prepare(sql); m.set(sql, st); }
  return st;
}

function parseJson(val, fallback) {
  if (val == null) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * @returns {object|null}
 */
export function getCognitiveMeta(db, dtuId) {
  if (!db || !dtuId || !tableReady(db)) return null;
  try {
    const row = stmt(db, `SELECT * FROM dtu_cognitive_meta WHERE dtu_id = ?`).get(dtuId);
    if (!row) return null;
    return {
      dtuId: row.dtu_id,
      causalParents: parseJson(row.causal_parents_json, []),
      causalChildren: parseJson(row.causal_children_json, []),
      outcomes: parseJson(row.outcomes_json, []),
      applicability: parseJson(row.applicability_json, {}),
      invalidation: parseJson(row.invalidation_json, null),
      usageHistory: parseJson(row.usage_history_json, []),
      confidence: row.confidence ?? 1,
      updatedAt: row.updated_at,
      invalidated: !!row.invalidation_json,
    };
  } catch {
    return null;
  }
}

/**
 * Merge-patch cognitive metadata for a DTU.
 */
export function upsertCognitiveMeta(db, dtuId, patch = {}) {
  if (!db || !dtuId || !tableReady(db)) return { ok: false, reason: "no_table" };

  const existing = getCognitiveMeta(db, dtuId) || {
    causalParents: [],
    causalChildren: [],
    outcomes: [],
    applicability: {},
    invalidation: null,
    usageHistory: [],
    confidence: 1,
  };

  const next = {
    causalParents: patch.causalParents ?? existing.causalParents,
    causalChildren: patch.causalChildren ?? existing.causalChildren,
    outcomes: patch.outcomes ?? existing.outcomes,
    applicability: { ...existing.applicability, ...(patch.applicability || {}) },
    invalidation: patch.invalidation !== undefined ? patch.invalidation : existing.invalidation,
    usageHistory: patch.usageHistory ?? existing.usageHistory,
    confidence: patch.confidence ?? existing.confidence,
  };

  try {
    stmt(db, `
      INSERT INTO dtu_cognitive_meta (
        dtu_id, causal_parents_json, causal_children_json, outcomes_json,
        applicability_json, invalidation_json, usage_history_json, confidence, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dtu_id) DO UPDATE SET
        causal_parents_json = excluded.causal_parents_json,
        causal_children_json = excluded.causal_children_json,
        outcomes_json = excluded.outcomes_json,
        applicability_json = excluded.applicability_json,
        invalidation_json = excluded.invalidation_json,
        usage_history_json = excluded.usage_history_json,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(
      dtuId,
      JSON.stringify(next.causalParents),
      JSON.stringify(next.causalChildren),
      JSON.stringify(next.outcomes),
      JSON.stringify(next.applicability),
      next.invalidation ? JSON.stringify(next.invalidation) : null,
      JSON.stringify(next.usageHistory),
      next.confidence,
      nowIso(),
    );
    return { ok: true, dtuId, meta: next };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Record a causal edge parent → child (bidirectional bookkeeping).
 */
export function linkCausalEdge(db, parentId, childId, kind = "caused") {
  if (!parentId || !childId) return { ok: false, reason: "missing_ids" };

  const parent = getCognitiveMeta(db, parentId) || {};
  const child = getCognitiveMeta(db, childId) || {};
  const pChildren = [...(parent.causalChildren || [])];
  const cParents = [...(child.causalParents || [])];

  if (!pChildren.find((e) => e.id === childId)) {
    pChildren.push({ id: childId, kind });
  }
  if (!cParents.find((e) => e.id === parentId)) {
    cParents.push({ id: parentId, kind });
  }

  upsertCognitiveMeta(db, parentId, { causalChildren: pChildren });
  upsertCognitiveMeta(db, childId, { causalParents: cParents });
  return { ok: true, parentId, childId, kind };
}

/**
 * Append an outcome record (verification result, side-effect, etc.).
 */
export function recordOutcome(db, dtuId, outcome) {
  const meta = getCognitiveMeta(db, dtuId);
  const outcomes = [...(meta?.outcomes || []), { ...outcome, at: nowIso() }];
  return upsertCognitiveMeta(db, dtuId, { outcomes });
}

/**
 * Mark a DTU invalidated (stale/contradicted/superseded).
 */
export function invalidateDtu(db, dtuId, { reason, supersededBy } = {}) {
  return upsertCognitiveMeta(db, dtuId, {
    invalidation: { reason: reason || "stale", supersededBy: supersededBy || null, at: nowIso() },
    confidence: 0,
  });
}

/**
 * Append usage event; trims to last N entries.
 */
export function recordUsage(db, dtuId, event, { maxHistory = 50 } = {}) {
  const meta = getCognitiveMeta(db, dtuId);
  const history = [...(meta?.usageHistory || []), { ...event, at: nowIso() }];
  while (history.length > maxHistory) history.shift();
  return upsertCognitiveMeta(db, dtuId, { usageHistory: history });
}

/**
 * Auto-enrich cognitive metadata when a DTU is persisted.
 * Derives applicability from tags/source; never overwrites existing causal graph.
 */
export function enrichDtuOnWrite(db, dtu) {
  if (!db || !dtu?.id || !tableReady(db)) return { ok: false, reason: "no_table" };

  const existing = getCognitiveMeta(db, dtu.id);
  const tags = Array.isArray(dtu.tags) ? dtu.tags : [];
  const source = typeof dtu.source === "string" ? dtu.source : "";
  const domain = source.split(".")[0] || dtu.domain || null;

  const applicability = {
    ...(existing?.applicability || {}),
    tags: [...new Set([...(existing?.applicability?.tags || []), ...tags])],
    domains: domain
      ? [...new Set([...(existing?.applicability?.domains || []), domain])]
      : (existing?.applicability?.domains || []),
  };

  const patch = { applicability };
  if (dtu.confidence != null) patch.confidence = dtu.confidence;
  if (dtu.outcome) {
    patch.outcomes = [
      ...(existing?.outcomes || []),
      { key: "write_outcome", value: dtu.outcome, at: nowIso() },
    ].slice(-20);
  }

  return upsertCognitiveMeta(db, dtu.id, patch);
}

/**
 * Filter recall pack rows — drop invalidated cognitive memories.
 */
export function filterRecallPackByCognitiveMeta(db, recallPack) {
  if (!recallPack?.ok || !db) return recallPack;

  const filterRows = (rows) => (rows || []).filter((r) => {
    const meta = getCognitiveMeta(db, r.id);
    return !meta?.invalidated;
  });

  return {
    ...recallPack,
    recent: filterRows(recallPack.recent),
    pinned: filterRows(recallPack.pinned),
    cognitiveFiltered: true,
  };
}
export function filterApplicableDtus(db, dtuIds, context = {}) {
  if (!db || !dtuIds?.length) return [];

  const applicable = [];
  for (const id of dtuIds) {
    const meta = getCognitiveMeta(db, id);
    if (meta?.invalidated) continue;

    const rules = meta?.applicability || {};
    if (rules.domains?.length && context.domain && !rules.domains.includes(context.domain)) continue;
    if (rules.tags?.length && context.tags?.length) {
      const overlap = rules.tags.some((t) => context.tags.includes(t));
      if (!overlap) continue;
    }
    if (rules.minConfidence != null && (meta?.confidence ?? 1) < rules.minConfidence) continue;

    applicable.push({ dtuId: id, meta, confidence: meta?.confidence ?? 1 });
  }

  return applicable.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Link DTU to a repository symbol/route/migration ref.
 */
export function linkDtuToRepo(db, dtuId, repoRef, linkKind = "references", meta = null) {
  if (!db || !dtuId || !repoRef) return { ok: false, reason: "invalid_args" };
  try {
    const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dtu_repo_links'`).get();
    if (!has) return { ok: false, reason: "no_table" };
    db.prepare(`
      INSERT OR IGNORE INTO dtu_repo_links (dtu_id, repo_ref, link_kind, meta_json)
      VALUES (?, ?, ?, ?)
    `).run(dtuId, repoRef, linkKind, meta ? JSON.stringify(meta) : null);
    return { ok: true, dtuId, repoRef, linkKind };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * List repo refs linked to a DTU.
 */
export function getDtuRepoLinks(db, dtuId) {
  if (!db || !dtuId) return [];
  try {
    return db.prepare(`
      SELECT repo_ref, link_kind, meta_json, created_at
      FROM dtu_repo_links WHERE dtu_id = ?
    `).all(dtuId).map((r) => ({
      repoRef: r.repo_ref,
      linkKind: r.link_kind,
      meta: r.meta_json ? JSON.parse(r.meta_json) : null,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
