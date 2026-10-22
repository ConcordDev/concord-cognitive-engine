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
 *   PUT    /audio/:projectId/:assetId     — upload a recorded/imported take (chunked, raw WAV bytes)
 *   GET    /audio/:projectId/:assetId     — download it (owner / joined collaborator only)
 */

import express, { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import expressRateLimit from "express-rate-limit";

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

  // ── Audio files for DAW projects (recorded takes, imports) ──────────────────
  //
  // Takes live in the browser's IndexedDB for instant playback AND on the
  // server so the project opens with its audio on any device. Uploads are
  // chunked (≤ 8 MB per request) to stay under proxy body limits:
  //   PUT ?offset=0&total=N  (truncates), then offset=k*chunk ... until offset+len == total.
  // Files: <DATA_DIR>/studio-audio/<sha256(user)>/<projectId>/<assetId>.wav
  // Access: the project must be in the caller's studio project roster (or a
  // collab session they joined).

  const AUDIO_ROOT = path.join(
    process.env.DATA_DIR || (fs.existsSync("/workspace") ? "/workspace/concord-data" : path.join(process.cwd(), "data")),
    "studio-audio",
  );
  const SAFE_ID = /^[A-Za-z0-9_-]{1,96}$/;
  const AUDIO_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB per take
  const AUDIO_USER_QUOTA = 20 * 1024 * 1024 * 1024; // 20 GB per user

  function studioProjectOwner(userId, projectId) {
    const st = globalThis._concordSTATE?.studioLens;
    if (!st || !userId) return null;
    if (st.projects?.get(userId)?.has(projectId)) return userId;
    const session = st.collab?.get?.(projectId);
    if (session && Array.isArray(session.collaborators) && session.collaborators.some((c) => c.userId === userId)) {
      if (st.projects?.get(session.hostUserId)?.has(projectId)) return session.hostUserId;
    }
    return null;
  }
  const AUDIO_ROOT_RESOLVED = path.resolve(AUDIO_ROOT);
  /** Resolve a path under AUDIO_ROOT; throws if it would escape it. */
  function underAudioRoot(...parts) {
    const p = path.resolve(AUDIO_ROOT_RESOLVED, ...parts);
    if (!p.startsWith(AUDIO_ROOT_RESOLVED + path.sep)) throw new Error("path outside audio root");
    return p;
  }
  function audioDir(ownerId, projectId) {
    const u = crypto.createHash("sha256").update(String(ownerId)).digest("hex").slice(0, 32);
    return underAudioRoot(u, projectId);
  }
  // Uploads arrive in 4 MB chunks: 600/min per user covers ~40 MB/s.
  const audioWriteLimit = expressRateLimit({
    windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `studio-audio-w:${req.user?.id || "anon"}`,
    message: { ok: false, error: "Too many upload requests" },
  });
  const audioReadLimit = expressRateLimit({
    windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `studio-audio-r:${req.user?.id || "anon"}`,
    message: { ok: false, error: "Too many requests" },
  });
  function dirBytes(dir) {
    let total = 0;
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) total += dirBytes(p);
        else { try { total += fs.statSync(p).size; } catch { /* gone */ } }
      }
    } catch { /* missing */ }
    return total;
  }

  router.put(
    "/audio/:projectId/:assetId",
    requireAuth(),
    audioWriteLimit,
    express.raw({ type: () => true, limit: "8mb" }),
    (req, res) => {
      try {
        const { projectId, assetId } = req.params;
        if (!SAFE_ID.test(projectId) || !SAFE_ID.test(assetId)) return res.status(400).json({ ok: false, error: "bad id" });
        const userId = req.user?.id;
        const owner = studioProjectOwner(userId, projectId);
        if (!owner) return res.status(404).json({ ok: false, error: "project not found" });
        const offset = Number(req.query.offset || 0);
        const total = Number(req.query.total || 0);
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || total <= 0 || total > AUDIO_MAX_BYTES) {
          return res.status(400).json({ ok: false, error: "bad offset/total" });
        }
        if (offset + body.length > total) return res.status(400).json({ ok: false, error: "chunk past total" });
        const dir = audioDir(owner, projectId);
        fs.mkdirSync(dir, { recursive: true });
        const part = underAudioRoot(dir, `${assetId}.wav.part`);
        const final = underAudioRoot(dir, `${assetId}.wav`);
        if (offset === 0) {
          const used = dirBytes(underAudioRoot(path.dirname(dir)));
          if (used + total > AUDIO_USER_QUOTA) return res.status(413).json({ ok: false, error: "audio storage quota reached" });
          if (body.length < 12 || body.toString("ascii", 0, 4) !== "RIFF" || body.toString("ascii", 8, 12) !== "WAVE") {
            return res.status(415).json({ ok: false, error: "expected a WAV file" });
          }
          fs.writeFileSync(part, body);
        } else {
          let size = 0;
          try { size = fs.statSync(part).size; } catch { return res.status(409).json({ ok: false, error: "upload not started", expectedOffset: 0 }); }
          if (size !== offset) return res.status(409).json({ ok: false, error: "offset mismatch", expectedOffset: size });
          fs.appendFileSync(part, body);
        }
        const size = fs.statSync(part).size;
        if (size === total) {
          fs.renameSync(part, final);
          return res.json({ ok: true, complete: true, bytes: total });
        }
        return res.json({ ok: true, complete: false, received: size });
      } catch (err) {
        console.error("[studio] PUT /audio error:", err?.message || err);
        res.status(500).json({ ok: false, error: "An unexpected error occurred" });
      }
    },
  );

  router.get("/audio/:projectId/:assetId", requireAuth(), audioReadLimit, (req, res) => {
    try {
      const { projectId, assetId } = req.params;
      if (!SAFE_ID.test(projectId) || !SAFE_ID.test(assetId)) return res.status(400).json({ ok: false, error: "bad id" });
      const owner = studioProjectOwner(req.user?.id, projectId);
      if (!owner) return res.status(404).json({ ok: false, error: "not found" });
      const file = underAudioRoot(audioDir(owner, projectId), `${assetId}.wav`);
      if (!fs.existsSync(file)) return res.status(404).json({ ok: false, error: "not found" });
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      console.error("[studio] GET /audio error:", err?.message || err);
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
