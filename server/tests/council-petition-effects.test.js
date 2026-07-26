/**
 * Tier-2 contract tests — council petition → real decree effect.
 *
 * Pins:
 *   - an APPROVED petition whose topic names a real decree kind
 *     (kingdom-decrees.js KIND_DEFAULTS) lands a real realm_decrees row
 *     AND the kind-specific side effect (e.g. tax_change updates
 *     realms.tax_rate) — not just a resolution column flip.
 *   - a REJECTED or TABLED petition produces NO decree row, even when
 *     its topic would otherwise map to a real effect.
 *   - a petition topic with no known decree-kind mapping honestly
 *     reports { ok:false, reason:'no_mapped_effect' } instead of
 *     silently no-oping or fabricating an effect.
 *
 * Run: node --test tests/council-petition-effects.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  openSession,
  closeSession,
  submitPetition,
  castVote,
} from "../lib/council-engine.js";
import { applyPetitionEffect } from "../lib/council-petition-effects.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up158 } from "../migrations/158_kingdoms.js";
import { up as up183 } from "../migrations/183_council_sessions.js";

const KINGDOM_ID = "kd_test_realm";

function setupDb() {
  const db = new Database(":memory:");
  up153(db); up158(db); up183(db);
  db.prepare(`
    INSERT INTO realms (id, name, world_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
    VALUES (?, 'Test Realm', 'concordia-hub', 'npc', 'npc_ruler_1', 60, 1000, 0.10)
  `).run(KINGDOM_ID);
  return db;
}

function voteApproved(db, petitionId) {
  castVote(db, petitionId, "m1", "aye");
  castVote(db, petitionId, "m2", "aye");
  castVote(db, petitionId, "m3", "nay");
}

function voteRejected(db, petitionId) {
  castVote(db, petitionId, "m1", "nay");
  castVote(db, petitionId, "m2", "nay");
  castVote(db, petitionId, "m3", "aye");
}

function voteTabled(db, petitionId) {
  castVote(db, petitionId, "m1", "aye");
  castVote(db, petitionId, "m2", "nay");
}

describe("council petition effects — approved + mapped topic lands a real decree", () => {
  it("tax_change petition approval actually changes realms.tax_rate", () => {
    const db = setupDb();
    const s = openSession(db, KINGDOM_ID, 1, 1);
    const p = submitPetition(
      db, s.sessionId, { kind: "player", id: "u_1" },
      "tax_change", JSON.stringify({ new_rate: 0.25 }),
    );
    assert.equal(p.action, "submitted");
    voteApproved(db, p.petitionId);

    const closed = closeSession(db, s.sessionId);
    assert.equal(closed.approved, 1);

    const row = db.prepare(`SELECT resolution FROM council_petitions WHERE id = ?`).get(p.petitionId);
    assert.equal(row.resolution, "approved");

    // The real, load-bearing assertion: query the actual tables the
    // decree pipeline writes, not a return value.
    const decree = db.prepare(`SELECT * FROM realm_decrees WHERE kingdom_id = ? AND kind = 'tax_change'`).get(KINGDOM_ID);
    assert.ok(decree, "expected a real realm_decrees row for the approved petition");
    assert.equal(decree.effect_state, "active");
    assert.equal(decree.issued_by_kind, "system");
    const body = JSON.parse(decree.body_json);
    assert.equal(body.new_rate, 0.25);

    const realm = db.prepare(`SELECT tax_rate FROM realms WHERE id = ?`).get(KINGDOM_ID);
    assert.equal(realm.tax_rate, 0.25, "applyDecreeEffect's tax_change branch must have actually run");
  });

  it("applyPetitionEffect return value reports the landed decree", () => {
    const db = setupDb();
    const s = openSession(db, KINGDOM_ID, 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "festival", null);
    voteApproved(db, p.petitionId);
    const petitionRow = db.prepare(`SELECT * FROM council_petitions WHERE id = ?`).get(p.petitionId);
    const r = applyPetitionEffect(db, petitionRow);
    assert.equal(r.ok, true);
    assert.equal(r.kind, "festival");
    assert.equal(r.kingdomId, KINGDOM_ID);
    assert.ok(r.decreeId);

    const decree = db.prepare(`SELECT * FROM realm_decrees WHERE id = ?`).get(r.decreeId);
    assert.ok(decree);
    assert.equal(decree.kind, "festival");
    assert.equal(decree.effect_state, "active");
  });
});

describe("council petition effects — rejected/tabled never produce an effect", () => {
  it("a rejected tax_change petition creates no decree row", () => {
    const db = setupDb();
    const s = openSession(db, KINGDOM_ID, 1, 1);
    const p = submitPetition(
      db, s.sessionId, { kind: "player", id: "u_1" },
      "tax_change", JSON.stringify({ new_rate: 0.40 }),
    );
    voteRejected(db, p.petitionId);

    const closed = closeSession(db, s.sessionId);
    assert.equal(closed.rejected, 1);
    assert.equal(closed.approved, 0);

    const row = db.prepare(`SELECT resolution FROM council_petitions WHERE id = ?`).get(p.petitionId);
    assert.equal(row.resolution, "rejected");

    const decree = db.prepare(`SELECT * FROM realm_decrees WHERE kingdom_id = ?`).get(KINGDOM_ID);
    assert.equal(decree, undefined, "a rejected petition must never issue a decree");

    const realm = db.prepare(`SELECT tax_rate FROM realms WHERE id = ?`).get(KINGDOM_ID);
    assert.equal(realm.tax_rate, 0.10, "tax_rate must be unchanged");
  });

  it("a tabled (tied-vote) festival petition creates no decree row", () => {
    const db = setupDb();
    const s = openSession(db, KINGDOM_ID, 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "festival", null);
    voteTabled(db, p.petitionId);

    const closed = closeSession(db, s.sessionId);
    assert.equal(closed.tabled, 1);
    assert.equal(closed.approved, 0);

    const row = db.prepare(`SELECT resolution FROM council_petitions WHERE id = ?`).get(p.petitionId);
    assert.equal(row.resolution, "tabled");

    const decree = db.prepare(`SELECT * FROM realm_decrees WHERE kingdom_id = ?`).get(KINGDOM_ID);
    assert.equal(decree, undefined, "a tabled petition must never issue a decree");
  });
});

describe("council petition effects — unmapped topic is honest, not a silent no-op", () => {
  it("closeSession approves the petition but leaves an honest no_mapped_effect trace", () => {
    const db = setupDb();
    const s = openSession(db, KINGDOM_ID, 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "declare_founders_day_a_holiday", null);
    voteApproved(db, p.petitionId);

    const closed = closeSession(db, s.sessionId);
    assert.equal(closed.approved, 1, "vote tally + resolution stamping still happen");

    const row = db.prepare(`SELECT resolution FROM council_petitions WHERE id = ?`).get(p.petitionId);
    assert.equal(row.resolution, "approved");

    // No decree fabricated for an unrecognised topic.
    const decree = db.prepare(`SELECT * FROM realm_decrees WHERE kingdom_id = ?`).get(KINGDOM_ID);
    assert.equal(decree, undefined);
  });

  it("applyPetitionEffect reports no_mapped_effect directly (not ok:true, not a throw)", () => {
    const db = setupDb();
    const s = openSession(db, KINGDOM_ID, 1, 1);
    const p = submitPetition(db, s.sessionId, { kind: "player", id: "u_1" }, "rename_the_plaza", null);
    const petitionRow = db.prepare(`SELECT * FROM council_petitions WHERE id = ?`).get(p.petitionId);
    const r = applyPetitionEffect(db, petitionRow);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_mapped_effect");
    assert.equal(r.topic, "rename_the_plaza");
  });

  it("missing session_id is an honest missing_inputs, not a throw", () => {
    const db = setupDb();
    const r = applyPetitionEffect(db, { id: "cp_x", topic: "tax_change" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});
