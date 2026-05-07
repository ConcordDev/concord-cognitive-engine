// server/lib/minigames/basketball.js
//
// Basketball / 1v1 hoops minigame engine.
//
// First-to-21 by default. 2-pt and 3-pt shots based on distance from
// the hoop. Server-side validation: the shooter's position must be
// within reasonable distance of the hoop (anti-cheat reach pattern
// reused). Each shot mints a minigame_events row; match end mints a
// chronicle DTU.

import crypto from "crypto";

const DEFAULT_TARGET_SCORE = 21;
const HOOP_REACH_M = 12;       // can't shoot from > 12m from hoop
const TWO_POINT_RADIUS_M = 6.75; // shots within this radius score 2
// shots beyond TWO_POINT_RADIUS_M and within HOOP_REACH_M score 3

function _newId() {
  return `mg_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)}`;
}

export function createMatch(db, { challengerId, opponentId, worldId = "concordia-hub", districtId = null, hoopPosition = { x: 0, y: 0, z: 0 }, targetScore = DEFAULT_TARGET_SCORE } = {}) {
  if (!db || !challengerId || !opponentId) return { ok: false, error: "missing_args" };
  if (challengerId === opponentId) return { ok: false, error: "cannot_self_play" };
  const id = _newId();
  db.prepare(`
    INSERT INTO minigame_matches
      (id, kind, world_id, district_id, players_json, scores_json, meta_json)
    VALUES (?, 'basketball', ?, ?, ?, ?, ?)
  `).run(
    id, worldId, districtId,
    JSON.stringify([challengerId, opponentId]),
    JSON.stringify({ [challengerId]: 0, [opponentId]: 0 }),
    JSON.stringify({ hoopPosition, targetScore }),
  );
  return { ok: true, matchId: id };
}

/**
 * Record a shot attempt. Player position is validated against hoop
 * distance. Distance from hoop determines point value. `madeShot`
 * is the resolved outcome from physics-vs-hoop arc (computed server-side
 * from ballVelocity + arc + perception random). For v1 we accept the
 * caller's `made` boolean but bound it by distance so it can't claim
 * a 50m made shot.
 */
export function recordShot(db, matchId, { shooterId, shooterPos, hitRim = false, made = false, ballVelocity = null } = {}) {
  const m = db.prepare(`SELECT * FROM minigame_matches WHERE id = ?`).get(matchId);
  if (!m) return { ok: false, error: "match_not_found" };
  if (m.status !== "active") return { ok: false, error: "match_not_active" };
  const players = JSON.parse(m.players_json);
  if (!players.includes(shooterId)) return { ok: false, error: "not_a_player" };

  const meta = JSON.parse(m.meta_json || "{}");
  const hoopPos = meta.hoopPosition || { x: 0, y: 0, z: 0 };
  const dx = (shooterPos?.x ?? 0) - (hoopPos.x ?? 0);
  const dz = (shooterPos?.z ?? 0) - (hoopPos.z ?? 0);
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance > HOOP_REACH_M + 1) {
    return { ok: false, error: "out_of_reach", distance, max: HOOP_REACH_M };
  }
  void hitRim; void ballVelocity; // reserved for v1.1 physics-resolved made/missed

  const points = made
    ? (distance > TWO_POINT_RADIUS_M ? 3 : 2)
    : 0;

  const eventKind = made
    ? (points === 3 ? "shot_made_3" : "shot_made_2")
    : "shot_missed";

  db.prepare(`
    INSERT INTO minigame_events (id, match_id, actor_id, event_kind, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(_newId(), matchId, shooterId, eventKind, JSON.stringify({ distance, points }));

  let scoresUpdated = JSON.parse(m.scores_json);
  scoresUpdated[shooterId] = (scoresUpdated[shooterId] || 0) + points;
  db.prepare(`UPDATE minigame_matches SET scores_json = ? WHERE id = ?`).run(JSON.stringify(scoresUpdated), matchId);

  // Check end condition
  const targetScore = meta.targetScore || DEFAULT_TARGET_SCORE;
  let ended = false;
  let winner = null;
  if (scoresUpdated[shooterId] >= targetScore) {
    ended = true;
    winner = shooterId;
    db.prepare(`UPDATE minigame_matches SET status = 'ended', ended_at = unixepoch(), winner_id = ? WHERE id = ?`)
      .run(shooterId, matchId);
  }

  return { ok: true, eventKind, points, scoreNow: scoresUpdated, ended, winner, distance };
}

export function endMatch(db, matchId, { reason = "manual" } = {}) {
  const m = db.prepare(`SELECT * FROM minigame_matches WHERE id = ?`).get(matchId);
  if (!m) return { ok: false, error: "match_not_found" };
  if (m.status === "ended") return { ok: true, alreadyEnded: true };

  const scores = JSON.parse(m.scores_json);
  const players = JSON.parse(m.players_json);
  // Winner = highest score
  let winner = null, best = -1;
  for (const p of players) {
    if ((scores[p] || 0) > best) { winner = p; best = scores[p] || 0; }
  }
  db.prepare(`
    UPDATE minigame_matches SET status = 'ended', ended_at = unixepoch(), winner_id = ?,
                                 meta_json = json_patch(meta_json, ?)
    WHERE id = ?
  `).run(winner, JSON.stringify({ endReason: reason }), matchId);
  return { ok: true, winner, finalScores: scores, reason };
}

export function getMatch(db, matchId) {
  const m = db.prepare(`SELECT * FROM minigame_matches WHERE id = ?`).get(matchId);
  if (!m) return null;
  return {
    ...m,
    players: JSON.parse(m.players_json),
    scores: JSON.parse(m.scores_json),
    meta: JSON.parse(m.meta_json || "{}"),
  };
}

export {
  HOOP_REACH_M,
  TWO_POINT_RADIUS_M,
  DEFAULT_TARGET_SCORE,
};
