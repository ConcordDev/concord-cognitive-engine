/**
 * Concord Guidance Layer v1 — Backend Module
 *
 * Provides:
 * - Enhanced event system with typed events, scope, entityType, undoToken, summary
 * - SSE event stream (/api/events/stream)
 * - Paginated events with full filtering (/api/events/paginated)
 * - System health endpoint (/api/system/health)
 * - Object Inspector endpoint (/api/inspect/:entityType/:entityId)
 * - Undo system (/api/undo)
 */

import { randomUUID } from "crypto";
import fs from "fs";
import logger from './logger.js';
import { startSSE } from './lib/sse.js';

function uid(prefix = "") {
  return prefix ? `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}` : randomUUID().replace(/-/g, "").slice(0, 20);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function escapeLike(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ═══════════════════════════════════════════════════════════════
// SSE Connection Manager
// ═══════════════════════════════════════════════════════════════

const sseClients = new Set();

function broadcastEvent(event) {
  const data = JSON.stringify(event);
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Enhanced Event Emitter
// ═══════════════════════════════════════════════════════════════

/**
 * Emit a typed, scoped event with optional undo support.
 * This is the primary event function for the guidance layer.
 */
function emitEvent(db, {
  type,
  actorUserId = null,
  scope = "global",
  entityType = null,
  entityId = null,
  summary = "",
  payload = {},
  requestId = null,
  undoPayload = null,
}) {
  const id = uid("evt");
  const now = nowISO();
  let undoToken = null;

  // Generate undo token if undo payload provided
  if (undoPayload) {
    undoToken = uid("undo");
  }

  try {
    db.prepare(`
      INSERT INTO events (id, type, actor_user_id, payload_json, created_at, request_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, type, actorUserId, JSON.stringify({
      ...payload,
      _scope: scope,
      _entityType: entityType,
      _entityId: entityId,
      _summary: summary,
      _undoToken: undoToken,
      _undoPayload: undoPayload,
    }), now, requestId);
  } catch {
    // Non-critical
  }

  // Broadcast to SSE clients
  const event = { id, type, scope, entityType, entityId, summary, actorUserId, createdAt: now, undoToken };
  broadcastEvent(event);

  return { eventId: id, undoToken };
}

/**
 * Register all guidance layer endpoints.
 */
export function registerGuidanceEndpoints(app, db) {
  if (!db) {
    console.warn("[Guidance] No database — guidance endpoints disabled");
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // SSE Event Stream
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/events/stream", (req, res) => {
    startSSE(res);
    res.write("data: {\"type\":\"connected\"}\n\n");
    sseClients.add(res);

    const cleanup = () => sseClients.delete(res);
    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("error", cleanup);
  });

  // ═══════════════════════════════════════════════════════════════
  // Enhanced Paginated Events
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/events/paginated", (req, res) => {
    try {
      const { type, scope, entityType, entityId, limit = 50, offset = 0 } = req.query;
      const where = [];
      const params = [];

      if (type) { where.push("type = ?"); params.push(type); }
      if (entityType) { where.push("payload_json LIKE ?"); params.push(`%"_entityType":"${escapeLike(entityType)}"%`); }
      if (entityId) { where.push("payload_json LIKE ?"); params.push(`%"_entityId":"${escapeLike(entityId)}"%`); }
      if (scope) { where.push("payload_json LIKE ?"); params.push(`%"_scope":"${escapeLike(scope)}"%`); }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

      const total = db.prepare(`SELECT COUNT(*) as c FROM events ${whereClause}`).get(...params)?.c || 0;

      const lim = Math.min(Math.max(1, Number(limit)), 200);
      const off = Math.max(0, Number(offset));

      // TODO: project explicit columns (auto-fix suggestion)

      const rows = db.prepare(`SELECT * FROM events ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, lim, off);

      const items = rows.map((row) => {
        const payload = safeJSON(row.payload_json);
        return {
          id: row.id,
          type: row.type,
          actorUserId: row.actor_user_id,
          scope: payload?._scope || "global",
          entityType: payload?._entityType || null,
          entityId: payload?._entityId || null,
          summary: payload?._summary || row.type,
          undoToken: payload?._undoToken || null,
          payload: stripInternal(payload),
          createdAt: row.created_at,
          requestId: row.request_id,
        };
      });

      res.json({ ok: true, items, total, limit: lim, offset: off });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // System Health
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/system/health", (req, res) => {
    try {
      // DB writable test
      let dbWritable = false;
      try {
        db.prepare("SELECT 1").get();
        dbWritable = true;
      } catch (_e) { logger.debug('guidance', 'not writable', { error: _e?.message }); }

      // Storage writable test
      let storageWritable = false;
      try {
        const dataDir = process.env.DATA_DIR || "data";
        fs.accessSync(`${dataDir}/artifacts`, fs.constants.W_OK);
        storageWritable = true;
      } catch (_e) { logger.debug('guidance', 'not writable', { error: _e?.message }); }

      // Job queue health
      const jobCounts = {};
      try {
        const rows = db.prepare("SELECT status, COUNT(*) as c FROM jobs GROUP BY status").all();
        for (const r of rows) jobCounts[r.status] = r.c;
      } catch (_e) { logger.debug('guidance', 'no jobs table yet', { error: _e?.message }); }

      // Recent errors (last 5 minutes)
      const recentErrors = [];
      try {
        const fiveMinAgo = new Date(Date.now() - 300000).toISOString().replace("T", " ").replace("Z", "");
        recentErrors.push(...db.prepare(
          "SELECT id, type, created_at, payload_json FROM events WHERE type LIKE '%error%' OR type LIKE '%FAILED%' AND created_at > ? ORDER BY created_at DESC LIMIT 10"
        ).all(fiveMinAgo));
      } catch (_e) { logger.debug('guidance', 'ok', { error: _e?.message }); }

      // Counts
      const counts = {};
      for (const table of ["dtus", "artifacts", "jobs", "marketplace_listings", "studio_projects", "events"]) {
        try {
          counts[table] = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get()?.c || 0;
        } catch {
          counts[table] = 0;
        }
      }

      res.json({
        ok: true,
        authMode: process.env.AUTH_MODE || "public",
        originRequired: process.env.NODE_ENV === "production",
        dbWritable,
        storageWritable,
        jobQueue: jobCounts,
        recentErrors: recentErrors.length,
        counts,
        uptime: process.uptime(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Object Inspector
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/inspect/:entityType/:entityId", (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      let entity = null;
      let versions = [];
      let links = [];
      let recentEvents = [];
      let actions = [];

      switch (entityType) {
        case "dtu": {
          // TODO: project explicit columns (auto-fix suggestion)
          entity = db.prepare("SELECT * FROM dtus WHERE id = ?").get(entityId);
          if (!entity) return res.status(404).json({ error: "DTU not found" });
          entity.body = safeJSON(entity.body_json);
          entity.tags = safeJSON(entity.tags_json);
          versions = db.prepare("SELECT id, version, created_at FROM dtu_versions WHERE dtu_id = ? ORDER BY version DESC").all(entityId);
          // TODO: project explicit columns (auto-fix suggestion)
          links = db.prepare("SELECT * FROM artifact_links WHERE from_kind = 'dtu' AND from_id = ?").all(entityId);
          actions = ["update", "delete", "publish", "sync_to_lens"];
          if (entity.visibility === "private") actions.push("make_public");
          break;
        }
        case "artifact": {
          // TODO: project explicit columns (auto-fix suggestion)
          entity = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(entityId);
          if (!entity) return res.status(404).json({ error: "Artifact not found" });
          entity.metadata = safeJSON(entity.metadata_json);
          versions = db.prepare("SELECT id, version, sha256, size_bytes, mime_type, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC").all(entityId);
          // TODO: project explicit columns (auto-fix suggestion)
          links = db.prepare("SELECT * FROM artifact_links WHERE to_artifact_id = ?").all(entityId);
          const linkedJobs = db.prepare("SELECT j.* FROM jobs j JOIN job_artifacts ja ON j.id = ja.job_id WHERE ja.artifact_id = ?").all(entityId);
          actions = ["download", "delete", "publish_to_marketplace", "sync_to_lens"];
          entity._linkedJobs = linkedJobs.map((j) => ({ id: j.id, type: j.type, status: j.status }));
          break;
        }
        case "listing": {
          // TODO: project explicit columns (auto-fix suggestion)
          entity = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(entityId);
          if (!entity) return res.status(404).json({ error: "Listing not found" });
          const assets = db.prepare("SELECT a.* FROM artifacts a JOIN marketplace_listing_assets mla ON a.id = mla.artifact_id WHERE mla.listing_id = ?").all(entityId);
          entity._assets = assets;
          const entitlements = db.prepare("SELECT COUNT(*) as c FROM entitlements WHERE listing_id = ?").get(entityId);
          entity._entitlementCount = entitlements?.c || 0;
          actions = entity.visibility === "draft" ? ["publish", "attach_asset", "delete"] : ["archive", "view_entitlements"];
          break;
        }
        case "project": {
          // TODO: project explicit columns (auto-fix suggestion)
          entity = db.prepare("SELECT * FROM studio_projects WHERE id = ?").get(entityId);
          if (!entity) return res.status(404).json({ error: "Project not found" });
          entity.metadata = safeJSON(entity.metadata_json);
          // TODO: project explicit columns (auto-fix suggestion)
          const tracks = db.prepare("SELECT * FROM studio_tracks WHERE project_id = ?").all(entityId);
          entity._tracks = tracks;
          // TODO: project explicit columns (auto-fix suggestion)
          const renders = db.prepare("SELECT * FROM studio_renders WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(entityId);
          entity._renders = renders;
          actions = ["update", "add_track", "render", "master", "delete"];
          break;
        }
        case "job": {
          // TODO: project explicit columns (auto-fix suggestion)
          entity = db.prepare("SELECT * FROM jobs WHERE id = ?").get(entityId);
          if (!entity) return res.status(404).json({ error: "Job not found" });
          entity.input = safeJSON(entity.input_json);
          entity.output = safeJSON(entity.output_json);
          entity.error = safeJSON(entity.error_json);
          const jobArtifacts = db.prepare("SELECT a.*, ja.role FROM artifacts a JOIN job_artifacts ja ON a.id = ja.artifact_id WHERE ja.job_id = ?").all(entityId);
          entity._artifacts = jobArtifacts;
          actions = entity.status === "pending" || entity.status === "running" ? ["cancel"] : ["retry", "view_output"];
          break;
        }
        default:
          return res.status(400).json({ error: `Unknown entity type: ${entityType}. Supported: dtu, artifact, listing, project, job` });
      }

      // Get recent events for this entity
      try {
        recentEvents = db.prepare(
          // TODO: project explicit columns (auto-fix suggestion)
          "SELECT * FROM events WHERE payload_json LIKE ? ORDER BY created_at DESC LIMIT 20"
        ).all(`%"_entityId":"${escapeLike(entityId)}"%`).map((row) => {
          const p = safeJSON(row.payload_json);
          return {
            id: row.id,
            type: row.type,
            summary: p?._summary || row.type,
            createdAt: row.created_at,
            undoToken: p?._undoToken || null,
          };
        });
      } catch (_e) { logger.debug('guidance', 'ok', { error: _e?.message }); }

      res.json({
        ok: true,
        entityType,
        entity,
        versions,
        links,
        recentEvents,
        actions,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Undo System
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/undo", (req, res) => {
    try {
      const { undoToken } = req.body;
      if (!undoToken) return res.status(400).json({ error: "undoToken required" });

      // Find event with this undo token
      const event = db.prepare(
        // TODO: project explicit columns (auto-fix suggestion)
        "SELECT * FROM events WHERE payload_json LIKE ? ORDER BY created_at DESC LIMIT 1"
      ).get(`%"_undoToken":"${escapeLike(undoToken)}"%`);

      if (!event) return res.status(404).json({ error: "Undo token not found or expired" });

      const payload = safeJSON(event.payload_json);
      if (!payload?._undoPayload) return res.status(400).json({ error: "This action is not undoable" });

      const undo = payload._undoPayload;
      const now = nowISO();

      const tx = db.transaction(() => {
        switch (undo.action) {
          case "restore_dtu": {
            // Restore DTU to previous state
            db.prepare(
              "UPDATE dtus SET title = ?, body_json = ?, tags_json = ?, visibility = ?, tier = ?, updated_at = ? WHERE id = ?"
            ).run(undo.previousState.title, undo.previousState.body_json, undo.previousState.tags_json, undo.previousState.visibility, undo.previousState.tier, now, undo.entityId);
            break;
          }
          case "delete_created": {
            // Delete the entity that was just created
            const UNDO_ALLOWED_TABLES = ["dtus", "artifacts", "jobs", "marketplace_listings", "lens_items", "studio_projects"];
            const table = UNDO_ALLOWED_TABLES.includes(undo.table) ? undo.table : "dtus";
            db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(undo.entityId);
            break;
          }
          case "restore_deleted": {
            // Re-insert a soft-deleted entity
            if (undo.table === "dtus") {
              db.prepare(
                "INSERT OR REPLACE INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(undo.previousState.id, undo.previousState.owner_user_id, undo.previousState.title, undo.previousState.body_json, undo.previousState.tags_json, undo.previousState.visibility, undo.previousState.tier, undo.previousState.created_at, now);
            }
            break;
          }
          case "remove_lens_item": {
            db.prepare("DELETE FROM lens_items WHERE id = ?").run(undo.entityId);
            break;
          }
          case "unpublish_listing": {
            db.prepare("UPDATE marketplace_listings SET visibility = 'draft', updated_at = ? WHERE id = ?").run(now, undo.entityId);
            break;
          }
          default:
            throw new Error(`Unknown undo action: ${undo.action}`);
        }

        // Mark original event as undone
        emitEvent(db, {
          type: "UNDO_APPLIED",
          actorUserId: req.user?.id || null,
          scope: "global",
          entityType: payload._entityType,
          entityId: payload._entityId,
          summary: `Undid: ${payload._summary || event.type}`,
          payload: { originalEventId: event.id, undoAction: undo.action },
          requestId: req.headers["x-request-id"],
        });
      });
      tx();

      res.json({ ok: true, message: "Undo applied", originalEvent: event.id });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Enhanced DTU Create/Update with undo + events
  // ═══════════════════════════════════════════════════════════════

  // Override the durable DTU create to emit typed events
  app.post("/api/dtus/guided", (req, res) => {
    try {
      const { title = "Untitled", body, tags = [], visibility = "private", tier = "regular", owner_user_id } = req.body;
      const id = uid("dtu");
      const now = nowISO();
      const versionId = uid("dtuv");

      const tx = db.transaction(() => {
        db.prepare(
          "INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id, owner_user_id || null, title, JSON.stringify(body || {}), JSON.stringify(tags), visibility, tier, now, now);

        db.prepare(
          "INSERT INTO dtu_versions (id, dtu_id, version, body_json, created_at) VALUES (?, ?, 1, ?, ?)"
        ).run(versionId, id, JSON.stringify(body || {}), now);
      });
      tx();

      const { undoToken } = emitEvent(db, {
        type: "DTU_CREATED",
        actorUserId: owner_user_id,
        scope: "global",
        entityType: "dtu",
        entityId: id,
        summary: `Created DTU "${title}"`,
        payload: { dtuId: id, title, visibility, tier },
        requestId: req.headers["x-request-id"],
        undoPayload: { action: "delete_created", table: "dtus", entityId: id },
      });

      res.json({ ok: true, dtu: { id, title, visibility, tier, created_at: now }, undoToken });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DTU Update with undo
  app.put("/api/dtus/guided/:id", (req, res) => {
    try {
      // TODO: project explicit columns (auto-fix suggestion)
      const existing = db.prepare("SELECT * FROM dtus WHERE id = ?").get(req.params.id);
      if (!existing) return res.status(404).json({ error: "DTU not found" });

      const { title, body, tags, visibility, tier } = req.body;
      const now = nowISO();

      // Capture previous state for undo
      const previousState = { ...existing };

      const sets = [];
      const params = [];
      if (title !== undefined) { sets.push("title = ?"); params.push(title); }
      if (body !== undefined) { sets.push("body_json = ?"); params.push(JSON.stringify(body)); }
      if (tags !== undefined) { sets.push("tags_json = ?"); params.push(JSON.stringify(tags)); }
      if (visibility !== undefined) { sets.push("visibility = ?"); params.push(visibility); }
      if (tier !== undefined) { sets.push("tier = ?"); params.push(tier); }

      if (sets.length === 0) return res.json({ ok: true, dtu: existing });

      sets.push("updated_at = ?");
      params.push(now);
      params.push(req.params.id);

      const tx = db.transaction(() => {
        db.prepare(`UPDATE dtus SET ${sets.join(", ")} WHERE id = ?`).run(...params);

        // Create new version
        const versionCount = db.prepare("SELECT COUNT(*) as c FROM dtu_versions WHERE dtu_id = ?").get(req.params.id)?.c || 0;
        db.prepare(
          "INSERT INTO dtu_versions (id, dtu_id, version, body_json, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(uid("dtuv"), req.params.id, versionCount + 1, JSON.stringify(body || safeJSON(existing.body_json) || {}), now);
      });
      tx();

      const { undoToken } = emitEvent(db, {
        type: "DTU_UPDATED",
        actorUserId: req.body.owner_user_id || existing.owner_user_id,
        scope: "global",
        entityType: "dtu",
        entityId: req.params.id,
        summary: `Updated DTU "${title || existing.title}"`,
        payload: { dtuId: req.params.id, changes: Object.keys(req.body).filter((k) => k !== "owner_user_id") },
        requestId: req.headers["x-request-id"],
        undoPayload: { action: "restore_dtu", entityId: req.params.id, previousState },
      });

      // TODO: project explicit columns (auto-fix suggestion)

      const updated = db.prepare("SELECT * FROM dtus WHERE id = ?").get(req.params.id);
      res.json({ ok: true, dtu: updated, undoToken });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DTU Delete with undo
  app.delete("/api/dtus/guided/:id", (req, res) => {
    try {
      // TODO: project explicit columns (auto-fix suggestion)
      const existing = db.prepare("SELECT * FROM dtus WHERE id = ?").get(req.params.id);
      if (!existing) return res.status(404).json({ error: "DTU not found" });

      db.prepare("DELETE FROM dtus WHERE id = ?").run(req.params.id);

      const { undoToken } = emitEvent(db, {
        type: "DTU_DELETED",
        actorUserId: req.body?.owner_user_id || existing.owner_user_id,
        scope: "global",
        entityType: "dtu",
        entityId: req.params.id,
        summary: `Deleted DTU "${existing.title}"`,
        payload: { dtuId: req.params.id },
        requestId: req.headers["x-request-id"],
        undoPayload: { action: "restore_deleted", table: "dtus", entityId: req.params.id, previousState: existing },
      });

      res.json({ ok: true, undoToken });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Guided Lens Sync (with undo)
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/lens-items/guided-sync", (req, res) => {
    try {
      const { lens_id, artifact_id, dtu_id, owner_user_id, metadata } = req.body;
      if (!lens_id) return res.status(400).json({ error: "lens_id required" });
      if (!artifact_id && !dtu_id) return res.status(400).json({ error: "artifact_id or dtu_id required" });

      const id = uid("li");
      db.prepare(
        "INSERT INTO lens_items (id, lens_id, artifact_id, dtu_id, owner_user_id, added_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, lens_id, artifact_id || null, dtu_id || null, owner_user_id || null, nowISO(), JSON.stringify(metadata || {}));

      const { undoToken } = emitEvent(db, {
        type: "LENS_ITEM_SYNCED",
        actorUserId: owner_user_id,
        scope: `lens:${lens_id}`,
        entityType: artifact_id ? "artifact" : "dtu",
        entityId: artifact_id || dtu_id,
        summary: `Synced item to ${lens_id} lens`,
        payload: { lensItemId: id, lensId: lens_id },
        requestId: req.headers["x-request-id"],
        undoPayload: { action: "remove_lens_item", entityId: id },
      });

      res.json({ ok: true, lens_item_id: id, undoToken });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Guided Marketplace Publish (with undo)
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/marketplace/listings/:id/guided-publish", (req, res) => {
    try {
      // TODO: project explicit columns (auto-fix suggestion)
      const listing = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(req.params.id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });
      if (listing.visibility === "published") return res.json({ ok: true, message: "Already published" });

      const assetCount = db.prepare("SELECT COUNT(*) as c FROM marketplace_listing_assets WHERE listing_id = ?").get(req.params.id);
      if (!assetCount || assetCount.c === 0) {
        return res.status(400).json({ error: "Listing must have at least one artifact attached" });
      }

      db.prepare("UPDATE marketplace_listings SET visibility = 'published', updated_at = ? WHERE id = ?").run(nowISO(), req.params.id);

      const { undoToken } = emitEvent(db, {
        type: "MARKETPLACE_LISTING_PUBLISHED",
        actorUserId: listing.owner_user_id,
        scope: "marketplace",
        entityType: "listing",
        entityId: req.params.id,
        summary: `Published listing "${listing.title}"`,
        payload: { listingId: req.params.id },
        requestId: req.headers["x-request-id"],
        undoPayload: { action: "unpublish_listing", entityId: req.params.id },
      });

      res.json({ ok: true, message: "Published", undoToken });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Action Preview (dry-run)
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/preview-action", (req, res) => {
    try {
      const { action, entityType, entityId, params: actionParams } = req.body;
      if (!action) return res.status(400).json({ error: "action required" });

      const preview = { action, entityType, entityId, willCreate: [], willModify: [], willDelete: [], warnings: [] };

      switch (action) {
        case "publish_listing": {
          // TODO: project explicit columns (auto-fix suggestion)
          const listing = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(entityId);
          if (!listing) { preview.warnings.push("Listing not found"); break; }
          preview.willModify.push({ type: "listing", id: entityId, field: "visibility", from: listing.visibility, to: "published" });
          const assets = db.prepare("SELECT COUNT(*) as c FROM marketplace_listing_assets WHERE listing_id = ?").get(entityId);
          if (!assets || assets.c === 0) preview.warnings.push("No assets attached — publish will fail");
          break;
        }
        case "delete_dtu": {
          // TODO: project explicit columns (auto-fix suggestion)
          const dtu = db.prepare("SELECT * FROM dtus WHERE id = ?").get(entityId);
          if (!dtu) { preview.warnings.push("DTU not found"); break; }
          preview.willDelete.push({ type: "dtu", id: entityId, title: dtu.title });
          const lensItems = db.prepare("SELECT COUNT(*) as c FROM lens_items WHERE dtu_id = ?").get(entityId);
          if (lensItems?.c > 0) preview.warnings.push(`${lensItems.c} lens item(s) reference this DTU`);
          break;
        }
        case "sync_to_lens": {
          preview.willCreate.push({ type: "lens_item", lensId: actionParams?.lens_id, entityId });
          break;
        }
        case "render_project": {
          // TODO: project explicit columns (auto-fix suggestion)
          const project = db.prepare("SELECT * FROM studio_projects WHERE id = ?").get(entityId);
          if (!project) { preview.warnings.push("Project not found"); break; }
          preview.willCreate.push({ type: "job", jobType: "studio_render" });
          preview.willCreate.push({ type: "artifact", artifactType: "render" });
          const tracks = db.prepare("SELECT COUNT(*) as c FROM studio_tracks WHERE project_id = ?").get(entityId);
          if (!tracks || tracks.c === 0) preview.warnings.push("Project has no tracks — render may produce empty output");
          break;
        }
        default:
          preview.warnings.push(`Unknown action: ${action}`);
      }

      res.json({ ok: true, preview });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Context Suggestions (deterministic)
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/guidance/suggestions", (req, res) => {
    try {
      const { lens } = req.query;
      const suggestions = [];

      // Count entities
      const dtuCount = db.prepare("SELECT COUNT(*) as c FROM dtus").get()?.c || 0;
      const artifactCount = db.prepare("SELECT COUNT(*) as c FROM artifacts").get()?.c || 0;
      const listingCount = db.prepare("SELECT COUNT(*) as c FROM marketplace_listings WHERE visibility = 'published'").get()?.c || 0;
      const projectCount = db.prepare("SELECT COUNT(*) as c FROM studio_projects").get()?.c || 0;

      // Rule: no DTUs → suggest create
      if (dtuCount === 0) {
        suggestions.push({
          id: "create_first_dtu",
          priority: 1,
          title: "Create your first DTU",
          description: "Discrete Thought Units are the foundation of your knowledge.",
          action: "create_dtu",
          icon: "brain",
        });
      }

      // Rule: DTUs exist but no artifacts → suggest generate
      if (dtuCount > 0 && artifactCount === 0) {
        suggestions.push({
          id: "generate_first_artifact",
          priority: 2,
          title: "Generate an artifact",
          description: "Upload or create a file from your knowledge.",
          action: "upload_artifact",
          icon: "package",
        });
      }

      // Rule: artifact exists, not published → suggest publish
      const unpublishedArtifacts = db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE visibility = 'private'").get()?.c || 0;
      if (unpublishedArtifacts > 0) {
        suggestions.push({
          id: "publish_artifact",
          priority: 3,
          title: "Publish an artifact to Global",
          description: `You have ${unpublishedArtifacts} private artifact(s) that could be shared.`,
          action: "publish_artifact",
          icon: "globe",
        });
      }

      // Rule: published artifacts but no marketplace listing → suggest list
      if (artifactCount > 0 && listingCount === 0) {
        suggestions.push({
          id: "create_listing",
          priority: 4,
          title: "List on Marketplace",
          description: "Share your work and let others access it.",
          action: "create_listing",
          icon: "store",
        });
      }

      // Studio: project exists + no render → suggest render
      if (lens === "studio" || lens === "music") {
        if (projectCount > 0) {
          const renderCount = db.prepare("SELECT COUNT(*) as c FROM studio_renders WHERE status = 'completed'").get()?.c || 0;
          if (renderCount === 0) {
            suggestions.push({
              id: "render_project",
              priority: 2,
              title: "Render your mix",
              description: "Export your project as an audio file.",
              action: "render_project",
              icon: "headphones",
            });
          }
        }
      }

      // Recent errors → suggest debug
      const recentErrorCount = db.prepare(
        "SELECT COUNT(*) as c FROM events WHERE type LIKE '%error%' OR type LIKE '%FAILED%'"
      ).get()?.c || 0;
      if (recentErrorCount > 0) {
        suggestions.push({
          id: "check_errors",
          priority: 1,
          title: "Check recent errors",
          description: `${recentErrorCount} error event(s) detected.`,
          action: "open_debug",
          icon: "alert-triangle",
        });
      }

      suggestions.sort((a, b) => a.priority - b.priority);
      res.json({ ok: true, suggestions: suggestions.slice(0, 5) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // First-Win status
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/guidance/first-win", (req, res) => {
    try {
      const dtuCount = db.prepare("SELECT COUNT(*) as c FROM dtus").get()?.c || 0;
      const artifactCount = db.prepare("SELECT COUNT(*) as c FROM artifacts").get()?.c || 0;

      // Check if user visited global (look for any lens_item synced event)
      let viewedGlobal = false;
      try {
        const globalEvent = db.prepare("SELECT id FROM events WHERE type = 'LENS_ITEM_SYNCED' LIMIT 1").get();
        viewedGlobal = Boolean(globalEvent);
      } catch (_e) { logger.debug('guidance', 'ok', { error: _e?.message }); }

      const steps = [
        { id: "create_dtu", label: "Create your first DTU", completed: dtuCount > 0 },
        { id: "create_artifact", label: "Generate or upload an artifact", completed: artifactCount > 0 },
        { id: "view_global", label: "View it in Global", completed: viewedGlobal },
      ];

      const allDone = steps.every((s) => s.completed);

      res.json({ ok: true, steps, allDone, completedCount: steps.filter((s) => s.completed).length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  logger.log("info", "guidance", "all guidance layer endpoints registered (events, SSE, inspector, undo, suggestions, first-win)");
}

function safeJSON(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch (err) { console.debug('[guidance] JSON parse failed, returning raw string'); return str; }
}

function stripInternal(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith("_")) result[k] = v;
  }
  return result;
}
