/**
 * Marketplace Lens Service — Query, seed, and manage the 112-lens registry.
 *
 * Bridges the static registry definition with the database lens_registry table,
 * provides search/browse endpoints, and computes cross-lens citation economics.
 */

import { randomUUID } from "crypto";
import {
  MARKETPLACE_LENS_REGISTRY,
  LENS_CATEGORIES,
  REGISTRY_STATS,
  getLensById,
  getLensByNumber,
  getLensesByCategory,
  getLensesByClassification,
  getMarketplaceLenses,
  getLensCrossReferences,
  searchLenses,
  getRegistrySummary,
} from "../lib/marketplace-lens-registry.js";

function uid(prefix = "mlr") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Seed all 112 lenses into the marketplace_lens_registry table.
 * Idempotent — skips lenses that already exist.
 */
export function seedMarketplaceLensRegistry(db) {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO marketplace_lens_registry
      (id, lens_id, name, lens_number, category, classification, icon,
       sub_tabs_json, marketplace_dtus_json, economics_json,
       citation_rules_json, cross_lens_refs_json, unique_value,
       industries_disrupted_json, preview_strategy, protection_default,
       federation_tiers_json, layers_used_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = nowISO();
  let seeded = 0;
  let skipped = 0;

  const runSeed = db.transaction(() => {
    for (const lens of MARKETPLACE_LENS_REGISTRY) {
      const result = insertStmt.run(
        uid("mlr"),
        lens.id,
        lens.name,
        lens.lensNumber,
        lens.category,
        lens.classification,
        lens.icon,
        JSON.stringify(lens.subTabs || []),
        JSON.stringify(lens.marketplaceDTUs || []),
        JSON.stringify(lens.economics || {}),
        JSON.stringify(lens.citationRules || {}),
        JSON.stringify(lens.crossLensRefs || []),
        lens.uniqueValue || "",
        JSON.stringify(lens.industriesDisrupted || []),
        lens.previewStrategy || "structural_summary",
        lens.protectionDefault || "OPEN",
        JSON.stringify(lens.federationTiers || []),
        JSON.stringify(lens.layersUsed || []),
        now,
        now,
      );
      if (result.changes > 0) seeded++;
      else skipped++;
    }
  });

  runSeed();

  return {
    ok: true,
    seeded,
    skipped,
    total: MARKETPLACE_LENS_REGISTRY.length,
  };
}

/**
 * Get lens registry entry by lens_id from database.
 */
export function getMarketplaceLens(db, lensId) {
  const row = db.prepare(
    "SELECT * FROM marketplace_lens_registry WHERE lens_id = ?"
  ).get(lensId);

  if (!row) return { ok: false, error: "lens_not_found" };
  return { ok: true, lens: formatRow(row) };
}

/**
 * Browse marketplace lenses with filters.
 */
export function browseMarketplaceLenses(db, {
  category, classification, hasMarketplace, search,
  limit = 50, offset = 0,
} = {}) {
  let sql = "SELECT * FROM marketplace_lens_registry WHERE 1=1";
  const params = [];

  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  if (classification) {
    sql += " AND classification = ?";
    params.push(classification);
  }
  if (hasMarketplace) {
    sql += " AND marketplace_dtus_json != '[]'";
  }
  if (search) {
    sql += " AND (name LIKE ? OR unique_value LIKE ? OR lens_id LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as c");
  const total = db.prepare(countSql).get(...params)?.c || 0;

  sql += " ORDER BY lens_number ASC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params).map(formatRow);

  return { ok: true, items, total, limit, offset };
}

/**
 * Get all DTU types across all marketplace lenses.
 */
export function getAllDTUTypes(db) {
  const rows = db.prepare(
    "SELECT lens_id, name, marketplace_dtus_json FROM marketplace_lens_registry WHERE marketplace_dtus_json != '[]' ORDER BY lens_number"
  ).all();

  const dtuTypes = [];
  for (const row of rows) {
    const dtus = safeJsonParse(row.marketplace_dtus_json);
    for (const dtu of dtus) {
      dtuTypes.push({
        lensId: row.lens_id,
        lensName: row.name,
        type: dtu.type,
        description: dtu.description,
        priceMin: dtu.price?.min,
        priceMax: dtu.price?.max,
        priceUnit: dtu.price?.unit || "one-time",
      });
    }
  }

  return { ok: true, dtuTypes, count: dtuTypes.length };
}

/**
 * Get cross-lens citation map for a specific lens.
 */
export function getCitationMap(db, lensId) {
  const row = db.prepare(
    "SELECT * FROM marketplace_lens_registry WHERE lens_id = ?"
  ).get(lensId);

  if (!row) return { ok: false, error: "lens_not_found" };

  const refs = safeJsonParse(row.cross_lens_refs_json);
  const citationRules = safeJsonParse(row.citation_rules_json);

  // Single batched SELECT replaces the per-ref loop (was N+1).
  const crossRefs = [];
  if (Array.isArray(refs) && refs.length > 0) {
    const placeholders = refs.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT lens_id, name, category, classification FROM marketplace_lens_registry WHERE lens_id IN (${placeholders})`,
    ).all(...refs);
    // Preserve declaration order from the input refs array.
    const byId = new Map(rows.map(r => [r.lens_id, r]));
    for (const refId of refs) {
      const ref = byId.get(refId);
      if (ref) {
        crossRefs.push({
          lensId: ref.lens_id,
          name: ref.name,
          category: ref.category,
          classification: ref.classification,
        });
      }
    }
  }

  // Find lenses that reference this lens
  const inbound = db.prepare(
    "SELECT lens_id, name, category FROM marketplace_lens_registry WHERE cross_lens_refs_json LIKE ?"
  ).all(`%"${lensId}"%`);

  return {
    ok: true,
    lensId,
    lensName: row.name,
    citationRules,
    outboundReferences: crossRefs,
    inboundReferences: inbound.map(r => ({
      lensId: r.lens_id,
      name: r.name,
      category: r.category,
    })),
  };
}

/**
 * Get registry statistics.
 */
export function getMarketplaceRegistryStats() {
  return {
    ok: true,
    ...getRegistrySummary(),
    categories: LENS_CATEGORIES,
    registryVersion: REGISTRY_STATS.version,
    lastUpdated: REGISTRY_STATS.lastUpdated,
  };
}

// ── In-memory lookups (no DB needed) ────────────────────────────────────

export {
  getLensById,
  getLensByNumber,
  getLensesByCategory,
  getLensesByClassification,
  getMarketplaceLenses as getMarketplaceLensesStatic,
  getLensCrossReferences,
  searchLenses,
  getRegistrySummary,
  MARKETPLACE_LENS_REGISTRY,
  LENS_CATEGORIES,
  REGISTRY_STATS,
};

// ── Helpers ─────────────────────────────────────────────────────────────

function formatRow(row) {
  return {
    id: row.id,
    lensId: row.lens_id,
    name: row.name,
    lensNumber: row.lens_number,
    category: row.category,
    classification: row.classification,
    icon: row.icon,
    subTabs: safeJsonParse(row.sub_tabs_json),
    marketplaceDTUs: safeJsonParse(row.marketplace_dtus_json),
    economics: safeJsonParse(row.economics_json),
    citationRules: safeJsonParse(row.citation_rules_json),
    crossLensRefs: safeJsonParse(row.cross_lens_refs_json),
    uniqueValue: row.unique_value,
    industriesDisrupted: safeJsonParse(row.industries_disrupted_json),
    previewStrategy: row.preview_strategy,
    protectionDefault: row.protection_default,
    federationTiers: safeJsonParse(row.federation_tiers_json),
    layersUsed: safeJsonParse(row.layers_used_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (err) { console.debug('[marketplace-lens-service] JSON parse failed', err?.message); return []; }
}
