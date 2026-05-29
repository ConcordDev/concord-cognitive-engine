/**
 * C4 / F4.3 — co-op in runs.
 *
 * Pins: a party shares one extraction run (a party-mate joins the leader's run
 * instead of opening a solo one); the participant roster accumulates; a solo
 * player (no party) opens their own.
 *
 * Run: node --test tests/integration/run-coop.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up258 } from "../../migrations/258_extraction_runs.js";
import { up as up270 } from "../../migrations/270_run_coop.js";
import { addRunParticipant, runParticipants, findActivePartyRun } from "../../lib/run-coop.js";
import { startRun } from "../../lib/extraction.js";

function freshDb() {
  const db = new Database(":memory:");
  up258(db); up270(db);
  return db;
}

describe("C4 — run-coop roster", () => {
  it("addRunParticipant is idempotent; roster lists in join order", () => {
    const db = freshDb();
    addRunParticipant(db, "extraction", "r1", "u1");
    addRunParticipant(db, "extraction", "r1", "u2");
    addRunParticipant(db, "extraction", "r1", "u1"); // dup
    assert.deepEqual(runParticipants(db, "extraction", "r1"), ["u1", "u2"]);
    db.close();
  });
});

describe("C4 — party shares one extraction run", () => {
  it("a party-mate joins the leader's run, not a new one", () => {
    const db = freshDb();
    const leader = startRun(db, "leader", { worldId: "w1", partyId: "party-1" });
    assert.equal(leader.ok, true);
    assert.equal(leader.partyId, "party-1");

    const mate = startRun(db, "mate", { worldId: "w1", partyId: "party-1" });
    assert.equal(mate.ok, true);
    assert.equal(mate.joined, true);
    assert.equal(mate.runId, leader.runId, "mate joined the same run");

    // both on the roster; only one run row exists for the party
    assert.deepEqual(runParticipants(db, "extraction", leader.runId).sort(), ["leader", "mate"]);
    assert.equal(findActivePartyRun(db, "extraction_runs", "party-1"), leader.runId);
    db.close();
  });

  it("a solo player (no party) opens their own run", () => {
    const db = freshDb();
    const a = startRun(db, "solo-a", { worldId: "w1" });
    const b = startRun(db, "solo-b", { worldId: "w1" });
    assert.notEqual(a.runId, b.runId);
    db.close();
  });
});
