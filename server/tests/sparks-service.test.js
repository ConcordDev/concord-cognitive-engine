// Wave 0 — the unified sparks mover. Pins credit/debit/transfer over both
// holder kinds (player users.sparks + npc world_npcs.wealth_sparks), the
// overdraw rejection, and idempotency on refId (the property Civic Bonds'
// pledge/payout retries depend on). Players are canonical `users.sparks`.
//
// Run: node --test tests/sparks-service.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { getSparks, creditSparks, debitSparks, transferSparks } from "../lib/sparks-service.js";

function mkUser(db, id) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)`)
    .run(id, id, `${id}@test.local`, new Date().toISOString());
}

describe("sparks-service", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("credits + reads a player balance (canonical users.sparks)", () => {
    mkUser(db, "u1");
    assert.equal(getSparks(db, "player", "u1"), 0);
    const r = creditSparks(db, { holderKind: "player", holderId: "u1", amount: 500, reason: "seed" });
    assert.equal(r.ok, true);
    assert.equal(getSparks(db, "player", "u1"), 500);
    // canonical store actually moved
    assert.equal(db.prepare(`SELECT sparks FROM users WHERE id='u1'`).get().sparks, 500);
  });

  it("debits and rejects an overdraw without mutating", () => {
    mkUser(db, "u1");
    creditSparks(db, { holderKind: "player", holderId: "u1", amount: 100 });
    const ok = debitSparks(db, { holderKind: "player", holderId: "u1", amount: 60 });
    assert.equal(ok.ok, true);
    assert.equal(getSparks(db, "player", "u1"), 40);
    const bad = debitSparks(db, { holderKind: "player", holderId: "u1", amount: 999 });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "insufficient_sparks");
    assert.equal(getSparks(db, "player", "u1"), 40); // unchanged
  });

  it("is idempotent on refId — a retried credit moves money once", () => {
    mkUser(db, "u1");
    const a = creditSparks(db, { holderKind: "player", holderId: "u1", amount: 250, refId: "pledge:bond1:u1" });
    assert.equal(a.idempotent, false);
    const b = creditSparks(db, { holderKind: "player", holderId: "u1", amount: 250, refId: "pledge:bond1:u1" });
    assert.equal(b.idempotent, true);
    assert.equal(getSparks(db, "player", "u1"), 250); // not 500
  });

  it("moves sparks to/from an NPC (wealth_sparks)", () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, is_dead) VALUES ('npc1','concordia-hub','trader',0)`).run();
    creditSparks(db, { holderKind: "npc", holderId: "npc1", amount: 300 });
    assert.equal(getSparks(db, "npc", "npc1"), 300);
    debitSparks(db, { holderKind: "npc", holderId: "npc1", amount: 100 });
    assert.equal(getSparks(db, "npc", "npc1"), 200);
    const bad = debitSparks(db, { holderKind: "npc", holderId: "npc1", amount: 9999 });
    assert.equal(bad.ok, false);
    assert.equal(getSparks(db, "npc", "npc1"), 200);
  });

  it("transfers player→player in one transaction; insufficient source moves nothing", () => {
    mkUser(db, "rich"); mkUser(db, "poor");
    creditSparks(db, { holderKind: "player", holderId: "rich", amount: 1000 });
    const t = transferSparks(db, { fromId: "rich", toId: "poor", amount: 400, refId: "x1" });
    assert.equal(t.ok, true);
    assert.equal(getSparks(db, "player", "rich"), 600);
    assert.equal(getSparks(db, "player", "poor"), 400);

    const fail = transferSparks(db, { fromId: "poor", toId: "rich", amount: 99999, refId: "x2" });
    assert.equal(fail.ok, false);
    assert.equal(getSparks(db, "player", "poor"), 400); // unchanged — rolled back
    assert.equal(getSparks(db, "player", "rich"), 600);
  });

  it("transfer is idempotent on refId across both legs", () => {
    mkUser(db, "a"); mkUser(db, "b");
    creditSparks(db, { holderKind: "player", holderId: "a", amount: 500 });
    transferSparks(db, { fromId: "a", toId: "b", amount: 200, refId: "settle:1" });
    transferSparks(db, { fromId: "a", toId: "b", amount: 200, refId: "settle:1" }); // retry
    assert.equal(getSparks(db, "player", "a"), 300);
    assert.equal(getSparks(db, "player", "b"), 200); // moved once, not twice
  });
});
