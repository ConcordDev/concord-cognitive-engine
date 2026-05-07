// Property-based tests for load-bearing math in Concord.
//
// "Property" tests assert invariants that must hold for ALL valid inputs,
// not just hand-picked examples. Each property below is run against ~200
// random inputs per assertion. If any input breaks the property, the
// failure is reproducible: the seed is logged so the exact case can be
// re-run.
//
// We use a hand-rolled mulberry32 PRNG instead of pulling in fast-check
// to keep the test suite zero-dependency.
//
// Properties tested:
//   - calculateGenerationalRate is monotonically non-increasing in
//     generation, never below ROYALTY_FLOOR, and equals initialRate at gen 0.
//   - computeBase6Layer + glyphAdd combine without producing strength > 9
//     (the documented hard cap for compound refusals).
//   - isCompoundRefusal fires iff strength >= 6 (the documented threshold).

import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateGenerationalRate } from "../../economy/royalty-cascade.js";
import {
  computeFieldComposition,
  applyTemporaryRefusal,
  isCompoundRefusal,
} from "../../lib/refusal-field.js";

// ─────────────────────────────────────────────────────────────────────
// PRNG — mulberry32 deterministic for reproducible failures.
// ─────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function forAll(name, n, gen, prop) {
  // Default seed lets failures be reproduced. Override via env to hunt
  // intermittent properties.
  const baseSeed = Number(process.env.PROPERTY_SEED ?? 0xC0FFEE);
  for (let i = 0; i < n; i++) {
    const seed = baseSeed + i;
    const rng = mulberry32(seed);
    const input = gen(rng);
    try {
      prop(input);
    } catch (err) {
      throw new Error(
        `Property "${name}" failed at iteration ${i} (seed=${seed}, input=${JSON.stringify(input)}):\n  ${err.message}`,
      );
    }
  }
}

const ROYALTY_FLOOR = 0.0005;
const DEFAULT_INITIAL_RATE = 0.21;

// ─────────────────────────────────────────────────────────────────────
// Royalty cascade properties
// ─────────────────────────────────────────────────────────────────────

test("property: royalty rate at generation 0 equals initialRate", () => {
  forAll(
    "rate(0, r) = r",
    200,
    (rng) => ({ initialRate: ROYALTY_FLOOR + rng() * 0.5 }),
    ({ initialRate }) => {
      const r = calculateGenerationalRate(0, initialRate);
      // rate(0) = initialRate, EXCEPT when initialRate is below the floor —
      // then the floor kicks in.
      const expected = Math.max(initialRate, ROYALTY_FLOOR);
      assert.ok(Math.abs(r - expected) < 1e-9, `expected ${expected}, got ${r}`);
    },
  );
});

test("property: royalty rate is monotonically non-increasing in generation", () => {
  forAll(
    "rate(g) >= rate(g+1)",
    200,
    (rng) => ({
      generation: Math.floor(rng() * 50),
      initialRate: ROYALTY_FLOOR + rng() * 0.5,
    }),
    ({ generation, initialRate }) => {
      const a = calculateGenerationalRate(generation, initialRate);
      const b = calculateGenerationalRate(generation + 1, initialRate);
      assert.ok(
        a >= b,
        `rate(${generation})=${a} must be >= rate(${generation + 1})=${b}`,
      );
    },
  );
});

test("property: royalty rate never falls below ROYALTY_FLOOR", () => {
  forAll(
    "rate(g) >= ROYALTY_FLOOR for all g >= 0",
    200,
    (rng) => ({
      generation: Math.floor(rng() * 100),
      initialRate: ROYALTY_FLOOR + rng() * 0.5,
    }),
    ({ generation, initialRate }) => {
      const r = calculateGenerationalRate(generation, initialRate);
      assert.ok(r >= ROYALTY_FLOOR, `rate(${generation}, ${initialRate}) = ${r} < floor`);
    },
  );
});

test("property: negative generation returns 0 (defensive)", () => {
  forAll(
    "rate(g<0, r) = 0",
    100,
    (rng) => ({ generation: -Math.floor(rng() * 100) - 1, initialRate: ROYALTY_FLOOR + rng() * 0.5 }),
    ({ generation, initialRate }) => {
      const r = calculateGenerationalRate(generation, initialRate);
      assert.strictEqual(r, 0, `negative generation must yield 0, got ${r}`);
    },
  );
});

