// server/domains/hub.js
//
// Concordia Hub lens-action domain (id "hub"). Backs the de-demo'd
// ConcordiaHub panel with REAL recent world activity + REAL per-district
// counts. The panel keeps its authored district LAYOUT config; this domain
// supplies the data its activity feed and building/population/online counts
// were previously faking.
//
// Honest by construction: the activity feed aggregates genuinely-recorded
// hub activity events plus real `world_events` rows (read from ctx.db when a
// DB handle is present) — newest-first, EMPTY when there is none. It NEVER
// fabricates "@user did X" rows. District counts are computed from recorded
// activity (and real `world_buildings` rows when a worldId + db are present),
// honestly returning 0 when no source data exists.
//
// In-memory, STATE-backed (STATE.hubActivity), no migrations.
//
// Macros: activity-feed, activity-record, district-stats, hub-totals.

export default function registerHubActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function store() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    STATE.hubActivity ??= []; // Array<ActivityEvent> newest pushed last
    if (!Array.isArray(STATE.hubActivity)) STATE.hubActivity = [];
    return STATE;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Recognised activity kinds (kept open — anything else normalises to "event").
  const KINDS = ["building", "material", "discovery", "event", "trade", "validation"];
  const normKind = (k) => {
    const v = String(k || "").trim().toLowerCase();
    return KINDS.includes(v) ? v : "event";
  };

  const MAX_ACTIVITY = 1000; // in-memory upper bound

  // Best-effort handle to the live sqlite DB (present in production via
  // makeCtx → STATE.db; absent under the local-shim test → graceful 0/empty).
  function dbHandle(ctx) {
    return ctx?.db || globalThis._concordSTATE?.db || null;
  }

  // Pull recent real world_events rows (if the table + db are present).
  // Returns [] on any absence/error — never throws, never fabricates.
  function readWorldEvents(db, { worldId, limit } = {}) {
    if (!db || typeof db.prepare !== "function") return [];
    try {
      const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 50;
      let rows;
      if (worldId) {
        rows = db.prepare(
          `SELECT id, world_id, event_type, kind, title, description, created_at
             FROM world_events
            WHERE world_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
        ).all(String(worldId), lim);
      } else {
        rows = db.prepare(
          `SELECT id, world_id, event_type, kind, title, description, created_at
             FROM world_events
            ORDER BY created_at DESC
            LIMIT ?`,
        ).all(lim);
      }
      return (rows || []).map((r) => {
        // world_events.created_at is unixepoch seconds; normalise to ms + ISO.
        const ms = Number(r.created_at) > 0 ? Number(r.created_at) * 1000 : 0;
        return {
          id: `we_${r.id}`,
          districtId: r.world_id ? String(r.world_id) : null,
          kind: normKind(r.kind || r.event_type),
          actor: null, // world-generated events have no individual actor
          summary: String(r.title || r.description || r.event_type || "World event"),
          source: "world_events",
          at: ms > 0 ? new Date(ms).toISOString() : null,
          ts: ms,
        };
      });
    } catch (_e) {
      return [];
    }
  }

  // Real building count for a world from world_buildings (if present).
  // Returns null when no DB source exists so callers can be honest (0).
  function readBuildingCount(db, worldId) {
    if (!db || typeof db.prepare !== "function" || !worldId) return null;
    try {
      const row = db.prepare(
        "SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?",
      ).get(String(worldId));
      return row ? Number(row.n) || 0 : 0;
    } catch (_e) {
      return null;
    }
  }

  // ── activity-record ──────────────────────────────────────────────
  // Append a REAL activity event the caller actually observed.
  registerLensAction("hub", "activity-record", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const p = params || {};
      const districtId = String(p.districtId || "").trim();
      if (!districtId) return { ok: false, error: "districtId required" };
      const summary = String(p.summary || "").trim();
      if (!summary) return { ok: false, error: "summary required" };
      const at = p.at ? new Date(p.at) : new Date();
      if (Number.isNaN(at.getTime())) return { ok: false, error: "invalid timestamp" };
      // actor defaults to the authenticated caller; explicit actor honoured.
      const actor = p.actor !== undefined && p.actor !== null
        ? String(p.actor).trim() || null
        : aid(ctx);
      const event = {
        id: sid("hub"),
        districtId,
        kind: normKind(p.kind),
        actor,
        summary,
        source: "recorded",
        at: at.toISOString(),
        ts: at.getTime(),
      };
      STATE.hubActivity.push(event);
      if (STATE.hubActivity.length > MAX_ACTIVITY) {
        STATE.hubActivity.splice(0, STATE.hubActivity.length - MAX_ACTIVITY);
      }
      save();
      return { ok: true, result: { event, activityCount: STATE.hubActivity.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── activity-feed ────────────────────────────────────────────────
  // Newest-first aggregation of recorded hub activity + real world_events.
  // Optionally filtered by districtId. EMPTY when no source has data.
  registerLensAction("hub", "activity-feed", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const p = params || {};
      const districtId = p.districtId ? String(p.districtId).trim() : null;
      const limit = Number.isFinite(Number(p.limit)) && Number(p.limit) > 0
        ? Math.floor(Number(p.limit)) : 50;

      // 1) Recorded hub activity (genuine — only what activity-record appended).
      let recorded = STATE.hubActivity.slice();
      if (districtId) recorded = recorded.filter((e) => e.districtId === districtId);

      // 2) Real world_events from the live DB (scoped to district/world when given).
      const worldEvents = readWorldEvents(dbHandle(ctx), { worldId: districtId, limit });

      // Merge, newest-first by ts. No fabrication — both sources are real.
      const merged = recorded.concat(worldEvents);
      merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const events = merged.slice(0, limit);

      return {
        ok: true,
        result: {
          districtId: districtId || null,
          events,
          count: events.length,
          sources: { recorded: recorded.length, worldEvents: worldEvents.length },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── district-stats ───────────────────────────────────────────────
  // REAL per-district counts. buildingCount comes from world_buildings when a
  // worldId + DB are present (else honest 0). population/activeUsers are
  // derived strictly from recorded activity (distinct actors seen). Honest 0
  // when nothing has been recorded for the district.
  registerLensAction("hub", "district-stats", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const p = params || {};
      const districtId = String(p.districtId || "").trim();
      if (!districtId) return { ok: false, error: "districtId required" };

      const recorded = STATE.hubActivity.filter((e) => e.districtId === districtId);

      // activeUsers: distinct real actors that produced activity within the
      // recency window (default 1h); population: distinct actors all-time.
      const windowMs = Number.isFinite(Number(p.windowMs)) && Number(p.windowMs) > 0
        ? Math.floor(Number(p.windowMs)) : 60 * 60 * 1000;
      const now = Date.now();
      const allActors = new Set();
      const recentActors = new Set();
      for (const e of recorded) {
        if (!e.actor) continue;
        allActors.add(e.actor);
        if (now - (e.ts || 0) <= windowMs) recentActors.add(e.actor);
      }

      // buildingCount: real from world_buildings when a worldId maps to it.
      const worldId = p.worldId ? String(p.worldId) : districtId;
      const dbCount = readBuildingCount(dbHandle(ctx), worldId);
      const buildingCount = dbCount === null ? 0 : dbCount;

      return {
        ok: true,
        result: {
          districtId,
          buildingCount,
          population: allActors.size,
          activeUsers: recentActors.size,
          activityCount: recorded.length,
          // honest provenance flags so the UI can tell "real 0" from "no source"
          hasBuildingSource: dbCount !== null,
          hasActivity: recorded.length > 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── hub-totals ───────────────────────────────────────────────────
  // Aggregate across districts. With no `districtIds` param, aggregates every
  // district that has recorded activity; with one, aggregates exactly those
  // (so the frontend can total its authored layout). All counts are real.
  registerLensAction("hub", "hub-totals", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const p = params || {};

      const requested = Array.isArray(p.districtIds)
        ? p.districtIds.map((d) => String(d || "").trim()).filter(Boolean)
        : null;

      // Districts that actually have recorded activity.
      const seen = new Set();
      for (const e of STATE.hubActivity) if (e.districtId) seen.add(e.districtId);

      const districtIds = requested && requested.length
        ? requested
        : [...seen];

      const db = dbHandle(ctx);
      const windowMs = Number.isFinite(Number(p.windowMs)) && Number(p.windowMs) > 0
        ? Math.floor(Number(p.windowMs)) : 60 * 60 * 1000;
      const now = Date.now();

      let totalBuildings = 0;
      const allActors = new Set();
      const recentActors = new Set();
      const districts = [];

      for (const districtId of districtIds) {
        const recorded = STATE.hubActivity.filter((e) => e.districtId === districtId);
        const dActors = new Set();
        const dRecent = new Set();
        for (const e of recorded) {
          if (!e.actor) continue;
          allActors.add(e.actor); dActors.add(e.actor);
          if (now - (e.ts || 0) <= windowMs) { recentActors.add(e.actor); dRecent.add(e.actor); }
        }
        const dbCount = readBuildingCount(db, districtId);
        const buildingCount = dbCount === null ? 0 : dbCount;
        totalBuildings += buildingCount;
        districts.push({
          districtId,
          buildingCount,
          population: dActors.size,
          activeUsers: dRecent.size,
          activityCount: recorded.length,
        });
      }

      return {
        ok: true,
        result: {
          districtCount: districts.length,
          totalBuildings,
          totalPopulation: allActors.size,
          totalActiveUsers: recentActors.size,
          districts,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
