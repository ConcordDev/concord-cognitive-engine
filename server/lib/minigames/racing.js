// server/lib/minigames/racing.js
//
// Vehicle racing minigame engine. Multi-racer, checkpoint-driven, with
// anti-cheat on lap times.
//
// Anti-cheat: each vehicle class has a max speed; a checkpoint reached
// faster than physics would allow (delta-t × max-speed < distance to
// previous checkpoint) is rejected. Pattern reused from the combat
// reach validator.

import crypto from "crypto";

const VEHICLE_MAX_SPEED_M_S = {
  car:    40,
  glider: 60,
  plane:  150,
};

function _newId() {
  return `mg_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)}`;
}

export function createRace(db, { worldId = "concordia-hub", districtId = null, trackId, racerIds, lapCount = 3, allowedVehicleClasses = ["car"] } = {}) {
  if (!db) return { ok: false, error: "db_required" };
  if (!Array.isArray(racerIds) || racerIds.length < 1) return { ok: false, error: "racers_required" };
  if (!trackId) return { ok: false, error: "trackId_required" };
  const id = _newId();
  const startingScores = Object.fromEntries(racerIds.map((r) => [r, { lap: 0, lastCheckpoint: -1, totalTime: 0 }]));
  db.prepare(`
    INSERT INTO minigame_matches
      (id, kind, world_id, district_id, players_json, scores_json, meta_json)
    VALUES (?, 'racing', ?, ?, ?, ?, ?)
  `).run(
    id, worldId, districtId,
    JSON.stringify(racerIds),
    JSON.stringify(startingScores),
    JSON.stringify({ trackId, lapCount, allowedVehicleClasses }),
  );
  return { ok: true, raceId: id };
}

/**
 * Record a checkpoint hit. validates against time delta + vehicle max
 * speed + distance from prev checkpoint. Track checkpoint coordinates
 * are passed in from the caller (frontend track loader knows them).
 */
export function recordCheckpoint(db, raceId, {
  racerId, checkpointIdx, checkpointPos, prevCheckpointPos = null,
  vehicleClass = "car", t = Date.now(),
} = {}) {
  const m = db.prepare(`SELECT * FROM minigame_matches WHERE id = ?`).get(raceId);
  if (!m) return { ok: false, error: "race_not_found" };
  if (m.status !== "active") return { ok: false, error: "race_not_active" };
  const racers = JSON.parse(m.players_json);
  if (!racers.includes(racerId)) return { ok: false, error: "not_a_racer" };
  const meta = JSON.parse(m.meta_json || "{}");
  if (!meta.allowedVehicleClasses?.includes(vehicleClass)) {
    return { ok: false, error: "vehicle_class_not_allowed", allowed: meta.allowedVehicleClasses };
  }

  const scores = JSON.parse(m.scores_json);
  const racerState = scores[racerId];
  if (!racerState) return { ok: false, error: "racer_state_missing" };

  // Anti-cheat: validate time delta vs distance vs vehicle max speed.
  if (prevCheckpointPos && racerState.lastCheckpoint >= 0) {
    const lastT = racerState.lastCheckpointAt || (t - 1000);
    const dt = (t - lastT) / 1000; // seconds
    const dx = (checkpointPos.x ?? 0) - (prevCheckpointPos.x ?? 0);
    const dz = (checkpointPos.z ?? 0) - (prevCheckpointPos.z ?? 0);
    const distance = Math.sqrt(dx * dx + dz * dz);
    const maxSpeed = VEHICLE_MAX_SPEED_M_S[vehicleClass] ?? 40;
    const minPlausibleDt = distance / (maxSpeed * 1.1); // 10% generosity
    if (dt < minPlausibleDt - 0.1) {
      return { ok: false, error: "checkpoint_too_fast", dt, distance, maxSpeed };
    }
  }

  // Record the event
  db.prepare(`
    INSERT INTO minigame_events (id, match_id, actor_id, event_kind, payload_json)
    VALUES (?, ?, ?, 'checkpoint', ?)
  `).run(_newId(), raceId, racerId, JSON.stringify({ checkpointIdx, t }));

  // Update racer state
  const lapAdvance = checkpointIdx === 0 && racerState.lastCheckpoint > 0;
  if (lapAdvance) racerState.lap += 1;
  racerState.lastCheckpoint = checkpointIdx;
  racerState.lastCheckpointAt = t;
  scores[racerId] = racerState;
  db.prepare(`UPDATE minigame_matches SET scores_json = ? WHERE id = ?`).run(JSON.stringify(scores), raceId);

  // End condition
  const lapCount = meta.lapCount || 3;
  if (racerState.lap >= lapCount) {
    db.prepare(`
      UPDATE minigame_matches SET status = 'ended', ended_at = unixepoch(), winner_id = ?
      WHERE id = ?
    `).run(racerId, raceId);
    return { ok: true, ended: true, winner: racerId, finalLap: racerState.lap };
  }
  return { ok: true, ended: false, currentLap: racerState.lap, lastCheckpoint: racerState.lastCheckpoint };
}

export function getRace(db, raceId) {
  const m = db.prepare(`SELECT * FROM minigame_matches WHERE id = ? AND kind = 'racing'`).get(raceId);
  if (!m) return null;
  return {
    ...m,
    players: JSON.parse(m.players_json),
    scores: JSON.parse(m.scores_json),
    meta: JSON.parse(m.meta_json || "{}"),
  };
}

export { VEHICLE_MAX_SPEED_M_S };
