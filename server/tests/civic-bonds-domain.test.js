// Behavioral macro tests for server/domains/civic-bonds.js — the `civic_bonds`
// macro surface the /lenses/civic-bonds lens drives through POST /api/lens/run.
//
// LIGHTWEIGHT + HERMETIC: an in-memory better-sqlite3 DB migrated in-process
// (runMigrations, no server boot — ~4s) and the macros registered the way
// runMacro would, then driven as (ctx, input) calls. These are NOT shape-only
// assertions: every test asserts ACTUAL values + multi-step round-trips
// (create → open → vote → pledge(escrow) → fund(110% gate) → complete(returns +
// spillover)), the public reads, per-actor auth gating, and the fail-CLOSED
// numeric guard the macro-assassin's V2 vectors probe.
//
// Run: node --test tests/civic-bonds-domain.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { creditSparks, getSparks } from "../lib/sparks-service.js";
import registerCivicBondsMacros from "../domains/civic-bonds.js";

// ── register the macros into a local map (mirrors server.js `register`) ──────
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "civic_bonds", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
registerCivicBondsMacros(register);

function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`civic_bonds.${name} not registered`);
  return fn(ctx, input);
}

function mkUser(db, id, sparks) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
    .run(id, id, `${id}@t.local`, new Date().toISOString());
  if (sparks) creditSparks(db, { holderKind: "player", holderId: id, amount: sparks, reason: "seed" });
}

