// server/tests/death-loot-currency-separation.test.js
//
// Gap 3 verdict pin — the two death-drop mechanics use two GENUINELY SEPARATE
// currencies, and no single wired death event fires both. This is not a bug;
// it is coherent design. This test regression-pins the separation.
//
// Wired-call-site evidence (grep across server/, verified at authoring time):
//   - dropCorpseOnDeath  — server.js:9737 (socket PvP `combat:attack` kill path,
//     player targets only, skipped in training) + domains/player-corpse.js:24
//     (explicit macro). Debits ONLY users.concordia_credits (Concord Coin,
//     migration 045); a self-recoverable penalty — the coins return to the SAME
//     player on corpse recovery; the killer never receives them.
//   - handlePlayerDeath  — routes/world.js:2283 ONLY (POST /api/world/combat/death;
//     no wired client caller — 0 grep hits for combat/death in concord-frontend/).
//     Debits ONLY users.sparks (migration 048, own sparks_ledger).
//   - handleNPCKilledPlayer — routes/worlds.js:3276 (NPC-attack kill route; that
//     route never calls dropCorpseOnDeath). Debits ONLY users.sparks.
//
// So each wired death event fires exactly ONE mechanic on ONE currency.
// concordia_credits (real, USD-pegged Concord Coin) and sparks (gameplay-only,
// zero real-world value, transferable killer reward) are separate by design.
//
// Run: node --test tests/death-loot-currency-separation.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { dropCorpseOnDeath } from "../lib/player-corpse.js";
import { handlePlayerDeath, handleNPCKilledPlayer } from "../lib/pvp-loot.js";

async function freshDb() {
  const db = new Database(":memory:");
  await runMigrations(db);
  return db;
}

function seedUser(db, { id, sparks = 0, credits = 0 } = {}) {
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, created_at, sparks, concordia_credits)
    VALUES (?, ?, ?, 'x', '2026-01-01', ?, ?)
  `).run(id, `u_${id}`, `${id}@t.test`, sparks, credits);
}

function seedInventory(db, userId, n = 2) {
  for (let i = 0; i < n; i++) {
    db.prepare(`
      INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality)
      VALUES (?, ?, 'resource', ?, ?, 5, 'common')
    `).run(`inv_${userId}_${i}`, userId, `item${i}`, `Item ${i}`);
  }
}

function creditsOf(db, id) { return db.prepare(`SELECT concordia_credits AS c FROM users WHERE id=?`).get(id).c; }
function sparksOf(db, id) { return db.prepare(`SELECT sparks AS s FROM users WHERE id=?`).get(id).s; }
function sparksLedgerRows(db, id) { return db.prepare(`SELECT COUNT(*) AS c FROM sparks_ledger WHERE user_id=?`).get(id).c; }

test("dropCorpseOnDeath touches ONLY concordia_credits — sparks + sparks_ledger untouched", async () => {
  const db = await freshDb();
  seedUser(db, { id: "u1", sparks: 1000, credits: 2000 });

  const r = dropCorpseOnDeath(db, {
    userId: "u1", worldId: "concordia-hub", position: { x: 0, y: 0, z: 0 }, cause: "combat",
  });
  assert.equal(r.ok, true);

  // Concord Coin debited by 25% (capped at 1000).
  const expectedLost = Math.min(1000, Math.floor(2000 * 0.25)); // 500
  assert.equal(r.coinsLost, expectedLost);
  assert.equal(creditsOf(db, "u1"), 2000 - expectedLost);

  // Sparks completely untouched — no debit, no ledger row.
  assert.equal(sparksOf(db, "u1"), 1000, "corpse drop never touches sparks");
  assert.equal(sparksLedgerRows(db, "u1"), 0, "corpse drop writes no sparks_ledger row");
  db.close();
});

test("handlePlayerDeath touches ONLY sparks — concordia_credits untouched", async () => {
  const db = await freshDb();
  seedUser(db, { id: "victim", sparks: 1000, credits: 2000 });
  seedInventory(db, "victim");

  const r = handlePlayerDeath(db, {
    killedId: "victim", killerId: "killer", gameMode: "combat", worldId: "w1",
  });
  assert.equal(r.sparksDropped, 300); // 30%

  // Sparks debited + exactly one ledger row.
  assert.equal(sparksOf(db, "victim"), 700);
  assert.equal(sparksLedgerRows(db, "victim"), 1);

  // Concord Coin balance completely untouched.
  assert.equal(creditsOf(db, "victim"), 2000, "pvp death never touches concordia_credits");
  db.close();
});

test("handleNPCKilledPlayer touches ONLY sparks — concordia_credits untouched", async () => {
  const db = await freshDb();
  seedUser(db, { id: "player", sparks: 1000, credits: 2000 });
  seedInventory(db, "player");

  const r = handleNPCKilledPlayer(db, { npcId: "npc1", playerId: "player", worldId: "w1" });
  assert.equal(r.sparksDropped, 300); // 30%

  assert.equal(sparksOf(db, "player"), 700);
  assert.equal(sparksLedgerRows(db, "player"), 1);
  assert.equal(creditsOf(db, "player"), 2000, "npc kill never touches concordia_credits");
  db.close();
});

test("no single death event fires both mechanics — corpse and sparks-loot are disjoint code paths", async () => {
  // Structural pin: the same user, run through each mechanic in isolation,
  // only ever loses the one currency that mechanic owns. There is no wired
  // call site that invokes both dropCorpseOnDeath AND handle*Death on one death.
  const db = await freshDb();
  seedUser(db, { id: "u", sparks: 1000, credits: 2000 });
  seedInventory(db, "u");

  // Corpse path in isolation.
  const before = { sparks: sparksOf(db, "u"), credits: creditsOf(db, "u") };
  dropCorpseOnDeath(db, { userId: "u", worldId: "w1", position: { x: 0, z: 0 } });
  assert.equal(sparksOf(db, "u"), before.sparks, "corpse path leaves sparks fixed");
  assert.ok(creditsOf(db, "u") < before.credits, "corpse path moves only credits");

  // Sparks path in isolation (fresh user to keep the assertion clean).
  seedUser(db, { id: "u2", sparks: 1000, credits: 2000 });
  handlePlayerDeath(db, { killedId: "u2", killerId: "k", gameMode: "combat", worldId: "w1" });
  assert.equal(creditsOf(db, "u2"), 2000, "sparks path leaves credits fixed");
  assert.ok(sparksOf(db, "u2") < 1000, "sparks path moves only sparks");
  db.close();
});
