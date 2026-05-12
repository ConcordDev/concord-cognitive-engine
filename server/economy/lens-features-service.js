/**
 * Lens Features Service — Seed, query, and manage the lens feature specifications.
 *
 * Bridges the static LENS_FEATURES registry with the database lens_features table,
 * provides search/browse endpoints, and computes cross-lens feature statistics.
 */

import { randomUUID } from "crypto";

function uid(prefix = "lf") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Seed all lens features into the database.
 * Idempotent — skips features that already exist.
 */
export function seedLensFeatures(db, lensFeatures) {
  const insertFeature = db.prepare(`
    INSERT OR IGNORE INTO lens_features
      (id, lens_id, feature_id, name, description, category,
       integrations_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSummary = db.prepare(`
    INSERT OR REPLACE INTO lens_feature_summary
      (lens_id, lens_number, category, feature_count,
       economic_integrations_json, emergent_access, bot_access,
       usb_integration, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = nowISO();
  let seeded = 0;
  let skipped = 0;

  const runSeed = db.transaction(() => {
    for (const [lensId, lens] of Object.entries(lensFeatures)) {
      // Seed individual features
      for (const feature of lens.features) {
        const result = insertFeature.run(
          uid("lf"),
          lensId,
          feature.id,
          feature.name,
          feature.description,
          feature.category,
          JSON.stringify(feature.integrations || []),
          feature.status || "active",
          now,
          now,
        );
        if (result.changes > 0) seeded++;
        else skipped++;
      }

      // Seed summary
      insertSummary.run(
        lensId,
        lens.lensNumber,
        lens.category,
        lens.featureCount,
        JSON.stringify(lens.economicIntegrations || []),
        lens.emergentAccess ? 1 : 0,
        lens.botAccess ? 1 : 0,
        lens.usbIntegration ? 1 : 0,
        now,
        now,
      );
    }
  });

  runSeed();

  return { ok: true, seeded, skipped, total: seeded + skipped };
}

/**
 * Get all features for a specific lens.
 */
export function getLensFeatures(db, lensId) {
  const features = db.prepare(
    "SELECT * FROM lens_features WHERE lens_id = ? ORDER BY rowid"
  ).all(lensId);

  if (features.length === 0) {
    return { ok: false, error: "lens_not_found_or_no_features" };
  }

  const summary = db.prepare(
    "SELECT * FROM lens_feature_summary WHERE lens_id = ?"
  ).get(lensId);

  return {
    ok: true,
    lensId,
    features: features.map(formatFeatureRow),
    summary: summary ? formatSummaryRow(summary) : null,
    count: features.length,
  };
}

/**
 * Get a specific feature by lens and feature ID.
 */
export function getFeature(db, lensId, featureId) {
  const feature = db.prepare(
    "SELECT * FROM lens_features WHERE lens_id = ? AND feature_id = ?"
  ).get(lensId, featureId);

  if (!feature) return { ok: false, error: "feature_not_found" };
  return { ok: true, feature: formatFeatureRow(feature) };
}

/**
 * Browse features across all lenses with filters.
 */
export function browseFeatures(db, {
  lensId, category, status, search,
  limit = 50, offset = 0,
} = {}) {
  let sql = "SELECT * FROM lens_features WHERE 1=1";
  const params = [];

  if (lensId) {
    sql += " AND lens_id = ?";
    params.push(lensId);
  }
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (search) {
    sql += " AND (name LIKE ? OR description LIKE ? OR feature_id LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as c");
  const total = db.prepare(countSql).get(...params)?.c || 0;

  sql += " ORDER BY lens_id, rowid LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params).map(formatFeatureRow);

  return { ok: true, items, total, limit, offset };
}

/**
 * Get all lens feature summaries.
 */
export function getAllLensFeatureSummaries(db) {
  const summaries = db.prepare(
    // @select-star-ok: lens_feature_summary — admin endpoint returns full summary
    "SELECT * FROM lens_feature_summary ORDER BY lens_number"
  ).all();

  return {
    ok: true,
    summaries: summaries.map(formatSummaryRow),
    count: summaries.length,
  };
}

/**
 * Get feature statistics across all lenses.
 */
export function getFeatureStats(db) {
  const totalFeatures = db.prepare(
    "SELECT COUNT(*) as c FROM lens_features"
  ).get()?.c || 0;

  const totalLenses = db.prepare(
    "SELECT COUNT(DISTINCT lens_id) as c FROM lens_features"
  ).get()?.c || 0;

  const byCategory = db.prepare(
    "SELECT category, COUNT(*) as count FROM lens_features GROUP BY category ORDER BY count DESC"
  ).all();

  const byStatus = db.prepare(
    "SELECT status, COUNT(*) as count FROM lens_features GROUP BY status"
  ).all();

  const emergentLenses = db.prepare(
    "SELECT COUNT(*) as c FROM lens_feature_summary WHERE emergent_access = 1"
  ).get()?.c || 0;

  const botLenses = db.prepare(
    "SELECT COUNT(*) as c FROM lens_feature_summary WHERE bot_access = 1"
  ).get()?.c || 0;

  const usbLenses = db.prepare(
    "SELECT COUNT(*) as c FROM lens_feature_summary WHERE usb_integration = 1"
  ).get()?.c || 0;

  return {
    ok: true,
    totalFeatures,
    totalLenses,
    byCategory,
    byStatus,
    emergentLenses,
    botLenses,
    usbLenses,
  };
}

/**
 * Search features across all lenses.
 */
export function searchFeatures(db, query) {
  const q = `%${query}%`;
  const features = db.prepare(
    `SELECT * FROM lens_features
     WHERE name LIKE ? OR description LIKE ? OR feature_id LIKE ? OR lens_id LIKE ?
     ORDER BY lens_id, rowid
     LIMIT 100`
  ).all(q, q, q, q);

  return {
    ok: true,
    results: features.map(formatFeatureRow),
    count: features.length,
  };
}

// ── Formatters ──────────────────────────────────────────────────────

function safeJsonParse(str) {
  try { return JSON.parse(str || "[]"); } catch (err) { console.debug('[lens-features-service] JSON parse failed', err?.message); return []; }
}

function formatFeatureRow(row) {
  return {
    id: row.id,
    lensId: row.lens_id,
    featureId: row.feature_id,
    name: row.name,
    description: row.description,
    category: row.category,
    integrations: safeJsonParse(row.integrations_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatSummaryRow(row) {
  return {
    lensId: row.lens_id,
    lensNumber: row.lens_number,
    category: row.category,
    featureCount: row.feature_count,
    economicIntegrations: safeJsonParse(row.economic_integrations_json),
    emergentAccess: !!row.emergent_access,
    botAccess: !!row.bot_access,
    usbIntegration: !!row.usb_integration,
  };
}
