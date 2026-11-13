import test from "node:test";
import assert from "node:assert/strict";
import { validateAgainstSchema } from "../../lib/cockpit/schema-validate.js";

const schema = {
  type: "object", additionalProperties: false, required: ["a"],
  properties: {
    a: { type: "string" },
    n: { type: "integer" },
    e: { type: "string", enum: ["x", "y"] },
    o: { type: "object", additionalProperties: false, required: ["k"], properties: { k: { type: "number" } } },
    l: { type: "array", items: { type: "string" } },
  },
};

test("valid value passes", () => {
  assert.equal(validateAgainstSchema(schema, { a: "s", n: 2, e: "x", o: { k: 1.5 }, l: ["q"] }).ok, true);
});
test("missing required", () => {
  assert.deepEqual(validateAgainstSchema(schema, {}).errors, [{ path: "a", code: "missing" }]);
});
test("wrong type", () => {
  assert.equal(validateAgainstSchema(schema, { a: 5 }).errors[0].code, "type");
});
test("enum reports allowed", () => {
  const e = validateAgainstSchema(schema, { a: "s", e: "z" }).errors[0];
  assert.equal(e.code, "enum");
  assert.deepEqual(e.allowed, ["x", "y"]);
});
test("extra key", () => {
  assert.deepEqual(validateAgainstSchema(schema, { a: "s", zzz: 1 }).errors, [{ path: "zzz", code: "extra" }]);
});
test("nested object path", () => {
  assert.deepEqual(validateAgainstSchema(schema, { a: "s", o: {} }).errors, [{ path: "o.k", code: "missing" }]);
});
test("array items", () => {
  const e = validateAgainstSchema(schema, { a: "s", l: ["ok", 3] }).errors[0];
  assert.equal(e.path, "l[1]");
  assert.equal(e.code, "type");
});
test("integer rejects 1.5", () => {
  assert.equal(validateAgainstSchema(schema, { a: "s", n: 1.5 }).ok, false);
  assert.equal(validateAgainstSchema(schema, { a: "s", n: 2 }).ok, true);
});
test("non-object schema is ok", () => {
  assert.deepEqual(validateAgainstSchema(null, 5), { ok: true, errors: [] });
  assert.deepEqual(validateAgainstSchema("x", {}), { ok: true, errors: [] });
});
