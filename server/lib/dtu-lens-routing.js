// server/lib/dtu-lens-routing.js
//
// DTU→lens routing (job a). Today every dtus row carries lens_id='unknown'
// (mig 024 added the column + default but nothing populates it), so a lens
// free-text-searches the whole flat pool instead of pulling its own grounding.
// This resolves a lens_id for a DTU from its kind/type + tags + meta (reusing the
// lens-manifest tag→lens index), and backfills the existing corpus. Then
// retrieval can filter by lens_id (the 2026 RAG best-practice: metadata-filter
// before search to cut noise) — connective-tissue already filters by lens_id; this
// makes the field meaningful + extends the filter to cross-lens-discovery.
//
// Pure resolver + a guarded, idempotent backfill. Kill-switch CONCORD_DTU_ROUTING
// (off → everything stays 'unknown' = today's flat pool, byte-identical retrieval).

import { findByTags } from "./lens-manifest.js";

// Internal kinds that are never groundable to a player lens (mirror the
// EXCLUDED_KINDS / INTERNAL_KINDS sets in server.js).
const EXCLUDED_KINDS = new Set([
  "shadow", "pattern_shadow", "repair_record", "royalty_record", "session_context",
  "linguistic_map", "audit_trail", "system_metric", "repair_dtu", "client_error",
]);

// kind/type → owning lens. Covers the live gameplay corpus types + the
// formal-science reasoning seeds (the standout thin-on-deep formal lenses).
export const KIND_LENS_MAP = Object.freeze({
  // gameplay corpus (observed in the live dtus table)
  material: "crafting", blueprint: "crafting", recipe: "cooking",
  fighting_style_recipe: "combat", spell_recipe: "glyph-spells",
  skill: "skills", skill_recipe: "skills", trivia_answer: "trivia",
  codex: "codex", knowledge: "knowledge", forge_app: "forge", photo: "gallery",
  // formal-science reasoning fuel (math / physics / control-theory→robotics/ml)
  fixed_point: "math", zeta: "math", manifold: "math", theorem: "math", proof: "math",
  dynamical_system: "robotics", control_theory: "robotics",
  physics: "physics", quantum: "physics", mechanics: "physics",
  algorithm: "code", ml_model: "ml", dataset: "ml",
});

const isStr = (v) => typeof v === "string" && v.length > 0;

/**
 * Resolve the owning lens for a DTU. Order: explicit meta.lens/domain →
 * kind/type map → manifest tag match → null (unroutable → stays 'unknown').
 * @returns {string|null} lensId
 */
export function resolveLensId({ type, kind, tags, meta } = {}) {
  const k = String(kind || type || "").toLowerCase();
  if (k && EXCLUDED_KINDS.has(k)) return null;

  const m = meta && typeof meta === "object" ? meta : {};
  if (isStr(m.lens)) return m.lens;
  if (isStr(m.domain)) return m.domain;

  if (k && KIND_LENS_MAP[k]) return KIND_LENS_MAP[k];

  const tagList = Array.isArray(tags)
    ? tags
    : (isStr(tags) ? tags.split(/[,\s]+/) : []);
  if (tagList.length) {
    const hits = findByTags(tagList.map((t) => String(t).toLowerCase()).filter(Boolean));
    if (hits && hits.length && hits[0].matchCount > 0) return hits[0].lensId;
  }
  return null;
}

/** Inverse: the kind/types a lens owns (for a lens-scoped search filter). */
export function lensOwnedKinds(lensId) {
  if (!lensId) return [];
  return Object.entries(KIND_LENS_MAP).filter(([, v]) => v === lensId).map(([k]) => k);
}

/**
 * Backfill lens_id on rows still 'unknown'/NULL. Path-independent — catches DTUs
 * from any create path. Idempotent (only touches unrouted rows), batched.
 * Reads type + tags(data/tags_json) + meta(data) to resolve.
 * @returns {{ok:boolean, scanned:number, stamped:number, byLens:object, reason?:string}}
 */
export function backfillLensIds(db, { limit = 5000 } = {}) {
  if (process.env.CONCORD_DTU_ROUTING === "0") return { ok: true, scanned: 0, stamped: 0, byLens: {}, disabled: true };
  if (!db) return { ok: false, reason: "no_db", scanned: 0, stamped: 0, byLens: {} };
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, type, data FROM dtus WHERE lens_id IS NULL OR lens_id = 'unknown' LIMIT ?`
    ).all(limit);
  } catch (e) {
    return { ok: false, reason: String(e?.message || e), scanned: 0, stamped: 0, byLens: {} };
  }
  const update = (() => { try { return db.prepare(`UPDATE dtus SET lens_id = ? WHERE id = ?`); } catch { return null; } })();
  if (!update) return { ok: false, reason: "no_update_stmt", scanned: rows.length, stamped: 0, byLens: {} };

  const byLens = {};
  let stamped = 0;
  for (const r of rows) {
    let meta = {};
    let tags = [];
    try {
      const parsed = r.data ? JSON.parse(r.data) : {};
      meta = parsed && typeof parsed === "object" ? parsed : {};
      tags = Array.isArray(meta.tags) ? meta.tags : (Array.isArray(parsed.tags) ? parsed.tags : []);
    } catch { /* malformed data → resolve on type alone */ }
    const lensId = resolveLensId({ type: r.type, tags, meta });
    if (!lensId) continue;
    try { update.run(lensId, r.id); stamped++; byLens[lensId] = (byLens[lensId] || 0) + 1; }
    catch { /* per-row best-effort */ }
  }
  return { ok: true, scanned: rows.length, stamped, byLens };
}

export default resolveLensId;
