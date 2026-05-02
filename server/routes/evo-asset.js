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
import { resolveCurrentBest, recordInteraction } from "../lib/evo-asset/registry.js";

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

  // GET /api/evo-asset/file/:id — serves the canonical file content. Public
  // because asset binaries aren't user-private. Streams from disk; no
  // path-traversal possible since we look the path up from the registry.
  router.get("/file/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const row = db.prepare(`
        SELECT a.id, a.local_path, a.cdn_url, v.local_path AS version_path, v.cdn_url AS version_cdn_url
          FROM evo_assets a
     LEFT JOIN evo_asset_versions v
            ON v.asset_id = a.id AND v.promoted = 1
         WHERE a.id = ? AND a.archived_at IS NULL
         ORDER BY v.version_number DESC NULLS LAST
         LIMIT 1
      `).get(id);
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });

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
      if (!filePath || !fs.existsSync(filePath)) {
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
  router.post("/interaction", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { source, sourceId, assetId: directId, action, weight } = req.body || {};
      let assetId = directId;
      if (!assetId && source && sourceId) {
        const row = db.prepare(`SELECT id FROM evo_assets WHERE source = ? AND source_id = ?`).get(source, sourceId);
        assetId = row?.id;
      }
      if (!assetId) return res.status(404).json({ ok: false, error: "asset_not_found" });
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
      const byQuality = db.prepare(`
        SELECT quality_level, COUNT(*) AS n FROM evo_assets WHERE archived_at IS NULL
         GROUP BY quality_level ORDER BY quality_level
      `).all();
      const bySource = db.prepare(`
        SELECT source, COUNT(*) AS n FROM evo_assets WHERE archived_at IS NULL
         GROUP BY source ORDER BY n DESC
      `).all();
      const totalEvolutions = db.prepare(`
        SELECT COUNT(*) AS n FROM evo_asset_versions WHERE promoted = 1
      `).get()?.n ?? 0;
      const recentEvolutions = db.prepare(`
        SELECT pass_kind, COUNT(*) AS n FROM evo_asset_versions
         WHERE promoted = 1 AND promoted_at >= ?
         GROUP BY pass_kind
      `).all(Math.floor(Date.now() / 1000) - 7 * 86400);
      res.json({ ok: true, byQuality, bySource, totalEvolutions, recentEvolutions });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
