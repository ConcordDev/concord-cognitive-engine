// Behavioral tests for server/domains/energy.js's `cheapest-window` macro —
// the WAVE4 "when should I run this?" cost advisor. Follows the same
// harness pattern as server/tests/energy-lens-macros.test.js: register the
// real domain module against a fake `registerLensAction`, call handlers
// directly (in-memory `globalThis._concordSTATE`, no DB, no network).
//
// These are NOT shape-only assertions — each cheapest-window test
// hand-computes the expected cost from a known time-of-use schedule + a
// known shiftable load and asserts the macro returns that EXACT number,
// pinning the "cheapest contiguous window" formula:
//
//   kwhPerHour = kWh / durationHours
//   cost(window starting at hour s) = sum over i in [0, durationHours) of
//     kwhPerHour * hourlyRate[(s + i) % 24]
//   cheapestWindow = argmin_s cost(s);  worstWindow = argmax_s cost(s)
//
// and asserts the honest "no rate data" state when neither an explicit
// hourly-rate table nor a time-of-use schedule (inline or saved) is
// available — never a fabricated recommendation from a flat rate alone.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEnergyActions from "../domains/energy.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "energy", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function call(name, ctx, body = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`energy.${name} not registered`);
  const peeled = peelRedundantArtifactWrapper(body) || {};
  const virtualArtifact = { id: null, domain: "energy", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, virtualArtifact, peeled);
}

