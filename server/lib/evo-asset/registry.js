// server/lib/evo-asset/registry.js
// EvoAsset registry: register assets, track interactions, query for
// evolution candidates.
//
// Every registered asset is a row in `evo_assets`. The canonical asset
// state lives in an Atlas DTU (linked via `canonical_dtu_id`) once
// promoted through the 5-stage quality pipeline. Pre-promotion, the
// registry row IS the source of truth for the candidate.

import crypto from "crypto";

/**
 * Register a new asset in the registry. Idempotent on (source, source_id).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {string} opts.kind          'mesh' | 'texture' | 'material' | 'hdri' | 'sprite'
 * @param {string} opts.source        'kenney' | 'polyhaven' | 'ambientcg' | 'os3a' | 'sketchfab' | 'authored' | 'evolved'
 * @param {string} [opts.sourceId]    upstream id (e.g. polyhaven asset slug)
 * @param {string} opts.localPath     where the file lives on disk
 * @param {string} [opts.category]
 * @param {string[]} [opts.tags]
 * @param {number} [opts.qualityLevel] starting quality level (0-10), default 0
 * @returns {{ id: string, created: boolean }}
 */
export function registerAsset(db, opts) {
  if (!opts.kind || !opts.source || !opts.localPath) {
    throw new Error("evo-asset: kind, source, localPath required");
  }

  // Dedup via (source, source_id) for sourced assets, or local_path for
  // authored/evolved variants.
  if (opts.sourceId) {
    const existing = db.prepare(`
      SELECT id FROM evo_assets WHERE source = ? AND source_id = ?
    `).get(opts.source, opts.sourceId);
    if (existing) return { id: existing.id, created: false };
  } else {
    const existing = db.prepare(`
      SELECT id FROM evo_assets WHERE local_path = ?
    `).get(opts.localPath);
    if (existing) return { id: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO evo_assets (
      id, kind, source, source_id, local_path, category, tags_json, quality_level
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.kind,
    opts.source,
    opts.sourceId ?? null,
    opts.localPath,
    opts.category ?? null,
    JSON.stringify(opts.tags ?? []),
    Math.max(0, Math.min(10, Math.floor(opts.qualityLevel ?? 0))),
  );
  return { id, created: true };
}

/**
 * Record an interaction with an asset. Increments interaction_points and
 * appends a row to the audit log.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} assetId
 * @param {object} actor       { kind: 'user'|'npc'|'system', id?: string }
 * @param {string} action      free-text action label (e.g. 'view', 'use', 'craft_with')
 * @param {number} [weight]    interaction points to add, default 1.0
 */
export function recordInteraction(db, assetId, actor, action, weight = 1.0) {
  const w = Math.max(0, Number(weight) || 1.0);
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO evo_asset_interactions (id, asset_id, actor_kind, actor_id, action, weight)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), assetId, actor.kind, actor.id ?? null, action, w);

    db.prepare(`
      UPDATE evo_assets
         SET interaction_points = interaction_points + ?,
             last_interacted_at = unixepoch()
       WHERE id = ?
    `).run(Math.round(w), assetId);
  });
  tx();
}

/**
 * Compute evolution_score for an asset and write it back. Score combines
 * recent interaction velocity with a recency bias, and decays the longer
 * an asset goes without interaction. Used by the scheduler to pick
 * candidates worth refining.
 */
export function recomputeEvolutionScore(db, assetId) {
  const row = db.prepare(`SELECT * FROM evo_assets WHERE id = ?`).get(assetId);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);

  // Sum interaction weights in the last 7 days. Recent activity drives
  // evolution far more than total cumulative use.
  const weekAgo = now - 7 * 24 * 3600;
  const recent = db.prepare(`
    SELECT SUM(weight) AS s FROM evo_asset_interactions
     WHERE asset_id = ? AND ts >= ?
  `).get(assetId, weekAgo)?.s ?? 0;

  // Decay: if last_interacted_at is far in the past, the score drops.
  const lastTs = row.last_interacted_at ?? row.created_at;
  const daysSilent = (now - lastTs) / 86400;
  const decay = Math.exp(-daysSilent / 14); // e-fold every two weeks

  // Quality cap: evolution slows as assets approach max quality.
  const qualitySlowdown = 1 - row.quality_level / 11;

  const score = recent * decay * qualitySlowdown;

  db.prepare(`UPDATE evo_assets SET evolution_score = ? WHERE id = ?`).run(score, assetId);
  return score;
}

/**
 * Pick top N evolution candidates — assets with the highest evolution_score
 * that are not at max quality and not archived.
 *
 * @returns {Array<object>} asset rows
 */
export function selectEvolutionCandidates(db, limit = 5) {
  return db.prepare(`
    SELECT * FROM evo_assets
     WHERE archived_at IS NULL
       AND quality_level < 10
     ORDER BY evolution_score DESC
     LIMIT ?
  `).all(limit);
}

/**
 * Look up the best-quality canonical asset for a given (source, sourceId)
 * pair. Used by the frontend loader to resolve an asset reference to its
 * current best version. Returns null if the asset is not registered or
 * has no promoted version yet (caller falls back to the base local_path).
 */
export function resolveCurrentBest(db, { source, sourceId }) {
  const row = db.prepare(`
    SELECT a.*,
           v.local_path AS version_path,
           v.version_number,
           v.pass_kind
      FROM evo_assets a
 LEFT JOIN evo_asset_versions v
        ON v.asset_id = a.id AND v.promoted = 1
     WHERE a.source = ? AND a.source_id = ? AND a.archived_at IS NULL
     ORDER BY v.version_number DESC NULLS LAST
     LIMIT 1
  `).get(source, sourceId);
  if (!row) return null;
  return {
    assetId: row.id,
    qualityLevel: row.quality_level,
    canonicalPath: row.version_path ?? row.local_path,
    pass: row.pass_kind ?? null,
  };
}

/**
 * Append a new version row after a refinement pass. The version is NOT
 * promoted yet — promotion happens after the quality gate verdict.
 *
 * @returns {string} version id
 */
export function appendVersion(db, assetId, opts) {
  const id = crypto.randomUUID();
  const next = (db.prepare(`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM evo_asset_versions WHERE asset_id = ?
  `).get(assetId)?.n) ?? 1;
  db.prepare(`
    INSERT INTO evo_asset_versions
      (id, asset_id, version_number, pass_kind, local_path, diff_summary, gate_dtu_id, gate_verdict)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, assetId, next, opts.passKind, opts.localPath,
    opts.diffSummary ?? null, opts.gateDtuId ?? null, opts.gateVerdict ?? null,
  );
  return id;
}

/**
 * Mark a version as promoted (passed the 5-stage gate) and bump the asset's
 * quality level + last_evolved_at.
 */
export function promoteVersion(db, versionId) {
  const v = db.prepare(`SELECT * FROM evo_asset_versions WHERE id = ?`).get(versionId);
  if (!v) throw new Error(`unknown_version:${versionId}`);
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE evo_asset_versions SET promoted = 1, promoted_at = unixepoch() WHERE id = ?
    `).run(versionId);
    db.prepare(`
      UPDATE evo_assets
         SET quality_level = MIN(10, quality_level + 1),
             last_evolved_at = unixepoch()
       WHERE id = ?
    `).run(v.asset_id);
  });
  tx();
}
