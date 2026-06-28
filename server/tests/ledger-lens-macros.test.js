// server/tests/ledger-lens-macros.test.js
//
// PHASE-2 behavioral gate for the Ledger lens (the Sere managed-parity /
// extraction-lien / mercy-fund satire surface). This file is the LENS-DRIVEN
// companion to the existing ledger-domain-macros.test.js — it does NOT
// re-assert what that file already pins (the basic anomalies/flow_summary/
// faction_economy happy paths + the CREDIT_ROW_PREDICATE conservation pin).
// It adds the gaps the lens itself depends on:
//
//   1. The exact `anomalies` shapes the PAGE consumes for its four UX states
//      (populated → managedParity/extractionLiens arrays; empty → total 0;
//      error → ok:false; and the null-collateral / no-collateral edge so the
//      populated render never crashes on a missing `.id`).
//   2. PER-USER / PER-WORLD ISOLATION — a row in world A must never leak into a
//      world-B audit, and an inactive/repaid row must never surface anywhere.
//   3. ANOMALY MATH round-trips — collateral_kind='none' → collateral:null;
//      dueAt/amount pass through verbatim; total === parity+lien count.
//   4. FAIL-CLOSED money-numeric — every poisoned `limit` (NaN/Infinity/-1/huge)
//      is rejected fail-CLOSED BEFORE it can reach the SQL LIMIT, and a sane
//      explicit limit is honoured. (The lens is read-only — there is no wallet
//      write to guard — so the numeric scrutiny lands on the only attacker-
//      controlled numeric the macros take: the rollup limit.)
//
// Hermetic: an in-memory better-sqlite3 with only the four tables the macros
// touch. The macros are driven exactly the way runMacro does it — `fn(ctx,
// input)` (2-arg; ledger registers via server.js register(), MACROS map, NOT
// registerLensAction). NO boot, NO network, NO LLM.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerLedgerMacros from "../domains/ledger.js";
import { up as upEconomy } from "../migrations/002_economy_tables.js";
import { up as upKingdoms } from "../migrations/158_kingdoms.js";
import { up as upFunding } from "../migrations/321_faction_funding.js";
import { up as upLoans } from "../migrations/322_extraction_loans.js";

// ── Mirror the server's register() → MACROS dispatch (fn(ctx, input)) ────────
function buildActions() {
  const actions = new Map();
  registerLedgerMacros((domain, name, fn) => {
    assert.equal(domain, "ledger", `unexpected domain registered: ${domain}`);
    actions.set(name, fn);
  });
  return actions;
}
const ACTIONS = buildActions();

// runMacro does `await m.fn(ctx, input ?? {})`. Mirror that exactly.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`ledger.${name} not registered`);
  return fn(ctx, input ?? {});
}

function bootDb() {
  const db = new Database(":memory:");
  upEconomy(db);
  upKingdoms(db);
  upFunding(db);
  upLoans(db);
  return db;
}

const ctx = (db, userId = "auditor_1") => ({ db, actor: { userId } });

const insFunding = (db, row) =>
  db.prepare(
    `INSERT INTO faction_funding (id, world_id, funder_id, war_faction_a, war_faction_b, active)
     VALUES (@id,@world_id,@funder_id,@a,@b,@active)`,
  ).run(row);

const insLoan = (db, row) =>
  db.prepare(
    `INSERT INTO extraction_loans
       (id, world_id, debtor_kind, debtor_id, creditor_id, amount, collateral_kind, collateral_id, status, due_at)
     VALUES (@id,@world_id,@debtor_kind,@debtor_id,@creditor_id,@amount,@collateral_kind,@collateral_id,@status,@due_at)`,
  ).run(row);

