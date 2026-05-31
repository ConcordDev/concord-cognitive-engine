// Wave 0 — the civic_bonds macro surface (the lens's /api/lens/run path).
// Pins kill-switch gating (off → disabled), auth gating, and a full create→
// vote→pledge→fund→complete flow through the macros.
//
// Run: node --test tests/civic-bonds-macros.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { creditSparks } from "../lib/sparks-service.js";
import registerCivicBondsMacros from "../domains/civic-bonds.js";

// Collect the registered macros into a Map<`${domain}.${name}`, fn>.
function buildMacros() {
  const m = new Map();
  registerCivicBondsMacros((domain, name, fn) => m.set(`${domain}.${name}`, fn));
  return m;
}
const ctxFor = (db, userId) => ({ db, actor: userId ? { userId } : undefined });

function mkUser(db, id, sparks = 0) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
    .run(id, id, `${id}@t.local`, new Date().toISOString());
  if (sparks) creditSparks(db, { holderKind: "player", holderId: id, amount: sparks, reason: "seed" });
}

describe("civic_bonds macros", () => {
  let db, M;
  beforeEach(async () => {
    db = new Database(":memory:"); await runMigrations(db); M = buildMacros();
    process.env.CONCORD_CIVIC_BONDS = "1";
  });
  afterEach(() => { delete process.env.CONCORD_CIVIC_BONDS; try { db.close(); } catch { /* noop */ } });

  it("gates on the kill-switch (off → disabled)", async () => {
    process.env.CONCORD_CIVIC_BONDS = "0";
    const r = await M.get("civic_bonds.list")(ctxFor(db, "u1"), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
  });

  it("write macros require auth", async () => {
    const r = await M.get("civic_bonds.create")(ctxFor(db, null), { worldId: "w1", title: "X", targetAmount: 10000 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("runs create→open→vote→pledge→fund→complete through the macros", async () => {
    mkUser(db, "ruler");
    const create = await M.get("civic_bonds.create")(ctxFor(db, "ruler"),
      { worldId: "w1", realmId: "r1", title: "Ember Bridge", targetAmount: 10000, denomination: 100, quorum: 2 });
    assert.equal(create.ok, true);
    const bondId = create.bondId;

    assert.equal((await M.get("civic_bonds.open")(ctxFor(db, "ruler"), { bondId })).ok, true);
    await M.get("civic_bonds.vote")(ctxFor(db, "v1"), { bondId, vote: "for" });
    await M.get("civic_bonds.vote")(ctxFor(db, "v2"), { bondId, vote: "for" });

    for (let i = 0; i < 22; i++) {
      mkUser(db, `p${i}`, 1000);
      const pl = await M.get("civic_bonds.pledge")(ctxFor(db, `p${i}`), { bondId, amount: 500 });
      assert.equal(pl.ok, true);
    }
    const fund = await M.get("civic_bonds.fund")(ctxFor(db, "ruler"), { bondId });
    assert.equal(fund.ok, true);
    const done = await M.get("civic_bonds.complete")(ctxFor(db, "ruler"), { bondId });
    assert.equal(done.ok, true);

    const get = await M.get("civic_bonds.get")(ctxFor(db, "ruler"), { bondId });
    assert.equal(get.bond.status, "completed");
    // public ledger surfaces the pledges
    const ledger = await M.get("civic_bonds.ledger")(ctxFor(db, "anon"), { bondId });
    assert.equal(ledger.pledges.length, 22);
  });
});
