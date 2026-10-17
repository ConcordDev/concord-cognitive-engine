// INC-117 regression — civic_bonds lifecycle verbs enforce authorization.
//
// Pins: an outsider (not the proposer, not the realm ruler, not an admin) cannot
// open, fund, complete_milestone, complete, fail, or raid another user's bond.
// Refusals are honest ({ ok:false, reason:"forbidden" } or "auth_required"),
// leave the bond row unchanged, and never move sparks. The proposer's lifecycle
// still works, and the realm ruler can still raid (the designed corruption hook).
//
// Run: cd server && NODE_ENV=test nice node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/117-authz.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { creditSparks, getSparks } from "../lib/sparks-service.js";
import registerCivicBondsMacros from "../domains/civic-bonds.js";

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

function ctxFor(db, userId) {
  return { db, actor: userId ? { userId } : undefined };
}

function mkUser(db, id, sparks = 0) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`,
  ).run(id, id, `${id}@t.local`, new Date().toISOString());
  if (sparks) {
    creditSparks(db, { holderKind: "player", holderId: id, amount: sparks, reason: "seed" });
  }
}

function mkRealm(db, id, rulerId) {
  db.prepare(
    `INSERT INTO realms (id, name, world_id, treasury, legitimacy, ruler_kind, ruler_id)
     VALUES (?,?,?,1000,60,'player',?)`,
  ).run(id, id, "w117", rulerId);
}

async function createProposedBond(db, proposerId, title = "Test Bond") {
  const r = await call(
    "create",
    ctxFor(db, proposerId),
    {
      worldId: "w117",
      realmId: "r117",
      title,
      targetAmount: 10000,
      denomination: 100,
      quorum: 2,
      milestones: [{ description: "M1", releasePct: 0.5 }],
    },
  );
  assert.equal(r.ok, true, `create failed: ${r.reason}`);
  return r.bondId;
}

async function openAndVote(db, bondId, proposerId) {
  assert.equal((await call("open", ctxFor(db, proposerId), { bondId })).ok, true);
  assert.equal((await call("vote", ctxFor(db, "v1"), { bondId, vote: "for" })).ok, true);
  assert.equal((await call("vote", ctxFor(db, "v2"), { bondId, vote: "for" })).ok, true);
}

async function pledgeToGate(db, bondId, count = 22, amount = 500) {
  for (let i = 0; i < count; i++) {
    const uid = `${bondId}_p${i}`;
    mkUser(db, uid, 1000);
    const r = await call("pledge", ctxFor(db, uid), { bondId, amount });
    assert.equal(r.ok, true, `pledge ${i}: ${r.reason}`);
  }
}

async function runToFunded(db, bondId, proposerId) {
  await openAndVote(db, bondId, proposerId);
  await pledgeToGate(db, bondId, 22, 500); // 22 × 500 = 11000 ≥ 110% of 10000
  const f = await call("fund", ctxFor(db, proposerId), { bondId });
  assert.equal(f.ok, true, `fund: ${f.reason}`);
  assert.equal(f.status, "active");
}

describe("INC-117 civic_bonds lifecycle authorization", () => {
  let db;

  beforeEach(async () => {
    process.env.CONCORD_CIVIC_BONDS = "1";
    db = new Database(":memory:");
    await runMigrations(db);
    mkRealm(db, "r117", "king");
    mkUser(db, "king");
    mkUser(db, "proposer");
    mkUser(db, "outsider", 1000);
    mkUser(db, "v1");
    mkUser(db, "v2");
    db.prepare(
      `INSERT INTO player_world_metrics (user_id, world_id, refusal_debt) VALUES ('king','w117',0.2)`,
    ).run();
  });

  afterEach(() => {
    delete process.env.CONCORD_CIVIC_BONDS;
    try { db.close(); } catch { /* noop */ }
  });

  it("outsider cannot open the proposer's bond", async () => {
    const bondId = await createProposedBond(db, "proposer");
    const before = (await call("get", ctxFor(db, "proposer"), { bondId })).bond.status;

    const r = await call("open", ctxFor(db, "outsider"), { bondId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");

    const after = (await call("get", ctxFor(db, "proposer"), { bondId })).bond.status;
    assert.equal(after, before);
    assert.equal(after, "proposed");
  });

  it("outsider cannot fail the proposer's bond (no refund, escrow untouched)", async () => {
    const bondId = await createProposedBond(db, "proposer");
    await openAndVote(db, bondId, "proposer");
    mkUser(db, "pledger", 1000);
    await call("pledge", ctxFor(db, "pledger"), { bondId, amount: 500 });
    const sparksBefore = getSparks(db, "player", "pledger");
    const statusBefore = (await call("get", ctxFor(db, "proposer"), { bondId })).bond.status;

    const r = await call("fail", ctxFor(db, "outsider"), { bondId, reason: "outside attack" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");

    const statusAfter = (await call("get", ctxFor(db, "proposer"), { bondId })).bond.status;
    assert.equal(statusAfter, statusBefore);
    assert.equal(getSparks(db, "player", "pledger"), sparksBefore);
    // The proposer can still fail it afterward.
    const ok = await call("fail", ctxFor(db, "proposer"), { bondId, reason: "legit" });
    assert.equal(ok.ok, true);
    assert.equal(getSparks(db, "player", "pledger"), 1000);
  });

  it("outsider cannot raid the proposer's funded bond (treasury + bond untouched)", async () => {
    const bondId = await createProposedBond(db, "proposer");
    await runToFunded(db, bondId, "proposer");
    const treasuryBefore = db.prepare(`SELECT treasury FROM realms WHERE id='r117'`).get().treasury;
    const statusBefore = (await call("get", ctxFor(db, "proposer"), { bondId })).bond.status;
    const pledgerSparksBefore = getSparks(db, "player", `${bondId}_p0`);

    const r = await call("raid", ctxFor(db, "outsider"), { bondId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");

    assert.equal((await call("get", ctxFor(db, "proposer"), { bondId })).bond.status, statusBefore);
    assert.equal(db.prepare(`SELECT treasury FROM realms WHERE id='r117'`).get().treasury, treasuryBefore);
    assert.equal(getSparks(db, "player", `${bondId}_p0`), pledgerSparksBefore);
  });

  it("outsider cannot fund, complete, or complete_milestone the proposer's bond", async () => {
    const bondId = await createProposedBond(db, "proposer");
    await runToFunded(db, bondId, "proposer");
    const statusBefore = (await call("get", ctxFor(db, "proposer"), { bondId })).bond.status;
    const milestoneBefore = db.prepare(
      `SELECT status FROM civic_bond_milestones WHERE bond_id=? AND idx=0`,
    ).get(bondId).status;

    const fund = await call("fund", ctxFor(db, "outsider"), { bondId });
    assert.equal(fund.ok, false);
    assert.equal(fund.reason, "forbidden");

    const complete = await call("complete", ctxFor(db, "outsider"), { bondId });
    assert.equal(complete.ok, false);
    assert.equal(complete.reason, "forbidden");

    const milestone = await call("complete_milestone", ctxFor(db, "outsider"), { bondId, idx: 0 });
    assert.equal(milestone.ok, false);
    assert.equal(milestone.reason, "forbidden");

    const after = await call("get", ctxFor(db, "proposer"), { bondId });
    assert.equal(after.bond.status, statusBefore); // still active
    assert.equal(
      db.prepare(`SELECT status FROM civic_bond_milestones WHERE bond_id=? AND idx=0`).get(bondId).status,
      milestoneBefore,
    );
  });

  it("anonymous caller is refused on all lifecycle verbs", async () => {
    const bondId = await createProposedBond(db, "proposer");
    for (const verb of ["open", "fund", "complete", "complete_milestone", "fail", "raid"]) {
      const input = verb === "complete_milestone" ? { bondId, idx: 0 } : { bondId };
      const r = await call(verb, ctxFor(db, null), input);
      assert.equal(r.ok, false, `${verb} should refuse anon`);
      assert.equal(r.reason, "auth_required", `${verb} refusal reason`);
    }
  });

  it("proposer lifecycle still works end-to-end", async () => {
    const bondId = await createProposedBond(db, "proposer");
    await openAndVote(db, bondId, "proposer");
    await pledgeToGate(db, bondId);

    const funded = await call("fund", ctxFor(db, "proposer"), { bondId });
    assert.equal(funded.ok, true);

    const milestone = await call("complete_milestone", ctxFor(db, "proposer"), { bondId, idx: 0 });
    assert.equal(milestone.ok, true);

    const completed = await call("complete", ctxFor(db, "proposer"), { bondId });
    assert.equal(completed.ok, true);
    assert.equal(completed.returnsPaid > 0, true);
    assert.equal((await call("get", ctxFor(db, "proposer"), { bondId })).bond.status, "completed");
  });

  it("realm ruler may raid (the designed corruption mechanic) even if not the proposer", async () => {
    const bondId = await createProposedBond(db, "proposer");
    await runToFunded(db, bondId, "proposer");
    const treasuryBefore = db.prepare(`SELECT treasury FROM realms WHERE id='r117'`).get().treasury;

    const r = await call("raid", ctxFor(db, "king"), { bondId });
    assert.equal(r.ok, true);
    assert.equal(r.corrupt, true);

    const treasuryAfter = db.prepare(`SELECT treasury FROM realms WHERE id='r117'`).get().treasury;
    assert.equal(treasuryAfter, treasuryBefore + r.looted);
    assert.equal((await call("get", ctxFor(db, "proposer"), { bondId })).bond.status, "cancelled");
    const debt = db.prepare(`SELECT refusal_debt FROM player_world_metrics WHERE user_id='king' AND world_id='w117'`).get().refusal_debt;
    assert.ok(debt > 0.2);
  });
});
