/**
 * Tier-2 contract tests for the shadow-corpse substrate
 * (Theme deferred, game-feel pass).
 *
 * Pins:
 *   - dropCorpseOnDeath records a row + emits player:corpse-dropped
 *   - 25% of wallet (capped at 1000) lost; wallet debited
 *   - Re-dropping while a prior corpse is active marks the prior lost
 *   - activeCorpsesFor excludes recovered + lost
 *   - recoverCorpse rejects out-of-range / not_yours / lost / recovered
 *   - recoverCorpse credits coins back; subsequent attempts fail
 *   - sweepStaleCorpses marks past-TTL corpses lost
 *
 * Run: node --test tests/player-corpse.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  dropCorpseOnDeath,
  activeCorpsesFor,
  recoverCorpse,
  sweepStaleCorpses,
  COIN_LOSS_FRACTION,
  COIN_LOSS_MAX,
  RECOVER_RADIUS_M,
} from "../lib/player-corpse.js";
import { up as up148 } from "../migrations/151_player_corpses.js";

function setupDb(initialBalance = 0) {
  const db = new Database(":memory:");
  up148(db);
  // Concord Coin balances live in users.concordia_credits (migration 045).
  db.exec(`
    CREATE TABLE users (
      id                TEXT PRIMARY KEY,
      concordia_credits REAL DEFAULT 0
    );
  `);
  if (initialBalance > 0) {
    db.prepare(`INSERT INTO users (id, concordia_credits) VALUES (?, ?)`)
      .run("u1", initialBalance);
  }
  return db;
}

function installFakeRealtime() {
  const calls = [];
  globalThis.__CONCORD_REALTIME__ = {
    io: {
      to(channel) {
        return { emit(event, payload) { calls.push({ channel, event, payload }); } };
      },
    },
  };
  return calls;
}
function clearRealtime() { delete globalThis.__CONCORD_REALTIME__; }

describe("dropCorpseOnDeath", () => {
  let db, calls;
  beforeEach(() => { db = setupDb(2000); calls = installFakeRealtime(); });
  afterEach(() => clearRealtime());

  it("records a row + emits player:corpse-dropped", () => {
    const r = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "concordia-hub",
      position: { x: 12, y: 0, z: 5 }, cause: "combat",
    });
    assert.equal(r.ok, true);
    assert.equal(r.corpse.cause, "combat");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, "player:corpse-dropped");
    assert.equal(calls[0].channel, "world:concordia-hub");
  });

  it("loses COIN_LOSS_FRACTION × wallet, capped at COIN_LOSS_MAX", () => {
    const r = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1",
      position: { x: 0, z: 0 },
    });
    assert.equal(r.coinsLost, Math.min(COIN_LOSS_MAX, Math.floor(2000 * COIN_LOSS_FRACTION)));
    const w = db.prepare(`SELECT concordia_credits AS concord_coins FROM users WHERE id='u1'`).get();
    assert.equal(w.concord_coins, 2000 - r.coinsLost);
  });

  it("hard-caps loss at COIN_LOSS_MAX even with huge balance", () => {
    db.prepare(`UPDATE users SET concordia_credits = 1000000 WHERE id='u1'`).run();
    const r = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 },
    });
    assert.equal(r.coinsLost, COIN_LOSS_MAX);
  });

  it("re-dropping marks the prior corpse lost", () => {
    const r1 = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 },
    });
    assert.equal(r1.replacedLost, 0);
    const r2 = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 5, z: 5 },
    });
    assert.equal(r2.replacedLost, 1);
    // Verify the first row is now marked lost.
    const old = db.prepare(`SELECT lost_at FROM player_corpses WHERE id = ?`).get(r1.corpse.id);
    assert.ok(old.lost_at != null);
  });

  it("rejects bad input", () => {
    assert.equal(dropCorpseOnDeath(db, { userId: "u1" }).ok, false);
    assert.equal(dropCorpseOnDeath(db, { userId: "u1", worldId: "w1" }).ok, false);
    assert.equal(
      dropCorpseOnDeath(db, { userId: "u1", worldId: "w1", position: { x: "bad", z: 0 } }).ok,
      false,
    );
  });

  it("works with no wallet (zero loss)", () => {
    const db2 = setupDb(0); // no row inserted
    const r = dropCorpseOnDeath(db2, {
      userId: "alice", worldId: "w1", position: { x: 0, z: 0 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.coinsLost, 0);
  });
});

describe("activeCorpsesFor + recoverCorpse", () => {
  let db, calls;
  beforeEach(() => { db = setupDb(800); calls = installFakeRealtime(); });
  afterEach(() => clearRealtime());

  it("activeCorpsesFor returns only active rows", () => {
    const r1 = dropCorpseOnDeath(db, { userId: "u1", worldId: "w1", position: { x: 0, z: 0 } });
    const r2 = dropCorpseOnDeath(db, { userId: "u1", worldId: "w1", position: { x: 5, z: 5 } });
    // r1 is now lost (replaced by r2). active should only return r2.
    const list = activeCorpsesFor(db, { userId: "u1", worldId: "w1" });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, r2.corpse.id);
    void r1;
  });

  it("recoverCorpse credits coins + marks recovered", () => {
    const r = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 10, z: 10 },
    });
    const lostCoins = r.coinsLost;
    const before = db.prepare(`SELECT concordia_credits AS concord_coins FROM users WHERE id='u1'`).get();
    const rec = recoverCorpse(db, {
      userId: "u1", corpseId: r.corpse.id, position: { x: 10, z: 10 },
    });
    assert.equal(rec.ok, true);
    assert.equal(rec.coinsReturned, lostCoins);
    const after = db.prepare(`SELECT concordia_credits AS concord_coins FROM users WHERE id='u1'`).get();
    assert.equal(after.concord_coins, before.concord_coins + lostCoins);
  });

  it("recoverCorpse rejects out-of-range", () => {
    const r = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 },
    });
    const rec = recoverCorpse(db, {
      userId: "u1", corpseId: r.corpse.id, position: { x: 50, z: 50 },
    });
    assert.equal(rec.ok, false);
    assert.equal(rec.reason, "out_of_range");
    assert.ok(rec.distance > RECOVER_RADIUS_M);
  });

  it("recoverCorpse rejects not-yours", () => {
    const r = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 },
    });
    const rec = recoverCorpse(db, {
      userId: "u2", corpseId: r.corpse.id, position: { x: 0, z: 0 },
    });
    assert.equal(rec.ok, false);
    assert.equal(rec.reason, "not_yours");
  });

  it("recoverCorpse rejects already-recovered + lost", () => {
    const r = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 },
    });
    recoverCorpse(db, { userId: "u1", corpseId: r.corpse.id, position: { x: 0, z: 0 } });
    const second = recoverCorpse(db, {
      userId: "u1", corpseId: r.corpse.id, position: { x: 0, z: 0 },
    });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_recovered");

    // Drop fresh, mark lost manually, attempt recover.
    const r3 = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 1, z: 1 },
    });
    db.prepare(`UPDATE player_corpses SET lost_at = unixepoch() WHERE id = ?`).run(r3.corpse.id);
    const rec = recoverCorpse(db, {
      userId: "u1", corpseId: r3.corpse.id, position: { x: 1, z: 1 },
    });
    assert.equal(rec.ok, false);
    assert.equal(rec.reason, "lost");
  });
});

describe("sweepStaleCorpses", () => {
  it("marks past-TTL active corpses as lost", () => {
    const db = setupDb(500);
    // Insert one fresh corpse + one ancient
    const fresh = dropCorpseOnDeath(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 },
    });
    db.prepare(`
      INSERT INTO player_corpses (id, world_id, user_id, x, y, z, coins_held, cause, created_at)
      VALUES ('c_old', 'w1', 'u_other', 0, 0, 0, 100, 'fall', ?)
    `).run(Math.floor(Date.now() / 1000) - 8 * 86400);

    const swept = sweepStaleCorpses(db);
    assert.ok(swept >= 1);
    const old = db.prepare(`SELECT lost_at FROM player_corpses WHERE id = 'c_old'`).get();
    assert.ok(old.lost_at != null);
    const fr = db.prepare(`SELECT lost_at FROM player_corpses WHERE id = ?`).get(fresh.corpse.id);
    assert.equal(fr.lost_at, null);
  });
});
