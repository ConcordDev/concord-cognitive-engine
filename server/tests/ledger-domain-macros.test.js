// Lightweight hermetic behavioral tests for server/domains/ledger.js — the
// Ledger lens's read-only economy surface (the flows the Curtain hides).
//
// NO full-server boot: an in-memory better-sqlite3 DB with ONLY the migrations
// the macros touch (002 economy_ledger, 158 realms, 321 faction_funding, 322
// extraction_loans). The macros are driven the way runMacro would — a
// (ctx, input) call — and every test asserts ACTUAL values, not shapes:
//   - anomalies() flags a real managed-parity outlier + a real extraction lien
//   - flow_summary() rolls the ledger up by type
//   - faction_economy() reports treasury + funders + liens
//   - the fail-CLOSED numeric guard rejects a poisoned limit
//   - the CREDIT_ROW_PREDICATE money-math is NOT double-credited (the two-row
//     TRANSFER pattern credits the recipient exactly once)

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerLedgerMacros from "../domains/ledger.js";
import { up as upEconomy } from "../migrations/002_economy_tables.js";
import { up as upKingdoms } from "../migrations/158_kingdoms.js";
import { up as upFunding } from "../migrations/321_faction_funding.js";
import { up as upLoans } from "../migrations/322_extraction_loans.js";
import { getBalance, CREDIT_ROW_PREDICATE } from "../economy/balances.js";

// ── Build the macro table the way the server's register() would ──────────────
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "ledger", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
before(() => { registerLedgerMacros(register); });

function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`ledger.${name} not registered`);
  return fn(ctx, input);
}

// ── Hermetic in-memory DB: only the four tables the lens reads ───────────────
function bootDb() {
  const db = new Database(":memory:");
  upEconomy(db);
  upKingdoms(db);
  upFunding(db);
  upLoans(db);
  return db;
}

