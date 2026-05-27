// server/lib/elections-engine.js
//
// Phase II Wave 22 — world-scoped player elections.
//
// Lifecycle:
//   filing → primary → debates → general → certification → term
//
// Players (and NPCs) file as candidates, hold rallies + debates +
// town halls to build affinity, voters cast ballots, the cycle
// certifies and the winner's term begins. Term-end auto-fires the
// next cycle if a successor election is scheduled.
//
// Vote tally is simple plurality; ranked-choice + runoff can layer
// on top via a separate macro.

import crypto from "node:crypto";

const DEFAULT_PHASE_DURATIONS = Object.freeze({
  filing_days:        3,
  primary_days:       2,
  debates_days:       3,
  general_days:       5,
  certification_days: 1,
  term_days:          30,
});

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/* ───────── Cycle CRUD ──────────────────────────────────────────────── */

export function openCycle(db, opts) {
  if (!opts?.worldId || !opts?.officeKind || !opts?.seatLabel) {
    throw new Error("worldId, officeKind, seatLabel required");
  }
  const id = uid("election");
  const now = Math.floor(Date.now() / 1000);
  const D = DEFAULT_PHASE_DURATIONS;
  const filingClose = now + D.filing_days * 86400;
  const votingOpen = filingClose + (D.primary_days + D.debates_days) * 86400;
  const votingClose = votingOpen + D.general_days * 86400;
  const termEnds = votingClose + D.certification_days * 86400 + D.term_days * 86400;
  db.prepare(`
    INSERT INTO election_cycles
      (id, world_id, office_kind, seat_label, phase, filing_open_at, voting_open_at, voting_close_at, term_ends_at)
    VALUES (?, ?, ?, ?, 'filing', ?, ?, ?, ?)
  `).run(id, opts.worldId, opts.officeKind, String(opts.seatLabel).slice(0, 120), now, votingOpen, votingClose, termEnds);
  return { ok: true, cycleId: id, phase: "filing" };
}

export function getCycle(db, cycleId) {
  return db.prepare("SELECT * FROM election_cycles WHERE id = ?").get(cycleId) || null;
}

export function listCyclesByWorld(db, worldId, phase = null) {
  if (phase) {
    return db.prepare(`
      SELECT * FROM election_cycles WHERE world_id = ? AND phase = ? ORDER BY filing_open_at DESC LIMIT 100
    `).all(worldId, phase);
  }
  return db.prepare(`
    SELECT * FROM election_cycles WHERE world_id = ? ORDER BY filing_open_at DESC LIMIT 100
  `).all(worldId);
}

export function advancePhase(db, cycleId, nextPhase) {
  const allowed = ["filing", "primary", "debates", "general", "certification", "term"];
  if (!allowed.includes(nextPhase)) return { ok: false, reason: "invalid_phase" };
  const r = db.prepare(`
    UPDATE election_cycles SET phase = ? WHERE id = ?
  `).run(nextPhase, cycleId);
  return { ok: r.changes > 0, phase: nextPhase };
}

/* ───────── Candidacy ───────────────────────────────────────────────── */

export function declareCandidacy(db, opts) {
  if (!opts?.cycleId || !opts?.candidateKind || !opts?.candidateId) {
    return { ok: false, reason: "missing_inputs" };
  }
  const cycle = getCycle(db, opts.cycleId);
  if (!cycle) return { ok: false, reason: "cycle_not_found" };
  if (cycle.phase !== "filing") return { ok: false, reason: "filing_closed", phase: cycle.phase };
  const existing = db.prepare(`
    SELECT id FROM election_candidates WHERE cycle_id = ? AND candidate_kind = ? AND candidate_id = ?
  `).get(opts.cycleId, opts.candidateKind, opts.candidateId);
  if (existing) return { ok: true, candidateId: existing.id, alreadyFiled: true };
  const id = uid("cand");
  db.prepare(`
    INSERT INTO election_candidates (id, cycle_id, candidate_kind, candidate_id, platform_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, opts.cycleId, opts.candidateKind, opts.candidateId, JSON.stringify(opts.platform || {}));
  return { ok: true, candidateId: id };
}

export function withdrawCandidacy(db, candidateId) {
  const r = db.prepare("UPDATE election_candidates SET withdrawn_at = unixepoch() WHERE id = ? AND withdrawn_at IS NULL").run(candidateId);
  return { ok: r.changes > 0 };
}

export function listCandidatesInCycle(db, cycleId) {
  return db.prepare(`
    SELECT * FROM election_candidates
    WHERE cycle_id = ? AND withdrawn_at IS NULL
    ORDER BY total_votes DESC, filed_at ASC
  `).all(cycleId);
}

/* ───────── Campaign events ─────────────────────────────────────────── */

const CAMPAIGN_EFFECTS = {
  rally:      { affinity_per_attendee: 0.02, max_attendees: 50 },
  debate:     { affinity_per_quality:  0.18, max_quality:    1 },
  town_hall:  { affinity_per_attendee: 0.05, max_attendees: 20 },
};

export function holdCampaignEvent(db, candidateId, eventKind, payload = {}) {
  const cand = db.prepare("SELECT * FROM election_candidates WHERE id = ?").get(candidateId);
  if (!cand) return { ok: false, reason: "candidate_not_found" };
  if (cand.withdrawn_at) return { ok: false, reason: "candidate_withdrawn" };
  if (!["rally", "debate", "town_hall", "donation"].includes(eventKind)) {
    return { ok: false, reason: "invalid_event_kind" };
  }
  let affinityDelta = 0;
  if (eventKind === "rally" || eventKind === "town_hall") {
    const cfg = CAMPAIGN_EFFECTS[eventKind];
    const attendees = Math.max(0, Math.min(cfg.max_attendees, Number(payload.attendees) || 5));
    affinityDelta = cfg.affinity_per_attendee * attendees;
  } else if (eventKind === "debate") {
    const cfg = CAMPAIGN_EFFECTS.debate;
    const quality = Math.max(0, Math.min(cfg.max_quality, Number(payload.quality) || 0.5));
    affinityDelta = cfg.affinity_per_quality * quality;
  } else if (eventKind === "donation") {
    const amount = Math.max(0, Math.floor(Number(payload.amountCents) || 0));
    db.prepare("UPDATE election_candidates SET total_donations_cents = total_donations_cents + ? WHERE id = ?").run(amount, candidateId);
  }
  const id = uid("camp");
  db.prepare(`
    INSERT INTO campaign_events (id, candidate_id, event_kind, payload_json, affinity_delta)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, candidateId, eventKind, JSON.stringify(payload), affinityDelta);
  // Counter bump
  if (eventKind === "rally")     db.prepare("UPDATE election_candidates SET total_rallies = total_rallies + 1 WHERE id = ?").run(candidateId);
  if (eventKind === "debate")    db.prepare("UPDATE election_candidates SET total_debates = total_debates + 1 WHERE id = ?").run(candidateId);
  return { ok: true, eventId: id, eventKind, affinityDelta };
}

