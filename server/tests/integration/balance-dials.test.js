/**
 * T3.4 — balance-dial guard.
 *
 * Pins the defaults, bounds, and env-override fallback behaviour of the
 * combat-feel / intrigue / zone dials introduced this sprint. If a default
 * changes in source without updating docs/BALANCE_DIALS.md, this test is the
 * trip-wire (the doc references it).
 *
 * Modules that read env at module-load time are re-imported with a cache-
 * busting query string after setting process.env so the IIFE re-evaluates.
 *
 * Run: node --test tests/integration/balance-dials.test.js
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const ENV_KEYS = [
  "CONCORD_KNOCKBACK_SCALE",
  "CONCORD_BEFRIEND_THRESHOLD",
  "CONCORD_SCHEME_OVERHEAR_RADIUS_M",
  "CONCORD_HAZARD_DEFAULT_DPS",
];
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

let bust = 0;
async function freshImport(spec) {
  bust++;
  return import(`${spec}?b=${bust}`);
}

describe("T3.4 — combat knockback scale", () => {
  it("defaults to 1.0 and scales bounded", async () => {
    const { impactFeel } = await import("../../lib/combat/impact-feel.js");
    const base = impactFeel("rocked", 120).knockback;
    process.env.CONCORD_KNOCKBACK_SCALE = "2";
    const doubled = impactFeel("rocked", 120).knockback;
    assert.ok(Math.abs(doubled - base * 2) < 0.2, "2x scale roughly doubles knockback");
    process.env.CONCORD_KNOCKBACK_SCALE = "999"; // clamps to 3
    const clamped = impactFeel("rocked", 120).knockback;
    assert.ok(clamped <= base * 3 + 0.2);
    process.env.CONCORD_KNOCKBACK_SCALE = "garbage"; // falls back to 1
    assert.ok(Math.abs(impactFeel("rocked", 120).knockback - base) < 0.001);
  });
});

describe("T3.4 — befriend threshold", () => {
  it("defaults to 45", async () => {
    const m = await freshImport("../../lib/embodied/weaponise-triggers.js");
    assert.equal(m.BEFRIEND_OPINION_THRESHOLD, 45);
  });
  it("honours the override, clamped to 0..100", async () => {
    process.env.CONCORD_BEFRIEND_THRESHOLD = "70";
    let m = await freshImport("../../lib/embodied/weaponise-triggers.js");
    assert.equal(m.BEFRIEND_OPINION_THRESHOLD, 70);
    process.env.CONCORD_BEFRIEND_THRESHOLD = "9999";
    m = await freshImport("../../lib/embodied/weaponise-triggers.js");
    assert.equal(m.BEFRIEND_OPINION_THRESHOLD, 100);
    process.env.CONCORD_BEFRIEND_THRESHOLD = "abc";
    m = await freshImport("../../lib/embodied/weaponise-triggers.js");
    assert.equal(m.BEFRIEND_OPINION_THRESHOLD, 45);
  });
});

describe("T3.4 — scheme overhear radius", () => {
  it("defaults to 12 and honours bounded override", async () => {
    let m = await freshImport("../../lib/scheme-overhear.js");
    assert.equal(m.OVERHEAR_RADIUS_M, 12);
    process.env.CONCORD_SCHEME_OVERHEAR_RADIUS_M = "25";
    m = await freshImport("../../lib/scheme-overhear.js");
    assert.equal(m.OVERHEAR_RADIUS_M, 25);
    process.env.CONCORD_SCHEME_OVERHEAR_RADIUS_M = "500";
    m = await freshImport("../../lib/scheme-overhear.js");
    assert.equal(m.OVERHEAR_RADIUS_M, 100);
  });
});

describe("T3.4 — hazard default dps", () => {
  it("defaults to 6 and bakes into ZONE_DEFAULTS.hazard", async () => {
    let m = await freshImport("../../lib/world-zones.js");
    assert.equal(m.ZONE_DEFAULTS.hazard.hazard, 6);
    process.env.CONCORD_HAZARD_DEFAULT_DPS = "12";
    m = await freshImport("../../lib/world-zones.js");
    assert.equal(m.ZONE_DEFAULTS.hazard.hazard, 12);
    process.env.CONCORD_HAZARD_DEFAULT_DPS = "nope";
    m = await freshImport("../../lib/world-zones.js");
    assert.equal(m.ZONE_DEFAULTS.hazard.hazard, 6);
  });
});
