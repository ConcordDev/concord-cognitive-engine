/**
 * Tier-2 contract tests for Concordia Phase 16 — council engine.
 *
 * Pins:
 *   - openSession idempotent on (realm, season, year)
 *   - submitPetition requires open session
 *   - castVote upserts on (petition, member)
 *   - tallyVotes: aye>nay → approved, nay>aye → rejected, tie → tabled, 0/0 → tabled
 *   - closeSession resolves all unresolved petitions
 *   - playerLobby gated by member opinion ≥ 0
 *   - listOpenSessions filters by status='open'
 *
 * Run: node --test tests/council-engine.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  openSession,
  closeSession,
  submitPetition,
  listPetitions,
  castVote,
  tallyVotes,
  playerLobby,
  listOpenSessions,
} from "../lib/council-engine.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up183 } from "../migrations/183_council_sessions.js";
import { recordOpinionEvent } from "../lib/npc-opinions.js";

function setupDb() {
  const db = new Database(":memory:");
  up153(db); up183(db);
  return db;
}

describe("Phase 16 / council — openSession idempotency", () => {
  it("first open returns sessionId", () => {
    const db = setupDb();
    const r = openSession(db, "realm_1", 1, 1);
    assert.equal(r.action, "opened");
    assert.ok(r.sessionId);
  });

  it("re-open same (realm, season, year) returns same id", () => {
    const db = setupDb();
    const r1 = openSession(db, "realm_1", 1, 1);
    const r2 = openSession(db, "realm_1", 1, 1);
    assert.equal(r1.sessionId, r2.sessionId);
  });

  it("different season → different id", () => {
    const db = setupDb();
    const r1 = openSession(db, "realm_1", 1, 1);
    const r2 = openSession(db, "realm_1", 2, 1);
    assert.notEqual(r1.sessionId, r2.sessionId);
  });
});

describe("Phase 16 / council — submitPetition", () => {
  it("rejects when session not open", () => {
    const db = setupDb();
    const r = submitPetition(db, "ghost_session", { kind: "player", id: "u_1" }, "topic");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "session_not_found");
  });

  it("submits when session open", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const r = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "tax_cut");
    assert.equal(r.action, "submitted");
    assert.equal(listPetitions(db, s.sessionId).length, 1);
  });

  it("rejects bad petitioner kind", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const r = submitPetition(db, s.sessionId, { kind: "ghost", id: "x" }, "x");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_petitioner_kind");
  });
});

describe("Phase 16 / council — castVote + tallyVotes", () => {
  it("aye > nay → approved", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "x");
    castVote(db, p.petitionId, "m1", "aye");
    castVote(db, p.petitionId, "m2", "aye");
    castVote(db, p.petitionId, "m3", "nay");
    assert.equal(tallyVotes(db, p.petitionId).resolution, "approved");
  });

  it("nay > aye → rejected", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "x");
    castVote(db, p.petitionId, "m1", "nay");
    castVote(db, p.petitionId, "m2", "nay");
    castVote(db, p.petitionId, "m3", "aye");
    assert.equal(tallyVotes(db, p.petitionId).resolution, "rejected");
  });

  it("tie → tabled", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "x");
    castVote(db, p.petitionId, "m1", "aye");
    castVote(db, p.petitionId, "m2", "nay");
    assert.equal(tallyVotes(db, p.petitionId).resolution, "tabled");
  });

  it("no votes → tabled", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "x");
    assert.equal(tallyVotes(db, p.petitionId).resolution, "tabled");
  });

  it("vote upserts on (petition, member)", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "x");
    castVote(db, p.petitionId, "m1", "aye");
    castVote(db, p.petitionId, "m1", "nay");
    assert.equal(tallyVotes(db, p.petitionId).resolution, "rejected");
  });

  it("rejects bad vote value", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "x");
    const r = castVote(db, p.petitionId, "m1", "maybe");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_vote");
  });
});

describe("Phase 16 / council — closeSession resolves petitions", () => {
  it("closes + tallies pending petitions", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    const p1 = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "x");
    const p2 = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "y");
    castVote(db, p1.petitionId, "m1", "aye");
    castVote(db, p1.petitionId, "m2", "aye");
    castVote(db, p2.petitionId, "m1", "nay");
    castVote(db, p2.petitionId, "m2", "nay");
    const r = closeSession(db, s.sessionId);
    assert.equal(r.approved, 1);
    assert.equal(r.rejected, 1);
    const ses = db.prepare(`SELECT status FROM council_sessions WHERE id = ?`).get(s.sessionId);
    assert.equal(ses.status, "closed");
  });
});

describe("Phase 16 / council — playerLobby gate", () => {
  it("refuses lobby when member hostile", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    recordOpinionEvent(db, { npcId: "member_a", targetKind: "player", targetId: "u_1" }, -30, "x");
    const r = playerLobby(db, s.sessionId, "u_1", "member_a", 5);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "member_hostile");
  });

  it("succeeds when member neutral or positive", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    recordOpinionEvent(db, { npcId: "member_a", targetKind: "player", targetId: "u_1" }, 10, "x");
    const r = playerLobby(db, s.sessionId, "u_1", "member_a", 5);
    assert.equal(r.action, "lobbied");
    assert.equal(r.opinion_after, 15);
  });

  it("caps delta to [-10, 10]", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    recordOpinionEvent(db, { npcId: "member_a", targetKind: "player", targetId: "u_1" }, 5, "x");
    const r = playerLobby(db, s.sessionId, "u_1", "member_a", 1000);
    assert.equal(r.delta, 10);
  });

  it("requires open session", () => {
    const db = setupDb();
    const s = openSession(db, "realm_1", 1, 1);
    db.prepare(`UPDATE council_sessions SET status = 'closed' WHERE id = ?`).run(s.sessionId);
    recordOpinionEvent(db, { npcId: "member_a", targetKind: "player", targetId: "u_1" }, 5, "x");
    const r = playerLobby(db, s.sessionId, "u_1", "member_a", 5);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "session_not_open");
  });
});

describe("Phase 16 / council — listOpenSessions", () => {
  it("filters by status=open", () => {
    const db = setupDb();
    const s1 = openSession(db, "realm_1", 1, 1);
    const s2 = openSession(db, "realm_2", 1, 1);
    closeSession(db, s2.sessionId);
    const lst = listOpenSessions(db);
    assert.equal(lst.length, 1);
    assert.equal(lst[0].id, s1.sessionId);
  });

  it("filters by realm", () => {
    const db = setupDb();
    openSession(db, "realm_1", 1, 1);
    openSession(db, "realm_2", 1, 1);
    assert.equal(listOpenSessions(db, "realm_1").length, 1);
  });
});
