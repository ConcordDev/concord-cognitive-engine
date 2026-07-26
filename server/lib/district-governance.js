// server/lib/district-governance.js
//
// Player-influenced districts — governance layer.
//
// districts.js (migration 374) is server-authored and read-only: nothing
// ever let a player shape a district's identity. This module adds a real
// propose -> vote -> resolve pipeline modeled on the same shape as Layer 11's
// faction-strategy state machine (lib/embodied/faction-strategy.js —
// deterministic resolution, honest logging, never a silent no-op) and the
// constitutional governance surface (lib/governance.js — open/vote/resolve
// with quorum + threshold). It does NOT touch districts.js's read path: an
// accepted proposal writes through the districts table's EXISTING
// palette_json / lighting_tag columns with plain UPDATE statements, so
// getDistrict()/listDistricts() reflect the change with zero changes to
// districts.js.
//
// Eligibility gate: proposing a change requires a minimum amount of REAL
// per-world playtime, derived from the existing `world_visits` table
// (closed visits' total_time_minutes + the live elapsed time of any open
// visit — see server/lib/transit.js which populates total_time_minutes on
// departure). Concord tracks residency at world granularity, not per-district
// — there is no per-district presence tracker anywhere in the codebase, and
// `city-presence.js`'s live position map is in-memory/ephemeral, not a
// durable signal — so world-visit minutes is the most honest available
// proxy: real recorded time in the district's own world, not a fabricated
// "district residency" counter and not a bare account-age check (which a
// player could satisfy by registering and never playing).
//
// Kinds:
//   'identity_tag'  — writes districts.lighting_tag (the existing "vibe/
//                      identity" field districts.js already exposes as
//                      `lightingTag`). proposed_value is a short display
//                      string (1..60 chars).
//   'palette_shift' — merges into districts.palette_json (exposed as
//                      `palette`). proposed_value is a partial
//                      { primary?, secondary?, accent? } object of #rrggbb
//                      hex strings; only supplied keys change.

import crypto from "node:crypto";
import logger from "../logger.js";
import { getDistrict } from "./districts.js";

export const KINDS = Object.freeze(["identity_tag", "palette_shift"]);

export const MIN_QUORUM = Math.max(1, Number(process.env.CONCORD_DISTRICT_PROPOSAL_QUORUM) || 3);
export const MIN_RESIDENCY_MINUTES = Math.max(0, Number(process.env.CONCORD_DISTRICT_PROPOSAL_MIN_RESIDENCY_MINUTES) || 10);
const MIN_WINDOW_S = 5 * 60;
const MAX_WINDOW_S = 30 * 86400;
const DEFAULT_WINDOW_S = Number(process.env.CONCORD_DISTRICT_PROPOSAL_WINDOW_S) || 24 * 3600;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PALETTE_KEYS = ["primary", "secondary", "accent"];

function nowS() { return Math.floor(Date.now() / 1000); }

/**
 * Real per-world playtime for a user, derived ONLY from recorded
 * `world_visits` rows (closed visits' total_time_minutes, plus the live
 * elapsed time of any still-open visit). Never fabricated; a user with no
 * visits gets an honest 0.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} worldId
 * @returns {number} minutes (may be fractional)
 */