// ── 1. Per-world isolation — the lens audits ONE world at a time ─────────────
describe("ledger.anomalies — per-world isolation (the auditor audits one world)", () => {
  it("a sere row never surfaces in a concordia-hub audit, and vice-versa", () => {
    const db = bootDb();
    insFunding(db, { id: "f_sere", world_id: "sere", funder_id: "the_tessera", a: "house_pell", b: "house_varn", active: 1 });
    insFunding(db, { id: "f_hub", world_id: "concordia-hub", funder_id: "hub_bank", a: "guild_a", b: "guild_b", active: 1 });
    insLoan(db, { id: "l_sere", world_id: "sere", debtor_kind: "realm", debtor_id: "house_pell", creditor_id: "the_mercy_fund", amount: 9000, collateral_kind: "building", collateral_id: "tea_house", status: "active", due_at: 9999999999 });

    const sere = call("anomalies", ctx(db), { worldId: "sere" });
    assert.equal(sere.managedParity.length, 1);
    assert.equal(sere.managedParity[0].funder, "the_tessera");
    assert.equal(sere.extractionLiens.length, 1);
    assert.equal(sere.total, 2);

    const hub = call("anomalies", ctx(db), { worldId: "concordia-hub" });
    assert.equal(hub.managedParity.length, 1);
    assert.equal(hub.managedParity[0].funder, "hub_bank");
    assert.equal(hub.extractionLiens.length, 0, "the sere lien must not leak into the hub audit");
    assert.equal(hub.total, 1);

    // A third world the auditor has not seeded reads genuinely clean.
    const clean = call("anomalies", ctx(db), { worldId: "tunya" });
    assert.equal(clean.ok, true);
    assert.equal(clean.total, 0);
  });

  it("inactive funding + repaid/defaulted liens never surface (only the live record)", () => {
    const db = bootDb();
    insFunding(db, { id: "f_active", world_id: "sere", funder_id: "the_tessera", a: "x", b: "y", active: 1 });
    insFunding(db, { id: "f_dead", world_id: "sere", funder_id: "old_bank", a: "x", b: "y", active: 0 });
    insLoan(db, { id: "l_active", world_id: "sere", debtor_kind: "realm", debtor_id: "house_pell", creditor_id: "the_mercy_fund", amount: 100, collateral_kind: "none", collateral_id: null, status: "active", due_at: 9999999999 });
    insLoan(db, { id: "l_repaid", world_id: "sere", debtor_kind: "npc", debtor_id: "n1", creditor_id: "the_mercy_fund", amount: 50, collateral_kind: "none", collateral_id: null, status: "repaid", due_at: 1 });
    insLoan(db, { id: "l_default", world_id: "sere", debtor_kind: "npc", debtor_id: "n2", creditor_id: "the_mercy_fund", amount: 50, collateral_kind: "none", collateral_id: null, status: "defaulted", due_at: 1 });

    const out = call("anomalies", ctx(db), { worldId: "sere" });
    assert.equal(out.managedParity.length, 1, "the inactive funder must be filtered");
    assert.equal(out.extractionLiens.length, 1, "only the ACTIVE lien surfaces");
    assert.equal(out.extractionLiens[0].debtor.id, "house_pell");
    assert.equal(out.total, 2);
  });
});

// ── 2. Anomaly-math round-trips the populated render depends on ──────────────
describe("ledger.anomalies — math/shape the populated render reads verbatim", () => {
  it("collateral_kind='none' collapses to collateral:null (the render guards on truthiness)", () => {
    const db = bootDb();
    insLoan(db, { id: "l1", world_id: "sere", debtor_kind: "npc", debtor_id: "weaver", creditor_id: "the_mercy_fund", amount: 1234, collateral_kind: "none", collateral_id: null, status: "active", due_at: 42 });
    const out = call("anomalies", ctx(db), { worldId: "sere" });
    const l = out.extractionLiens[0];
    assert.equal(l.collateral, null, "a non-building lien must render with no collateral chip");
    assert.equal(l.amount, 1234, "amount passes through verbatim for the '… for N' render");
    assert.equal(l.dueAt, 42);
    assert.equal(l.debtor.kind, "npc");
  });

  it("building collateral round-trips to { kind:'building', id } the chip reads", () => {
    const db = bootDb();
    insLoan(db, { id: "l1", world_id: "sere", debtor_kind: "realm", debtor_id: "house_pell", creditor_id: "the_mercy_fund", amount: 9000, collateral_kind: "building", collateral_id: "tea_house", status: "active", due_at: 7 });
    const out = call("anomalies", ctx(db), { worldId: "sere" });
    assert.deepEqual(out.extractionLiens[0].collateral, { kind: "building", id: "tea_house" });
  });

  it("total === managedParity.length + extractionLiens.length (the section counters)", () => {
    const db = bootDb();
    insFunding(db, { id: "f1", world_id: "sere", funder_id: "t", a: "x", b: "y", active: 1 });
    insFunding(db, { id: "f2", world_id: "sere", funder_id: "u", a: "p", b: "q", active: 1 });
    insLoan(db, { id: "l1", world_id: "sere", debtor_kind: "npc", debtor_id: "n", creditor_id: "c", amount: 1, collateral_kind: "none", collateral_id: null, status: "active", due_at: 1 });
    const out = call("anomalies", ctx(db), { worldId: "sere" });
    assert.equal(out.managedParity.length, 2);
    assert.equal(out.extractionLiens.length, 1);
    assert.equal(out.total, out.managedParity.length + out.extractionLiens.length);
    assert.equal(out.total, 3);
  });
});

