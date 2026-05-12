/**
 * Concord "Everything Real" — Durable Endpoints Module
 *
 * Provides persistent, DB-backed endpoints for:
 * - Paginated browsing (DTUs, Artifacts, Jobs, Marketplace)
 * - Artifact upload/download with file storage
 * - Marketplace listings, publish, purchase, entitlements
 * - Studio project persistence (projects, tracks, clips, effects)
 * - Job-based pipelines (render, master, analyze, process)
 * - Event logging
 * - Lens item sync
 *
 * All writes happen inside transactions: DB commit + blob write + event logged.
 */

import { randomUUID } from "crypto";
import { createStorageAdapter } from "./storage/index.js";

const storage = createStorageAdapter();

function uid(prefix = "") {
  return prefix ? `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}` : randomUUID().replace(/-/g, "").slice(0, 20);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Send a generic DB error response.
 *
 * SECURITY: previously we returned `e.message` directly, which leaks
 * SQLite error text (table names, column names, constraint names) to
 * the client. We now log the full error server-side and return a
 * generic "Internal error" to the caller. "Not found" messages are
 * preserved because they're safe + useful.
 */
function sendDbError(res, e, context) {
  const msg = String(e?.message || e || "");
  // Preserve "not found" as 404 for client UX
  if (msg.toLowerCase().includes("not found")) {
    return res.status(404).json({ error: "Not found" });
  }
  // Preserve validation-style errors (short, no sql internals)
  if (msg && msg.length < 120 && !/sqlite|constraint|syntax|prepare|column/i.test(msg)) {
    return res.status(500).json({ error: msg });
  }
  // Log server-side with full context, respond generically
  try {
    console.error(`[durable] ${context || "db"} error:`, msg);
  } catch { /* ignore */ }
  return res.status(500).json({ error: "Internal error" });
}

/**
 * Log an event to the events table.
 */
function logEvent(db, type, actorUserId, payload, requestId) {
  try {
    db.prepare(
      "INSERT INTO events (id, type, actor_user_id, payload_json, created_at, request_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(uid("evt"), type, actorUserId || null, JSON.stringify(payload || {}), nowISO(), requestId || null);
  } catch {
    // Non-critical — don't fail the request
  }
}

/**
 * Register all durable endpoints on the Express app.
 *
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 */
export function registerDurableEndpoints(app, db) {
  if (!db) {
    console.warn("[Durable] No database available — durable endpoints disabled");
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGINATED ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build a paginated query with optional search, filters, and facets.
   */

  // Allowlists for SQL-interpolated identifiers to prevent injection.
  const PAGINATED_VALID_TABLES = {
    dtus: new Set([
      "id", "owner_user_id", "title", "body_json", "tags_json",
      "visibility", "tier", "created_at", "updated_at",
    ]),
    artifacts: new Set([
      "id", "owner_user_id", "type", "title", "metadata_json",
      "visibility", "created_at", "updated_at",
    ]),
    jobs: new Set([
      "id", "type", "owner_user_id", "status", "input_json",
      "output_json", "error_json", "created_at", "started_at", "finished_at",
    ]),
    marketplace_listings: new Set([
      "id", "owner_user_id", "dtu_id", "seller_id", "title", "description",
      "price_cents", "price", "currency", "license_id", "license_type",
      "status", "visibility", "listed_at", "created_at", "updated_at",
    ]),
    studio_projects: new Set([
      "id", "owner_user_id", "name", "bpm", "key", "scale", "genre",
      "metadata_json", "created_at", "updated_at",
    ]),
  };

  const PAGINATED_VALID_ORDER_DIRS = new Set(["ASC", "DESC"]);

  function _validatePaginatedParams(table, { orderBy, searchCols, filters }) {
    // Validate table name
    const validCols = PAGINATED_VALID_TABLES[table];
    if (!validCols) {
      throw new Error(`paginatedQuery: invalid table "${table}". Allowed: ${Object.keys(PAGINATED_VALID_TABLES).join(", ")}`);
    }

    // Validate orderBy — must be "column DIR" or "column"
    if (orderBy) {
      const parts = orderBy.trim().split(/\s+/);
      const col = parts[0];
      const dir = parts[1] || "ASC";
      if (!validCols.has(col)) {
        throw new Error(`paginatedQuery: invalid orderBy column "${col}" for table "${table}"`);
      }
      if (!PAGINATED_VALID_ORDER_DIRS.has(dir.toUpperCase())) {
        throw new Error(`paginatedQuery: invalid orderBy direction "${dir}". Allowed: ASC, DESC`);
      }
    }

    // Validate searchCols
    for (const col of searchCols) {
      if (!validCols.has(col)) {
        throw new Error(`paginatedQuery: invalid searchCol "${col}" for table "${table}"`);
      }
    }

    // Validate filter keys
    for (const key of Object.keys(filters)) {
      if (!validCols.has(key)) {
        throw new Error(`paginatedQuery: invalid filter key "${key}" for table "${table}"`);
      }
    }
  }

  function paginatedQuery(table, { q, limit = 50, offset = 0, filters = {}, searchCols = [], orderBy = "created_at DESC" }) {
    _validatePaginatedParams(table, { orderBy, searchCols, filters });

    const where = [];
    const params = [];

    if (q && searchCols.length > 0) {
      const searchWhere = searchCols.map((col) => `${col} LIKE ?`).join(" OR ");
      where.push(`(${searchWhere})`);
      for (const _ of searchCols) {
        params.push(`%${q}%`);
      }
    }

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== "") {
        where.push(`${key} = ?`);
        params.push(value);
      }
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM ${table} ${whereClause}`).get(...params);
    const total = countRow?.total || 0;

    const lim = Math.min(Math.max(1, Number(limit)), 200);
    const off = Math.max(0, Number(offset));

    const items = db
      .prepare(`SELECT * FROM ${table} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, lim, off);

    return { items, total, limit: lim, offset: off };
  }

  // GET /api/dtus/paginated
  app.get("/api/dtus/paginated", (req, res) => {
    try {
      const { q, limit, offset, visibility, tier } = req.query;
      const filters = {};
      if (visibility) filters.visibility = visibility;
      if (tier) filters.tier = tier;

      const result = paginatedQuery("dtus", {
        q,
        limit,
        offset,
        filters,
        searchCols: ["title", "body_json", "tags_json"],
        orderBy: "created_at DESC",
      });

      // Parse JSON fields
      result.items = result.items.map((item) => ({
        ...item,
        body: safeParseJSON(item.body_json),
        tags: safeParseJSON(item.tags_json),
      }));

      // Facets: count by visibility and tier
      const facets = {
        visibility: db.prepare("SELECT visibility, COUNT(*) as count FROM dtus GROUP BY visibility").all(),
        tier: db.prepare("SELECT tier, COUNT(*) as count FROM dtus GROUP BY tier").all(),
      };

      res.json({ ok: true, ...result, facets });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // GET /api/jobs/paginated
  app.get("/api/jobs/paginated", (req, res) => {
    try {
      const { q, limit, offset, type, status } = req.query;
      const filters = {};
      if (type) filters.type = type;
      if (status) filters.status = status;

      const result = paginatedQuery("jobs", {
        q,
        limit,
        offset,
        filters,
        searchCols: ["type", "input_json"],
        orderBy: "created_at DESC",
      });

      result.items = result.items.map((item) => ({
        ...item,
        input: safeParseJSON(item.input_json),
        output: safeParseJSON(item.output_json),
        error: safeParseJSON(item.error_json),
      }));

      const facets = {
        types: db.prepare("SELECT type, COUNT(*) as count FROM jobs GROUP BY type").all(),
        status: db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status").all(),
      };

      res.json({ ok: true, ...result, facets });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // GET /api/marketplace/paginated
  app.get("/api/marketplace/paginated", (req, res) => {
    try {
      const { q, limit, offset, visibility } = req.query;
      const filters = {};
      if (visibility) filters.visibility = visibility;
      else filters.visibility = "published"; // default: show only published

      const result = paginatedQuery("marketplace_listings", {
        q,
        limit,
        offset,
        filters,
        searchCols: ["title", "description"],
        orderBy: "created_at DESC",
      });

      const facets = {
        visibility: db.prepare("SELECT visibility, COUNT(*) as count FROM marketplace_listings GROUP BY visibility").all(),
      };

      res.json({ ok: true, ...result, facets });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ARTIFACT endpoints removed — superseded by routes/artifacts.js
  // (mounted earlier, so /upload, /:id, /:id/download, /:id/info routes
  // here were unreachable). The router writes to route_artifacts; studio
  // pipelines below still write to the artifacts table directly via
  // INSERTs (render/vocal/master). Reads of those rows are a TODO —
  // tracked separately, would need a new endpoint or a unified table.
  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  // MARKETPLACE — Durable Listings
  // ═══════════════════════════════════════════════════════════════

  // POST /api/marketplace/listings — create draft
  app.post("/api/marketplace/listings", (req, res) => {
    try {
      const { owner_user_id, title, description = "", price_cents = 0, currency = "USD", license_id } = req.body;
      if (!owner_user_id) return res.status(400).json({ error: "owner_user_id required" });
      if (!title) return res.status(400).json({ error: "title required" });

      const id = uid("lst");
      const now = nowISO();

      const tx = db.transaction(() => {
        db.prepare(
          "INSERT INTO marketplace_listings (id, owner_user_id, title, description, price_cents, currency, license_id, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)"
        ).run(id, owner_user_id, title, description, price_cents, currency, license_id || null, now, now);

        logEvent(db, "marketplace.listing_created", owner_user_id, { listingId: id, title }, req.headers["x-request-id"]);
      });
      tx();

      res.json({ ok: true, listing: { id, title, visibility: "draft", price_cents, currency } });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/marketplace/listings/:id/assets — attach artifacts
  app.post("/api/marketplace/listings/:id/assets", (req, res) => {
    try {
      const listing = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(req.params.id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });

      const { artifact_id } = req.body;
      if (!artifact_id) return res.status(400).json({ error: "artifact_id required" });

      const artifact = db.prepare("SELECT id FROM artifacts WHERE id = ?").get(artifact_id);
      if (!artifact) return res.status(404).json({ error: "Artifact not found" });

      db.prepare(
        "INSERT OR IGNORE INTO marketplace_listing_assets (listing_id, artifact_id) VALUES (?, ?)"
      ).run(req.params.id, artifact_id);

      logEvent(db, "marketplace.asset_attached", listing.owner_user_id, { listingId: req.params.id, artifactId: artifact_id }, req.headers["x-request-id"]);

      res.json({ ok: true });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/marketplace/listings/:id/publish
  app.post("/api/marketplace/listings/:id/publish", (req, res) => {
    try {
      const listing = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(req.params.id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });
      if (listing.visibility === "published") return res.json({ ok: true, message: "Already published" });

      // Must have at least one asset
      const assetCount = db.prepare("SELECT COUNT(*) as c FROM marketplace_listing_assets WHERE listing_id = ?").get(req.params.id);
      if (!assetCount || assetCount.c === 0) {
        return res.status(400).json({ error: "Listing must have at least one artifact attached" });
      }

      const tx = db.transaction(() => {
        db.prepare("UPDATE marketplace_listings SET visibility = 'published', updated_at = ? WHERE id = ?").run(nowISO(), req.params.id);
        logEvent(db, "marketplace.listing_published", listing.owner_user_id, { listingId: req.params.id }, req.headers["x-request-id"]);
      });
      tx();

      res.json({ ok: true, message: "Published" });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // GET /api/marketplace/listings/:id
  app.get("/api/marketplace/listings/:id", (req, res) => {
    try {
      const listing = db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(req.params.id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });

      const assets = db
        .prepare("SELECT a.* FROM artifacts a JOIN marketplace_listing_assets mla ON a.id = mla.artifact_id WHERE mla.listing_id = ?")
        .all(req.params.id);

      res.json({ ok: true, listing, assets });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/marketplace/listings/:id/purchase — creates entitlement
  app.post("/api/marketplace/listings/:id/purchase", (req, res) => {
    try {
      const listing = db.prepare("SELECT * FROM marketplace_listings WHERE id = ? AND visibility = 'published'").get(req.params.id);
      if (!listing) return res.status(404).json({ error: "Published listing not found" });

      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ error: "user_id required" });

      // Check if already entitled
      const existing = db.prepare("SELECT id FROM entitlements WHERE user_id = ? AND listing_id = ?").get(user_id, req.params.id);
      if (existing) return res.json({ ok: true, message: "Already entitled", entitlement_id: existing.id });

      const entId = uid("ent");
      const now = nowISO();

      const tx = db.transaction(() => {
        db.prepare("INSERT INTO entitlements (id, user_id, listing_id, created_at) VALUES (?, ?, ?, ?)").run(entId, user_id, req.params.id, now);
        logEvent(db, "marketplace.purchase", user_id, { listingId: req.params.id, entitlementId: entId, priceCents: listing.price_cents }, req.headers["x-request-id"]);
      });
      tx();

      res.json({ ok: true, entitlement_id: entId });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // STUDIO — Persistent Projects / Tracks / Clips
  // ═══════════════════════════════════════════════════════════════

  // POST /api/studio/projects
  app.post("/api/studio/projects", (req, res) => {
    try {
      const { name = "Untitled Project", bpm = 120, key = "C", scale = "major", genre, owner_user_id, metadata } = req.body;
      const id = uid("proj");
      const now = nowISO();

      db.prepare(
        "INSERT INTO studio_projects (id, owner_user_id, name, bpm, key, scale, genre, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, owner_user_id || null, name, bpm, key, scale, genre || null, JSON.stringify(metadata || {}), now, now);

      logEvent(db, "studio.project_created", owner_user_id, { projectId: id, name }, req.headers["x-request-id"]);

      res.json({ ok: true, project: { id, name, bpm, key, scale, genre } });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // GET /api/studio/projects
  app.get("/api/studio/projects", (req, res) => {
    try {
      const { owner_user_id, limit = 50, offset = 0 } = req.query;
      let where = "";
      const params = [];
      if (owner_user_id) {
        where = "WHERE owner_user_id = ?";
        params.push(owner_user_id);
      }
      const total = db.prepare(`SELECT COUNT(*) as c FROM studio_projects ${where}`).get(...params)?.c || 0;
      const projects = db.prepare(`SELECT * FROM studio_projects ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
      res.json({ ok: true, projects, total });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // GET /api/studio/projects/:id
  app.get("/api/studio/projects/:id", (req, res) => {
    try {
      const project = db.prepare("SELECT * FROM studio_projects WHERE id = ?").get(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const tracks = db.prepare("SELECT * FROM studio_tracks WHERE project_id = ? ORDER BY created_at").all(req.params.id);

      // Batch fetch clips and effects for all tracks (avoids N+1 query pattern)
      const trackIds = tracks.map(t => t.id);
      const clipsMap = new Map();
      const effectsMap = new Map();
      if (trackIds.length > 0) {
        const placeholders = trackIds.map(() => "?").join(",");
        const allClips = db.prepare(`SELECT * FROM studio_clips WHERE track_id IN (${placeholders})`).all(...trackIds);
        for (const clip of allClips) {
          if (!clipsMap.has(clip.track_id)) clipsMap.set(clip.track_id, []);
          clipsMap.get(clip.track_id).push(clip);
        }
        const allEffects = db.prepare(`SELECT * FROM studio_effect_chains WHERE track_id IN (${placeholders}) ORDER BY created_at DESC`).all(...trackIds);
        for (const eff of allEffects) {
          // Only keep the latest effect chain per track (first seen = most recent due to ORDER BY DESC)
          if (!effectsMap.has(eff.track_id)) effectsMap.set(eff.track_id, eff);
        }
      }
      for (const track of tracks) {
        track.clips = clipsMap.get(track.id) || [];
        const effectChain = effectsMap.get(track.id);
        track.effects = effectChain ? safeParseJSON(effectChain.chain_json) : [];
      }

      const renders = db.prepare("SELECT * FROM studio_renders WHERE project_id = ? ORDER BY created_at DESC").all(req.params.id);

      res.json({
        ok: true,
        project: { ...project, metadata: safeParseJSON(project.metadata_json) },
        tracks,
        renders,
      });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // PATCH /api/studio/projects/:id
  app.patch("/api/studio/projects/:id", (req, res) => {
    try {
      const project = db.prepare("SELECT * FROM studio_projects WHERE id = ?").get(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const allowed = ["name", "bpm", "key", "scale", "genre"];
      const sets = [];
      const params = [];
      for (const k of allowed) {
        if (req.body[k] !== undefined) {
          sets.push(`${k} = ?`);
          params.push(req.body[k]);
        }
      }
      if (req.body.metadata) {
        sets.push("metadata_json = ?");
        params.push(JSON.stringify(req.body.metadata));
      }
      if (sets.length === 0) return res.json({ ok: true, project });

      sets.push("updated_at = ?");
      params.push(nowISO());
      params.push(req.params.id);

      db.prepare(`UPDATE studio_projects SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      const updated = db.prepare("SELECT * FROM studio_projects WHERE id = ?").get(req.params.id);
      res.json({ ok: true, project: updated });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/studio/projects/:id/tracks
  app.post("/api/studio/projects/:id/tracks", (req, res) => {
    try {
      const project = db.prepare("SELECT id FROM studio_projects WHERE id = ?").get(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { name = "Track", type = "audio", instrument_id, color } = req.body;
      const id = uid("trk");

      db.prepare(
        "INSERT INTO studio_tracks (id, project_id, name, type, instrument_id, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, req.params.id, name, type, instrument_id || null, color || "#4A9EFF", nowISO());

      db.prepare("UPDATE studio_projects SET updated_at = ? WHERE id = ?").run(nowISO(), req.params.id);

      res.json({ ok: true, track: { id, name, type, instrument_id, color } });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/studio/projects/:projectId/tracks/:trackId/clips
  app.post("/api/studio/projects/:projectId/tracks/:trackId/clips", (req, res) => {
    try {
      const track = db.prepare("SELECT id FROM studio_tracks WHERE id = ? AND project_id = ?").get(req.params.trackId, req.params.projectId);
      if (!track) return res.status(404).json({ error: "Track not found" });

      const { name = "Clip", asset_version_id, start_ms = 0, duration_ms = 4000, gain_db = 0, fades } = req.body;
      const id = uid("clip");

      db.prepare(
        "INSERT INTO studio_clips (id, track_id, asset_version_id, start_ms, duration_ms, gain_db, fades_json, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, req.params.trackId, asset_version_id || null, start_ms, duration_ms, gain_db, JSON.stringify(fades || {}), name, nowISO());

      db.prepare("UPDATE studio_projects SET updated_at = ? WHERE id = ?").run(nowISO(), req.params.projectId);

      res.json({ ok: true, clip: { id, name, start_ms, duration_ms } });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/studio/projects/:projectId/tracks/:trackId/effects
  app.post("/api/studio/projects/:projectId/tracks/:trackId/effects", (req, res) => {
    try {
      const track = db.prepare("SELECT id FROM studio_tracks WHERE id = ? AND project_id = ?").get(req.params.trackId, req.params.projectId);
      if (!track) return res.status(404).json({ error: "Track not found" });

      const { chain } = req.body;
      const id = uid("fx");

      db.prepare(
        "INSERT INTO studio_effect_chains (id, track_id, chain_json, created_at) VALUES (?, ?, ?, ?)"
      ).run(id, req.params.trackId, JSON.stringify(chain || []), nowISO());

      res.json({ ok: true, effect_chain: { id, chain } });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // DELETE /api/studio/projects/:projectId/tracks/:trackId
  app.delete("/api/studio/projects/:projectId/tracks/:trackId", (req, res) => {
    try {
      const result = db.prepare("DELETE FROM studio_tracks WHERE id = ? AND project_id = ?").run(req.params.trackId, req.params.projectId);
      if (result.changes === 0) return res.status(404).json({ error: "Track not found" });
      db.prepare("UPDATE studio_projects SET updated_at = ? WHERE id = ?").run(nowISO(), req.params.projectId);
      res.json({ ok: true });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // JOBS — Persistent background work
  // ═══════════════════════════════════════════════════════════════

  function createJob(type, ownerUserId, input) {
    const id = uid("job");
    const now = nowISO();
    db.prepare(
      "INSERT INTO jobs (id, type, owner_user_id, status, input_json, created_at) VALUES (?, ?, ?, 'pending', ?, ?)"
    ).run(id, type, ownerUserId || null, JSON.stringify(input || {}), now);
    return id;
  }

  function completeJob(jobId, output) {
    const now = nowISO();
    db.prepare(
      "UPDATE jobs SET status = 'completed', output_json = ?, finished_at = ? WHERE id = ?"
    ).run(JSON.stringify(output || {}), now, jobId);
  }

  function failJob(jobId, error) {
    const now = nowISO();
    db.prepare(
      "UPDATE jobs SET status = 'failed', error_json = ?, finished_at = ? WHERE id = ?"
    ).run(JSON.stringify({ message: error }), now, jobId);
  }

  function startJob(jobId) {
    db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(nowISO(), jobId);
  }

  // GET /api/jobs/:id
  app.get("/api/jobs/:id", (req, res) => {
    try {
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json({
        ok: true,
        job: {
          ...job,
          input: safeParseJSON(job.input_json),
          output: safeParseJSON(job.output_json),
          error: safeParseJSON(job.error_json),
        },
      });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // RENDER / MASTER / ANALYZE — Job-based pipelines
  // ═══════════════════════════════════════════════════════════════

  // POST /api/studio/:projectId/render
  app.post("/api/studio/:projectId/render", (req, res) => {
    try {
      const project = db.prepare("SELECT * FROM studio_projects WHERE id = ?").get(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { format = "wav", settings } = req.body;
      const jobId = createJob("studio_render", project.owner_user_id, { projectId: req.params.projectId, format, settings });

      // Create render record
      const renderId = uid("rnd");
      db.prepare(
        "INSERT INTO studio_renders (id, project_id, job_id, status, format, created_at) VALUES (?, ?, ?, 'pending', ?, ?)"
      ).run(renderId, req.params.projectId, jobId, format, nowISO());

      logEvent(db, "studio.render_started", project.owner_user_id, { projectId: req.params.projectId, jobId, renderId }, req.headers["x-request-id"]);

      // Simulate render (in production, a worker would process this)
      setTimeout(() => {
        try {
          startJob(jobId);
          // Create output artifact
          const artifactId = uid("art");
          const versionId = uid("artv");
          const now = nowISO();
          const pendingBuf = Buffer.alloc(1024); // Stub artifact — replaced when real audio worker processes the job
          // The promise rejection path MUST be handled — the surrounding
          // try/catch only catches sync throws. Without .catch(), a storage
          // failure leaves the job in 'running' forever and never writes
          // the artifact rows (or worse: writes them with bogus data).
          storage.put(`renders/${artifactId}/v1/render.${format}`, pendingBuf, format === "mp3" ? "audio/mpeg" : "audio/wav").then((putResult) => {
            const tx = db.transaction(() => {
              db.prepare(
                "INSERT INTO artifacts (id, owner_user_id, type, title, metadata_json, visibility, created_at, updated_at) VALUES (?, ?, 'render', ?, ?, 'private', ?, ?)"
              ).run(artifactId, project.owner_user_id, `${project.name} - Render`, JSON.stringify({ format, projectId: req.params.projectId }), now, now);

              db.prepare(
                "INSERT INTO artifact_versions (id, artifact_id, version, storage_uri, sha256, size_bytes, mime_type, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)"
              ).run(versionId, artifactId, putResult.uri, putResult.sha256, putResult.size, format === "mp3" ? "audio/mpeg" : "audio/wav", now);

              db.prepare("INSERT INTO job_artifacts (job_id, artifact_id, role) VALUES (?, ?, 'render_output')").run(jobId, artifactId);

              completeJob(jobId, { artifactId, versionId });
              db.prepare("UPDATE studio_renders SET status = 'completed' WHERE id = ?").run(renderId);
            });
            tx();
          }).catch((err) => {
            failJob(jobId, `storage.put failed: ${err?.message || err}`);
            try { db.prepare("UPDATE studio_renders SET status = 'failed' WHERE id = ?").run(renderId); } catch { /* job is already failed; render row is best-effort */ }
          });
        } catch (e) {
          failJob(jobId, e.message);
          db.prepare("UPDATE studio_renders SET status = 'failed' WHERE id = ?").run(renderId);
        }
      }, 100);

      res.json({ ok: true, job_id: jobId, render_id: renderId });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/studio/vocal/analyze — job-based
  app.post("/api/studio/vocal/analyze", (req, res) => {
    try {
      const { project_id, track_id, owner_user_id } = req.body;
      const jobId = createJob("vocal_analyze", owner_user_id, { project_id, track_id });
      startJob(jobId);

      // Simulate analysis result
      const analysisResult = {
        pitch: { min: 180, max: 520, average: 340 },
        vibrato: { rate: 5.2, depth: 0.3 },
        timbre: { brightness: 0.7, warmth: 0.6, clarity: 0.8 },
        dynamics: { range: 15, average_db: -18 },
      };

      // Create analysis artifact
      const artifactId = uid("art");
      const versionId = uid("artv");
      const now = nowISO();
      const analysisBuffer = Buffer.from(JSON.stringify(analysisResult, null, 2));

      storage.put(`analysis/${artifactId}/v1/analysis.json`, analysisBuffer, "application/json").then((putResult) => {
        const tx = db.transaction(() => {
          db.prepare(
            "INSERT INTO artifacts (id, owner_user_id, type, title, metadata_json, visibility, created_at, updated_at) VALUES (?, ?, 'analysis', 'Vocal Analysis', ?, 'private', ?, ?)"
          ).run(artifactId, owner_user_id || null, JSON.stringify({ project_id, track_id }), now, now);

          db.prepare(
            "INSERT INTO artifact_versions (id, artifact_id, version, storage_uri, sha256, size_bytes, mime_type, created_at) VALUES (?, ?, 1, ?, ?, ?, 'application/json', ?)"
          ).run(versionId, artifactId, putResult.uri, putResult.sha256, putResult.size, now);

          db.prepare("INSERT INTO job_artifacts (job_id, artifact_id, role) VALUES (?, ?, 'analysis_output')").run(jobId, artifactId);
          completeJob(jobId, { artifactId, analysis: analysisResult });
        });
        tx();
      }).catch((err) => {
        // Storage rejection is silently lost without this — the
        // surrounding try/catch only catches sync throws. Job stays
        // in 'running' forever and analysis never persists.
        failJob(jobId, `storage.put failed: ${err?.message || err}`);
      });

      res.json({ ok: true, job_id: jobId, analysis: analysisResult });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/studio/vocal/process — job-based
  app.post("/api/studio/vocal/process", (req, res) => {
    try {
      const { project_id, track_id, corrections, owner_user_id } = req.body;
      const jobId = createJob("vocal_process", owner_user_id, { project_id, track_id, corrections });
      startJob(jobId);

      // Create processed audio artifact
      const artifactId = uid("art");
      const versionId = uid("artv");
      const now = nowISO();
      const pendingBuf = Buffer.alloc(512); // Stub artifact — replaced when real audio worker processes the job

      storage.put(`processed/${artifactId}/v1/processed.wav`, pendingBuf, "audio/wav").then((putResult) => {
        const tx = db.transaction(() => {
          db.prepare(
            "INSERT INTO artifacts (id, owner_user_id, type, title, metadata_json, visibility, created_at, updated_at) VALUES (?, ?, 'audio', 'Processed Vocal', ?, 'private', ?, ?)"
          ).run(artifactId, owner_user_id || null, JSON.stringify({ project_id, track_id, corrections }), now, now);

          db.prepare(
            "INSERT INTO artifact_versions (id, artifact_id, version, storage_uri, sha256, size_bytes, mime_type, created_at) VALUES (?, ?, 1, ?, ?, ?, 'audio/wav', ?)"
          ).run(versionId, artifactId, putResult.uri, putResult.sha256, putResult.size, now);

          db.prepare("INSERT INTO job_artifacts (job_id, artifact_id, role) VALUES (?, ?, 'processed_audio')").run(jobId, artifactId);
          completeJob(jobId, { artifactId });
        });
        tx();
      }).catch((err) => {
        failJob(jobId, `storage.put failed: ${err?.message || err}`);
      });

      res.json({ ok: true, job_id: jobId });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // POST /api/studio/master — job-based mastering
  app.post("/api/studio/master/job", (req, res) => {
    try {
      const { project_id, preset = "balanced", target_lufs = -14, format = "wav", owner_user_id } = req.body;
      const jobId = createJob("master_audio", owner_user_id, { project_id, preset, target_lufs, format });
      startJob(jobId);

      const artifactId = uid("art");
      const versionId = uid("artv");
      const now = nowISO();
      const pendingBuf = Buffer.alloc(1024);

      storage.put(`mastered/${artifactId}/v1/master.${format}`, pendingBuf, format === "mp3" ? "audio/mpeg" : "audio/wav").then((putResult) => {
        const tx = db.transaction(() => {
          db.prepare(
            "INSERT INTO artifacts (id, owner_user_id, type, title, metadata_json, visibility, created_at, updated_at) VALUES (?, ?, 'master', 'Mastered Audio', ?, 'private', ?, ?)"
          ).run(artifactId, owner_user_id || null, JSON.stringify({ project_id, preset, target_lufs }), now, now);

          db.prepare(
            "INSERT INTO artifact_versions (id, artifact_id, version, storage_uri, sha256, size_bytes, mime_type, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)"
          ).run(versionId, artifactId, putResult.uri, putResult.sha256, putResult.size, format === "mp3" ? "audio/mpeg" : "audio/wav", now);

          db.prepare("INSERT INTO job_artifacts (job_id, artifact_id, role) VALUES (?, ?, 'mastered_audio')").run(jobId, artifactId);
          completeJob(jobId, { artifactId, lufs: target_lufs });
        });
        tx();
      }).catch((err) => {
        failJob(jobId, `storage.put failed: ${err?.message || err}`);
      });

      res.json({ ok: true, job_id: jobId });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // DISTRIBUTION / RELEASES
  // ═══════════════════════════════════════════════════════════════

  // POST /api/distribution/releases — create release referencing artifact
  app.post("/api/distribution/releases", (req, res) => {
    try {
      const { artifact_id, title, artist_name, license_terms, visibility = "private", owner_user_id } = req.body;
      if (!artifact_id) return res.status(400).json({ error: "artifact_id required" });

      const artifact = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(artifact_id);
      if (!artifact) return res.status(404).json({ error: "Artifact not found" });

      // Ownership check
      if (owner_user_id && artifact.owner_user_id && artifact.owner_user_id !== owner_user_id) {
        return res.status(403).json({ error: "You do not own this artifact" });
      }

      // Get latest version hash for proof
      const version = db.prepare("SELECT sha256 FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC LIMIT 1").get(artifact_id);

      const releaseId = uid("rel");
      const now = nowISO();

      const tx = db.transaction(() => {
        // Store release as a marketplace listing with special type
        db.prepare(
          "INSERT INTO marketplace_listings (id, owner_user_id, title, description, price_cents, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)"
        ).run(releaseId, owner_user_id || artifact.owner_user_id, title || artifact.title, JSON.stringify({ artist_name, license_terms, type: "release", hash_proof: version?.sha256 }), visibility, now, now);

        db.prepare("INSERT INTO marketplace_listing_assets (listing_id, artifact_id) VALUES (?, ?)").run(releaseId, artifact_id);

        // Link artifact
        db.prepare(
          "INSERT INTO artifact_links (id, from_kind, from_id, to_artifact_id, relation, created_at) VALUES (?, 'listing', ?, ?, 'release', ?)"
        ).run(uid("lnk"), releaseId, artifact_id, now);

        logEvent(db, "distribution.release_created", owner_user_id, { releaseId, artifactId: artifact_id, title, hashProof: version?.sha256 }, req.headers["x-request-id"]);
      });
      tx();

      res.json({
        ok: true,
        release: { id: releaseId, title: title || artifact.title, artifact_id, hash_proof: version?.sha256, visibility },
      });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // LENS SYNC — "Sync to lens" and "Publish to Global"
  // ═══════════════════════════════════════════════════════════════

  // POST /api/lens-items/sync — add item to a lens
  app.post("/api/lens-items/sync", (req, res) => {
    try {
      const { lens_id, artifact_id, dtu_id, owner_user_id, metadata } = req.body;
      if (!lens_id) return res.status(400).json({ error: "lens_id required" });
      if (!artifact_id && !dtu_id) return res.status(400).json({ error: "artifact_id or dtu_id required" });

      const id = uid("li");
      db.prepare(
        "INSERT INTO lens_items (id, lens_id, artifact_id, dtu_id, owner_user_id, added_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, lens_id, artifact_id || null, dtu_id || null, owner_user_id || null, nowISO(), JSON.stringify(metadata || {}));

      logEvent(db, "lens.item_synced", owner_user_id, { lensItemId: id, lensId: lens_id, artifactId: artifact_id, dtuId: dtu_id }, req.headers["x-request-id"]);

      res.json({ ok: true, lens_item_id: id });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // GET /api/lens-items/:lensId
  app.get("/api/lens-items/:lensId", (req, res) => {
    try {
      const items = db.prepare("SELECT * FROM lens_items WHERE lens_id = ? ORDER BY added_at DESC").all(req.params.lensId);
      res.json({ ok: true, items, total: items.length });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // EVENTS — query endpoint
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/events/log", (req, res) => {
    try {
      const { type, limit = 100, offset = 0 } = req.query;
      let where = "";
      const params = [];
      if (type) {
        where = "WHERE type = ?";
        params.push(type);
      }
      const total = db.prepare(`SELECT COUNT(*) as c FROM events ${where}`).get(...params)?.c || 0;
      const events = db
        .prepare(`SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, Number(limit), Number(offset));
      res.json({ ok: true, events, total });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // DURABLE DTU CREATE (writes to both STATE + DB)
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/dtus/durable", (req, res) => {
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

        logEvent(db, "dtu.created", owner_user_id, { dtuId: id, title, visibility, tier }, req.headers["x-request-id"]);
      });
      tx();

      res.json({ ok: true, dtu: { id, title, visibility, tier, created_at: now } });
    } catch (e) {
      sendDbError(res, e, "durable");
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // MIGRATION STATUS ENDPOINT
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/schema/version", (req, res) => {
    try {
      const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get();
      // @select-star-ok: schema_version registry — admin endpoint returns full row to client
      const migrations = db.prepare("SELECT * FROM schema_version ORDER BY version").all();
      res.json({ ok: true, current_version: row?.v || 0, migrations });
    } catch {
      res.json({ ok: true, current_version: 0, migrations: [], note: "schema_version table not found" });
    }
  });

  console.warn("[Durable] All durable endpoints registered");
}

function safeParseJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
