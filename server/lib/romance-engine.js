// server/lib/romance-engine.js
//
// Phase II Wave 25 — player romance / family / dynasty engine.
//
// Courtship lifecycle:
//   acquainted → courting → engaged → married
//   married → widowed (partner death) | estranged (separation)
//
// Affinity is a -1..+1 scalar updated by interaction. Courtship
// gating requires sustained positive interactions; engagement
// requires affinity > 0.7; marriage requires affinity > 0.85.
//
// Bloodline buffs: children inherit weighted-average of best parent's
// skills (deterministic 80% of best-parent skill at coming-of-age).
// On player death, heir succession cascades the skill snapshot.

import crypto from "node:crypto";
import { checkHeartEvent } from "./heart-events.js";
import { gatherAttendees } from "./social-gatherings.js";
import { getActiveWorldForPlayer } from "./world-loader.js";

const COURT_AFFINITY_DELTA = 0.05;
const ENGAGE_THRESHOLD     = 0.70;
const MARRY_THRESHOLD      = 0.85;
const PREGNANCY_DAYS       = 30;   // in-game days from conceive to birth
const ADOLESCENT_DAYS      = 90;
const ADULT_DAYS           = 180;
const SKILL_INHERITANCE_FRAC = 0.80;
const DAILY_PLAYER_INTERACTION_CAP = 24;

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function ensureConsentTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_courtship_proposals (
      id TEXT PRIMARY KEY,
      proposer_user_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_courtship_proposals_partner
      ON player_courtship_proposals (partner_id, status);
    CREATE TABLE IF NOT EXISTS player_courtship_daily (
      player_user_id TEXT NOT NULL,
      partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      day_key INTEGER NOT NULL,
      n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_user_id, partner_kind, partner_id, day_key)
    );
    CREATE TABLE IF NOT EXISTS player_courtship_notices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_courtship_notices_user
      ON player_courtship_notices (user_id, created_at DESC);
  `);
}

function notePlayerInteraction(db, playerUserId, partnerKind, partnerId) {
  ensureConsentTables(db);
  const day = Math.floor(Date.now() / 1000 / 86400);
  const row = db.prepare(`
    SELECT n FROM player_courtship_daily
     WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ? AND day_key = ?
  `).get(playerUserId, partnerKind, partnerId, day);
  if ((row?.n || 0) >= DAILY_PLAYER_INTERACTION_CAP) {
    return { ok: false, reason: "daily_cap", cap: DAILY_PLAYER_INTERACTION_CAP };
  }
  db.prepare(`
    INSERT INTO player_courtship_daily (player_user_id, partner_kind, partner_id, day_key, n)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(player_user_id, partner_kind, partner_id, day_key) DO UPDATE SET n = n + 1
  `).run(playerUserId, partnerKind, partnerId, day);
  return { ok: true };
}

/** Drop the other player's raw account id from a row the viewer did not author as themselves. */
export function presentCourtship(row, viewerId) {
  if (!row || row.partner_kind !== "player") return row;
  const out = { ...row };
  if (out.player_user_id && out.player_user_id !== viewerId) delete out.player_user_id;
  if (out.partner_id && out.partner_id !== viewerId) delete out.partner_id;
  return out;
}

function presentMarriage(row, viewerId) {
  if (!row || row.partner_kind !== "player") return row;
  const out = { ...row };
  if (out.player_user_id && out.player_user_id !== viewerId) delete out.player_user_id;
  if (out.partner_id && out.partner_id !== viewerId) delete out.partner_id;
  return out;
}

/* ───────── Courtship ───────────────────────────────────────────────── */

export function getCourtship(db, playerUserId, partnerKind, partnerId) {
  return db.prepare(`
    SELECT * FROM player_courtship WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).get(playerUserId, partnerKind, partnerId) || null;
}

