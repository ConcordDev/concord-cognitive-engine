// Contract test for the elections-engine Phase II Wave 22 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  openCycle, getCycle, listCyclesByWorld, advancePhase,
  declareCandidacy, withdrawCandidacy, listCandidatesInCycle,
  holdCampaignEvent, listCampaignEvents,
  castVote, tallyResults, certify,
  ELECTIONS_CONSTANTS,
} from "../lib/elections-engine.js";
import registerPoliticsMacros from "../domains/politics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`politics.${name}`);
  assert.ok(fn, `politics.${name} not registered`);
  return fn(ctx, input);
}

let db;
before(() => { registerPoliticsMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE election_cycles (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      office_kind TEXT NOT NULL,
      seat_label TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'filing',
      filing_open_at INTEGER NOT NULL DEFAULT (unixepoch()),
      voting_open_at INTEGER,
      voting_close_at INTEGER,
      certified_at INTEGER,
      term_ends_at INTEGER,
      winner_candidate_id TEXT
    );
    CREATE TABLE election_candidates (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      candidate_kind TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      platform_json TEXT NOT NULL DEFAULT '{}',
      filed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      withdrawn_at INTEGER,
      total_donations_cents INTEGER NOT NULL DEFAULT 0,
      total_rallies INTEGER NOT NULL DEFAULT 0,
      total_debates INTEGER NOT NULL DEFAULT 0,
      total_votes INTEGER NOT NULL DEFAULT 0,
      UNIQUE (cycle_id, candidate_kind, candidate_id)
    );
    CREATE TABLE election_ballots (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      voter_kind TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      cast_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (cycle_id, voter_kind, voter_id)
    );
    CREATE TABLE campaign_events (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      occurred_at INTEGER NOT NULL DEFAULT (unixepoch()),
      affinity_delta REAL NOT NULL DEFAULT 0
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "alice" }, userId: "alice", db });
const ctxBob   = () => ({ actor: { userId: "bob"   }, userId: "bob",   db });

