// server/lib/house-visit.js
//
// Phase BA2 — house visit (snapshot OR live, owner-toggled).
//
// Snapshot mode: serialized layout cached on the house row, served
// statically. Cheap; no owner needed; no realtime room.
//
// Live mode: opens a Socket.IO room `house:${houseId}` and emits
// `house:visitor-arrived`. Owner can be home or away; visitors see
// other current visitors via the room presence.
//
// Owner toggles `allow_live_visits` (BA1). When off, even public
// houses serve snapshot only. When on, public houses serve live;
// private/friends still gate by visibility (BA1#canVisit).
//
// Snapshot is captured on visibility change AND debounced on
// placeFurniture / removeFurniture (every ~5s of decoration activity).

import logger from "../logger.js";
import { canVisit, getHouse } from "./player-housing.js";

const SNAPSHOT_DEBOUNCE_MS = 5000;
const _pendingSnapshots = new Map(); // houseId → timeout handle

/**
 * Request a visit. Returns `{ ok, mode, payload }` where mode is
 * 'snapshot'|'live'|'owner' and payload is the serialized house data
 * (snapshot) or the room name to subscribe to (live).
 */
export function requestVisit(db, visitorId, houseId, opts = {}) {
  if (!db || !visitorId || !houseId) return { ok: false, error: "missing_inputs" };

  const gate = canVisit(db, visitorId, houseId, opts);
  if (!gate.allowed) return { ok: false, error: gate.reason };

  if (gate.mode === "owner") {
    // Owner viewing own house — always live and unrestricted.
    return { ok: true, mode: "live", payload: { roomName: `house:${houseId}`, owner: true } };
  }

  if (gate.mode === "snapshot") {
    const snap = _loadSnapshot(db, houseId);
    return { ok: true, mode: "snapshot", payload: snap };
  }

  // live mode — emit arrival event via the passed-in io if available.
  if (opts.io) {
    try {
      opts.io.to(`house:${houseId}`).emit("house:visitor-arrived", {
        houseId, visitorId, ts: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      logger.debug?.("house-visit", "emit_failed", { error: err?.message });
    }
  }
  return { ok: true, mode: "live", payload: { roomName: `house:${houseId}` } };
}

/**
 * Walk the house's rooms + furniture_layout + lock state + building
 * health into a single JSON blob. Stored on `player_houses.snapshot_json`
 * so visitors get a frozen render without joining tables on every visit.
 */
export function captureSnapshot(db, houseId) {
  if (!db || !houseId) return { ok: false, error: "missing_inputs" };
  try {
    const house = getHouse(db, houseId);
    if (!house) return { ok: false, error: "no_house" };

    const building = db.prepare(`
      SELECT building_type, x, y, z, width, depth, height, material,
             state, health_pct
      FROM world_buildings WHERE id = ?
    `).get(house.building_id);

    const snapshot = {
      version: 1,
      capturedAt: Math.floor(Date.now() / 1000),
      house: {
        id: house.id,
        name: house.name,
        worldId: house.world_id,
        visibility: house.visibility,
      },
      building,
      rooms: house.rooms.map(r => ({
        id: r.id,
        roomType: r.room_type,
        name: r.name,
        floor: r.floor,
        width: r.width, depth: r.depth, height: r.height,
        x_offset: r.x_offset, z_offset: r.z_offset,
        lockTier: r.lock_tier, lockState: r.lock_state,
        furniture: r.furniture_layout && r.furniture_layout.length > 0
          ? r.furniture_layout
          : (r.furniture || []),
      })),
    };

    db.prepare(`
      UPDATE player_houses SET snapshot_json = ? WHERE id = ?
    `).run(JSON.stringify(snapshot), houseId);
    return { ok: true, snapshot };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/**
 * Debounced snapshot capture. Multiple rapid placeFurniture calls
 * collapse into a single capture ~5s after the last edit. Callers fire
 * and forget.
 */
export function scheduleSnapshotCapture(db, houseId) {
  if (!houseId) return;
  const prev = _pendingSnapshots.get(houseId);
  if (prev) clearTimeout(prev);
  const handle = setTimeout(() => {
    _pendingSnapshots.delete(houseId);
    try { captureSnapshot(db, houseId); }
    catch (err) {
      logger.debug?.("house-visit", "scheduled_capture_failed", { houseId, error: err?.message });
    }
  }, SNAPSHOT_DEBOUNCE_MS);
  if (typeof handle.unref === "function") handle.unref();
  _pendingSnapshots.set(houseId, handle);
}

function _loadSnapshot(db, houseId) {
  try {
    const row = db.prepare(`SELECT snapshot_json FROM player_houses WHERE id = ?`).get(houseId);
    if (row?.snapshot_json) {
      return JSON.parse(row.snapshot_json);
    }
    // No cached snapshot — generate one inline.
    const r = captureSnapshot(db, houseId);
    return r.ok ? r.snapshot : null;
  } catch { return null; }
}

export { SNAPSHOT_DEBOUNCE_MS };
