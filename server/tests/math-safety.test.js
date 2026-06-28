/**
 * Adversarial-hardening — vector/position safety contract test.
 *
 * Pins: NaN/Infinity/non-finite components are coerced to the fallback;
 * out-of-bounds positions are recovered to a safe respawn; valid positions
 * pass through untouched. Both helpers are pure + total (never throw).
 *
 * Run: node --test tests/math-safety.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeVector, clampToWorldBounds, safePosition, WORLD_BOUNDS } from "../lib/math-safety.js";

describe("sanitizeVector", () => {
  it("passes a valid finite vector through unchanged", () => {
    assert.deepEqual(sanitizeVector({ x: 1.5, y: -2, z: 30 }), { x: 1.5, y: -2, z: 30 });
  });

  it("coerces NaN components to the fallback", () => {
    assert.deepEqual(sanitizeVector({ x: NaN, y: 5, z: 10 }), { x: 0, y: 5, z: 10 });
  });

  it("coerces Infinity and -Infinity to the fallback", () => {
    assert.deepEqual(sanitizeVector({ x: Infinity, y: -Infinity, z: 2 }), { x: 0, y: 0, z: 2 });
  });

  it("honors a custom fallback", () => {
    assert.deepEqual(sanitizeVector({ x: NaN, y: NaN, z: NaN }, 7), { x: 7, y: 7, z: 7 });
  });

  it("defends against non-object / null / missing components", () => {
    assert.deepEqual(sanitizeVector(null), { x: 0, y: 0, z: 0 });
    assert.deepEqual(sanitizeVector(undefined), { x: 0, y: 0, z: 0 });
    assert.deepEqual(sanitizeVector({}), { x: 0, y: 0, z: 0 });
    assert.deepEqual(sanitizeVector({ x: "1", y: "abc", z: 3 }), { x: 1, y: 0, z: 3 });
  });

  it("falls back when the fallback itself is non-finite", () => {
    assert.deepEqual(sanitizeVector({ x: NaN, y: 0, z: 0 }, Infinity), { x: 0, y: 0, z: 0 });
  });

  it("never throws on hostile input", () => {
    assert.doesNotThrow(() => sanitizeVector(42));
    assert.doesNotThrow(() => sanitizeVector("not a vector"));
  });
});

describe("clampToWorldBounds", () => {
  it("passes an in-bounds position through with recovered=false", () => {
    const r = clampToWorldBounds({ x: 100, y: 5, z: -200 });
    assert.equal(r.recovered, false);
    assert.deepEqual(r.pos, { x: 100, y: 5, z: -200 });
  });

  it("recovers an out-of-bounds X", () => {
    const r = clampToWorldBounds({ x: 99999, y: 5, z: 0 });
    assert.equal(r.recovered, true);
    assert.deepEqual(r.pos, { ...WORLD_BOUNDS.RESPAWN });
  });

  it("recovers an out-of-bounds Z", () => {
    const r = clampToWorldBounds({ x: 0, y: 5, z: -50000 });
    assert.equal(r.recovered, true);
  });

  it("recovers a sub-floor Y (fell through the world)", () => {
    const r = clampToWorldBounds({ x: 0, y: -9999, z: 0 });
    assert.equal(r.recovered, true);
  });

  it("recovers a non-finite component (defense if un-sanitized)", () => {
    assert.equal(clampToWorldBounds({ x: NaN, y: 0, z: 0 }).recovered, true);
    assert.equal(clampToWorldBounds({ x: Infinity, y: 0, z: 0 }).recovered, true);
  });

  it("treats the exact boundary as in-bounds", () => {
    const r = clampToWorldBounds({ x: WORLD_BOUNDS.HORIZONTAL, y: WORLD_BOUNDS.FLOOR_Y, z: -WORLD_BOUNDS.HORIZONTAL });
    assert.equal(r.recovered, false);
  });

  it("never throws", () => {
    assert.doesNotThrow(() => clampToWorldBounds(null));
  });
});

describe("safePosition (sanitize + clamp)", () => {
  it("a NaN attack value is sanitized to a finite, in-bounds position (never poisons)", () => {
    // sanitize fixes NaN→0 (in bounds), so no clamp recovery is needed — the
    // point is the output is finite and safe, never a NaN that bypasses checks.
    const r = safePosition({ x: NaN, y: 0, z: 0 });
    assert.equal(r.recovered, false);
    assert.ok(Number.isFinite(r.pos.x) && Number.isFinite(r.pos.y) && Number.isFinite(r.pos.z));
    assert.deepEqual(r.pos, { x: 0, y: 0, z: 0 });
  });

  it("an Infinity that is ALSO out-of-bounds is sanitized then passes clean", () => {
    const r = safePosition({ x: Infinity, y: Infinity, z: Infinity });
    assert.ok(Number.isFinite(r.pos.x) && Number.isFinite(r.pos.y) && Number.isFinite(r.pos.z));
  });

  it("a finite but out-of-bounds attack value is recovered", () => {
    const r = safePosition({ x: 1e9, y: 0, z: 0 });
    assert.equal(r.recovered, true);
    assert.ok(Number.isFinite(r.pos.x));
  });

  it("a valid position survives the round-trip", () => {
    const r = safePosition({ x: 10, y: 1, z: 20 });
    assert.equal(r.recovered, false);
    assert.deepEqual(r.pos, { x: 10, y: 1, z: 20 });
  });
});
