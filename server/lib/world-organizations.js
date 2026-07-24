/**
 * World Organizations — Guilds, Parties, Mentorship, Recruitment
 *
 * Organizations are the social glue. Research shows players who participate
 * in group content are 3.2x more likely to stay past six months.
 *
 * Organization types: guild, crew, studio, firm, lab, band, club
 * Each gets a headquarters building in the relevant district.
 *
 * ── Durability (grounding audit, 2026-07) ─────────────────────────────────
 * Organizations + their rosters used to live ONLY in a module-scope
 * `LruMap` — a real, player-formed guild vanished the instant the server
 * process restarted. That's inconsistent with the authored-faction "realm"
 * system (migration 158_kingdoms.js), which is durable. This module is now
 * DB-backed: `world_organizations` (migration — see server/migrations/)
 * holds the org row, `org_members` holds the roster. Every function that
 * touches org/roster state takes `db` as its FIRST argument (the same
 * convention `server/lib/guild-substrate.js` and `server/economy/
 * creative-marketplace.js` already use) and is a real read/write against
 * those tables — never the in-memory Map alone.
 *
 * `_orgRowCache` is a read-through, write-invalidated performance cache for
 * the ORG ROW ONLY (name/type/treasury/stats/...) — never the roster/member
 * count, which is always a live query so a join/leave/role-change is
 * instantly visible with no separate invalidation path to get wrong. A
 * fresh process boots with an empty cache and falls straight through to a
 * real `SELECT`, so correctness never depends on the cache being warm —
 * this is the same "cache but the DB is the real source of truth" pattern
 * `server/lib/dtu-shadow-hydrate.js` documents (Wave C).
 *
 * Parties (temporary groups), mentorships, and the recruitment board remain
 * in-memory by design — they're genuinely ephemeral session state, not the
 * durability bug this audit found. Alliances also remain in-memory (no
 * player-durability complaint was raised against them); `createAlliance`
 * still takes `db` because it must verify the founder org is real against
 * the durable substrate.
 */

import { randomUUID } from "crypto";
import logger from "../logger.js";
import { LruMap, LruSet } from "./lru-map.js";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const ORG_TYPES = new Set(["guild", "crew", "studio", "firm", "lab", "band", "club", "department", "alliance"]);
const MEMBER_ROLES = Object.freeze(["leader", "officer", "member", "apprentice"]);
const MAX_PARTY_SIZE = 10;
const MAX_ORG_MEMBERS = 500;
// Resource-leak fix (verification-audit campaign): nothing ever flipped a
// recruitment listing off "active" or removed it — _recruitmentBoard grew
// unbounded for the life of the process. Real cleanup hook (not just a
// size cap): listings older than the TTL are stale postings and are culled
// opportunistically on each new post, plus a hard size cap as a backstop.
const RECRUITMENT_LISTING_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_RECRUITMENT_LISTINGS = 1000;

// ══════════════════════════════════════════════════════════════════════════════
// STATE (in-memory only — everything else lives in the DB, see above)
// ══════════════════════════════════════════════════════════════════════════════

/** @type {Map<string, object>} Read-through org-row cache, keyed by org ID. */
const _orgRowCache = new LruMap();

/** @type {Map<string, object>} Parties (temp groups) keyed by party ID */
const _parties = new Map();

/** @type {Map<string, string>} userId -> partyId for quick lookup */
const _userParty = new Map();

/** @type {Map<string, object>} Mentorship pairs: mentorshipId -> { mentorId, menteeId, domain, ... } */
const _mentorships = new LruMap();

/** @type {object[]} Recruitment board listings */
const _recruitmentBoard = [];

// ══════════════════════════════════════════════════════════════════════════════
// ORGANIZATIONS — DB-backed (world_organizations + org_members)
// ══════════════════════════════════════════════════════════════════════════════

function _defaultRevenueSplit() {
  return { leader: 10, treasury: 20, members: 70 };
}

