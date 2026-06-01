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
