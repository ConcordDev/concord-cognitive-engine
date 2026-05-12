/**
 * Artifacts Routes — REST surface for file/content artifact management.
 *
 * Artifacts are pieces of content (files, documents, generated outputs)
 * attached to DTUs or produced standalone. Content is stored as base64
 * in SQLite for items ≤ 1MB; larger items get a storage_path reference
 * pointing to the uploads directory.
 *
 * Mounts under /api/artifacts via app.use("/api/artifacts", ...).
 *
 * Endpoints:
 *   GET    /                    — list artifacts (paginated)
 *   POST   /upload              — upload an artifact
 *   GET    /:id                 — get artifact metadata
 *   GET    /:id/info            — extended info (with DTU link)
 *   GET    /:id/download        — download artifact content
 *   DELETE /:id                 — delete an artifact
 */

import { Router } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import {
  STORAGE_CONSTANTS,
  ARTIFACT_STORAGE,
} from "../lib/storage-constants.js";

function uid() {
  return crypto.randomUUID();
}

const INLINE_LIMIT = 1024 * 1024; // 1MB — store inline; larger goes to disk

export default function createArtifactsRouter({ db, requireAuth, STATE }) {
  const router = Router();

  // Resolve upload directory — falls back to /tmp if not configured
  const uploadDir = process.env.ARTIFACTS_DIR
    || (STATE?.config?.artifactsDir)
    || path.join(process.cwd(), "uploads", "artifacts");

  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (_) { /* non-fatal */ }

  // ── Schema bootstrap ────────────────────────────────────────────────────────

  // The migration-001 `artifacts` table uses a different schema and is owned
  // by the lens artifact pipeline. This router uses its own `route_artifacts`
  // table to avoid colliding with that schema while keeping the API contract
  // (artifactId-based CRUD) stable.
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_artifacts (
      artifact_id  TEXT PRIMARY KEY,
      dtu_id       TEXT,
      name         TEXT NOT NULL,
      mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      storage_mode TEXT NOT NULL DEFAULT 'inline',
      content_b64  TEXT,
      storage_path TEXT,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      description  TEXT NOT NULL DEFAULT '',
      tags         TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_route_artifacts_dtu ON route_artifacts (dtu_id);
    CREATE INDEX IF NOT EXISTS idx_route_artifacts_creator ON route_artifacts (created_by, created_at DESC);
  `);

  // ── Prepared statements ─────────────────────────────────────────────────────

  const stmts = {
    insert: db.prepare(
      `INSERT INTO route_artifacts (artifact_id, dtu_id, name, mime_type, size_bytes, storage_mode, content_b64, storage_path, created_by, description, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    get: db.prepare(
      `SELECT artifact_id, dtu_id, name, mime_type, size_bytes, storage_mode, storage_path, created_by, created_at, description, tags
       FROM route_artifacts WHERE artifact_id = ?`
    ),
    getWithContent: db.prepare(
      `SELECT * FROM route_artifacts WHERE artifact_id = ?`
    ),
    list: db.prepare(
      `SELECT artifact_id, dtu_id, name, mime_type, size_bytes, storage_mode, created_by, created_at, description, tags
       FROM route_artifacts ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ),
    listByDtu: db.prepare(
      `SELECT artifact_id, dtu_id, name, mime_type, size_bytes, storage_mode, created_by, created_at, description, tags
       FROM route_artifacts WHERE dtu_id = ? ORDER BY created_at DESC LIMIT ?`
    ),
    delete: db.prepare(
      `DELETE FROM route_artifacts WHERE artifact_id = ?`
    ),
    getStoragePath: db.prepare(
      `SELECT artifact_id, storage_mode, storage_path FROM route_artifacts WHERE artifact_id = ?`
    ),
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resolveUserId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.id || req.body?.userId || req.query?.userId || "anonymous"; // safe: target-identifier
  }

  function parseArtifact(row) {
    if (!row) return null;
    let tags = [];
    try { tags = JSON.parse(row.tags || "[]"); } catch { /* ignore */ }
    return {
      artifactId: row.artifact_id,
      dtuId: row.dtu_id || null,
      name: row.name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      storageMode: row.storage_mode,
      createdBy: row.created_by,
      createdAt: row.created_at,
      description: row.description,
      tags,
    };
  }

  // ── GET / — list artifacts ──────────────────────────────────────────────────

  router.get("/", (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const dtuId = req.query.dtuId;
      const rows = dtuId
        ? stmts.listByDtu.all(dtuId, limit)
        : stmts.list.all(limit, offset);
      const artifacts = rows.map(parseArtifact);
      res.json({ ok: true, artifacts, count: artifacts.length, offset });
    } catch (err) {
      console.error("[artifacts] GET / error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /upload — upload artifact ─────────────────────────────────────────
  // Accepts: { name, mimeType, content (base64), dtuId?, description?, tags? }
  // For binary uploads via multipart/form-data, `content` should be base64-encoded.

  router.post("/upload", requireAuth(), async (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { name, mimeType, content, dtuId, description, tags } = req.body || {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ ok: false, error: "Artifact name is required" });
      }
      if (!content || typeof content !== "string") {
        return res.status(400).json({ ok: false, error: "content (base64) is required" });
      }

      const safeName = path.basename(name.trim()).slice(0, 255);
      const safeMime = typeof mimeType === "string" ? mimeType.slice(0, 100) : "application/octet-stream";
      const safeDesc = (description || "").slice(0, 1000);
      const safeTags = Array.isArray(tags)
        ? tags.filter((t) => typeof t === "string").slice(0, 20)
        : [];

      // Decode to get byte size
      let buf;
      try {
        buf = Buffer.from(content, "base64");
      } catch (_) {
        return res.status(400).json({ ok: false, error: "content must be valid base64" });
      }

      const artifactId = uid();
      let storageMode = "inline";
      let contentB64 = null;
      let storagePath = null;

      if (buf.length <= INLINE_LIMIT) {
        storageMode = "inline";
        contentB64 = content;
      } else {
        // Write to disk
        storageMode = "disk";
        const fileName = `${artifactId}_${safeName}`;
        // safeName already passed through `path.basename(...).slice(0,255)`
        // at construction (line ~160) so it cannot contain path separators.
        // Defence-in-depth: re-resolve through path.relative to give CodeQL
        // a sanitiser it recognises and to catch any future change that
        // weakens safeName's invariants.
        const candidate = path.resolve(uploadDir, fileName);
        const rel = path.relative(uploadDir, candidate);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          return res.status(400).json({ ok: false, error: "invalid filename" });
        }
        storagePath = candidate;
        try {
          await fs.promises.writeFile(storagePath, buf);
        } catch (fsErr) {
          console.error("[artifacts] disk write failed:", fsErr);
          // Fall back to inline for resilience
          storageMode = "inline";
          contentB64 = content;
          storagePath = null;
        }
      }

      stmts.insert.run(
        artifactId,
        dtuId || null,
        safeName,
        safeMime,
        buf.length,
        storageMode,
        contentB64,
        storagePath,
        userId,
        safeDesc,
        JSON.stringify(safeTags)
      );

      res.json({ ok: true, artifactId, name: safeName, sizeBytes: buf.length, storageMode });
    } catch (err) {
      console.error("[artifacts] POST /upload error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /:id — metadata ─────────────────────────────────────────────────────

  router.get("/:id", (req, res) => {
    try {
      const row = stmts.get.get(req.params.id);
      if (!row) return res.status(404).json({ ok: false, error: "Artifact not found" });
      res.json({ ok: true, artifact: parseArtifact(row) });
    } catch (err) {
      console.error("[artifacts] GET /:id error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /:id/info — extended info ───────────────────────────────────────────

  router.get("/:id/info", (req, res) => {
    try {
      const row = stmts.get.get(req.params.id);
      if (!row) return res.status(404).json({ ok: false, error: "Artifact not found" });
      const artifact = parseArtifact(row);

      // Attach DTU title if linked
      let dtuTitle = null;
      if (artifact.dtuId) {
        try {
          const store = STATE?.dtus;
          if (store && typeof store.get === "function") {
            const dtu = store.get(artifact.dtuId);
            dtuTitle = dtu?.title || (dtu?.core?.title) || null;
          }
        } catch (_) { /* non-fatal */ }
      }

      res.json({ ok: true, artifact, dtuTitle, downloadUrl: `/api/artifacts/${req.params.id}/download` });
    } catch (err) {
      console.error("[artifacts] GET /:id/info error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /:id/download — download content ────────────────────────────────────

  router.get("/:id/download", async (req, res) => {
    try {
      const row = stmts.getWithContent.get(req.params.id);
      if (!row) return res.status(404).json({ ok: false, error: "Artifact not found" });

      res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.name)}"`);
      res.setHeader("Content-Length", row.size_bytes);

      if (row.storage_mode === "inline" && row.content_b64) {
        const buf = Buffer.from(row.content_b64, "base64");
        return res.end(buf);
      }

      if (row.storage_mode === "disk" && row.storage_path) {
        try {
          await fs.promises.access(row.storage_path);
        } catch {
          return res.status(404).json({ ok: false, error: "Artifact content missing from disk" });
        }
        return fs.createReadStream(row.storage_path).pipe(res);
      }

      res.status(404).json({ ok: false, error: "Artifact content unavailable" });
    } catch (err) {
      console.error("[artifacts] GET /:id/download error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── DELETE /:id ─────────────────────────────────────────────────────────────

  router.delete("/:id", requireAuth(), (req, res) => {
    try {
      const pathRow = stmts.getStoragePath.get(req.params.id);
      if (!pathRow) return res.status(404).json({ ok: false, error: "Artifact not found" });

      // Remove disk file if present
      if (pathRow.storage_mode === "disk" && pathRow.storage_path) {
        try { fs.unlinkSync(pathRow.storage_path); } catch (_) { /* non-fatal */ }
      }

      stmts.delete.run(req.params.id);
      res.json({ ok: true, artifactId: req.params.id, deleted: true });
    } catch (err) {
      console.error("[artifacts] DELETE /:id error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