export function courtInteraction(db, playerUserId, partnerKind, partnerId, sentiment = 1) {
  if (!playerUserId || !partnerId) return { ok: false, reason: "missing_inputs" };
  if (partnerKind === "player") {
    if (String(partnerId) === String(playerUserId)) return { ok: false, reason: "cannot_court_self" };
    const capped = notePlayerInteraction(db, playerUserId, partnerKind, String(partnerId));
    if (!capped.ok) return capped;
  }
  const sentimentNum = Math.max(-1, Math.min(1, Number(sentiment) || 1));
  const existing = getCourtship(db, playerUserId, partnerKind, partnerId);
  const delta = COURT_AFFINITY_DELTA * sentimentNum;
  if (!existing) {
    db.prepare(`
      INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status)
      VALUES (?, ?, ?, ?, 'acquainted')
    `).run(playerUserId, partnerKind, partnerId, Math.max(-1, Math.min(1, delta)));
    return { ok: true, affinity: delta, status: "acquainted", new: true };
  }
  let next = Math.max(-1, Math.min(1, existing.affinity + delta));
  let status = existing.status;
  // H3 — fire an authored heart-event scene when this interaction crosses a
  // milestone threshold (once per milestone per partner). The scene's small
  // affinity bonus is folded in so the milestone beat feels earned.
  const heartEvent = checkHeartEvent(db, playerUserId, partnerKind, partnerId, existing.affinity, next);
  if (heartEvent?.affinityBonus) {
    next = Math.max(-1, Math.min(1, next + Number(heartEvent.affinityBonus)));
  }
  // Auto-promote toward courting at moderate affinity
  if (status === "acquainted" && next > 0.30) status = "courting";
  if (status === "courting" && next < 0)       status = "acquainted";
  db.prepare(`
    UPDATE player_courtship SET affinity = ?, status = ?, last_interaction = unixepoch()
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).run(next, status, playerUserId, partnerKind, partnerId);
  return { ok: true, affinity: next, status, new: false, delta, heartEvent: heartEvent || null };
}

export function listMyCourtships(db, playerUserId, status = null) {
  return status
    ? db.prepare(`
        SELECT * FROM player_courtship WHERE player_user_id = ? AND status = ?
        ORDER BY last_interaction DESC LIMIT 200
      `).all(playerUserId, status)
    : db.prepare(`
        SELECT * FROM player_courtship WHERE player_user_id = ?
        ORDER BY last_interaction DESC LIMIT 200
      `).all(playerUserId);
}

/* ───────── Engagement + marriage ───────────────────────────────────── */

export function propose(db, playerUserId, partnerKind, partnerId) {
  if (partnerKind === "player" && String(partnerId) === String(playerUserId)) {
    return { ok: false, reason: "cannot_court_self" };
  }
  const c = getCourtship(db, playerUserId, partnerKind, partnerId);
  if (!c) return { ok: false, reason: "no_courtship" };
  if (c.affinity < ENGAGE_THRESHOLD) return { ok: false, reason: "affinity_too_low", required: ENGAGE_THRESHOLD, got: c.affinity };
  if (c.status === "married") return { ok: false, reason: "already_married" };
  if (partnerKind === "player") return openPlayerProposal(db, playerUserId, String(partnerId));
  db.prepare(`
    UPDATE player_courtship SET status = 'engaged', last_interaction = unixepoch()
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).run(playerUserId, partnerKind, partnerId);
  return { ok: true, status: "engaged" };
}

function openPlayerProposal(db, proposerUserId, partnerId) {
  ensureConsentTables(db);
  const existing = db.prepare(`
    SELECT id FROM player_courtship_proposals
     WHERE proposer_user_id = ? AND partner_id = ? AND status = 'pending'
  `).get(proposerUserId, partnerId);
  if (existing) return { ok: true, status: "pending", proposalId: existing.id };
  const proposalId = uid("prop");
  db.prepare(`
    INSERT INTO player_courtship_proposals (id, proposer_user_id, partner_id, status)
    VALUES (?, ?, ?, 'pending')
  `).run(proposalId, proposerUserId, partnerId);
  // Notice carries the opaque proposal id only — never the proposer's account id.
  db.prepare(`
    INSERT INTO player_courtship_notices (id, user_id, kind, payload_json)
    VALUES (?, ?, 'proposal', ?)
  `).run(uid("note"), partnerId, JSON.stringify({ proposalId }));
  return { ok: true, status: "pending", proposalId };
}