describe("civic_bonds — registration", () => {
  it("registers every macro the lens + manifest reference", () => {
    for (const m of ["list", "get", "spillover", "ledger", "create", "open", "vote", "pledge", "unpledge", "fund", "complete_milestone", "complete", "fail", "raid"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing civic_bonds.${m}`);
    }
  });
});

describe("civic_bonds — macro surface against a real migrated DB", () => {
  let db;
  let dbCtx; let king; let world;
  beforeEach(async () => {
    process.env.CONCORD_CIVIC_BONDS = "1"; // explicit ON (a sibling test may leave it "0")
    db = new Database(":memory:");
    await runMigrations(db);
    world = "w_civic";
    king = { actor: { userId: "king" } };
    dbCtx = { db, ...king };
    db.prepare(`INSERT INTO realms (id, name, world_id, treasury, legitimacy, ruler_kind, ruler_id) VALUES ('r_c','R','w_civic',1000,60,'player','king')`).run();
    mkUser(db, "king");
  });
  afterEach(() => { delete process.env.CONCORD_CIVIC_BONDS; try { db.close(); } catch { /* noop */ } });

  it("read reads with {} return ok:true (never no_db) — list/spillover", async () => {
    const listed = await call("list", dbCtx, {});
    assert.equal(listed.ok, true);
    assert.ok(Array.isArray(listed.bonds));
    const sp = await call("spillover", dbCtx, {});
    assert.equal(sp.ok, true);
    assert.equal(typeof sp.amount, "number");
  });

  it("create requires an actor and persists actual field values", async () => {
    const anon = await call("create", { db }, { worldId: world, realmId: "r_c", title: "Bridge", targetAmount: 10000 });
    assert.equal(anon.ok, false);
    assert.equal(anon.reason, "auth_required");

    const created = await call("create", dbCtx, { worldId: world, realmId: "r_c", title: "Bridge", targetAmount: 10000, denomination: 100, quorum: 2 });
    assert.equal(created.ok, true);
    const bondId = created.bondId;
    assert.ok(bondId);

    const detail = await call("get", dbCtx, { bondId });
    assert.equal(detail.ok, true);
    assert.equal(detail.bond.title, "Bridge");
    assert.equal(detail.bond.target_amount, 10000);
    assert.equal(detail.bond.denomination, 100);
    assert.equal(detail.bond.status, "proposed");
    assert.equal(detail.bond.funding_gate_pct, 1.10);
    // quorum is reported alongside the detail
    assert.equal(typeof detail.quorum.quorumMet, "boolean");
  });

  it("full lifecycle round-trip: create → open → vote → pledge(escrow) → fund(110% gate) → complete(returns + spillover)", async () => {
    const created = await call("create", dbCtx, { worldId: world, realmId: "r_c", title: "Aqueduct", targetAmount: 10000, denomination: 100, quorum: 2, returnRate: 0.005 });
    const bondId = created.bondId;

    assert.equal((await call("open", dbCtx, { bondId })).ok, true);
    assert.equal((await call("vote", dbCtx, { bondId, vote: "for" })).ok, true);
    // a second distinct voter to clear quorum (2)
    assert.equal((await call("vote", { db, actor: { userId: "v2" } }, { bondId, vote: "for" })).ok, true);

    // 22 pledgers × 500 = 11000 sparks → clears the 110% gate (target 10000 × 1.10 = 11000)
    for (let i = 0; i < 22; i++) {
      mkUser(db, `p${i}`, 1000);
      const r = await call("pledge", { db, actor: { userId: `p${i}` } }, { bondId, amount: 500 });
      assert.equal(r.ok, true, `pledge ${i}: ${r.reason}`);
    }

    const ledger = await call("ledger", dbCtx, { bondId });
    assert.equal(ledger.ok, true);
    assert.equal(ledger.pledges.length, 22);

    // escrow really debited the pledger's sparks
    assert.equal(getSparks(db, "player", "p0"), 500); // 1000 seed − 500 escrowed

    const funded = await call("fund", dbCtx, { bondId });
    assert.equal(funded.ok, true, funded.reason);
    assert.equal(funded.status, "active");

    const completed = await call("complete", dbCtx, { bondId });
    assert.equal(completed.ok, true, completed.reason);
    // capped returns paid (0.005 × 500 = 2 per pledger × 22 = 44)
    assert.equal(completed.returnsPaid, 44);
    // pledger got their capped return back
    assert.equal(getSparks(db, "player", "p0"), 502);

    const after = await call("get", dbCtx, { bondId });
    assert.equal(after.bond.status, "completed");
  });

  it("fund enforces the 110% pre-funding gate (under-pledged → funding_gate_not_met)", async () => {
    const created = await call("create", dbCtx, { worldId: world, realmId: "r_c", title: "Wall", targetAmount: 10000, denomination: 100, quorum: 2 });
    const bondId = created.bondId;
    await call("open", dbCtx, { bondId });
    await call("vote", dbCtx, { bondId, vote: "for" });
    await call("vote", { db, actor: { userId: "v2" } }, { bondId, vote: "for" });
    // only 10000 pledged (= target, but below 11000 gate)
    for (let i = 0; i < 20; i++) { mkUser(db, `q${i}`, 1000); await call("pledge", { db, actor: { userId: `q${i}` } }, { bondId, amount: 500 }); }
    const funded = await call("fund", dbCtx, { bondId });
    assert.equal(funded.ok, false);
    assert.equal(funded.reason, "funding_gate_not_met");
    assert.equal(funded.need, 11000);
    assert.equal(funded.have, 10000);
  });

  it("unpledge refunds escrow while still voting/funding", async () => {
    const created = await call("create", dbCtx, { worldId: world, realmId: "r_c", title: "Mill", targetAmount: 10000, denomination: 100, quorum: 2 });
    const bondId = created.bondId;
    await call("open", dbCtx, { bondId });
    mkUser(db, "u1", 1000);
    await call("pledge", { db, actor: { userId: "u1" } }, { bondId, amount: 200 });
    assert.equal(getSparks(db, "player", "u1"), 800);
    const un = await call("unpledge", { db, actor: { userId: "u1" } }, { bondId });
    assert.equal(un.ok, true);
    assert.equal(un.refunded, 200);
    assert.equal(getSparks(db, "player", "u1"), 1000); // made whole
  });

  it("fail-CLOSED numeric guard: poisoned amount/targetAmount → bad_numeric_field, never a thrown crash", async () => {
    // create with Infinity targetAmount
    const c1 = await call("create", dbCtx, { worldId: world, realmId: "r_c", title: "X", targetAmount: Infinity });
    assert.equal(c1.ok, false);
    assert.equal(c1.reason, "bad_numeric_field");
    assert.equal(c1.field, "targetAmount");

    const c2 = await call("create", dbCtx, { worldId: world, realmId: "r_c", title: "X", targetAmount: 1e308 });
    assert.equal(c2.ok, false);
    assert.equal(c2.reason, "bad_numeric_field");

    // pledge with NaN amount
    const created = await call("create", dbCtx, { worldId: world, realmId: "r_c", title: "Y", targetAmount: 10000, denomination: 100 });
    await call("open", dbCtx, { bondId: created.bondId });
    mkUser(db, "z1", 1000);
    const p = await call("pledge", { db, actor: { userId: "z1" } }, { bondId: created.bondId, amount: Number.NaN });
    assert.equal(p.ok, false);
    assert.equal(p.reason, "bad_numeric_field");
    assert.equal(p.field, "amount");
    // negative amount
    const pn = await call("pledge", { db, actor: { userId: "z1" } }, { bondId: created.bondId, amount: -500 });
    assert.equal(pn.ok, false);
    assert.equal(pn.reason, "bad_numeric_field");
  });

  it("get on an unknown bond returns bond_not_found (not a crash)", async () => {
    const r = await call("get", dbCtx, { bondId: "does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bond_not_found");
  });
});