describe("elections-engine library", () => {
  it("openCycle creates a row in filing phase", () => {
    const r = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "Plaza-North" });
    assert.equal(r.ok, true);
    const c = getCycle(db, r.cycleId);
    assert.equal(c.phase, "filing");
    assert.equal(c.world_id, "w1");
  });

  it("declareCandidacy idempotent + phase-gated", () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const c1 = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    const c2 = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    assert.equal(c1.ok, true);
    assert.equal(c2.alreadyFiled, true);
    advancePhase(db, cyc.cycleId, "general");
    const c3 = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "carol" });
    assert.equal(c3.ok, false);
    assert.equal(c3.reason, "filing_closed");
  });

  it("withdrawCandidacy hides candidate from list", () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const c = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    withdrawCandidacy(db, c.candidateId);
    const list = listCandidatesInCycle(db, cyc.cycleId);
    assert.equal(list.length, 0);
  });

  it("holdCampaignEvent — rally bumps total_rallies, debate bumps total_debates", () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const c = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    const rally = holdCampaignEvent(db, c.candidateId, "rally", { attendees: 30 });
    assert.equal(rally.ok, true);
    assert.ok(rally.affinityDelta > 0);
    const debate = holdCampaignEvent(db, c.candidateId, "debate", { quality: 0.9 });
    assert.equal(debate.ok, true);
    const cand = db.prepare("SELECT * FROM election_candidates WHERE id = ?").get(c.candidateId);
    assert.equal(cand.total_rallies, 1);
    assert.equal(cand.total_debates, 1);
    const events = listCampaignEvents(db, c.candidateId);
    assert.equal(events.length, 2);
  });

  it("donation tracks total_donations_cents", () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const c = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    holdCampaignEvent(db, c.candidateId, "donation", { amountCents: 2500 });
    holdCampaignEvent(db, c.candidateId, "donation", { amountCents: 1000 });
    const cand = db.prepare("SELECT total_donations_cents FROM election_candidates WHERE id = ?").get(c.candidateId);
    assert.equal(cand.total_donations_cents, 3500);
  });

  it("castVote requires general phase + unique per voter", () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const c1 = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    const c2 = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "bob" });
    const before = castVote(db, { cycleId: cyc.cycleId, voterKind: "player", voterId: "v1", candidateId: c1.candidateId });
    assert.equal(before.ok, false);
    assert.equal(before.reason, "voting_closed");

    advancePhase(db, cyc.cycleId, "general");
    const v1 = castVote(db, { cycleId: cyc.cycleId, voterKind: "player", voterId: "voter1", candidateId: c1.candidateId });
    assert.equal(v1.ok, true);
    const dup = castVote(db, { cycleId: cyc.cycleId, voterKind: "player", voterId: "voter1", candidateId: c2.candidateId });
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, "already_voted");
  });

  it("tallyResults sums votes correctly", () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const a = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    const b = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "bob" });
    advancePhase(db, cyc.cycleId, "general");
    for (let i = 0; i < 4; i++) castVote(db, { cycleId: cyc.cycleId, voterKind: "player", voterId: `v${i}`, candidateId: a.candidateId });
    for (let i = 0; i < 2; i++) castVote(db, { cycleId: cyc.cycleId, voterKind: "player", voterId: `vb${i}`, candidateId: b.candidateId });
    const t = tallyResults(db, cyc.cycleId);
    assert.equal(t.ok, true);
    assert.equal(t.total, 6);
    assert.equal(t.winner.candidateId, a.candidateId);
  });

  it("certify writes winner and flips phase to term", () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const a = declareCandidacy(db, { cycleId: cyc.cycleId, candidateKind: "player", candidateId: "alice" });
    advancePhase(db, cyc.cycleId, "general");
    castVote(db, { cycleId: cyc.cycleId, voterKind: "player", voterId: "v1", candidateId: a.candidateId });
    const c = certify(db, cyc.cycleId);
    assert.equal(c.ok, true);
    assert.equal(c.winner.candidateId, a.candidateId);
    const updated = getCycle(db, cyc.cycleId);
    assert.equal(updated.phase, "term");
    assert.equal(updated.winner_candidate_id, a.candidateId);
  });

  it("constants exposed", () => {
    assert.ok(ELECTIONS_CONSTANTS.DEFAULT_PHASE_DURATIONS.term_days > 0);
    assert.ok(ELECTIONS_CONSTANTS.CAMPAIGN_EFFECTS.rally);
  });
});

describe("politics domain macros", () => {
  it("end-to-end: open → file → vote → tally → certify", async () => {
    const cyc = await call("open_cycle", ctxAlice(), { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    assert.equal(cyc.ok, true);
    const decl = await call("declare_candidacy", ctxAlice(), { cycleId: cyc.cycleId });
    assert.equal(decl.ok, true);
    const declBob = await call("declare_candidacy", ctxBob(), { cycleId: cyc.cycleId });
    assert.equal(declBob.ok, true);
    await call("advance_phase", ctxAlice(), { cycleId: cyc.cycleId, phase: "general" });
    await call("vote", ctxBob(), { cycleId: cyc.cycleId, candidateId: decl.candidateId });
    const t = await call("tally", ctxAlice(), { cycleId: cyc.cycleId });
    assert.equal(t.total, 1);
    const cert = await call("certify", ctxAlice(), { cycleId: cyc.cycleId });
    assert.equal(cert.ok, true);
  });

  it("rejects no_user on vote / declare_candidacy", async () => {
    const cyc = openCycle(db, { worldId: "w1", officeKind: "mayor", seatLabel: "x" });
    const r = await call("declare_candidacy", { actor: { userId: null }, userId: null, db }, { cycleId: cyc.cycleId });
    assert.equal(r.ok, false);
    const v = await call("vote", { actor: { userId: null }, userId: null, db }, { cycleId: cyc.cycleId, candidateId: "x" });
    assert.equal(v.ok, false);
  });
});