export function acceptProposal(db, actorUserId, proposalId) {
  if (!actorUserId || !proposalId) return { ok: false, reason: "missing_inputs" };
  ensureConsentTables(db);
  const p = db.prepare(`SELECT * FROM player_courtship_proposals WHERE id = ?`).get(String(proposalId));
  if (!p || p.status !== "pending" || p.partner_id !== actorUserId) return { ok: false, reason: "not_found" };
  const mine = getCourtship(db, p.proposer_user_id, "player", p.partner_id);
  if (!mine) return { ok: false, reason: "not_found" };
  const sharedAffinity = Math.max(Number(mine.affinity) || 0, ENGAGE_THRESHOLD);
  db.prepare(`
    UPDATE player_courtship SET status = 'engaged', last_interaction = unixepoch()
     WHERE player_user_id = ? AND partner_kind = 'player' AND partner_id = ?
  `).run(p.proposer_user_id, p.partner_id);
  const theirs = getCourtship(db, actorUserId, "player", p.proposer_user_id);
  if (!theirs) {
    db.prepare(`
      INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status)
      VALUES (?, 'player', ?, ?, 'engaged')
    `).run(actorUserId, p.proposer_user_id, Math.min(1, sharedAffinity));
  } else {
    db.prepare(`
      UPDATE player_courtship
         SET status = 'engaged', affinity = ?, last_interaction = unixepoch()
       WHERE player_user_id = ? AND partner_kind = 'player' AND partner_id = ?
    `).run(Math.min(1, Math.max(Number(theirs.affinity) || 0, sharedAffinity)), actorUserId, p.proposer_user_id);
  }
  db.prepare(`UPDATE player_courtship_proposals SET status = 'accepted', resolved_at = unixepoch() WHERE id = ?`).run(p.id);
  return { ok: true, status: "engaged", proposalId: p.id };
}

export function declineProposal(db, actorUserId, proposalId) {
  if (!actorUserId || !proposalId) return { ok: false, reason: "missing_inputs" };
  ensureConsentTables(db);
  const p = db.prepare(`SELECT * FROM player_courtship_proposals WHERE id = ?`).get(String(proposalId));
  if (!p || p.status !== "pending" || p.partner_id !== actorUserId) return { ok: false, reason: "not_found" };
  db.prepare(`UPDATE player_courtship_proposals SET status = 'declined', resolved_at = unixepoch() WHERE id = ?`).run(p.id);
  return { ok: true, status: "declined", proposalId: p.id };
}

export function listCourtshipNotices(db, userId) {
  if (!userId) return [];
  ensureConsentTables(db);
  const rows = db.prepare(`
    SELECT id, kind, payload_json, created_at FROM player_courtship_notices
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(userId);
  return rows.map((r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload_json || "{}"); } catch { payload = {}; }
    if (payload && typeof payload === "object") {
      delete payload.proposerUserId;
      delete payload.partnerId;
      delete payload.userId;
      delete payload.player_user_id;
    }
    return { id: r.id, kind: r.kind, created_at: r.created_at, ...(payload || {}) };
  });
}

export function wed(db, playerUserId, partnerKind, partnerId) {
  if (partnerKind === "player") {
    if (String(partnerId) === String(playerUserId)) return { ok: false, reason: "cannot_court_self" };
    const mine = getCourtship(db, playerUserId, "player", partnerId);
    const theirs = getCourtship(db, partnerId, "player", playerUserId);
    if (!mine || mine.status !== "engaged" || !theirs || theirs.status !== "engaged") {
      return { ok: false, reason: "consent_required" };
    }
  }
  const c = getCourtship(db, playerUserId, partnerKind, partnerId);
  if (!c) return { ok: false, reason: "no_courtship" };
  if (c.status !== "engaged") return { ok: false, reason: "not_engaged" };
  if (c.affinity < MARRY_THRESHOLD) return { ok: false, reason: "affinity_too_low", required: MARRY_THRESHOLD, got: c.affinity };
  const marriageId = uid("marriage");
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO player_marriages (id, player_user_id, partner_kind, partner_id)
      VALUES (?, ?, ?, ?)
    `).run(marriageId, playerUserId, partnerKind, partnerId);
    db.prepare(`
      UPDATE player_courtship SET status = 'married', last_interaction = unixepoch()
      WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
    `).run(playerUserId, partnerKind, partnerId);
    if (partnerKind === "player") {
      db.prepare(`
        UPDATE player_courtship SET status = 'married', last_interaction = unixepoch()
         WHERE player_user_id = ? AND partner_kind = 'player' AND partner_id = ?
      `).run(partnerId, playerUserId);
    }
  });
  tx();

  // Thin emit of the existing wedding composition — not a new guest engine.
  // Empty attendees stay empty; Unity only Attends matching GuestNpcs.
  try {
    const gathering = gatherAttendees(db, { kind: "wedding", focalKind: "player", focalId: playerUserId });
    const emit = globalThis._concordRealtimeEmit;
    if (typeof emit === "function") {
      let worldId = "concordia-hub";
      try {
        worldId = getActiveWorldForPlayer(db, playerUserId) || "concordia-hub";
      } catch { /* presence optional */ }
      emit("npc:wedding", {
        marriageId,
        celebrantId: playerUserId,
        partnerKind,
        partnerId,
        worldId,
        attendees: (gathering.attendees || []).map((a) => ({
          id: a.id || null,
          name: a.name || "",
          role: a.role || "",
        })),
        beats: gathering.beats || [],
      }, { worldId });
    }
  } catch { /* presentation optional */ }

  return { ok: true, marriageId, status: "married" };
}

