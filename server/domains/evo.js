// server/domains/evo.js
//
// Macros that expose the evo-asset registry to the frontend. The
// underlying tables (`evo_assets`, `evo_asset_versions`) have been
// silently accumulating data since migration 073 + 100, but until now
// no frontend surface could read them — meaning the procgen + evo
// cycle was invisible to players.
//
// Shape (all macros return `{ ok: true, ... }` or `{ ok: false, error }`):
//   evo.asset-stats           → totals by source + kind + recent promotions
//   evo.list-variants         → all versions of one asset_id, newest-first
//   evo.lineage-for           → ancestor chain ending in the seed
//   evo.recent-promotions     → last N globally-promoted variants
//
// All read-only — no write paths here. Promotion happens via the
// `evo-asset/scheduler.js` heartbeat.

export default function registerEvoMacros(registerLensAction) {
  registerLensAction("evo", "asset-stats", (ctx) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      const total = db.prepare(
        `SELECT COUNT(*) AS n FROM evo_assets WHERE archived_at IS NULL`
      ).get().n;
      const bySource = db.prepare(
        `SELECT source, COUNT(*) AS n FROM evo_assets WHERE archived_at IS NULL GROUP BY source ORDER BY n DESC`
      ).all();
      const byKind = db.prepare(
        `SELECT kind, COUNT(*) AS n FROM evo_assets WHERE archived_at IS NULL GROUP BY kind ORDER BY n DESC`
      ).all();
      const recentPromotions = db.prepare(`
        SELECT v.id AS version_id, v.asset_id, v.version_number, v.pass_kind,
               v.promoted_at, a.kind, a.source, a.source_id, a.category
          FROM evo_asset_versions v
          JOIN evo_assets a ON a.id = v.asset_id
         WHERE v.promoted = 1
         ORDER BY v.promoted_at DESC
         LIMIT 20
      `).all();
      return { ok: true, result: { total, bySource, byKind, recentPromotions } };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  registerLensAction("evo", "list-variants", (ctx, _artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      const assetId = String(params?.assetId || "");
      if (!assetId) return { ok: false, error: "assetId_required" };
      const asset = db.prepare(`SELECT * FROM evo_assets WHERE id = ?`).get(assetId);
      if (!asset) return { ok: false, error: "asset_not_found" };
      const versions = db.prepare(`
        SELECT id, version_number, pass_kind, local_path, promoted, gate_verdict,
               diff_summary, created_at, promoted_at
          FROM evo_asset_versions
         WHERE asset_id = ?
         ORDER BY version_number DESC
      `).all(assetId);
      return { ok: true, result: { asset, versions, totalVariants: versions.length } };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  registerLensAction("evo", "lineage-for", (ctx, _artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      const assetId = String(params?.assetId || "");
      if (!assetId) return { ok: false, error: "assetId_required" };
      const asset = db.prepare(`SELECT * FROM evo_assets WHERE id = ?`).get(assetId);
      if (!asset) return { ok: false, error: "asset_not_found" };
      // The lineage = all promoted versions of this asset in order, plus the
      // base asset row at depth 0. This is what the AssetLineageTree
      // component renders top-down.
      const promotedChain = db.prepare(`
        SELECT id, version_number, pass_kind, local_path, gate_verdict,
               diff_summary, created_at, promoted_at
          FROM evo_asset_versions
         WHERE asset_id = ? AND promoted = 1
         ORDER BY version_number ASC
      `).all(assetId);
      const lineage = [
        {
          depth: 0,
          isSeed: true,
          versionNumber: 0,
          source: asset.source,
          sourceId: asset.source_id,
          localPath: asset.local_path,
          createdAt: asset.created_at,
          qualityLevel: asset.quality_level,
        },
        ...promotedChain.map((v, idx) => ({
          depth: idx + 1,
          isSeed: false,
          versionNumber: v.version_number,
          passKind: v.pass_kind,
          localPath: v.local_path,
          gateVerdict: v.gate_verdict,
          diffSummary: v.diff_summary,
          createdAt: v.created_at,
          promotedAt: v.promoted_at,
        })),
      ];
      return {
        ok: true,
        result: {
          asset,
          lineage,
          lineageDepth: lineage.length - 1,
        },
      };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  registerLensAction("evo", "recent-promotions", (ctx, _artifact, params) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      const limit = Math.max(1, Math.min(100, Number(params?.limit) || 20));
      const rows = db.prepare(`
        SELECT v.id AS version_id, v.asset_id, v.version_number, v.pass_kind,
               v.diff_summary, v.promoted_at, v.local_path,
               a.kind, a.source, a.source_id, a.category, a.quality_level
          FROM evo_asset_versions v
          JOIN evo_assets a ON a.id = v.asset_id
         WHERE v.promoted = 1
         ORDER BY v.promoted_at DESC
         LIMIT ?
      `).all(limit);
      return { ok: true, result: { promotions: rows, count: rows.length } };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });
}