function seedWorld(db) {
  // A realm with a treasury (faction_economy reads realms.treasury).
  db.prepare(
    `INSERT INTO realms (id, name, world_id, faction_id, treasury) VALUES (?,?,?,?,?)`,
  ).run("realm_pell", "Pell's Hold", "sere", "house_pell", 4200);

  // Managed parity: the Tessera funds BOTH belligerents → the war never ends.
  db.prepare(
    `INSERT INTO faction_funding (id, world_id, funder_id, war_faction_a, war_faction_b, active)
     VALUES (?,?,?,?,?,1)`,
  ).run("ff1", "sere", "the_tessera", "house_pell", "house_varn");

  // An inactive funding row that must NOT surface.
  db.prepare(
    `INSERT INTO faction_funding (id, world_id, funder_id, war_faction_a, war_faction_b, active)
     VALUES (?,?,?,?,?,0)`,
  ).run("ff2", "sere", "old_bank", "house_a", "house_b");

  // Extraction lien: the Mercy Fund holds a building as collateral over Pell.
  db.prepare(
    `INSERT INTO extraction_loans
       (id, world_id, debtor_kind, debtor_id, creditor_id, amount, collateral_kind, collateral_id, status, due_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run("el1", "sere", "realm", "house_pell", "the_mercy_fund", 9000, "building", "tea_house", "active", 9999999999);

  // A repaid (resolved) lien that must NOT surface.
  db.prepare(
    `INSERT INTO extraction_loans
       (id, world_id, debtor_kind, debtor_id, creditor_id, amount, collateral_kind, collateral_id, status, due_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run("el2", "sere", "npc", "some_npc", "the_mercy_fund", 100, "none", null, "repaid", 1);
}

const ctx = (db) => ({ db, actor: { userId: "auditor_1" } });

describe("ledger — registration", () => {
  it("registers every macro the lens manifest points at", () => {
    for (const m of ["anomalies", "faction_economy", "flow_summary"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing ledger.${m}`);
    }
  });
});

describe("ledger.anomalies — surfaces the real outliers (and only the active ones)", () => {
  it("flags the managed-parity funder + the active extraction lien with real values", () => {
    const db = bootDb();
    seedWorld(db);

    const out = call("anomalies", ctx(db), { worldId: "sere" });
    assert.equal(out.ok, true);
    assert.equal(out.worldId, "sere");

    // Exactly ONE active managed-parity row (the inactive ff2 is excluded).
    assert.equal(out.managedParity.length, 1);
    const p = out.managedParity[0];
    assert.equal(p.funder, "the_tessera");
    assert.deepEqual(p.fundsBothSidesOf, ["house_pell", "house_varn"]);

    // Exactly ONE active lien (the repaid el2 is excluded).
    assert.equal(out.extractionLiens.length, 1);
    const l = out.extractionLiens[0];
    assert.equal(l.creditor, "the_mercy_fund");
    assert.equal(l.debtor.id, "house_pell");
    assert.equal(l.amount, 9000);
    assert.deepEqual(l.collateral, { kind: "building", id: "tea_house" });

    assert.equal(out.total, 2);
  });

  it("returns a clean (empty) record for a world with no anomalous flows — ok:true, not no_db", () => {
    const db = bootDb();
    seedWorld(db);
    const out = call("anomalies", ctx(db), { worldId: "concordia-hub" });
    assert.equal(out.ok, true);
    assert.equal(out.managedParity.length, 0);
    assert.equal(out.extractionLiens.length, 0);
    assert.equal(out.total, 0);
  });

  it("an empty input {} defaults to 'sere' and reads ok:true against a live DB (NEVER no_db)", () => {
    const db = bootDb();
    seedWorld(db);
    const out = call("anomalies", ctx(db), {});
    assert.equal(out.ok, true);
    assert.equal(out.worldId, "sere");
    assert.equal(out.total, 2);
  });

  it("returns no_db ONLY when there is genuinely no DB handle", () => {
    const out = call("anomalies", { actor: { userId: "x" } }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_db");
  });
});

describe("ledger.faction_economy — treasury + funders + liens for one realm", () => {
  it("reports the realm treasury, who funds it, and the liens against it", () => {
    const db = bootDb();
    seedWorld(db);
    const out = call("faction_economy", ctx(db), { worldId: "sere", factionId: "house_pell" });
    assert.equal(out.ok, true);
    assert.equal(out.treasury, 4200);
    assert.deepEqual(out.fundedBy, ["the_tessera"]);
    assert.equal(out.liensAgainst.length, 1);
    assert.equal(out.liensAgainst[0].creditor_id, "the_mercy_fund");
    assert.equal(out.liensAgainst[0].amount, 9000);
  });

  it("rejects a missing factionId with missing_inputs (not no_db)", () => {
    const db = bootDb();
    const out = call("faction_economy", ctx(db), { worldId: "sere" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missing_inputs");
  });
});

describe("ledger.flow_summary — by-type rollup of the economy ledger", () => {
  function seedLedger(db) {
    const ins = db.prepare(
      `INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status)
       VALUES (?,?,?,?,?,?,?, 'complete')`,
    );
    // A real transfer is written as TWO rows: a debit row (both sides set) +
    // a credit row (from NULL → recipient). This is the pattern the
    // CREDIT_ROW_PREDICATE exists to de-duplicate.
    ins.run("t_debit", "TRANSFER", "alice", "bob", 100, 0, 100); // debit-half
    ins.run("t_credit", "TRANSFER", null, "bob", 100, 0, 100);   // real credit
    // A royalty payout — a genuine both-sided single row (still counted).
    ins.run("r1", "ROYALTY_PAYOUT", "treasury", "carol", 25, 0, 25);
    // A token purchase (closed-loop credit).
    ins.run("tp1", "TOKEN_PURCHASE", null, "bob", 500, 7, 493);
  }

  it("rolls flows up by type with real summed totals", () => {
    const db = bootDb();
    seedLedger(db);
    const out = call("flow_summary", ctx(db), {});
    assert.equal(out.ok, true);
    const byType = Object.fromEntries(out.byType.map((r) => [r.type, r]));
    assert.equal(byType.TRANSFER.n, 2);        // both rows counted as VOLUME
    assert.equal(byType.TRANSFER.total, 200);  // by-type volume, not a balance
    assert.equal(byType.ROYALTY_PAYOUT.total, 25);
    assert.equal(byType.TOKEN_PURCHASE.total, 493);
  });

  it("fails CLOSED on a poisoned numeric limit (NaN / Infinity / negative / huge)", () => {
    const db = bootDb();
    seedLedger(db);
    for (const bad of ["not-a-number", Infinity, -1, 1e9]) {
      const out = call("flow_summary", ctx(db), { limit: bad });
      assert.equal(out.ok, false, `limit=${bad} should be rejected`);
      assert.equal(out.reason, "bad_numeric_field");
      assert.equal(out.field, "limit");
    }
    // A sane explicit limit is honored.
    const okOut = call("flow_summary", ctx(db), { limit: 2 });
    assert.equal(okOut.ok, true);
    assert.ok(okOut.byType.length <= 2);
  });
});

// ── The money-math invariant the lens sits on top of ─────────────────────────
// flow_summary is a VOLUME rollup (correct to count both transfer rows). A
// per-USER balance, by contrast, MUST NOT double-credit the recipient of the
// two-row pattern — that is what CREDIT_ROW_PREDICATE guards. Pin it here so the
// ledger surface can never be wired to a double-crediting balance read.
describe("ledger money-math — CREDIT_ROW_PREDICATE is NOT double-credited", () => {
  it("credits the recipient of a two-row TRANSFER exactly once", () => {
    const db = bootDb();
    const ins = db.prepare(
      `INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status)
       VALUES (?,?,?,?,?,?,?, 'complete')`,
    );
    // Bob receives a single 100-CC transfer, written as the canonical two rows.
    ins.run("d", "TRANSFER", "alice", "bob", 100, 0, 100); // debit-half (to_user_id=bob is linkage only)
    ins.run("c", "TRANSFER", null, "bob", 100, 0, 100);    // real credit row

    const bal = getBalance(db, "bob");
    // Naively summing every to_user_id=bob row would credit 200 (minting CC).
    // The predicate excludes the debit-half → bob is credited exactly 100.
    assert.equal(bal.totalCredits, 100, "double-credit detected — this is a money bug");
    assert.equal(bal.balance, 100);

    // Sanity: the predicate is the one balances.js exports, and the raw
    // two-row sum really would be 200 without it.
    const raw = db.prepare(
      `SELECT COALESCE(SUM(net),0) AS s FROM economy_ledger WHERE to_user_id='bob' AND status='complete'`,
    ).get().s;
    assert.equal(raw, 200, "the raw (unguarded) sum must double-count, proving the guard matters");
    const guarded = db.prepare(
      `SELECT COALESCE(SUM(net),0) AS s FROM economy_ledger WHERE to_user_id='bob' AND status='complete' AND ${CREDIT_ROW_PREDICATE}`,
    ).get().s;
    assert.equal(guarded, 100);
  });
});