function _hydrateOrgRow(row) {
  if (!row || !row.id) return null;
  let revenueSplit, headquarters, stats;
  try { revenueSplit = JSON.parse(row.revenue_split_json); } catch { revenueSplit = _defaultRevenueSplit(); }
  try { headquarters = JSON.parse(row.headquarters_json); } catch { headquarters = { districtId: row.district_id || null, customized: false }; }
  try { stats = JSON.parse(row.stats_json); } catch { stats = { totalEarned: 0, totalCited: 0, activeMissions: 0 }; }
  if (!revenueSplit || typeof revenueSplit !== "object") revenueSplit = _defaultRevenueSplit();
  if (!headquarters || typeof headquarters !== "object") headquarters = { districtId: row.district_id || null, customized: false };
  if (!stats || typeof stats !== "object") stats = { totalEarned: 0, totalCited: 0, activeMissions: 0 };
  return {
    id: row.id,
    name: row.name,
    type: row.type || "guild",
    description: row.description || "",
    leaderId: row.leader_id,
    districtId: row.district_id || null,
    purpose: row.purpose || "",
    recruitCriteria: row.recruit_criteria || "open",
    revenueSplit,
    treasury: Number(row.treasury) || 0,
    dtuCount: Number(row.dtu_count) || 0,
    headquarters,
    createdAt: row.created_at,
    stats,
  };
}

/**
 * Read-through cache lookup for the org ROW (never the roster). Returns
 * null on any miss/error — callers treat that as "org not found", same as
 * a plain Map miss would have before this module was made durable.
 */
function _readOrgRow(db, orgId) {
  if (!db || !orgId) return null;
  const cached = _orgRowCache.get(orgId);
  if (cached) return cached;
  let row;
  try {
    row = db.prepare(`SELECT * FROM world_organizations WHERE id = ?`).get(orgId);
  } catch {
    return null;
  }
  const org = _hydrateOrgRow(row);
  if (org) _orgRowCache.set(orgId, org);
  return org;
}

function _memberCount(db, orgId) {
  if (!db || !orgId) return 0;
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM org_members WHERE org_id = ?`).get(orgId);
    return row?.c || 0;
  } catch {
    return 0;
  }
}

export function createOrganization(db, { name, type, description, leaderId, districtId, purpose, recruitCriteria, revenueSplit } = {}) {
  if (!db) return { ok: false, error: "db_required" };
  if (!name || !leaderId) return { ok: false, error: "name_and_leader_required" };
  if (type && !ORG_TYPES.has(type)) return { ok: false, error: `invalid_type. Valid: ${[...ORG_TYPES]}` };

  const id = `org_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const finalRevenueSplit = (revenueSplit && typeof revenueSplit === "object") ? revenueSplit : _defaultRevenueSplit();
  const headquarters = { districtId: districtId || null, customized: false };
  const stats = { totalEarned: 0, totalCited: 0, activeMissions: 0 };
  const finalType = type || "guild";
  const finalDescription = description || "";
  const finalPurpose = purpose || "";
  const finalRecruitCriteria = recruitCriteria || "open";

  try {
    const insertOrg = db.prepare(`
      INSERT INTO world_organizations
        (id, name, type, description, leader_id, district_id, purpose, recruit_criteria, revenue_split_json, treasury, dtu_count, headquarters_json, stats_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
    `);
    const insertMember = db.prepare(`
      INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'leader', ?)
    `);
    const doInsert = () => {
      insertOrg.run(
        id, name, finalType, finalDescription, leaderId, districtId || null,
        finalPurpose, finalRecruitCriteria, JSON.stringify(finalRevenueSplit),
        JSON.stringify(headquarters), JSON.stringify(stats), now,
      );
      insertMember.run(id, leaderId, now);
    };
    if (typeof db.transaction === "function") db.transaction(doInsert)();
    else doInsert();
  } catch (err) {
    return { ok: false, error: err?.message || "create_failed" };
  }

  const org = {
    id, name, type: finalType, description: finalDescription,
    leaderId, districtId: districtId || null,
    purpose: finalPurpose, recruitCriteria: finalRecruitCriteria,
    revenueSplit: finalRevenueSplit, treasury: 0, dtuCount: 0,
    headquarters, createdAt: now, stats,
  };
  _orgRowCache.set(id, org);

  return { ok: true, organization: { ...org, memberCount: 1 } };
}