export function computeWorldResidencyMinutes(db, userId, worldId) {
  if (!db || !userId || !worldId) return 0;
  let closedMinutes = 0;
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(total_time_minutes), 0) AS mins
        FROM world_visits
       WHERE user_id = ? AND world_id = ? AND departed_at IS NOT NULL
    `).get(userId, worldId);
    closedMinutes = Number(row?.mins || 0);
  } catch {
    return 0; // table missing on a minimal build — honest 0, never guessed
  }
  let openMinutes = 0;
  try {
    const open = db.prepare(`
      SELECT arrived_at FROM world_visits
       WHERE user_id = ? AND world_id = ? AND departed_at IS NULL
       ORDER BY arrived_at DESC LIMIT 1
    `).get(userId, worldId);
    if (open?.arrived_at) {
      openMinutes = Math.max(0, (nowS() - Number(open.arrived_at)) / 60);
    }
  } catch { /* ignore — closedMinutes alone is still honest */ }
  return closedMinutes + openMinutes;
}

function validateProposedValue(kind, value) {
  if (kind === "identity_tag") {
    const tag = typeof value === "string" ? value.trim() : "";
    if (!tag || tag.length > 60) return { ok: false, reason: "invalid_identity_tag" };
    return { ok: true, value: tag };
  }
  if (kind === "palette_shift") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: "invalid_palette_shift" };
    }
    const shift = {};
    for (const k of PALETTE_KEYS) {
      if (value[k] === undefined) continue;
      if (typeof value[k] !== "string" || !HEX_RE.test(value[k])) {
        return { ok: false, reason: "invalid_palette_color", key: k };
      }
      shift[k] = value[k];
    }
    if (Object.keys(shift).length === 0) return { ok: false, reason: "empty_palette_shift" };
    return { ok: true, value: shift };
  }
  return { ok: false, reason: "unknown_kind" };
}

/**
 * Propose a change to a district's identity_tag (lighting_tag) or palette.
 * Gated by real world-residency minutes (see computeWorldResidencyMinutes) —
 * an ineligible proposer is honestly rejected, never silently allowed.
 *
 * @returns {{ok:boolean, proposalId?:string, resolvesAt?:number, residencyMinutes?:number, reason?:string}}
 */
export function proposeDistrictChange(db, districtId, userId, kind, value, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!districtId) return { ok: false, reason: "missing_district" };
  if (!userId) return { ok: false, reason: "missing_user" };
  if (!KINDS.includes(kind)) return { ok: false, reason: "unknown_kind", kinds: [...KINDS] };

  const district = getDistrict(db, districtId);
  if (!district) return { ok: false, reason: "district_not_found" };

  const validated = validateProposedValue(kind, value);
  if (!validated.ok) return validated;

  const residencyMinutes = computeWorldResidencyMinutes(db, userId, district.worldId);
  if (residencyMinutes < MIN_RESIDENCY_MINUTES) {
    return {
      ok: false,
      reason: "ineligible_insufficient_residency",
      residencyMinutes: Math.round(residencyMinutes * 100) / 100,
      minutesRequired: MIN_RESIDENCY_MINUTES,
    };
  }

  const id = `distprop_${crypto.randomUUID()}`;
  const t = nowS();
  const windowS = Math.max(MIN_WINDOW_S, Math.min(MAX_WINDOW_S, Number(opts.durationS) || DEFAULT_WINDOW_S));

  try {
    db.prepare(`
      INSERT INTO district_proposals
        (id, district_id, proposer_user_id, kind, proposed_value, status, created_at, resolves_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, districtId, userId, kind, JSON.stringify(validated.value), t, t + windowS);
  } catch (err) {
    try { logger.warn?.("district-governance", "propose_failed", { error: err?.message }); } catch { /* ignore */ }
    return { ok: false, reason: "insert_failed", error: err?.message };
  }

  return { ok: true, proposalId: id, resolvesAt: t + windowS, residencyMinutes: Math.round(residencyMinutes * 100) / 100 };
}

/** Real (proposal, voter) vote tally — never fabricated, computed on demand. */
export function tallyVotes(db, proposalId) {
  if (!db || !proposalId) return { for: 0, against: 0, total: 0 };
  try {
    const rows = db.prepare(`
      SELECT vote, COUNT(*) AS n FROM district_votes WHERE proposal_id = ? GROUP BY vote
    `).all(proposalId);
    const counts = { for: 0, against: 0 };
    for (const r of rows) counts[r.vote] = r.n || 0;
    return { for: counts.for, against: counts.against, total: counts.for + counts.against };
  } catch {
    return { for: 0, against: 0, total: 0 };
  }
}

export function getProposal(db, proposalId) {
  if (!db || !proposalId) return null;
  try {
    return db.prepare(`SELECT * FROM district_proposals WHERE id = ?`).get(proposalId) || null;
  } catch {
    return null;
  }
}

/**
 * Cast a for/against vote. A second vote from the same user on the same
 * proposal is honestly rejected — district_votes' composite PRIMARY KEY
 * (proposal_id, user_id) is the real constraint that guarantees this, not
 * just an application-level check.
 */
export function castVote(db, proposalId, userId, vote) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!proposalId) return { ok: false, reason: "missing_proposal" };
  if (!userId) return { ok: false, reason: "missing_user" };
  if (vote !== "for" && vote !== "against") return { ok: false, reason: "invalid_vote" };

  const proposal = getProposal(db, proposalId);
  if (!proposal) return { ok: false, reason: "proposal_not_found" };
  if (proposal.status !== "pending") return { ok: false, reason: "not_pending", status: proposal.status };
  if (proposal.resolves_at <= nowS()) return { ok: false, reason: "voting_closed" };

  try {
    db.prepare(`
      INSERT INTO district_votes (proposal_id, user_id, vote, cast_at)
      VALUES (?, ?, ?, ?)
    `).run(proposalId, userId, vote, nowS());
  } catch (err) {
    // UNIQUE/PRIMARY KEY violation on (proposal_id, user_id) — real double-vote guard.
    const msg = String(err?.message || "");
    const code = String(err?.code || "");
    if (msg.includes("UNIQUE") || msg.includes("PRIMARY KEY") || code.includes("CONSTRAINT")) {
      return { ok: false, reason: "already_voted" };
    }
    return { ok: false, reason: "insert_failed", error: err?.message };
  }

  return { ok: true, tally: tallyVotes(db, proposalId) };
}

