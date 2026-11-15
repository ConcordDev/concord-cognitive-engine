// The Ledger lens data layer — the flows the Curtain hides. Pins that
// anomalousFlows surfaces the managed-parity funding + extraction liens, that
// factionEconomyState follows the money, and that the ledger macros register.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upFunding } from "../migrations/321_faction_funding.js";
import { up as upLoans } from "../migrations/322_extraction_loans.js";
import { anomalousFlows, factionEconomyState } from "../lib/economy-flows.js";
import registerLedgerMacros from "../domains/ledger.js";

function freshDb() {
  const db = new Database(":memory:");
  upFunding(db); upLoans(db);
  db.exec("CREATE TABLE realms (id TEXT PRIMARY KEY, world_id TEXT, faction_id TEXT, treasury INTEGER)");
  db.prepare("INSERT INTO faction_funding (id, world_id, funder_id, war_faction_a, war_faction_b, active) VALUES ('f1','sere','the_tessera','dovrane','keshar',1)").run();
  db.prepare("INSERT INTO extraction_loans (id, world_id, debtor_kind, debtor_id, creditor_id, amount, collateral_kind, collateral_id, status, due_at) VALUES ('l1','sere','npc','pell_of_keshar','the_mercy_fund',500,'building','teahouse_pell','active',9999999999)").run();
  db.prepare("INSERT INTO realms (id, world_id, faction_id, treasury) VALUES ('keshar_realm','sere','keshar',100)").run();
  return db;
}

describe("economy-flows (Ledger lens data)", () => {
  it("anomalousFlows surfaces the managed parity + the extraction lien", () => {
    const db = freshDb();
    const a = anomalousFlows(db, "sere");
    assert.equal(a.ok, true);
    assert.equal(a.managedParity.length, 1);
    assert.equal(a.managedParity[0].funder, "the_tessera");
    assert.deepEqual(a.managedParity[0].fundsBothSidesOf.sort(), ["dovrane", "keshar"]);
    assert.equal(a.extractionLiens.length, 1);
    assert.equal(a.extractionLiens[0].creditor, "the_mercy_fund");
    assert.equal(a.extractionLiens[0].collateral.id, "teahouse_pell");
    assert.equal(a.total, 2);
  });

  it("factionEconomyState follows the money for keshar", () => {
    const db = freshDb();
    const s = factionEconomyState(db, "sere", "keshar");
    assert.equal(s.treasury, 100);
    assert.deepEqual(s.fundedBy, ["the_tessera"]);
  });

  it("degrades to empty on a minimal build (no tables)", () => {
    const db = new Database(":memory:");
    const a = anomalousFlows(db, "sere");
    assert.equal(a.ok, true);
    assert.equal(a.total, 0);
  });

  it("registers the ledger macros", () => {
    const m = new Map();
    registerLedgerMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    assert.ok(m.has("ledger.anomalies"));
    assert.ok(m.has("ledger.faction_economy"));
    assert.ok(m.has("ledger.flow_summary"));
  });
});

// FIX-ledger-001: a dossier opened from the managed-parity row for the
// FUNDER (the_tessera) must show the factions it funds — the parity flow
// itself — not 'unknown / none on record' on every field.
describe("factionEconomyState — funder-side dossier (FIX-ledger-001)", () => {
  function seedFunderDb() {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE realms (id TEXT, world_id TEXT, faction_id TEXT, treasury REAL);
      CREATE TABLE faction_funding (id TEXT, world_id TEXT, funder_id TEXT, war_faction_a TEXT, war_faction_b TEXT, active INTEGER);
      CREATE TABLE extraction_loans (id TEXT, world_id TEXT, creditor_id TEXT, debtor_id TEXT, amount REAL, collateral_id TEXT, status TEXT);
      INSERT INTO realms VALUES ('realm-a','sere','faction_a', 4200);
      INSERT INTO faction_funding VALUES ('ff1','sere','the_tessera','faction_a','faction_b',1);
      INSERT INTO extraction_loans VALUES ('el1','sere','the_tessera','faction_b', 750, NULL, 'active');
    `);
    return db;
  }

  it("the funder's dossier lists the factions it funds and the liens it holds", () => {
    const db = seedFunderDb();
    const out = factionEconomyState(db, "sere", "the_tessera");
    assert.equal(out.ok, true);
    assert.deepEqual([...out.funds].sort(), ["faction_a", "faction_b"]);
    assert.equal(out.liensHeld.length, 1);
    assert.equal(out.liensHeld[0].debtor_id, "faction_b");
    db.close();
  });

  it("the faction's dossier still reads its treasury and its funder", () => {
    const db = seedFunderDb();
    const out = factionEconomyState(db, "sere", "faction_a");
    assert.equal(out.treasury, 4200);
    assert.deepEqual(out.fundedBy, ["the_tessera"]);
    db.close();
  });
});