export function getOrganization(db, orgId) {
  const org = _readOrgRow(db, orgId);
  if (!org) return null;
  return { ...org, memberCount: _memberCount(db, orgId) };
}

export function joinOrganization(db, orgId, userId, role = "member") {
  if (!db) return { ok: false, error: "db_required" };
  const org = _readOrgRow(db, orgId);
  if (!org) return { ok: false, error: "org_not_found" };
  if (_memberCount(db, orgId) >= MAX_ORG_MEMBERS) return { ok: false, error: "org_full" };
  let existing;
  try {
    existing = db.prepare(`SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId);
  } catch (err) {
    return { ok: false, error: err?.message || "join_failed" };
  }
  if (existing) return { ok: false, error: "already_member" };
  try {
    db.prepare(`INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`)
      .run(orgId, userId, role, new Date().toISOString());
  } catch (err) {
    return { ok: false, error: err?.message || "join_failed" };
  }
  return { ok: true, role };
}

export function leaveOrganization(db, orgId, userId) {
  if (!db) return { ok: false, error: "db_required" };
  let membership;
  try {
    membership = db.prepare(`SELECT role FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId);
  } catch {
    membership = null;
  }
  if (!membership) return { ok: false, error: "not_member" };
  const org = _readOrgRow(db, orgId);
  if (org?.leaderId === userId) return { ok: false, error: "leader_cannot_leave" };
  try {
    db.prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`).run(orgId, userId);
  } catch (err) {
    return { ok: false, error: err?.message || "leave_failed" };
  }
  return { ok: true };
}

export function setMemberRole(db, orgId, targetUserId, newRole, actorId) {
  if (!db) return { ok: false, error: "db_required" };
  const org = _readOrgRow(db, orgId);
  if (!org) return { ok: false, error: "org_not_found" };
  let actorRole, targetExists;
  try {
    actorRole = db.prepare(`SELECT role FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, actorId)?.role;
    targetExists = db.prepare(`SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, targetUserId);
  } catch (err) {
    return { ok: false, error: err?.message || "set_role_failed" };
  }
  if (actorRole !== "leader" && actorRole !== "officer") return { ok: false, error: "insufficient_rank" };
  if (!targetExists) return { ok: false, error: "target_not_member" };
  if (!MEMBER_ROLES.includes(newRole)) return { ok: false, error: "invalid_role" };
  try {
    db.prepare(`UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?`).run(newRole, orgId, targetUserId);
  } catch (err) {
    return { ok: false, error: err?.message || "set_role_failed" };
  }
  return { ok: true, role: newRole };
}

export function getOrgMembers(db, orgId) {
  if (!db || !orgId) return [];
  try {
    return db.prepare(`SELECT user_id AS userId, role FROM org_members WHERE org_id = ? ORDER BY joined_at ASC`).all(orgId);
  } catch {
    return [];
  }
}

// Reverse lookup: which org(s) is a user a member of. Used to resolve "the
// caller's firm" for org-scoped chat without the client supplying an orgId.
export function getOrgsForUser(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`SELECT org_id AS orgId, role FROM org_members WHERE user_id = ?`).all(userId);
  } catch {
    return [];
  }
}

export function listOrganizations(db, { type, districtId, limit = 50 } = {}) {
  if (!db) return [];
  let sql = `SELECT * FROM world_organizations WHERE 1=1`;
  const params = [];
  if (type) { sql += ` AND type = ?`; params.push(type); }
  if (districtId) { sql += ` AND district_id = ?`; params.push(districtId); }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(Math.max(1, Math.min(500, Number(limit) || 50)));
  let rows;
  try {
    rows = db.prepare(sql).all(...params);
  } catch {
    return [];
  }
  return rows.map((row) => {
    const org = _hydrateOrgRow(row);
    _orgRowCache.set(org.id, org);
    return { ...org, memberCount: _memberCount(db, org.id) };
  });
}

export function contributeToTreasury(db, orgId, amount, userId) {
  if (!db) return { ok: false, error: "db_required" };
  const org = _readOrgRow(db, orgId);
  if (!org) return { ok: false, error: "org_not_found" };
  const amt = Number(amount) || 0;
  const newTreasury = org.treasury + amt;
  const newStats = { ...org.stats, totalEarned: (org.stats.totalEarned || 0) + amt };
  try {
    db.prepare(`UPDATE world_organizations SET treasury = ?, stats_json = ? WHERE id = ?`)
      .run(newTreasury, JSON.stringify(newStats), orgId);
  } catch (err) {
    return { ok: false, error: err?.message || "contribute_failed" };
  }
  // Invalidate rather than patch-in-place — the next read re-hydrates the
  // authoritative row from the DB, so a fresh process (empty cache) and a
  // long-running one (invalidated cache) behave identically.
  _orgRowCache.delete(orgId);
  void userId; // kept for API compat; there's no per-user contribution ledger
  return { ok: true, treasury: newTreasury };
}

// ══════════════════════════════════════════════════════════════════════════════
// ALLIANCES — Cross-organization collaboration (in-memory; org existence is
// verified live against the durable substrate above)
// ══════════════════════════════════════════════════════════════════════════════

/** @type {Map<string, object>} Alliances keyed by alliance ID */
const _alliances = new LruMap();

export function createAlliance(db, { name, founderOrgId, description }) {
  const org = _readOrgRow(db, founderOrgId);
  if (!org) return { ok: false, error: "org_not_found" };
  const id = `alliance_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  _alliances.set(id, {
    id, name, description: description || "", founderOrgId,
    memberOrgs: [founderOrgId], revenueSplit: "equal",
    createdAt: new Date().toISOString(),
  });
  return { ok: true, allianceId: id };
}

export function joinAlliance(allianceId, orgId) {
  const alliance = _alliances.get(allianceId);
  if (!alliance) return { ok: false, error: "alliance_not_found" };
  if (alliance.memberOrgs.includes(orgId)) return { ok: false, error: "already_member" };
  alliance.memberOrgs.push(orgId);
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// PARTIES — Temporary groups of 2-10 (in-memory by design — session-lived)
// ══════════════════════════════════════════════════════════════════════════════

export function createParty(leaderId) {
  if (_userParty.has(leaderId)) return { ok: false, error: "already_in_party" };
  const id = `party_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  _parties.set(id, {
    id, leaderId, members: [leaderId],
    sharedQuest: null, chatChannel: `party_${id}`,
    createdAt: new Date().toISOString(),
  });
  _userParty.set(leaderId, id);
  return { ok: true, partyId: id, chatChannel: `party_${id}` };
}

export function joinParty(partyId, userId) {
  if (_userParty.has(userId)) return { ok: false, error: "already_in_party" };
  const party = _parties.get(partyId);
  if (!party) return { ok: false, error: "party_not_found" };
  if (party.members.length >= MAX_PARTY_SIZE) return { ok: false, error: "party_full" };
  party.members.push(userId);
  _userParty.set(userId, partyId);
  return { ok: true, members: party.members };
}

export function leaveParty(userId) {
  const partyId = _userParty.get(userId);
  if (!partyId) return { ok: false, error: "not_in_party" };
  const party = _parties.get(partyId);
  if (!party) { _userParty.delete(userId); return { ok: true }; }
  party.members = party.members.filter(m => m !== userId);
  _userParty.delete(userId);
  if (party.members.length === 0) _parties.delete(partyId);
  else if (party.leaderId === userId) party.leaderId = party.members[0];
  return { ok: true };
}

export function getParty(partyId) {
  return _parties.get(partyId) || null;
}

export function getUserParty(userId) {
  const partyId = _userParty.get(userId);
  return partyId ? _parties.get(partyId) : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// MENTORSHIP (in-memory by design — session-lived)
// ══════════════════════════════════════════════════════════════════════════════

export function registerMentor(userId, { domain, maxMentees = 3 }) {
  const id = `mentor_${userId}_${domain}`;
  if (!_mentorships.has(id)) {
    _mentorships.set(id, {
      id, mentorId: userId, domain, maxMentees, activeMentees: [],
      revenueSharePercent: 5, // mentor earns 5% of mentee earnings
      registeredAt: new Date().toISOString(),
    });
  }
  return { ok: true, mentorId: id };
}

export function requestMentorship(menteeId, mentorRegistrationId) {
  const mentor = _mentorships.get(mentorRegistrationId);
  if (!mentor) return { ok: false, error: "mentor_not_found" };
  if (mentor.activeMentees.length >= mentor.maxMentees) return { ok: false, error: "mentor_full" };
  if (mentor.activeMentees.includes(menteeId)) return { ok: false, error: "already_mentored" };

  const pairId = `mentorship_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  mentor.activeMentees.push(menteeId);
  _mentorships.set(pairId, {
    id: pairId, mentorId: mentor.mentorId, menteeId,
    domain: mentor.domain, revenueSharePercent: mentor.revenueSharePercent,
    status: "active", startedAt: new Date().toISOString(),
    dtusCreated: 0, ccEarned: 0,
  });
  return { ok: true, mentorshipId: pairId, domain: mentor.domain };
}

export function getMentorships(userId) {
  const result = [];
  for (const [id, m] of _mentorships) {
    if (m.mentorId === userId || m.menteeId === userId) result.push(m);
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// RECRUITMENT BOARD (in-memory by design — session-lived listings)
// ══════════════════════════════════════════════════════════════════════════════

function _cullExpiredRecruitments() {
  const cutoff = Date.now() - RECRUITMENT_LISTING_TTL_MS;
  let i = 0;
  while (i < _recruitmentBoard.length) {
    const postedAtMs = Date.parse(_recruitmentBoard[i].postedAt);
    if (Number.isFinite(postedAtMs) && postedAtMs < cutoff) {
      _recruitmentBoard.splice(i, 1);
    } else {
      i++;
    }
  }
  if (_recruitmentBoard.length > MAX_RECRUITMENT_LISTINGS) {
    _recruitmentBoard.splice(0, _recruitmentBoard.length - MAX_RECRUITMENT_LISTINGS);
  }
}

export function postRecruitment({ orgId, type, title, description, requirements, benefits, districtId }) {
  const id = `recruit_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const listing = {
    id, orgId, type: type || "looking_for_members",
    title, description: description || "", requirements: requirements || "none",
    benefits: benefits || "", districtId,
    postedAt: new Date().toISOString(), status: "active",
    applications: [],
  };
  _recruitmentBoard.push(listing);
  _cullExpiredRecruitments();
  return { ok: true, listingId: id };
}

export function applyToRecruitment(listingId, userId, { message, portfolio }) {
  const listing = _recruitmentBoard.find(l => l.id === listingId);
  if (!listing) return { ok: false, error: "listing_not_found" };
  if (listing.applications.some(a => a.userId === userId)) return { ok: false, error: "already_applied" };
  listing.applications.push({
    userId, message: message || "", portfolio: portfolio || null,
    appliedAt: new Date().toISOString(), status: "pending",
  });
  return { ok: true };
}

export function getRecruitmentBoard({ districtId, type, limit = 50 } = {}) {
  let board = _recruitmentBoard.filter(l => l.status === "active");
  if (districtId) board = board.filter(l => l.districtId === districtId);
  if (type) board = board.filter(l => l.type === type);
  return board.slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════════════

export function getOrganizationStats(db) {
  let totalOrgs = 0;
  const orgsByType = Object.fromEntries([...ORG_TYPES].map(t => [t, 0]));
  if (db) {
    try {
      const rows = db.prepare(`SELECT type, COUNT(*) AS c FROM world_organizations GROUP BY type`).all();
      for (const r of rows) {
        if (Object.prototype.hasOwnProperty.call(orgsByType, r.type)) orgsByType[r.type] = r.c;
        totalOrgs += r.c;
      }
    } catch { /* best-effort; degrade to zeros */ }
  }
  return {
    totalOrgs,
    totalParties: _parties.size,
    totalMentorships: _mentorships.size,
    totalRecruitments: _recruitmentBoard.length,
    totalAlliances: _alliances.size,
    orgsByType,
  };
}