/** All proposals for a district, newest first, each with a live vote tally. */
export function listProposalsForDistrict(db, districtId, opts = {}) {
  if (!db || !districtId) return [];
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  let rows;
  try {
    // Secondary sort on rowid (SQLite's implicit rowid alias, since the
    // table has a TEXT — not INTEGER — PRIMARY KEY) breaks ties between
    // proposals created within the same unixepoch second in real insertion
    // order; created_at alone is not a stable enough clock for that.
    if (opts.status) {
      rows = db.prepare(`
        SELECT * FROM district_proposals WHERE district_id = ? AND status = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?
      `).all(districtId, opts.status, limit);
    } else {
      rows = db.prepare(`
        SELECT * FROM district_proposals WHERE district_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?
      `).all(districtId, limit);
    }
  } catch {
    return [];
  }
  return rows.map((r) => ({ ...r, tally: tallyVotes(db, r.id) }));
}

/**
 * Apply an accepted proposal's change to the REAL districts table, through
 * plain UPDATE statements against the existing palette_json / lighting_tag
 * columns — districts.js's read path (getDistrict/listDistricts) needs zero
 * changes to reflect this.
 */
function applyAcceptedProposal(db, proposal) {
  let value;
  try { value = JSON.parse(proposal.proposed_value); } catch { return null; }

  if (proposal.kind === "identity_tag") {
    db.prepare(`UPDATE districts SET lighting_tag = ? WHERE id = ?`).run(value, proposal.district_id);
    return { field: "lighting_tag", value };
  }
  if (proposal.kind === "palette_shift") {
    const row = db.prepare(`SELECT palette_json FROM districts WHERE id = ?`).get(proposal.district_id);
    let palette = {};
    try { palette = JSON.parse(row?.palette_json || "{}"); } catch { palette = {}; }
    const merged = { ...palette, ...value };
    db.prepare(`UPDATE districts SET palette_json = ? WHERE id = ?`).run(JSON.stringify(merged), proposal.district_id);
    return { field: "palette_json", value: merged };
  }
  return null;
}

/**
 * Resolve every pending proposal whose voting window has closed. Deterministic:
 *   - fewer than MIN_QUORUM total votes cast -> 'expired' (never applied —
 *     a single vote, or none, can never tip a district).
 *   - quorum met AND for-votes are a strict majority of votes cast -> 'accepted',
 *     applied to the real districts row.
 *   - quorum met but no majority -> 'rejected'.
 * Never throws; isolates each proposal so one bad row doesn't block the rest
 * (same discipline as faction-strategy-cycle's per-faction try/catch).
 */
export function resolveDistrictProposals(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const t = Number(opts.now) || nowS();
  let pending = [];
  try {
    pending = db.prepare(`
      SELECT * FROM district_proposals WHERE status = 'pending' AND resolves_at <= ?
      LIMIT 500
    `).all(t);
  } catch {
    return { ok: true, resolved: 0, accepted: 0, rejected: 0, expired: 0 };
  }

  let accepted = 0, rejected = 0, expired = 0;
  for (const proposal of pending) {
    try {
      const tally = tallyVotes(db, proposal.id);
      const quorumMet = tally.total >= MIN_QUORUM;
      const majorityFor = tally.total > 0 && tally.for > tally.against;

      let newStatus;
      if (!quorumMet) {
        newStatus = "expired";
        expired++;
      } else if (majorityFor) {
        newStatus = "accepted";
        accepted++;
      } else {
        newStatus = "rejected";
        rejected++;
      }

      const tx = db.transaction(() => {
        if (newStatus === "accepted") applyAcceptedProposal(db, proposal);
        db.prepare(`
          UPDATE district_proposals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'
        `).run(newStatus, t, proposal.id);
      });
      tx();

      try {
        logger.info?.("district-governance", "proposal_resolved", {
          proposalId: proposal.id, districtId: proposal.district_id, kind: proposal.kind,
          status: newStatus, forVotes: tally.for, againstVotes: tally.against, quorumMet,
        });
      } catch { /* logging must never block resolution */ }
    } catch (err) {
      try { logger.warn?.("district-governance", "proposal_resolve_failed", { proposalId: proposal.id, error: err?.message }); }
      catch { /* ignore */ }
    }
  }

  return { ok: true, resolved: pending.length, accepted, rejected, expired };
}

export default {
  KINDS,
  MIN_QUORUM,
  MIN_RESIDENCY_MINUTES,
  computeWorldResidencyMinutes,
  proposeDistrictChange,
  castVote,
  tallyVotes,
  getProposal,
  listProposalsForDistrict,
  resolveDistrictProposals,
};
