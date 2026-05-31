// Wave 3 — the dynamics layer (#3 collapse / #7 saturation / #26 regrowth) + the
// viability-cycle heartbeat contract. Pins logistic regrowth, the hysteretic
// collapse classifier (the principled V→0 crisis trigger), saturation detection,
// and that the heartbeat never throws + no-ops when CONCORD_VIABILITY is off.
//
// Run: node --test tests/viability/world-dynamics.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import { logisticRegrow, classifyCollapse, detectSaturation } from "../../lib/viability/world-dynamics.js";
import { runViabilityCycle, _testing } from "../../emergent/viability-cycle.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("#26 logistic regrowth", () => {
  it("recovers a depleted stock fastest at mid-stock; caps; can't regrow from 0", () => {
    assert.ok(close(logisticRegrow(50, 100, 0.1), 52.5)); // 50 + 0.1·50·0.5
    assert.ok(close(logisticRegrow(100, 100, 0.1), 100)); // at cap → no growth
    assert.equal(logisticRegrow(0, 100, 0.1), 0);         // extinction is absorbing
  });
});

describe("#3 collapse classifier (hysteresis)", () => {
  it("enters crisis at the floor, recovers only above the higher threshold", () => {
    const r1 = classifyCollapse([{ id: "ecosystem", V: 0.02 }], new Set());
    assert.deepEqual(r1.entered, ["ecosystem"]);
    assert.ok(r1.inCrisis.has("ecosystem"));
    // V climbs to 0.1 — above crisisAt(0.05) but below recoverAt(0.25) → STAYS in crisis (no flap)
    const r2 = classifyCollapse([{ id: "ecosystem", V: 0.1 }], r1.inCrisis);
    assert.deepEqual(r2.recovered, []);
    assert.ok(r2.inCrisis.has("ecosystem"));
    // V climbs to 0.4 → recovers
    const r3 = classifyCollapse([{ id: "ecosystem", V: 0.4 }], r2.inCrisis);
    assert.deepEqual(r3.recovered, ["ecosystem"]);
    assert.ok(!r3.inCrisis.has("ecosystem"));
  });
});

describe("#7 saturation cascade", () => {
  it("detects when enough cells bottom out", () => {
    assert.equal(detectSaturation([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]).saturated, true); // 6/10
    assert.equal(detectSaturation([0.5, 0.5, 0, 1]).saturated, false);              // 1/4
    assert.equal(detectSaturation([]).saturated, false);
  });
});

describe("viability-cycle heartbeat contract", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); _testing.reset(); });
  afterEach(() => { delete process.env.CONCORD_VIABILITY; try { db.close(); } catch { /* noop */ } });

  it("no-ops when the kill-switch is off", async () => {
    const r = await runViabilityCycle({ db });
    assert.equal(r.reason, "disabled");
  });

  it("never throws on a bad db", async () => {
    process.env.CONCORD_VIABILITY = "1";
    const r = await runViabilityCycle({});
    assert.equal(r.ok, false);
  });

  it("runs a pass when enabled (no worlds/metrics → 0 crises, still ok)", async () => {
    process.env.CONCORD_VIABILITY = "1";
    const r = await runViabilityCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.crises, 0);
  });
});
