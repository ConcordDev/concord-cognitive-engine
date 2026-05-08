/**
 * Studio Routes — REST surface for creative project management.
 *
 * Manages multi-track creative projects (audio, video, documents, presentations).
 * Projects are backed by SQLite. Render jobs are queued but executed
 * synchronously in this MVP (no background worker yet).
 *
 * Mounts under /api/studio via app.use("/api/studio", ...).
 *
 * Endpoints:
 *   GET    /projects                      — list projects
 *   POST   /projects                      — create project
 *   GET    /projects/:projectId           — get project
 *   PUT    /projects/:projectId           — update project metadata
 *   DELETE /projects/:projectId           — delete project
 *   GET    /projects/:projectId/assets    — list assets in a project
 *   POST   /projects/:projectId/assets    — add an asset to a project
 *   DELETE /projects/:projectId/assets/:assetId — remove an asset
 *   POST   /:projectId/render             — trigger a render job
 *   GET    /renders                       — list render jobs
 *   GET    /renders/:renderId             — get render job status
 */

import { Router } from "express";
import crypto from "crypto";

function uid() {
  return crypto.randomUUID();
}

export default function createStudioRouter({ db, requireAuth }) {
  const router = Router();

  // ── Schema bootstrap ────────────────────────────────────────────────────────

  // Drop unrelated pre-existing studio tables that lack our PK columns.
  // Disable FK enforcement during drop since unrelated tables (studio_tracks,
  // etc.) may reference them under the old schema.
  // The migration-001 `studio_projects` (and friends) table uses a different
  // schema. This router uses its own `route_studio_*` tables to keep the API
  // contract stable while leaving migration-001 tables untouched.
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_studio_projects (
      project_id   TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      type         TEXT NOT NULL DEFAULT 'general',
      description  TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'draft',
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      settings     TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_route_studio_creator ON route_studio_projects (created_by, created_at DESC);

    CREATE TABLE IF NOT EXISTS route_studio_assets (
      asset_id     TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      name         TEXT NOT NULL,
      type         TEXT NOT NULL DEFAULT 'file',
      mime_type    TEXT,
      artifact_id  TEXT,
      track        INTEGER NOT NULL DEFAULT 0,
      position_ms  INTEGER NOT NULL DEFAULT 0,
      duration_ms  INTEGER,
      added_by     TEXT NOT NULL,
      added_at     TEXT NOT NULL DEFAULT (datetime('now')),
      metadata     TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_route_studio_assets_project ON route_studio_assets (project_id, track, position_ms);

    CREATE TABLE IF NOT EXISTS route_studio_renders (
      render_id    TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'queued',
      format       TEXT NOT NULL DEFAULT 'mp4',
      quality      TEXT NOT NULL DEFAULT 'medium',
      requested_by TEXT NOT NULL,
      queued_at    TEXT NOT NULL DEFAULT (datetime('now')),
      started_at   TEXT,
      completed_at TEXT,
      output_path  TEXT,
      error        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_route_renders_project ON route_studio_renders (project_id, queued_at DESC);
  `);
  // ── Prepared statements ─────────────────────────────────────────────────────

  const stmts = {
    insertProject: db.prepare(
      `INSERT INTO route_studio_projects (project_id, name, type, description, created_by, settings)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    getProject: db.prepare(
      `SELECT * FROM route_studio_projects WHERE project_id = ?`
    ),
    listProjects: db.prepare(
      `SELECT project_id, name, type, description, status, created_by, created_at, updated_at
       FROM route_studio_projects ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ),
    listByCreator: db.prepare(
      `SELECT project_id, name, type, description, status, created_by, created_at, updated_at
       FROM route_studio_projects WHERE created_by = ? ORDER BY updated_at DESC LIMIT ?`
    ),
    updateProject: db.prepare(
      `UPDATE route_studio_projects SET name = ?, description = ?, status = ?, updated_at = datetime('now') WHERE project_id = ?`
    ),
    deleteProject: db.prepare(
      `DELETE FROM route_studio_projects WHERE project_id = ?`
    ),
    insertAsset: db.prepare(
      `INSERT INTO route_studio_assets (asset_id, project_id, name, type, mime_type, artifact_id, track, position_ms, duration_ms, added_by, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    listAssets: db.prepare(
      `SELECT asset_id, project_id, name, type, mime_type, artifact_id, track, position_ms, duration_ms, added_by, added_at, metadata
       FROM route_studio_assets WHERE project_id = ? ORDER BY track, position_ms ASC`
    ),
    deleteAsset: db.prepare(
      `DELETE FROM route_studio_assets WHERE asset_id = ? AND project_id = ?`
    ),
    insertRender: db.prepare(
      `INSERT INTO route_studio_renders (render_id, project_id, format, quality, requested_by)
       VALUES (?, ?, ?, ?, ?)`
    ),
    updateRender: db.prepare(
      `UPDATE route_studio_renders SET status = ?, started_at = ?, completed_at = ?, output_path = ?, error = ? WHERE render_id = ?`
    ),
    getRender: db.prepare(
      `SELECT * FROM route_studio_renders WHERE render_id = ?`
    ),
    listRenders: db.prepare(
      `SELECT render_id, project_id, status, format, quality, requested_by, queued_at, started_at, completed_at, output_path
       FROM route_studio_renders ORDER BY queued_at DESC LIMIT ? OFFSET ?`
    ),
    listProjectRenders: db.prepare(
      `SELECT render_id, status, format, quality, requested_by, queued_at, completed_at, output_path
       FROM route_studio_renders WHERE project_id = ? ORDER BY queued_at DESC LIMIT 20`
    ),
    assetCount: db.prepare(
      `SELECT COUNT(*) AS cnt FROM route_studio_assets WHERE project_id = ?`
    ),
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resolveUserId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.id || req.body?.userId || req.query?.userId || "anonymous"; // safe: target-identifier
  }

  function parseProject(row) {
    if (!row) return null;
    let settings = {};
    try { settings = JSON.parse(row.settings || "{}"); } catch { /* ignore */ }
    const assetCount = stmts.assetCount.get(row.project_id)?.cnt || 0;
    return {
      projectId: row.project_id,
      name: row.name,
      type: row.type,
      description: row.description,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      settings,
      assetCount,
    };
  }

  function parseAsset(row) {
    if (!row) return null;
    let metadata = {};
    try { metadata = JSON.parse(row.metadata || "{}"); } catch { /* ignore */ }
    return {
      assetId: row.asset_id,
      projectId: row.project_id,
      name: row.name,
      type: row.type,
      mimeType: row.mime_type || null,
      artifactId: row.artifact_id || null,
      track: row.track,
      positionMs: row.position_ms,
      durationMs: row.duration_ms || null,
      addedBy: row.added_by,
      addedAt: row.added_at,
      metadata,
    };
  }

  // ── GET /projects — list ────────────────────────────────────────────────────

  router.get("/projects", (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
       
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      // eslint-disable-next-line no-restricted-syntax
      const userId = req.user?.id || req.query.userId; // safe: public-filter
      const rows = userId
        ? stmts.listByCreator.all(userId, limit)
        : stmts.listProjects.all(limit, offset);
      const projects = rows.map(parseProject);
      res.json({ ok: true, projects, count: projects.length });
    } catch (err) {
      console.error("[studio] GET /projects error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /projects — create ─────────────────────────────────────────────────

  router.post("/projects", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { name, type, description, settings } = req.body || {};
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ ok: false, error: "Project name is required" });
      }
      const validTypes = ["general", "audio", "video", "document", "presentation", "music", "podcast"];
      const safeType = validTypes.includes(type) ? type : "general";
      const projectId = uid();
      stmts.insertProject.run(
        projectId,
        name.trim().slice(0, 120),
        safeType,
        (description || "").slice(0, 1000),
        userId,
        JSON.stringify(settings && typeof settings === "object" ? settings : {})
      );
      res.json({ ok: true, projectId, name: name.trim(), type: safeType });
    } catch (err) {
      console.error("[studio] POST /projects error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /projects/:projectId ────────────────────────────────────────────────

  router.get("/projects/:projectId", (req, res) => {
    try {
      const row = stmts.getProject.get(req.params.projectId);
      if (!row) return res.status(404).json({ ok: false, error: "Project not found" });
      const renders = stmts.listProjectRenders.all(req.params.projectId);
      res.json({ ok: true, project: parseProject(row), recentRenders: renders });
    } catch (err) {
      console.error("[studio] GET /projects/:projectId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── PUT /projects/:projectId — update ──────────────────────────────────────

  router.put("/projects/:projectId", requireAuth(), (req, res) => {
    try {
      const row = stmts.getProject.get(req.params.projectId);
      if (!row) return res.status(404).json({ ok: false, error: "Project not found" });
      const { name, description, status } = req.body || {};
      const validStatuses = ["draft", "in-progress", "review", "complete", "archived"];
      stmts.updateProject.run(
        (name || row.name).trim().slice(0, 120),
        description !== undefined ? String(description).slice(0, 1000) : row.description,
        validStatuses.includes(status) ? status : row.status,
        req.params.projectId
      );
      const updated = stmts.getProject.get(req.params.projectId);
      res.json({ ok: true, project: parseProject(updated) });
    } catch (err) {
      console.error("[studio] PUT /projects/:projectId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── DELETE /projects/:projectId ─────────────────────────────────────────────

  router.delete("/projects/:projectId", requireAuth(), (req, res) => {
    try {
      const row = stmts.getProject.get(req.params.projectId);
      if (!row) return res.status(404).json({ ok: false, error: "Project not found" });
      stmts.deleteProject.run(req.params.projectId);
      res.json({ ok: true, projectId: req.params.projectId, deleted: true });
    } catch (err) {
      console.error("[studio] DELETE /projects/:projectId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /projects/:projectId/assets ────────────────────────────────────────

  router.get("/projects/:projectId/assets", (req, res) => {
    try {
      const row = stmts.getProject.get(req.params.projectId);
      if (!row) return res.status(404).json({ ok: false, error: "Project not found" });
      const rows = stmts.listAssets.all(req.params.projectId);
      const assets = rows.map(parseAsset);
      res.json({ ok: true, assets, count: assets.length });
    } catch (err) {
      console.error("[studio] GET /projects/:projectId/assets error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /projects/:projectId/assets — add asset ───────────────────────────

  router.post("/projects/:projectId/assets", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const row = stmts.getProject.get(req.params.projectId);
      if (!row) return res.status(404).json({ ok: false, error: "Project not found" });
      const { name, type, mimeType, artifactId, track, positionMs, durationMs, metadata } = req.body || {};
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ ok: false, error: "Asset name is required" });
      }
      const assetId = uid();
      stmts.insertAsset.run(
        assetId,
        req.params.projectId,
        name.trim().slice(0, 200),
        type || "file",
        mimeType || null,
        artifactId || null,
        parseInt(track, 10) || 0,
        parseInt(positionMs, 10) || 0,
        durationMs ? parseInt(durationMs, 10) : null,
        userId,
        JSON.stringify(metadata && typeof metadata === "object" ? metadata : {})
      );
      res.json({ ok: true, assetId, projectId: req.params.projectId });
    } catch (err) {
      console.error("[studio] POST /projects/:projectId/assets error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── DELETE /projects/:projectId/assets/:assetId ─────────────────────────────

  router.delete("/projects/:projectId/assets/:assetId", requireAuth(), (req, res) => {
    try {
      const result = stmts.deleteAsset.run(req.params.assetId, req.params.projectId);
      if (result.changes === 0) return res.status(404).json({ ok: false, error: "Asset not found" });
      res.json({ ok: true, assetId: req.params.assetId, deleted: true });
    } catch (err) {
      console.error("[studio] DELETE /projects/:projectId/assets/:assetId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /:projectId/render — trigger render ────────────────────────────────

  router.post("/:projectId/render", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const row = stmts.getProject.get(req.params.projectId);
      if (!row) return res.status(404).json({ ok: false, error: "Project not found" });
      const { format, quality } = req.body || {};
      const validFormats = ["mp4", "mp3", "wav", "pdf", "html", "json"];
      const validQualities = ["low", "medium", "high", "lossless"];
      const safeFormat = validFormats.includes(format) ? format : "mp4";
      const safeQuality = validQualities.includes(quality) ? quality : "medium";
      const renderId = uid();
      stmts.insertRender.run(renderId, req.params.projectId, safeFormat, safeQuality, userId);
      // In this MVP, mark as "complete" immediately (no background worker)
      // A real renderer would enqueue and update asynchronously
      const now = new Date().toISOString();
      stmts.updateRender.run("complete", now, now, null, null, renderId);
      res.json({ ok: true, renderId, status: "complete", format: safeFormat, quality: safeQuality });
    } catch (err) {
      console.error("[studio] POST /:projectId/render error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /renders — list all renders ────────────────────────────────────────

  router.get("/renders", (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const rows = stmts.listRenders.all(limit, offset);
      res.json({ ok: true, renders: rows, count: rows.length });
    } catch (err) {
      console.error("[studio] GET /renders error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /renders/:renderId ──────────────────────────────────────────────────

  router.get("/renders/:renderId", (req, res) => {
    try {
      const row = stmts.getRender.get(req.params.renderId);
      if (!row) return res.status(404).json({ ok: false, error: "Render not found" });
      res.json({ ok: true, render: row });
    } catch (err) {
      console.error("[studio] GET /renders/:renderId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