test("property: cumulative cascade royalty (geometric series) bounded by initialRate * 2", () => {
  // Sum over all generations: r0 + r0/2 + r0/4 + ... = 2*r0
  // The cascade walks at most MAX_CASCADE_DEPTH (50) ancestors, so the
  // partial sum strictly < 2 * initialRate. This bounds the worst case
  // even before MAX_ROYALTY_RATE (30%) clamps it.
  forAll(
    "sum_{g=0..50} rate(g) <= 2 * initialRate (modulo floor)",
    100,
    (rng) => ({ initialRate: ROYALTY_FLOOR + rng() * 0.5 }),
    ({ initialRate }) => {
      let sum = 0;
      for (let g = 0; g <= 50; g++) sum += calculateGenerationalRate(g, initialRate);
      // Floor adds up to 50 * ROYALTY_FLOOR = 0.025 in the worst case;
      // include that as the slack.
      const upperBound = 2 * initialRate + 50 * ROYALTY_FLOOR + 1e-9;
      assert.ok(
        sum <= upperBound,
        `cumulative sum ${sum} > bound ${upperBound} for initialRate=${initialRate}`,
      );
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// Refusal-field algebra properties
// ─────────────────────────────────────────────────────────────────────

function freshState() {
  return { settings: {}, refusalFields: new Map() };
}

test("property: composition strength is bounded [0, 9]", () => {
  forAll(
    "0 <= computeFieldComposition.strength <= 9",
    100,
    (rng) => ({
      // Apply between 0 and 8 random refusal fields with random TTLs.
      n: Math.floor(rng() * 8),
      kinds: ["death_suspended", "harvest_disabled", "hostility_paused", "consequence_held", "numbers_refused", "dome_collapse", "win_condition_refused"],
      seed: rng(),
    }),
    ({ n, kinds, seed }) => {
      const state = freshState();
      const rng = mulberry32(Math.floor(seed * 1e9));
      for (let i = 0; i < n; i++) {
        const kind = kinds[Math.floor(rng() * kinds.length)];
        applyTemporaryRefusal({
          state,
          kind,
          durationMs: 60_000 + Math.floor(rng() * 600_000),
          reason: "property-test",
          appliedTo: { worldId: "concordia-hub" },
        });
      }
      const result = computeFieldComposition(state, "concordia-hub");
      assert.ok(typeof result.strength === "number", "strength must be a number");
      assert.ok(
        result.strength >= 0 && result.strength <= 9,
        `strength ${result.strength} out of bounds for n=${n}`,
      );
    },
  );
});

test("property: isCompoundRefusal iff strength >= 6", () => {
  forAll(
    "isCompoundRefusal(state, w) === (strength(state, w) >= 6)",
    100,
    (rng) => ({
      n: Math.floor(rng() * 8),
      kinds: ["death_suspended", "harvest_disabled", "hostility_paused", "consequence_held", "numbers_refused", "dome_collapse", "win_condition_refused"],
      seed: rng(),
    }),
    ({ n, kinds, seed }) => {
      const state = freshState();
      const rng = mulberry32(Math.floor(seed * 1e9));
      for (let i = 0; i < n; i++) {
        const kind = kinds[Math.floor(rng() * kinds.length)];
        applyTemporaryRefusal({
          state,
          kind,
          durationMs: 60_000 + Math.floor(rng() * 600_000),
          reason: "property-test",
          appliedTo: { worldId: "concordia-hub" },
        });
      }
      const composition = computeFieldComposition(state, "concordia-hub");
      const isCompound = isCompoundRefusal(state, "concordia-hub");
      assert.strictEqual(
        isCompound,
        composition.strength >= 6,
        `isCompoundRefusal mismatch: returned ${isCompound} but strength=${composition.strength}`,
      );
    },
  );
});

test("property: empty state has strength 0 and isCompoundRefusal=false", () => {
  forAll(
    "no fields → strength=0, !compound",
    50,
    (_rng) => ({}),
    () => {
      const state = freshState();
      const c = computeFieldComposition(state, "concordia-hub");
      assert.strictEqual(c.strength, 0);
      assert.strictEqual(isCompoundRefusal(state, "concordia-hub"), false);
    },
  );
});