// `expectedUserId`, when passed, enforces that the caller is a party to the
// marriage (the row's `player_user_id`). Optional for back-compat with
// internal/system callers (e.g. spouse-death cascades) that already know the
// marriage is theirs to close and don't have a player actor in context —
// player-facing callers (the courtship/romance macros) MUST pass it.
export function dissolveMarriage(db, marriageId, reason = "estranged", expectedUserId = null) {
  const m = db.prepare("SELECT * FROM player_marriages WHERE id = ?").get(marriageId);
  if (!m) return { ok: false, reason: "marriage_not_found" };
  if (expectedUserId) {
    const isOwner = m.player_user_id === expectedUserId;
    const isPlayerPartner = m.partner_kind === "player" && m.partner_id === expectedUserId;
    if (!isOwner && !isPlayerPartner) return { ok: false, reason: "not_a_party" };
  }
  if (m.dissolved_at) return { ok: false, reason: "already_dissolved" };
  db.prepare(`
    UPDATE player_marriages SET dissolved_at = unixepoch(), dissolved_reason = ?
    WHERE id = ?
  `).run(String(reason), marriageId);
  // Knock the courtship status to widowed (death) or estranged
  const courtStatus = reason === "widowed" ? "widowed" : "estranged";
  db.prepare(`
    UPDATE player_courtship SET status = ?, last_interaction = unixepoch()
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ?
  `).run(courtStatus, m.player_user_id, m.partner_kind, m.partner_id);
  if (m.partner_kind === "player") {
    db.prepare(`
      UPDATE player_courtship SET status = ?, last_interaction = unixepoch()
       WHERE player_user_id = ? AND partner_kind = 'player' AND partner_id = ?
    `).run(courtStatus, m.partner_id, m.player_user_id);
  }
  return { ok: true, dissolvedReason: reason, courtStatus };
}

export function listMyMarriages(db, playerUserId, activeOnly = true) {
  const owned = activeOnly
    ? db.prepare("SELECT * FROM player_marriages WHERE player_user_id = ? AND dissolved_at IS NULL ORDER BY married_at DESC").all(playerUserId)
    : db.prepare("SELECT * FROM player_marriages WHERE player_user_id = ? ORDER BY married_at DESC LIMIT 50").all(playerUserId);
  let asPartner = [];
  try {
    asPartner = activeOnly
      ? db.prepare("SELECT * FROM player_marriages WHERE partner_kind = 'player' AND partner_id = ? AND dissolved_at IS NULL ORDER BY married_at DESC").all(playerUserId)
      : db.prepare("SELECT * FROM player_marriages WHERE partner_kind = 'player' AND partner_id = ? ORDER BY married_at DESC LIMIT 50").all(playerUserId);
  } catch { asPartner = []; }
  const seen = new Set();
  const out = [];
  for (const row of [...owned, ...asPartner]) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(presentMarriage(row, playerUserId));
  }
  return out;
}

/* ───────── Pregnancy + birth ───────────────────────────────────────── */

