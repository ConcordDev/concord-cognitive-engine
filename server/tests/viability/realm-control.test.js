// Wave 5 #19 — civilization-as-control. Pins the PID realm controller (eases tax
// when legitimacy is low, raises it when high), the closed-loop convergence to
// the legitimacy setpoint, and the gated heartbeat (off == today / writes
// nothing; on = a low-legitimacy realm self-corrects toward stability).
//
// Run: node --test tests/viability/realm-control.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import {
  recommendTax,
  legitimacyResponse,
  legitimacyTargetFor,
  LEGITIMACY_SETPOINT,
  MAX_TAX_STEP,
} from "../../lib/viability/realm-control.js";
import { runRealmControlCycle, _testing } from "../../emergent/realm-control-cycle.js";

describe("recommendTax (PID actuation)", () => {
  it("eases tax when legitimacy is below the setpoint, raises it when above", () => {
    const low = recommendTax({ legitimacy: 30, tax_rate: 0.25 });
    const high = recommendTax({ legitimacy: 90, tax_rate: 0.25 });
    assert.ok(low.deltaTax < 0, `low ${low.deltaTax}`);   // restless people → ease tax
    assert.ok(high.deltaTax > 0, `high ${high.deltaTax}`); // content people → can tax more
  });
  it("bounds the actuation per tick and keeps tax in [0,0.5]", () => {
    const r = recommendTax({ legitimacy: 0, tax_rate: 0.02 });
    assert.ok(Math.abs(r.deltaTax) <= MAX_TAX_STEP + 1e-9);
    assert.ok(r.newTax >= 0 && r.newTax <= 0.5);
  });
});

describe("closed-loop convergence", () => {
  it("drives legitimacy toward the setpoint from a destabilised start", () => {
    let realm = { legitimacy: 20, tax_rate: 0.45 }; // heavy tax, restless
    let prior = {};
    for (let i = 0; i < 400; i++) {
      const { newTax, integral, prevError } = recommendTax(realm, prior);
      prior = { integral, prevError };
      realm = { legitimacy: legitimacyResponse(realm.legitimacy, newTax), tax_rate: newTax };
    }
    assert.ok(Math.abs(realm.legitimacy - LEGITIMACY_SETPOINT) < 8, `settled at ${realm.legitimacy.toFixed(1)}`);
  });
  it("legitimacyTargetFor is monotone-decreasing in tax (setpoint near 0.25 tax)", () => {
    assert.ok(legitimacyTargetFor(0) > legitimacyTargetFor(0.25));
    assert.ok(legitimacyTargetFor(0.25) > legitimacyTargetFor(0.5));
    assert.ok(Math.abs(legitimacyTargetFor(0.25) - 60) < 1e-9);
  });
});

describe("realm-control-cycle heartbeat (gated)", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    _testing.reset();
    db.prepare("INSERT INTO realms (id, name, world_id, legitimacy, tax_rate) VALUES ('r1','Reach','w', 25, 0.45)").run();
  });
  afterEach(() => { delete process.env.CONCORD_REALM_CONTROL; try { db.close(); } catch { /* noop */ } });

  const realm = () => db.prepare("SELECT legitimacy, tax_rate FROM realms WHERE id='r1'").get();

  it("OFF (kill-switch =0): writes nothing", async () => {
    process.env.CONCORD_REALM_CONTROL = "0";
    const r = await runRealmControlCycle({ db });
    assert.equal(r.reason, "disabled");
    assert.equal(realm().legitimacy, 25);
    assert.equal(realm().tax_rate, 0.45);
  });

  it("ON: a low-legitimacy realm eases tax and recovers legitimacy", async () => {
    process.env.CONCORD_REALM_CONTROL = "1";
    const before = realm();
    let last = before;
    for (let i = 0; i < 20; i++) { await runRealmControlCycle({ db }); last = realm(); }
    assert.ok(last.tax_rate < before.tax_rate, `tax eased ${before.tax_rate}→${last.tax_rate}`);
    assert.ok(last.legitimacy > before.legitimacy, `legitimacy recovered ${before.legitimacy}→${last.legitimacy}`);
  });
});
