// betting-markets-hub-attribution.test.js
//
// FIX-spectate-001: the spectate index card for Concordia Hub counted
// open markets whose world_id is NULL (spectate.list groups them under
// "concordia-hub"), while the world detail (spectate.get →
// listOpenMarkets(db, 'concordia-hub')) required an exact world_id
// match and showed "No open markets" — phantom markets. The scoped
// read now applies the same hub attribution as the grouping.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/162_spectator_betting.js";
import { listOpenMarkets } from "../lib/betting-markets.js";

function seed() {
  const db = new Database(":memory:");
  up(db);
  const ins = db.prepare(
    "INSERT INTO prediction_markets (world_id, question, resolution_kind, status) VALUES (?, ?, 'manual', ?)",
  );
  ins.run(null, "Worldless one", "open");
  ins.run("", "Worldless two", "open");
  ins.run("concordia-hub", "Hub market", "open");
  ins.run("other-world", "Other market", "open");
  ins.run(null, "Worldless but resolved", "resolved");
  return db;
}

test("hub read includes worldless open markets — card and detail agree", () => {
  const db = seed();
  const hub = listOpenMarkets(db, "concordia-hub", 50);
  assert.equal(hub.length, 3);
  assert.deepEqual(
    hub.map((m) => m.question).sort(),
    ["Hub market", "Worldless one", "Worldless two"],
  );
});

test("other worlds and the unscoped read are unchanged", () => {
  const db = seed();
  assert.equal(listOpenMarkets(db, "other-world", 50).length, 1);
  assert.equal(listOpenMarkets(db, null, 50).length, 4);
  assert.equal(listOpenMarkets(db, "no-such-world", 50).length, 0);
});
