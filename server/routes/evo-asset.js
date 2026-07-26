// server/routes/evo-asset.js
// Public endpoints for the EvoAsset Engine.
//
//   GET  /api/evo-asset/resolve?source=&sourceId=
//        Returns the current canonical URL for an asset reference.
//   POST /api/evo-asset/interaction
//        Records a player interaction with an asset.
//   GET  /api/evo-asset/asset/:id
//        Detailed asset state (versions, quality level, recent interactions).
//   GET  /api/evo-asset/stats
//        Public transparency: counts by source/quality_level. No user-identifying detail.

import { Router } from "express";
import path from "path";
import fs from "fs";
import { resolveCurrentBest, recordInteraction, resolveOrAutoRegisterForInteraction } from "../lib/evo-asset/registry.js";
import { isGlbSource, extractMeshData } from "../lib/evo-asset/glb-bridge.js";
import { meshToSTL } from "../lib/asset-gen/stl-export.js";

export default function createEvoAssetRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/evo-asset/resolve — public read, no auth required
  router.get("/resolve", (req, res) => {
    try {
      const source = String(req.query.source || "");
      const sourceId = String(req.query.sourceId || "");
      if (!source || !sourceId) {
        return res.status(400).json({ ok: false, error: "source and sourceId required" });
      }
      const resolved = resolveCurrentBest(db, { source, sourceId });
      if (!resolved) return res.json({ ok: false, error: "not_registered" });

      // Translate the local file path to a fetchable URL. Static files are
      // served from /api/evo-asset/file/:assetId/* via the route below so we
      // never expose the raw filesystem path.
      const url = `/api/evo-asset/file/${resolved.assetId}?v=${resolved.qualityLevel}`;
      res.json({
        ok: true,
        url,
        qualityLevel: resolved.qualityLevel,
        pass: resolved.pass,
      });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/evo-asset/material — public read. Returns the promoted
  // material_upgrade PBR spec for an asset (roughness/metalness/clearcoat/
  // sheen …) so the renderer can upgrade the material of an already-loaded
  // GLB without the metadata JSON ever masquerading as the geometry file.
  router.get("/material", async (req, res) => {
    try {
      const source = String(req.query.source || "");
      const sourceId = String(req.query.sourceId || "");
      if (!source || !sourceId) {
        return res.status(400).json({ ok: false, error: "source and sourceId required" });
      }
      const asset = db.prepare(`
        SELECT id FROM evo_assets WHERE source = ? AND source_id = ? AND archived_at IS NULL
      `).get(source, sourceId);
      if (!asset) return res.json({ ok: false, error: "not_registered" });
      const version = db.prepare(`
        SELECT local_path FROM evo_asset_versions
         WHERE asset_id = ? AND promoted = 1 AND pass_kind = 'material_upgrade'
         ORDER BY version_number DESC
         LIMIT 1
      `).get(asset.id);
      if (!version?.local_path) return res.json({ ok: false, error: "no_material_upgrade" });
      let material;
      try {
        material = JSON.parse(await fs.promises.readFile(version.local_path, "utf8"));
      } catch {
        return res.json({ ok: false, error: "material_read_failed" });
      }
      res.json({ ok: true, material });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/evo-asset/file/:id — serves the canonical file content. Public
  // because asset binaries aren't user-private. Streams from disk; no
  // path-traversal possible since we look the path up from the registry.
  //
  // GET /api/evo-asset/file/:id?format=stl — sibling export option: the
  // SAME canonical mesh, re-serialized to binary STL (server/lib/asset-gen/
  // stl-export.js#meshToSTL) instead of the source GLB. No new geometry is
  // generated and no separate asset/version is registered — the vertex
  // data is extracted from the already-promoted GLB (glb-bridge.js's
  // extractMeshData, the same vertex-extraction bridge the refinement
  // passes use) and re-packed. STL isn't CDN-mirrored today, so this path
  // always converts from the local canonical file rather than following
  // the GLB CDN-redirect branch below. Honest failure (never a corrupt or
  // silently-wrong file): a non-GLB canonical source, an unreadable/multi-
  // primitive GLB, or a degenerate mesh all return `{ ok:false, reason }`
  // instead of a fabricated STL.
  router.get("/file/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const format = String(req.query.format || "").toLowerCase();
      // Exclude material_upgrade from the geometry channel — it's a
      // metadata-only JSON (served via /material), never the canonical mesh.
      const row = db.prepare(`
        SELECT a.id, a.local_path, a.cdn_url, v.local_path AS version_path, v.cdn_url AS version_cdn_url
          FROM evo_assets a
     LEFT JOIN evo_asset_versions v
            ON v.asset_id = a.id AND v.promoted = 1 AND v.pass_kind != 'material_upgrade'
         WHERE a.id = ? AND a.archived_at IS NULL
         ORDER BY v.version_number DESC NULLS LAST
         LIMIT 1
      `).get(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });

      if (format === "stl") {
        const filePath = row.version_path ?? row.local_path;
        if (!filePath) return res.status(404).json({ ok: false, error: "file_missing" });
        try {
          await fs.promises.access(filePath);
        } catch {
          return res.status(404).json({ ok: false, error: "file_missing" });
        }
        if (!isGlbSource(filePath)) {
          return res.status(422).json({ ok: false, error: "not_glb_source" });
        }
        let mesh;
        try {
          mesh = await extractMeshData(filePath);
        } catch (err) {
          return res.status(422).json({ ok: false, error: "mesh_extract_failed", reason: err?.message });
        }
        const stl = meshToSTL(mesh);
        if (!stl.ok) {
          return res.status(422).json({ ok: false, error: "stl_export_failed", reason: stl.reason, detail: stl.detail });
        }
        res.setHeader("Content-Type", "model/stl");
        res.setHeader("Content-Disposition", `attachment; filename="${id}.stl"`);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(stl.buffer);
      }

      // CDN redirect path: when CONCORD_CDN_BASE_URL is configured and we
      // have a stored cdn_url for this asset (or version), 302 to it. Saves
      // the origin from streaming GLB bytes for every request.
      const cdnBaseConfigured = !!process.env.CONCORD_CDN_BASE_URL;
      const cdnUrl = row.version_cdn_url ?? row.cdn_url;
      if (cdnBaseConfigured && cdnUrl) {
        // Optionally sign the URL so CDN can verify expiry.
        try {
          const signer = await import("../lib/cdn-url-signer.js").catch(() => null);
          const signed = signer?.signUrl ? signer.signUrl(cdnUrl, { ttl: 3600 }) : cdnUrl;
          res.setHeader("Cache-Control", "public, max-age=86400");
          return res.redirect(302, signed);
        } catch {
          res.setHeader("Cache-Control", "public, max-age=86400");
          return res.redirect(302, cdnUrl);
        }
      }

      const filePath = row.version_path ?? row.local_path;
      if (!filePath) return res.status(404).json({ ok: false, error: "file_missing" });
      try {
        await fs.promises.access(filePath);
      } catch {
        return res.status(404).json({ ok: false, error: "file_missing" });
      }
      // Set a long-cache header keyed off quality level (the caller passes
      // ?v= so URL changes when the asset evolves; cache invalidates).
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(path.resolve(filePath));
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/evo-asset/interaction — record a player interaction
  //
  // Auto-registers a real placeholder evo_assets row on first touch for the
  // three internally-originated sources ('authored' / 'evolved' /
  // 'concordia') — see resolveOrAutoRegisterForInteraction's header for why
  // this is restricted to those three and never the external CC0-catalog
  // sources. Verified 2026-07-25: without this, every passive world-lens
  // presence ping (building render, NPC dialogue/combat, combo VFX) 404'd
  // by construction — the frontend and server agreed on field names but
  // never on a resolvable (source, sourceId) scheme. See
  // server/tests/invariants/evo-asset-source-scheme.test.js.
  router.post("/interaction", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { source, sourceId, assetId: directId, action, weight, kind } = req.body || {};
      let assetId = directId;
      if (!assetId && source && sourceId) {
        assetId = resolveOrAutoRegisterForInteraction(db, { source, sourceId, kind });
      }
      if (!assetId) return res.status(404).json({ ok: false, error: "asset_not_found" });
      // A present-but-invalid id flowed into recordInteraction → FK throw → 500
      // (playtest #R5). Validate existence first so it's a clean 404.
      const _exists = db.prepare(`SELECT 1 FROM evo_assets WHERE id = ?`).get(assetId);
      if (!_exists) return res.status(404).json({ ok: false, error: "asset_not_found" });
      recordInteraction(db, assetId,
        { kind: "user", id: userId },
        String(action || "interact").slice(0, 64),
        Math.max(0, Math.min(10, Number(weight) || 1)),
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/evo-asset/by-category — list assets matching category + kind.
  //
  // Public read used by procedural-buildings.ts#applyBlueprintOverlayIfAny
  // and similar overlay-by-archetype lookups (textures, materials).
  // Ranked by evolution_score so marketplace canon wins per slot.
  router.get("/by-category", (req, res) => {
    try {
      const category = String(req.query.category || "").slice(0, 80);
      const kind = req.query.kind ? String(req.query.kind).slice(0, 32) : null;
      if (!category) return res.status(400).json({ ok: false, error: "category required" });
      const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || "10"), 10) || 10));
      const rows = kind
        ? db.prepare(`
            SELECT id, source_id, local_path, evolution_score, quality_level
            FROM evo_assets
            WHERE category = ? AND kind = ? AND archived_at IS NULL
            ORDER BY evolution_score DESC, quality_level DESC, created_at DESC
            LIMIT ?
          `).all(category, kind, limit)
        : db.prepare(`
            SELECT id, source_id, local_path, evolution_score, quality_level
            FROM evo_assets
            WHERE category = ? AND archived_at IS NULL
            ORDER BY evolution_score DESC, quality_level DESC, created_at DESC
            LIMIT ?
          `).all(category, limit);
      res.json({
        ok: true,
        category,
        kind,
        assets: rows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          localPath: r.local_path,
          evolutionScore: r.evolution_score,
          qualityLevel: r.quality_level,
        })),
      });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/evo-asset/asset/:id — detailed state
  router.get("/asset/:id", (req, res) => {
    try {
      const asset = db.prepare(`SELECT * FROM evo_assets WHERE id = ?`).get(req.params.id);
      if (!asset) return res.status(404).json({ ok: false, error: "not_found" });
      const versions = db.prepare(`
        SELECT id, version_number, pass_kind, promoted, gate_verdict, diff_summary, created_at
          FROM evo_asset_versions
         WHERE asset_id = ?
         ORDER BY version_number DESC
         LIMIT 20
      `).all(asset.id);
      const recentInteractions = db.prepare(`
        SELECT actor_kind, action, weight, ts
          FROM evo_asset_interactions
         WHERE asset_id = ?
         ORDER BY ts DESC
         LIMIT 10
      `).all(asset.id);
      res.json({ ok: true, asset, versions, recentInteractions });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/evo-asset/stats — public transparency
  router.get("/stats", (req, res) => {
    try {
      // Interaction placeholders are EXCLUDED from the library counts and
      // reported as their own number instead.
      //
      // resolveOrAutoRegisterForInteraction() (lib/evo-asset/registry.js)
      // creates a real evo_assets row on a first-ever interaction so the
      // interaction can be recorded honestly. Those rows carry no asset —
      // no mesh, no texture, `local_path` is the virtual
      // `interaction://<source>/<sourceId>`. Counting them here would
      // inflate an endpoint whose own comment calls it "public
      // transparency": a viewer would read "concordia: 412" as 412 real
      // assets when most are contentless first-touch markers. Since every
      // rendered building and NPC mints one, the inflation would dwarf the
      // real library.
      //
      // They are excluded from byQuality/bySource rather than hidden
      // outright — suppressing them entirely would be its own small
      // dishonesty, since the rows do exist. `interactionPlaceholders`
      // below reports them explicitly, so the number is neither inflated
      // nor concealed.
      const PLACEHOLDER_PREDICATE = `local_path LIKE 'interaction://%'`;
      const byQuality = db.prepare(`
        SELECT quality_level, COUNT(*) AS n FROM evo_assets
         WHERE archived_at IS NULL AND NOT (${PLACEHOLDER_PREDICATE})
         GROUP BY quality_level ORDER BY quality_level
      `).all();
      const bySource = db.prepare(`
        SELECT source, COUNT(*) AS n FROM evo_assets
         WHERE archived_at IS NULL AND NOT (${PLACEHOLDER_PREDICATE})
         GROUP BY source ORDER BY n DESC
      `).all();
      const interactionPlaceholders = db.prepare(`
        SELECT COUNT(*) AS n FROM evo_assets
         WHERE archived_at IS NULL AND ${PLACEHOLDER_PREDICATE}
      `).get()?.n ?? 0;
      const totalEvolutions = db.prepare(`
        SELECT COUNT(*) AS n FROM evo_asset_versions WHERE promoted = 1
      `).get()?.n ?? 0;
      const recentEvolutions = db.prepare(`
        SELECT pass_kind, COUNT(*) AS n FROM evo_asset_versions
         WHERE promoted = 1 AND promoted_at >= ?
         GROUP BY pass_kind
      `).all(Math.floor(Date.now() / 1000) - 7 * 86400);
      res.json({ ok: true, byQuality, bySource, interactionPlaceholders, totalEvolutions, recentEvolutions });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