function assertFinite(obj, label) {
  const walk = (v, path) => {
    if (typeof v === "number") {
      assert.ok(Number.isFinite(v), `${label}: non-finite number at ${path}: ${v}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  walk(obj, label);
}

before(() => {
  registerEnergyActions(registerLensAction);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = {};
});

// ──────────────────────────────────────────────────────────────────────────
// Honest "no rate data" state — never a fabricated recommendation
// ──────────────────────────────────────────────────────────────────────────
describe("energy.cheapest-window — honest no-data state", () => {
  it("no TOU plan, no rate on file → hasData:false, generic honest message", () => {
    const r = call("cheapest-window", ctxA, { kWh: 10, durationHours: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, false);
    assert.match(r.result.message, /No rate data available/i);
    assert.match(r.result.message, /tou-set/i);
    // No fabricated recommendation fields leak through.
    assert.equal(r.result.cheapestWindow, undefined);
  });

  it("a flat on-file rate alone still yields hasData:false (no time-of-day signal)", () => {
    call("rate-set", ctxA, { ratePerKwh: 0.22 });
    const r = call("cheapest-window", ctxA, { kWh: 10, durationHours: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, false);
    // Message should honestly reference the flat rate and explain why it
    // can't produce a window recommendation, not silently omit it.
    assert.match(r.result.message, /0\.22/);
    assert.match(r.result.message, /doesn't vary by time of day/i);
  });

  it("an explicit referenceRatePerKwh (e.g. from an EIA average) is surfaced honestly, still no window", () => {
    const r = call("cheapest-window", ctxA, { kWh: 10, durationHours: 3, referenceRatePerKwh: 0.19 });
    assert.equal(r.result.hasData, false);
    assert.match(r.result.message, /0\.19/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────────
describe("energy.cheapest-window — input validation", () => {
  it("rejects kWh <= 0", () => {
    const r = call("cheapest-window", ctxA, { kWh: 0, durationHours: 3 });
    assert.equal(r.ok, false);
  });

  it("rejects durationHours out of [1,24]", () => {
    assert.equal(call("cheapest-window", ctxA, { kWh: 5, durationHours: 0 }).ok, false);
    assert.equal(call("cheapest-window", ctxA, { kWh: 5, durationHours: 25 }).ok, false);
  });

  it("rejects a malformed hourlyRates array (wrong length / negative / non-finite)", () => {
    assert.equal(call("cheapest-window", ctxA, { kWh: 5, durationHours: 2, hourlyRates: [0.1, 0.2] }).ok, false);
    const negative = new Array(24).fill(0.1); negative[3] = -0.5;
    assert.equal(call("cheapest-window", ctxA, { kWh: 5, durationHours: 2, hourlyRates: negative }).ok, false);
    const poisoned = new Array(24).fill(0.1); poisoned[5] = "Infinity";
    assert.equal(call("cheapest-window", ctxA, { kWh: 5, durationHours: 2, hourlyRates: poisoned }).ok, false);
  });

  it("rejects an inline TOU schedule with peakEndHour <= peakStartHour", () => {
    const r = call("cheapest-window", ctxA, {
      kWh: 5, durationHours: 2, peakRate: 0.4, offPeakRate: 0.1, peakStartHour: 20, peakEndHour: 16,
    });
    assert.equal(r.ok, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Hand-computed worked example (the load-bearing formula pin)
//
//   TOU plan: peak $0.40/kWh 16:00–21:00 (hours 16,17,18,19,20 = 5h peak),
//             off-peak $0.10/kWh (the other 19 hours).
//   Load: 9 kWh over a 3-hour window → 3 kWh/hour.
//
//   Any all-off-peak 3h window costs 3 * 3 * 0.10 = $0.90 (the minimum;
//   the earliest such window is hours [0,1,2), so cheapestWindow.startHour
//   should be 0).
//   Any all-peak 3h window (e.g. start=16 → hours 16,17,18, all peak,
//   since peak spans 16..20 inclusive of 20) costs 3 * 3 * 0.40 = $3.60
//   (the maximum; earliest such window starts at hour 16).
//   savingsVsWorst = 3.60 - 0.90 = $2.70; savingsPctVsWorst = 2.70/3.60*100 = 75%.
// ──────────────────────────────────────────────────────────────────────────
describe("energy.cheapest-window — hand-computed cheapest/worst window (saved TOU plan)", () => {
  it("matches the exact worked-example cost math", () => {
    const set = call("tou-set", ctxA, { peakRate: 0.40, offPeakRate: 0.10, peakStartHour: 16, peakEndHour: 21 });
    assert.equal(set.ok, true);

    const r = call("cheapest-window", ctxA, { kWh: 9, durationHours: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, true);
    assert.equal(r.result.source, "tou-schedule-stored");
    assert.equal(r.result.kWh, 9);
    assert.equal(r.result.durationHours, 3);
    assert.equal(r.result.kwhPerHour, 3);

    assert.equal(r.result.cheapestWindow.startHour, 0);
    assert.equal(r.result.cheapestWindow.endHour, 3);
    assert.deepEqual(r.result.cheapestWindow.hours, [0, 1, 2]);
    assert.equal(r.result.cheapestWindow.cost, 0.9);

    assert.equal(r.result.worstWindow.startHour, 16);
    assert.equal(r.result.worstWindow.endHour, 19);
    assert.deepEqual(r.result.worstWindow.hours, [16, 17, 18]);
    assert.equal(r.result.worstWindow.cost, 3.6);

    assert.equal(r.result.savingsVsWorst, 2.7);
    assert.equal(r.result.savingsPctVsWorst, 75);

    // The full hourly-rate table used is surfaced (not a black box): 24
    // entries, peak hours 16-20 at 0.40, everything else at 0.10.
    assert.equal(r.result.hourlyRates.length, 24);
    for (let h = 0; h < 24; h++) {
      const expected = h >= 16 && h < 21 ? 0.40 : 0.10;
      assert.equal(r.result.hourlyRates[h], expected, `hour ${h}`);
    }

    // Gated hardware-control half is documented, not implied to work.
    assert.equal(r.result.hardwareControl.available, false);
    assert.match(r.result.hardwareControl.reason, /smart-plug|CT-clamp/i);

    assertFinite(r.result, "cheapest-window worked example");
  });

  it("an inline TOU schedule (no prior tou-set) computes the same math and does not persist", () => {
    const r = call("cheapest-window", ctxA, {
      kWh: 9, durationHours: 3, peakRate: 0.40, offPeakRate: 0.10, peakStartHour: 16, peakEndHour: 21,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "tou-schedule-param");
    assert.equal(r.result.cheapestWindow.cost, 0.9);
    assert.equal(r.result.worstWindow.cost, 3.6);
    // Confirm it was NOT saved as the user's persisted plan.
    const g = call("tou-get", ctxA, {});
    assert.equal(g.result.configured, false);
  });

  it("an explicit 24-hour rate table drives the same window search independent of any TOU plan", () => {
    const hourlyRates = new Array(24).fill(0.30);
    hourlyRates[2] = 0.08; hourlyRates[3] = 0.08; hourlyRates[4] = 0.08; // cheap overnight trough
    const r = call("cheapest-window", ctxA, { kWh: 6, durationHours: 3, hourlyRates });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "explicit-hourly-rates");
    assert.equal(r.result.cheapestWindow.startHour, 2);
    assert.deepEqual(r.result.cheapestWindow.hours, [2, 3, 4]);
    // kwhPerHour = 6/3 = 2; cost = 2 * (0.08+0.08+0.08) = 0.48
    assert.equal(r.result.cheapestWindow.cost, 0.48);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Midnight-wraparound window
// ──────────────────────────────────────────────────────────────────────────
describe("energy.cheapest-window — wraps past midnight", () => {
  it("finds a cheapest window that wraps hour 23 → 0 → 1", () => {
    const hourlyRates = new Array(24).fill(1.00);
    hourlyRates[23] = 0.05; hourlyRates[0] = 0.05; hourlyRates[1] = 0.05;
    const r = call("cheapest-window", ctxA, { kWh: 3, durationHours: 3, hourlyRates });
    assert.equal(r.ok, true);
    assert.equal(r.result.cheapestWindow.startHour, 23);
    assert.equal(r.result.cheapestWindow.endHour, 2);
    assert.deepEqual(r.result.cheapestWindow.hours, [23, 0, 1]);
    // kwhPerHour = 1; cost = 1*0.05*3 = 0.15
    assert.equal(r.result.cheapestWindow.cost, 0.15);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// No Math.random / no fabricated prices anywhere in the live path
// ──────────────────────────────────────────────────────────────────────────
describe("energy.cheapest-window — no fabricated data", () => {
  it("source code path contains no Math.random", () => {
    // Deterministic-math guard: the macro must never introduce randomness
    // into a cost recommendation. (Static string check against the
    // registered handler's own source, not the whole file, keeps this
    // scoped to what actually runs for this macro.)
    const fn = ACTIONS.get("cheapest-window");
    assert.ok(typeof fn === "function");
    assert.doesNotMatch(fn.toString(), /Math\.random/);
  });

  it("per-user isolation: user_b's saved TOU plan never leaks into user_a's advisor call", () => {
    call("tou-set", ctxB, { peakRate: 0.9, offPeakRate: 0.8, peakStartHour: 0, peakEndHour: 23 });
    const r = call("cheapest-window", ctxA, { kWh: 5, durationHours: 2 });
    assert.equal(r.result.hasData, false); // user_a still has no plan of their own
  });
});
