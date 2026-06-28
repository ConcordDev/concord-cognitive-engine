/**
 * Adversarial-hardening — JSON depth guard contract test.
 *
 * Pins: a deeply-nested object (past the cap) is rejected; a normal-shaped
 * object passes; the check is iterative (no recursion) so the guard itself
 * survives a deeply-nested adversarial payload.
 *
 * Run: node --test tests/json-depth-guard.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jsonDepthWithin, JSON_MAX_DEPTH } from "../middleware/index.js";

function nestObject(depth) {
  let o = { leaf: true };
  for (let i = 0; i < depth; i++) o = { nested: o };
  return o;
}

function nestArray(depth) {
  let a = [1];
  for (let i = 0; i < depth; i++) a = [a];
  return a;
}

describe("jsonDepthWithin", () => {
  it("accepts primitives (depth 0)", () => {
    assert.equal(jsonDepthWithin(null), true);
    assert.equal(jsonDepthWithin(42), true);
    assert.equal(jsonDepthWithin("hi"), true);
    assert.equal(jsonDepthWithin(true), true);
  });

  it("accepts a normal shallow object", () => {
    assert.equal(jsonDepthWithin({ a: 1, b: { c: 2, d: [1, 2, 3] } }), true);
  });

  it("rejects a 100-deep nested object", () => {
    assert.equal(jsonDepthWithin(nestObject(100)), false);
  });

  it("rejects a 100-deep nested array", () => {
    assert.equal(jsonDepthWithin(nestArray(100)), false);
  });

  it("accepts an object exactly at the cap", () => {
    // depth = JSON_MAX_DEPTH levels of nesting (top object is level 1).
    assert.equal(jsonDepthWithin(nestObject(JSON_MAX_DEPTH - 1), JSON_MAX_DEPTH), true);
  });

  it("rejects one level past the cap", () => {
    assert.equal(jsonDepthWithin(nestObject(JSON_MAX_DEPTH + 1), JSON_MAX_DEPTH), false);
  });

  it("honors a custom max", () => {
    assert.equal(jsonDepthWithin(nestObject(3), 5), true);
    assert.equal(jsonDepthWithin(nestObject(10), 5), false);
  });

  it("does not blow its own stack on a hostile payload (iterative)", () => {
    // 50k levels deep would overflow any recursive checker. The iterative
    // walker must return false without throwing.
    assert.doesNotThrow(() => {
      const r = jsonDepthWithin(nestArray(50000), 32);
      assert.equal(r, false);
    });
  });

  it("JSON_MAX_DEPTH default is a sane positive cap", () => {
    assert.ok(Number.isInteger(JSON_MAX_DEPTH) && JSON_MAX_DEPTH >= 8);
  });
});
