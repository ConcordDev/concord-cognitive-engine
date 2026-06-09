// server/lib/council-engine.js
//
// Concordia Phase 16 — council engine.
//
// Surface:
//   - openSession(db, realmId, seasonId, year) — idempotent on
//     (realm, season, year); inserts council_sessions row.
//   - closeSession(db, sessionId) — close + tally pending petitions.
//   - submitPetition(db, sessionId, petitioner, topic, body)
//   - listPetitions(db, sessionId)
//   - castVote(db, petitionId, memberId, vote) — idempotent on
//     (petition, member); ON CONFLICT UPDATE.
//   - tallyVotes(db, petitionId) → { aye, nay, abstain, resolution }
//   - playerLobby(db, sessionId, userId, memberNpcId, opinionDelta) —
//     gated by getOpinion(member, player) ≥ 0. Records opinion event
//     via npc-opinions.recordOpinionEvent.
//   - listOpenSessions(db, realmId?)

import crypto from "node:crypto";
import { recordOpinionEvent, getOpinion } from "./npc-opinions.js";
import logger from "../logger.js";

function makeSessionId(realmId, seasonId, year) {
  const h = crypto.createHash("sha1").update(`${realmId}:${seasonId}:${year}`).digest("hex");
  return `cs_${h.slice(0, 16)}`;
}
function makePetitionId() {
  return `cp_${crypto.randomUUID().slice(0, 16)}`;
}

export function openSession(db, realmId, seasonId, year = 1) {
  if (!db || !realmId || !Number.isFinite(seasonId)) return { ok: false, reason: "missing_inputs" };
  const id = makeSessionId(realmId, seasonId, year);
  try {
    db.prepare(`
      INSERT INTO council_sessions (id, realm_id, season_id, year, status)
      VALUES (?, ?, ?, ?, 'open')
      ON CONFLICT(realm_id, season_id, year) DO UPDATE SET status = 'open'
    `).run(id, realmId, seasonId, year);
    return { ok: true, action: "opened", sessionId: id };
  } catch (err) {
    try { logger.warn?.("council_open_failed", { error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

export function closeSession(db, sessionId) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  const petitions = listPetitions(db, sessionId);
  let approved = 0, rejected = 0, tabled = 0;
  const setResolution = db.prepare(`UPDATE council_petitions SET resolution = ? WHERE id = ?`);
  for (const p of petitions) {
    if (p.resolution) continue;  // already resolved
    const tally = tallyVotes(db, p.id);
    const resolution = tally.resolution;
    setResolution.run(resolution, p.id);
    if (resolution === "approved") approved++;
    else if (resolution === "rejected") rejected++;
    else tabled++;
  }
  db.prepare(`UPDATE council_sessions SET status = 'closed', closed_at = unixepoch() WHERE id = ?`).run(sessionId);
  return { ok: true, action: "closed", approved, rejected, tabled };
}

export function submitPetition(db, sessionId, petitioner, topic, body = null) {
  if (!db || !sessionId || !petitioner?.kind || !petitioner?.id || !topic) return { ok: false, reason: "missing_inputs" };
  if (!["player", "npc"].includes(petitioner.kind)) return { ok: false, reason: "bad_petitioner_kind" };
  const session = db.prepare(`SELECT status FROM council_sessions WHERE id = ?`).get(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };
  if (session.status !== "open") return { ok: false, reason: "session_not_open" };
  const id = makePetitionId();
  try {
    db.prepare(`
      INSERT INTO council_petitions (id, session_id, petitioner_kind, petitioner_id, topic, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, petitioner.kind, petitioner.id, topic, body);
    return { ok: true, action: "submitted", petitionId: id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listPetitions(db, sessionId) {
  if (!db || !sessionId) return [];
  try {
    return db.prepare(`
      SELECT id, session_id, petitioner_kind, petitioner_id, topic, body, submitted_at, resolution
      FROM council_petitions WHERE session_id = ? ORDER BY submitted_at ASC
    `).all(sessionId);
  } catch { return []; }
}

export function castVote(db, petitionId, memberId, vote) {
  if (!db || !petitionId || !memberId || !vote) return { ok: false, reason: "missing_inputs" };
  if (!["aye", "nay", "abstain"].includes(vote)) return { ok: false, reason: "bad_vote" };
  try {
    db.prepare(`
      INSERT INTO council_votes (petition_id, member_id, vote)
      VALUES (?, ?, ?)
      ON CONFLICT(petition_id, member_id) DO UPDATE
        SET vote = excluded.vote, cast_at = unixepoch()
    `).run(petitionId, memberId, vote);
    return { ok: true, action: "voted", vote };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function tallyVotes(db, petitionId) {
  if (!db || !petitionId) return { aye: 0, nay: 0, abstain: 0, resolution: "tabled" };
  try {
    const rows = db.prepare(`
      SELECT vote, COUNT(*) AS n FROM council_votes WHERE petition_id = ? GROUP BY vote
    `).all(petitionId);
    const counts = { aye: 0, nay: 0, abstain: 0 };
    for (const r of rows) counts[r.vote] = r.n;
    let resolution;
    if (counts.aye === 0 && counts.nay === 0) resolution = "tabled";
    else if (counts.aye > counts.nay) resolution = "approved";
    else if (counts.nay > counts.aye) resolution = "rejected";
    else resolution = "tabled";  // tie
    return { ...counts, resolution };
  } catch { return { aye: 0, nay: 0, abstain: 0, resolution: "tabled" }; }
}

/**
 * Player lobby — bump an opinion delta on a council member. Gated by
 * the member's current opinion of the player ≥ 0. Returns the
 * resulting opinion event.
 */
export function playerLobby(db, sessionId, userId, memberNpcId, opinionDelta = 5) {
  if (!db || !sessionId || !userId || !memberNpcId) return { ok: false, reason: "missing_inputs" };
  if (!Number.isFinite(opinionDelta) || opinionDelta === 0) return { ok: false, reason: "no_delta" };
  const op = getOpinion(db, memberNpcId, "player", userId);
  const baseScore = op?.score ?? 0;
  if (baseScore < 0) return { ok: false, reason: "member_hostile", opinion: baseScore };
  const session = db.prepare(`SELECT status FROM council_sessions WHERE id = ?`).get(sessionId);
  if (!session || session.status !== "open") return { ok: false, reason: "session_not_open" };
  // Cap the per-lobby delta so the player can't trivially flip a council.
  const capped = Math.max(-10, Math.min(10, Math.round(opinionDelta)));
  const r = recordOpinionEvent(db,
    { npcId: memberNpcId, targetKind: "player", targetId: userId },
    capped, "lobbied at council session");
  return { ok: true, action: "lobbied", delta: capped, opinion_after: r.score };
}

export function listOpenSessions(db, realmId = null) {
  if (!db) return [];
  try {
    const stmt = realmId
      ? db.prepare(`SELECT id, realm_id, season_id, year, status, opened_at FROM council_sessions WHERE realm_id = ? AND status = 'open' ORDER BY opened_at DESC`)
      : db.prepare(`SELECT id, realm_id, season_id, year, status, opened_at FROM council_sessions WHERE status = 'open' ORDER BY opened_at DESC`);
    return realmId ? stmt.all(realmId) : stmt.all();
  } catch { return []; }
}

export const COUNCIL_CONSTANTS = Object.freeze({
  // exposed for tests
});
