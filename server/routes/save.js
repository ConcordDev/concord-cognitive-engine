// server/routes/save.js
//
// User-facing save status + manual sync surface.
//
// Backend autosave runs continuously on the heartbeat tick (DTU pipeline,
// world events, royalty cascade, etc.) — there's no "save game" moment.
// This route exists for the user-visible save panel: reports per-subsystem
// freshness and exposes a manual snapshot trigger.
//
// GET  /api/save/status — per-subsystem last-write timestamps + summary.
// POST /api/save/manual — force a state-migration exportFull snapshot.

import { exportFull } from "../emergent/state-migration.js";

const FRESHNESS_QUERIES = [
  // [name, sql]. Each query must select exactly one timestamp column
  // aliased to `t` (or NULL if the table is empty / not yet present).
  // Wrapped in try/catch so a missing table doesn't break the whole endpoint.
  { name: "DTU substrate",      sql: "SELECT MAX(created_at) AS t FROM dtus" },
  { name: "World buildings",    sql: "SELECT MAX(updated_at) AS t FROM world_buildings" },
  { name: "Player inventory",   sql: "SELECT MAX(updated_at) AS t FROM player_inventory" },
  { name: "Skill progression",  sql: "SELECT MAX(updated_at) AS t FROM user_skill_progress" },
  { name: "Wallet ledger",      sql: "SELECT MAX(created_at) AS t FROM economy_ledger" },
  { name: "World events",       sql: "SELECT MAX(created_at) AS t FROM world_events" },
];

function _readFreshness(db) {
  const rows = [];
  // @sql-loop-ok: iterates FRESHNESS_QUERIES constant array (5 fixed queries)
  for (const q of FRESHNESS_QUERIES) {
    try {
      const r = db.prepare(q.sql).get();
      const ts = r?.t ? new Date(r.t).toISOString() : null;
      rows.push({ name: q.name, lastSaved: ts, status: ts ? "saved" : "pending" });
    } catch {
      // Table missing / SQL error — pending status with null timestamp.
      rows.push({ name: q.name, lastSaved: null, status: "pending" });
    }
  }
  return rows;
}

let _lastManualSaveAt = null;

// Map subsystem name → frontend lucide icon name. Frontend resolves
// to actual ComponentType via its lucide-react import.
const DEFAULT_ICONS = {
  "DTU substrate": "Database",
  "World buildings": "Globe",
  "Player inventory": "Backpack",
  "Skill progression": "Award",
  "Wallet ledger": "Coins",
  "World events": "CalendarDays",
};

export function registerSaveRoutes(app, deps) {
  const { db, asyncHandler, STATE, ICONS = DEFAULT_ICONS } = deps;

  app.get("/api/save/status", asyncHandler(async (_req, res) => {
    const subsystems = _readFreshness(db);
    const ts = subsystems
      .map((s) => s.lastSaved)
      .filter(Boolean)
      .sort();
    const lastSaveTime = ts[ts.length - 1] || _lastManualSaveAt || new Date().toISOString();
    const saveState = { autoSaving: false, lastSaveTime, subsystems };

    // worldPersistence is a UI structure: same per-subsystem entries
    // labelled with icon NAMES (frontend resolves to lucide icons via
    // the ICONS map at the JSX boundary; we send strings, not refs).
    const worldPersistence = {
      entries: subsystems.map((s) => ({
        label: s.name,
        lastUpdated: s.lastSaved || new Date(0).toISOString(),
        iconName: ICONS[s.name] || "Database",
      })),
    };

    res.json({ ok: true, saveState, offlineCalcs: null, worldPersistence });
  }));

  app.post("/api/save/manual", asyncHandler(async (_req, res) => {
    try {
      const snap = await exportFull(STATE);
      _lastManualSaveAt = new Date().toISOString();
      // Don't return the full snapshot payload — it can be MB-scale.
      // The user only needs the success signal + checksum.
      res.json({
        ok: true,
        savedAt: _lastManualSaveAt,
        checksum: snap?.checksum,
        size: snap?.payload ? JSON.stringify(snap.payload).length : 0,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || "snapshot failed" });
    }
  }));
}
