/**
 * World Organizations — Guilds, Parties, Mentorship, Recruitment
 *
 * Organizations are the social glue. Research shows players who participate
 * in group content are 3.2x more likely to stay past six months.
 *
 * Organization types: guild, crew, studio, firm, lab, band, club
 * Each gets a headquarters building in the relevant district.
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

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════

/** @type {Map<string, object>} Organizations keyed by org ID */
const _orgs = new LruMap();

/** @type {Map<string, object>} Parties (temp groups) keyed by party ID */
const _parties = new Map();

/** @type {Map<string, string>} userId -> partyId for quick lookup */
const _userParty = new Map();

/** @type {Map<string, object>} Mentorship pairs: mentorshipId -> { mentorId, menteeId, domain, ... } */
const _mentorships = new LruMap();

/** @type {object[]} Recruitment board listings */
const _recruitmentBoard = [];

/** @type {Map<string, Map<string, string>>} orgId -> Map<userId, role> */
const _orgMembers = new LruMap();

// ══════════════════════════════════════════════════════════════════════════════
// ORGANIZATIONS
// ══════════════════════════════════════════════════════════════════════════════

export function createOrganization({ name, type, description, leaderId, districtId, purpose, recruitCriteria, revenueSplit }) {
  if (!name || !leaderId) return { ok: false, error: "name_and_leader_required" };
  if (type && !ORG_TYPES.has(type)) return { ok: false, error: `invalid_type. Valid: ${[...ORG_TYPES]}` };

  const id = `org_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const org = {
    id, name, type: type || "guild", description: description || "",
    leaderId, districtId: districtId || null,
    purpose: purpose || "", recruitCriteria: recruitCriteria || "open",
    revenueSplit: revenueSplit || { leader: 10, treasury: 20, members: 70 },
    treasury: 0, dtuCount: 0,
    headquarters: { districtId, customized: false },
    createdAt: new Date().toISOString(),
    stats: { totalEarned: 0, totalCited: 0, activeMissions: 0 },
  };
  _orgs.set(id, org);

  const members = new Map();
  members.set(leaderId, "leader");
  _orgMembers.set(id, members);

  return { ok: true, organization: org };
}

export function getOrganization(orgId) {
  const org = _orgs.get(orgId);
  if (!org) return null;
  const members = _orgMembers.get(orgId);
  return { ...org, memberCount: members?.size || 0 };
}

export function joinOrganization(orgId, userId, role = "member") {
  const org = _orgs.get(orgId);
  if (!org) return { ok: false, error: "org_not_found" };
  const members = _orgMembers.get(orgId);
  if (members.size >= MAX_ORG_MEMBERS) return { ok: false, error: "org_full" };
  if (members.has(userId)) return { ok: false, error: "already_member" };
  members.set(userId, role);
  return { ok: true, role };
}

export function leaveOrganization(orgId, userId) {
  const members = _orgMembers.get(orgId);
  if (!members?.has(userId)) return { ok: false, error: "not_member" };
  const org = _orgs.get(orgId);
  if (org?.leaderId === userId) return { ok: false, error: "leader_cannot_leave" };
  members.delete(userId);
  return { ok: true };
}

export function setMemberRole(orgId, targetUserId, newRole, actorId) {
  const org = _orgs.get(orgId);
  if (!org) return { ok: false, error: "org_not_found" };
  const members = _orgMembers.get(orgId);
  const actorRole = members?.get(actorId);
  if (actorRole !== "leader" && actorRole !== "officer") return { ok: false, error: "insufficient_rank" };
  if (!members.has(targetUserId)) return { ok: false, error: "target_not_member" };
  if (!MEMBER_ROLES.includes(newRole)) return { ok: false, error: "invalid_role" };
  members.set(targetUserId, newRole);
  return { ok: true, role: newRole };
}

export function getOrgMembers(orgId) {
  const members = _orgMembers.get(orgId);
  if (!members) return [];
  return [...members.entries()].map(([userId, role]) => ({ userId, role }));
}

// Reverse lookup: which org(s) is a user a member of. Used to resolve "the
// caller's firm" for org-scoped chat without the client supplying an orgId.
export function getOrgsForUser(userId) {
  if (!userId) return [];
  const out = [];
  for (const [orgId, members] of _orgMembers) {
    if (members.has(userId)) out.push({ orgId, role: members.get(userId) });
  }
  return out;
}

export function listOrganizations({ type, districtId, limit = 50 } = {}) {
  let orgs = [..._orgs.values()];
  if (type) orgs = orgs.filter(o => o.type === type);
  if (districtId) orgs = orgs.filter(o => o.districtId === districtId);
  return orgs.slice(0, limit).map(o => ({
    ...o, memberCount: _orgMembers.get(o.id)?.size || 0,
  }));
}

export function contributeToTreasury(orgId, amount, userId) {
  const org = _orgs.get(orgId);
  if (!org) return { ok: false, error: "org_not_found" };
  org.treasury += amount;
  org.stats.totalEarned += amount;
  return { ok: true, treasury: org.treasury };
}

// ══════════════════════════════════════════════════════════════════════════════
// ALLIANCES — Cross-organization collaboration
// ══════════════════════════════════════════════════════════════════════════════

/** @type {Map<string, object>} Alliances keyed by alliance ID */
const _alliances = new LruMap();

export function createAlliance({ name, founderOrgId, description }) {
  const org = _orgs.get(founderOrgId);
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
// PARTIES — Temporary groups of 2-10
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
// MENTORSHIP
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
// RECRUITMENT BOARD
// ══════════════════════════════════════════════════════════════════════════════

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

export function getOrganizationStats() {
  return {
    totalOrgs: _orgs.size,
    totalParties: _parties.size,
    totalMentorships: _mentorships.size,
    totalRecruitments: _recruitmentBoard.length,
    totalAlliances: _alliances.size,
    orgsByType: Object.fromEntries([...ORG_TYPES].map(t => [t, [..._orgs.values()].filter(o => o.type === t).length])),
  };
}