export function conceive(db, carrierUserId, partnerKind, partnerId) {
  const married = db.prepare(`
    SELECT 1 FROM player_marriages
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ? AND dissolved_at IS NULL
  `).get(carrierUserId, partnerKind, partnerId);
  if (!married) return { ok: false, reason: "must_be_married_to_conceive" };
  const active = db.prepare(`
    SELECT 1 FROM player_pregnancies WHERE carrier_user_id = ? AND born_at IS NULL
  `).get(carrierUserId);
  if (active) return { ok: false, reason: "already_pregnant" };
  const id = uid("preg");
  const now = Math.floor(Date.now() / 1000);
  const dueAt = now + PREGNANCY_DAYS * 86400;
  db.prepare(`
    INSERT INTO player_pregnancies (id, carrier_user_id, partner_kind, partner_id, due_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, carrierUserId, partnerKind, partnerId, dueAt);
  return { ok: true, pregnancyId: id, dueAt };
}

function loadSkillRecord(db, userId) {
  if (!db || !userId) return {};
  try {
    const rows = db.prepare(
      `SELECT skill_type, level FROM player_skill_levels WHERE user_id = ?`
    ).all(userId);
    const out = {};
    for (const r of rows || []) {
      const n = Number(r.level);
      if (!Number.isFinite(n) || n < 0) continue;
      out[String(r.skill_type).slice(0, 40)] = Math.min(100, n);
    }
    return out;
  } catch {
    return {};
  }
}

function deriveParentSkills(db, pregnancy) {
  const bag = {};
  const carrier = loadSkillRecord(db, pregnancy.carrier_user_id);
  if (Object.keys(carrier).length) bag.carrier = carrier;
  if (pregnancy.partner_kind === "player") {
    const partner = loadSkillRecord(db, pregnancy.partner_id);
    if (Object.keys(partner).length) bag.partner = partner;
  }
  return bag;
}

export function birthChild(db, pregnancyId, options = {}) {
  const actor = options.actorUserId ? String(options.actorUserId) : "";
  let p = null;
  try {
    p = db.prepare("SELECT * FROM player_pregnancies WHERE id = ?").get(pregnancyId);
  } catch {
    p = null;
  }
  // Missing, or not this carrier: one not_found so a stranger cannot probe the row.
  if (!p || !actor || p.carrier_user_id !== actor) return { ok: false, reason: "not_found" };
  if (p.born_at) return { ok: false, reason: "already_born" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(p.due_at) > nowSec) return { ok: false, reason: "not_due" };
  const childId = uid("child");
  const name = String(options.name || `Heir-${childId.slice(-4)}`).slice(0, 80);
  // Client parentSkills are ignored. Inheritance comes from player_skill_levels.
  const inheritedSkills = inheritSkills(deriveParentSkills(db, p));
  const personality = options.personality && typeof options.personality === "object" && !Array.isArray(options.personality)
    ? options.personality
    : {};
  db.prepare(`
    INSERT INTO player_children
      (id, parent_user_id, other_parent_kind, other_parent_id, name,
       inherited_skills_json, personality_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    childId, p.carrier_user_id, p.partner_kind, p.partner_id, name,
    JSON.stringify(inheritedSkills), JSON.stringify(personality),
  );
  db.prepare("UPDATE player_pregnancies SET born_at = unixepoch() WHERE id = ?").run(pregnancyId);
  return { ok: true, childId, name, inheritedSkills };
}

function inheritSkills(parentSkillsByPerson) {
  // parentSkillsByPerson: { parentA: { skillKey: level }, parentB: { ... } }
  const merged = {};
  const all = Object.values(parentSkillsByPerson || {}).filter(Boolean);
  for (const parent of all) {
    for (const [skill, level] of Object.entries(parent || {})) {
      const candidate = Number(level) * SKILL_INHERITANCE_FRAC;
      if (!merged[skill] || candidate > merged[skill]) merged[skill] = candidate;
    }
  }
  return merged;
}

export function listChildren(db, parentUserId) {
  return db.prepare(`
    SELECT * FROM player_children WHERE parent_user_id = ? ORDER BY born_at DESC LIMIT 50
  `).all(parentUserId);
}

export function advanceChildMaturity(db, childId) {
  const c = db.prepare("SELECT * FROM player_children WHERE id = ?").get(childId);
  if (!c) return { ok: false, reason: "child_not_found" };
  const ageDays = Math.floor((Math.floor(Date.now() / 1000) - c.born_at) / 86400);
  let maturity = "infant";
  if (ageDays >= ADULT_DAYS) maturity = "adult";
  else if (ageDays >= ADOLESCENT_DAYS) maturity = "adolescent";
  else if (ageDays >= 30) maturity = "child";
  db.prepare(`
    UPDATE player_children SET age_days = ?, maturity = ? WHERE id = ?
  `).run(ageDays, maturity, childId);
  return { ok: true, childId, maturity, ageDays };
}

/* ───────── Heir succession (called from npc-legacy player path) ───── */

export function selectHeir(db, deceasedUserId) {
  // Among children, prefer 'adult' > 'adolescent' > 'child'; tiebreak by birth order
  const children = listChildren(db, deceasedUserId);
  const maturityRank = { adult: 3, adolescent: 2, child: 1, infant: 0 };
  const sorted = children
    .map((c) => ({ ...c, rank: maturityRank[c.maturity] || 0 }))
    .sort((a, b) => b.rank - a.rank || a.born_at - b.born_at);
  return sorted[0] || null;
}

export const ROMANCE_CONSTANTS = Object.freeze({
  COURT_AFFINITY_DELTA,
  ENGAGE_THRESHOLD,
  MARRY_THRESHOLD,
  PREGNANCY_DAYS,
  ADOLESCENT_DAYS,
  ADULT_DAYS,
  SKILL_INHERITANCE_FRAC,
  DAILY_PLAYER_INTERACTION_CAP,
});