export function listCampaignEvents(db, candidateId, limit = 100) {
  return db.prepare(`
    SELECT * FROM campaign_events WHERE candidate_id = ? ORDER BY occurred_at DESC LIMIT ?
  `).all(candidateId, Math.max(1, Math.min(500, Number(limit) || 100)));
}

/* ───────── Voting ──────────────────────────────────────────────────── */

export function castVote(db, opts) {
  if (!opts?.cycleId || !opts?.voterKind || !opts?.voterId || !opts?.candidateId) {
    return { ok: false, reason: "missing_inputs" };
  }
  const cycle = getCycle(db, opts.cycleId);
  if (!cycle) return { ok: false, reason: "cycle_not_found" };
  if (cycle.phase !== "general") return { ok: false, reason: "voting_closed", phase: cycle.phase };
  const cand = db.prepare("SELECT * FROM election_candidates WHERE id = ? AND cycle_id = ?").get(opts.candidateId, opts.cycleId);
  if (!cand) return { ok: false, reason: "candidate_not_in_cycle" };
  if (cand.withdrawn_at) return { ok: false, reason: "candidate_withdrawn" };

  const id = uid("ballot");
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO election_ballots (id, cycle_id, voter_kind, voter_id, candidate_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, opts.cycleId, opts.voterKind, opts.voterId, opts.candidateId);
      db.prepare("UPDATE election_candidates SET total_votes = total_votes + 1 WHERE id = ?").run(opts.candidateId);
    });
    tx();
    return { ok: true, ballotId: id };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) return { ok: false, reason: "already_voted" };
    return { ok: false, reason: "vote_failed", message: err?.message || String(err) };
  }
}

export function tallyResults(db, cycleId) {
  const candidates = listCandidatesInCycle(db, cycleId);
  if (candidates.length === 0) return { ok: true, total: 0, winner: null, results: [] };
  let totalVotes = 0;
  const results = candidates.map((c) => {
    totalVotes += c.total_votes;
    return { candidateId: c.id, candidateKind: c.candidate_kind, actorId: c.candidate_id, votes: c.total_votes };
  });
  const sorted = [...results].sort((a, b) => b.votes - a.votes);
  return { ok: true, total: totalVotes, winner: sorted[0]?.votes > 0 ? sorted[0] : null, results: sorted };
}

export function certify(db, cycleId) {
  const tally = tallyResults(db, cycleId);
  if (!tally.ok) return tally;
  const cycle = getCycle(db, cycleId);
  if (!cycle) return { ok: false, reason: "cycle_not_found" };
  const winnerCandidateId = tally.winner ? tally.winner.candidateId : null;
  db.prepare(`
    UPDATE election_cycles SET phase = 'term', winner_candidate_id = ?, certified_at = unixepoch()
    WHERE id = ?
  `).run(winnerCandidateId, cycleId);
  return { ok: true, winner: tally.winner, totalVotes: tally.total };
}

export const ELECTIONS_CONSTANTS = Object.freeze({
  DEFAULT_PHASE_DURATIONS,
  CAMPAIGN_EFFECTS,
});
