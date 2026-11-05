// ocean-build-slices.test.js — Ocean full-build (B9, 2026-11-03) pins.
//
// S4 — marineEcosystem refuses an EMPTY inventory (NOT_COMPUTED) instead
// of grading it "critical"; sparse stays honestly graded. waveAnalysis's
// existing zero refusal is pinned, not rebuilt.
// S2 — tide-alerts-check honours the entered lead: minutesUntilNotify is
// event-minus-lead against the real clock (driven end-to-end with a
// stubbed NOAA fetch; Review 2's F4 — the walked "notify in 300" with a
// 60-minute lead followed from neither input).
// S4 — tidalPrediction refuses without a station (pin of the contract
// the rebuilt panel is wired to).

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import registerOceanActions from "../domains/ocean.js";

// The alert check fetches NOAA through lib/external-fetch's SSRF guard,
// which refuses this sandbox's DNS (the host resolves to a private-range
// address here — the chem build hit the same wall at PubChem). The S2
// drive therefore module-mocks that one dependency (fresh import below)
// when the runner supports it (node --experimental-test-module-mocks);
// under the plain runner it reports itself skipped rather than failing
// the file — the handler's own arithmetic is what is under test.
const HAS_MODULE_MOCKS = typeof mock.module === "function";
const gmtFmt = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

const handlers = new Map();
registerOceanActions((domain, name, fn) => handlers.set(`${domain}.${name}`, fn));
const ctx = { actor: { userId: "ocean-build-test" } };
const call = (name, input = {}, artifact = undefined) =>
  handlers.get(`ocean.${name}`)(ctx, artifact ?? { data: input }, input);

describe("S4 — ecosystem honesty", () => {
  it("an empty inventory is NOT_COMPUTED, never a 'critical' verdict", async () => {
    const r = await call("marineEcosystem", { species: [] });
    assert.equal(r.result.status, "NOT_COMPUTED");
    assert.ok(r.result.missingInputs.includes("species"));
    assert.equal(r.result.ecosystemHealth, undefined);
  });

  it("a single species is graded (Shannon 0 is honest math beside its count)", async () => {
    const r = await call("marineEcosystem", { species: [{ name: "kelp", trophicLevel: "primary" }] });
    assert.equal(r.result.status, undefined);
    assert.equal(r.result.speciesCount, 1);
    assert.equal(r.result.shannonDiversityIndex, 0);
    assert.equal(r.result.ecosystemHealth, "critical");
  });

  it("five species grade above the sparse band", async () => {
    const species = ["a", "b", "c", "d", "e"].map((name) => ({ name, trophicLevel: "primary" }));
    const r = await call("marineEcosystem", { species });
    assert.equal(r.result.speciesCount, 5);
    assert.equal(r.result.ecosystemHealth, "stressed");
  });

  it("waveAnalysis still refuses zero height/period and computes real inputs", async () => {
    const zero = await call("waveAnalysis", { waveHeightMeters: 0, wavePeriodSeconds: 0, windSpeedKnots: 0 });
    assert.equal(zero.result.status, "NOT_COMPUTED");
    const real = await call("waveAnalysis", { waveHeightMeters: 2, wavePeriodSeconds: 8, windSpeedKnots: 15 });
    assert.equal(real.result.wavelength, "100m");
    assert.equal(real.result.speed, "12.5 m/s");
  });

  it("tidalPrediction refuses without a station ID", async () => {
    const r = await call("tidalPrediction", { location: "nowhere" });
    assert.equal(r.result.status, "NOT_COMPUTED");
    assert.ok(r.result.missingInputs.includes("stationId"));
  });
});

describe("S2 — the alert countdown honours its lead", () => {
  it("minutesUntilNotify = event − lead, from the real clock", {
    skip: HAS_MODULE_MOCKS ? false : "needs node --experimental-test-module-mocks (the sandbox SSRF guard refuses NOAA DNS, so the drive module-mocks lib/external-fetch)",
  }, async () => {
    mock.module("../lib/external-fetch.js", {
      exports: {
        cachedFetchJson: async () => ({
          predictions: [
            { t: gmtFmt(new Date(Date.now() + 120 * 60000)), v: "1.80", type: "H" },
            { t: gmtFmt(new Date(Date.now() + 360 * 60000)), v: "-0.13", type: "L" },
          ],
        }),
      },
    });
    const fresh = new Map();
    const { default: registerFresh } = await import("../domains/ocean.js?s2drive=1");
    registerFresh((domain, name, fn) => fresh.set(`${domain}.${name}`, fn));
    globalThis._concordSTATE = {};
    try {
      const added = await fresh.get("ocean.tide-alert-add")(ctx, {}, {
        stationId: "9414290", stationName: "San Francisco", tideType: "low", leadMinutes: 60, label: "pin",
      });
      assert.equal(added.result.alert.leadMinutes, 60);
      const check = await fresh.get("ocean.tide-alerts-check")(ctx, {}, {});
      const entry = check.result.alerts.find((a) => a.alertId === added.result.alert.id);
      assert.ok(entry, "the alert is checked");
      assert.equal(entry.nextTide.type, "low");
      assert.equal(entry.nextTide.height, -0.13);
      assert.ok(
        entry.minutesUntilNotify >= 297 && entry.minutesUntilNotify <= 301,
        `expected ≈300 (360 to the event − 60 lead), got ${entry.minutesUntilNotify}`,
      );
      const notifyMs = new Date(entry.notifyAt).getTime();
      const eventMs = new Date(entry.nextTide.time + "Z").getTime();
      assert.ok(Math.abs(notifyMs - (eventMs - 60 * 60000)) < 60000, "notifyAt is the event minus the lead");
      assert.equal(entry.due, false);
    } finally {
      delete globalThis._concordSTATE;
    }
  });
});