// ── 3. The four UX-driving reads the page branches on ────────────────────────
describe("ledger.anomalies — drives the page's four UX states honestly", () => {
  it("POPULATED: a live world returns ok:true + non-empty arrays", () => {
    const db = bootDb();
    insFunding(db, { id: "f1", world_id: "sere", funder_id: "the_tessera", a: "house_pell", b: "house_varn", active: 1 });
    const out = call("anomalies", ctx(db), { worldId: "sere" });
    assert.equal(out.ok, true);
    assert.ok(out.managedParity.length + out.extractionLiens.length > 0);
  });

  it("EMPTY: a clean world returns ok:true with total 0 (NOT an error)", () => {
    const db = bootDb();
    const out = call("anomalies", ctx(db), { worldId: "concordia-hub" });
    assert.equal(out.ok, true);
    assert.equal(out.total, 0);
    assert.equal(out.managedParity.length + out.extractionLiens.length, 0);
  });

  it("ERROR: no DB handle returns ok:false/no_db — the page must NOT render this as empty", () => {
    // This is the contract the page fix relies on: a closed ledger is ok:false,
    // distinguishable from a clean (ok:true,total:0) record.
    const out = call("anomalies", { actor: { userId: "x" } }, { worldId: "sere" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_db");
    // Crucially: there is no `total` field on the error envelope, so a page that
    // reads `total` would see undefined — the page must branch on ok:false first.
    assert.equal(out.total, undefined);
  });

  it("DEFAULT WORLD: an empty input {} audits 'sere' (the page's initial worldId)", () => {
    const db = bootDb();
    insFunding(db, { id: "f1", world_id: "sere", funder_id: "t", a: "x", b: "y", active: 1 });
    const out = call("anomalies", ctx(db), {});
    assert.equal(out.ok, true);
    assert.equal(out.worldId, "sere");
    assert.equal(out.total, 1);
  });
});

// ── 4. Fail-CLOSED money-numeric on the only attacker-controlled numeric ─────
describe("ledger.flow_summary — fail-CLOSED on a poisoned limit (no Infinity/NaN reaches SQL)", () => {
  function seedLedger(db) {
    const ins = db.prepare(
      `INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status)
       VALUES (?,?,?,?,?,?,?, 'complete')`,
    );
    ins.run("a", "TRANSFER", "alice", "bob", 100, 0, 100);
    ins.run("b", "TRANSFER", null, "bob", 100, 0, 100);
    ins.run("c", "ROYALTY_PAYOUT", "treasury", "carol", 25, 0, 25);
  }

  it("rejects every poisoned limit fail-CLOSED (NaN / Infinity / -Infinity / negative / >1e6)", () => {
    const db = bootDb();
    seedLedger(db);
    for (const bad of [NaN, Infinity, -Infinity, -1, 1e6 + 1, "1e308", "Infinity", "not-a-number"]) {
      const out = call("flow_summary", ctx(db), { limit: bad });
      assert.equal(out.ok, false, `limit=${String(bad)} must be rejected (fail-open mints/loops)`);
      assert.equal(out.reason, "bad_numeric_field");
      assert.equal(out.field, "limit");
    }
  });

  it("honours the boundary 1e6 limit and a sane small limit", () => {
    const db = bootDb();
    seedLedger(db);
    const boundary = call("flow_summary", ctx(db), { limit: 1e6 });
    assert.equal(boundary.ok, true, "exactly 1e6 is within bound");
    const small = call("flow_summary", ctx(db), { limit: 1 });
    assert.equal(small.ok, true);
    assert.ok(small.byType.length <= 1);
    // 0 is a valid, non-negative limit (SQL LIMIT 0 → empty rollup, not an error).
    const zero = call("flow_summary", ctx(db), { limit: 0 });
    assert.equal(zero.ok, true);
    assert.equal(zero.byType.length, 0);
  });

  it("an absent limit uses the lib default (no guard rejection on undefined)", () => {
    const db = bootDb();
    seedLedger(db);
    const out = call("flow_summary", ctx(db), {});
    assert.equal(out.ok, true);
    assert.ok(Array.isArray(out.byType));
  });
});

// ── 5. faction_economy — per-faction isolation + missing-input guard ─────────
describe("ledger.faction_economy — isolates one realm, guards missing factionId", () => {
  it("reports treasury + funders + liens for the named faction only", () => {
    const db = bootDb();
    db.prepare(`INSERT INTO realms (id, name, world_id, faction_id, treasury) VALUES (?,?,?,?,?)`)
      .run("realm_pell", "Pell's Hold", "sere", "house_pell", 4200);
    insFunding(db, { id: "f1", world_id: "sere", funder_id: "the_tessera", a: "house_pell", b: "house_varn", active: 1 });
    insLoan(db, { id: "l1", world_id: "sere", debtor_kind: "realm", debtor_id: "house_pell", creditor_id: "the_mercy_fund", amount: 9000, collateral_kind: "building", collateral_id: "tea_house", status: "active", due_at: 9 });
    // A different faction's lien must NOT bleed in.
    insLoan(db, { id: "l2", world_id: "sere", debtor_kind: "realm", debtor_id: "house_varn", creditor_id: "the_mercy_fund", amount: 1, collateral_kind: "none", collateral_id: null, status: "active", due_at: 9 });

    const out = call("faction_economy", ctx(db), { worldId: "sere", factionId: "house_pell" });
    assert.equal(out.ok, true);
    assert.equal(out.treasury, 4200);
    assert.deepEqual(out.fundedBy, ["the_tessera"]);
    assert.equal(out.liensAgainst.length, 1, "only house_pell's lien");
    assert.equal(out.liensAgainst[0].amount, 9000);
  });

  it("rejects a missing factionId with missing_inputs (never no_db, never a crash)", () => {
    const db = bootDb();
    const out = call("faction_economy", ctx(db), { worldId: "sere" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missing_inputs");
  });
});
