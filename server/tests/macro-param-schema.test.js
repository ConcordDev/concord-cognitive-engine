/**
 * Gate D — per-macro param-schema validation.
 *
 * Pins the declarative validator that runMacro uses to reject param-key drift
 * (#6/#31 wrong key) + missing required input (#21) with a clean error instead of a 500.
 *
 * Run: node --test tests/macro-param-schema.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateParamSchema } from "../lib/macro-param-schema.js";

test("no schema → always ok (opt-in, additive)", () => {
  assert.equal(validateParamSchema(null, { anything: 1 }).ok, true);
  assert.equal(validateParamSchema(undefined, {}).ok, true);
});

test("required field missing → error", () => {
  const r = validateParamSchema({ species_id: { type: "string", required: true } }, {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [{ field: "species_id", reason: "required" }]);
});

test("optional field absent → ok", () => {
  const r = validateParamSchema({ world: { type: "string" } }, {});
  assert.equal(r.ok, true);
});

test("wrong type → error (the param-key-drift symptom)", () => {
  const r = validateParamSchema({ count: { type: "number" } }, { count: "5" });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].reason, "expected_number");
});

test("number min/max enforced", () => {
  assert.equal(validateParamSchema({ n: { type: "number", min: 1 } }, { n: 0 }).ok, false);
  assert.equal(validateParamSchema({ n: { type: "number", max: 100 } }, { n: 250 }).ok, false);
  assert.equal(validateParamSchema({ n: { type: "number", min: 1, max: 100 } }, { n: 50 }).ok, true);
});

test("enum enforced", () => {
  assert.equal(validateParamSchema({ mode: { type: "string", enum: ["a", "b"] } }, { mode: "c" }).ok, false);
  assert.equal(validateParamSchema({ mode: { type: "string", enum: ["a", "b"] } }, { mode: "a" }).ok, true);
});

test("string maxLength enforced", () => {
  assert.equal(validateParamSchema({ s: { type: "string", maxLength: 3 } }, { s: "toolong" }).ok, false);
});

test("happy path with several fields", () => {
  const schema = {
    species_id: { type: "string", required: true },
    world: { type: "string" },
    count: { type: "number", min: 1, max: 10 },
  };
  assert.equal(validateParamSchema(schema, { species_id: "wolf", world: "tunya", count: 3 }).ok, true);
});
