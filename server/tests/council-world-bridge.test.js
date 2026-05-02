/**
 * Council ↔ World bridge tests.
 * Run: node --test tests/council-world-bridge.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  recordFactionPolicy,
  getFactionPolicyState,
  bridgeSummitToWorld,
} from "../lib/council-world-bridge.js";

function setupDB() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE faction_policy_state (
      faction_id        TEXT PRIMARY KEY,
      policy_state_json TEXT NOT NULL DEFAULT '[]',
      updated_at        INTEGER NOT NULL
    )
  `);
  return db;
}

describe("council-world-bridge: recordFactionPolicy", () => {
  it("inserts a fresh policy entry", () => {
    const db = setupDB();
    const ok = recordFactionPolicy(db, "scholars_guild", {
      topic:     "magic_regulation",
      outcome:   "ban_unregistered_texts",
      summit_id: "sum_1",
    });
    assert.strictEqual(ok, true);
    const state = getFactionPolicyState(db, "scholars_guild");
    assert.strictEqual(state.length, 1);
    assert.strictEqual(state[0].outcome, "ban_unregistered_texts");
    assert.strictEqual(state[0].summit_id, "sum_1");
    assert.strictEqual(typeof state[0].ts, "number");
  });

  it("is idempotent on duplicate (summit_id, outcome) pairs", () => {
    const db = setupDB();
    recordFactionPolicy(db, "scholars_guild", { topic: "a", outcome: "X", summit_id: "sum_1" });
    recordFactionPolicy(db, "scholars_guild", { topic: "a", outcome: "X", summit_id: "sum_1" });
    const state = getFactionPolicyState(db, "scholars_guild");
    assert.strictEqual(state.length, 1);
  });

  it("preserves history for distinct outcomes", () => {
    const db = setupDB();
    recordFactionPolicy(db, "iron_wardens", { topic: "a", outcome: "X", summit_id: "sum_1" });
    recordFactionPolicy(db, "iron_wardens", { topic: "b", outcome: "Y", summit_id: "sum_2" });
    const state = getFactionPolicyState(db, "iron_wardens");
    assert.strictEqual(state.length, 2);
    // Most recent first
    assert.strictEqual(state[0].outcome, "Y");
    assert.strictEqual(state[1].outcome, "X");
  });

  it("returns empty array for unknown faction", () => {
    const db = setupDB();
    const state = getFactionPolicyState(db, "nonexistent");
    assert.deepStrictEqual(state, []);
  });

  it("returns false on missing inputs", () => {
    const db = setupDB();
    assert.strictEqual(recordFactionPolicy(null, "x", { outcome: "y", summit_id: "s" }), false);
    assert.strictEqual(recordFactionPolicy(db, "", { outcome: "y", summit_id: "s" }), false);
    assert.strictEqual(recordFactionPolicy(db, "x", { outcome: "" }), false);
  });
});

describe("council-world-bridge: bridgeSummitToWorld", () => {
  it("creates a world event and writes faction policy on completed summit", () => {
    const db = setupDB();
    const created = [];
    const fakeCreateEvent = (e) => { const r = { id: "evt_1", ...e }; created.push(r); return r; };

    const summit = {
      id: "sum_42",
      title: "Magic Regulation",
      outcomes: { decisionsReached: ["ban_unregistered_texts", "amnesty_period_30_days"] },
    };
    const cri = { id: "cri_phil", name: "Council of Philosophy", domain: "philosophy" };

    const res = bridgeSummitToWorld({
      db,
      summit,
      cri,
      createEvent: fakeCreateEvent,
      factionIds: ["scholars_guild", "iron_wardens"],
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.eventId, "evt_1");
    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0].type, "referendum");
    assert.strictEqual(created[0].cityId, "cri:philosophy");
    assert.ok(created[0].tags.includes("referendum"));
    assert.ok(created[0].tags.includes("summit:sum_42"));

    // 2 factions × 2 decisions = 4 policy writes
    assert.strictEqual(res.factionsUpdated, 4);
    const scholars = getFactionPolicyState(db, "scholars_guild");
    assert.strictEqual(scholars.length, 2);
  });

  it("is a no-op when no decisions were reached", () => {
    const db = setupDB();
    const created = [];
    const fakeCreateEvent = (e) => { created.push(e); return { id: "evt" }; };
    const res = bridgeSummitToWorld({
      db,
      summit: { id: "s1", outcomes: { decisionsReached: [] } },
      cri:    { id: "c1", domain: "x" },
      createEvent: fakeCreateEvent,
      factionIds: ["scholars_guild"],
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.eventId, null);
    assert.strictEqual(created.length, 0);
  });

  it("never throws on missing createEvent", () => {
    const db = setupDB();
    const res = bridgeSummitToWorld({
      db,
      summit: { id: "s1", outcomes: { decisionsReached: ["x"] } },
      cri:    { id: "c1", domain: "y" },
      createEvent: null,
      factionIds: ["scholars_guild"],
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.eventId, null);
    // Faction policy still recorded
    assert.strictEqual(res.factionsUpdated, 1);
  });
});
