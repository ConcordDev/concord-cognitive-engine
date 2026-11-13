import test from "node:test";
import assert from "node:assert/strict";
import { pickSchema, fillSchema, nativeTools } from "../../lib/cockpit/call-schema.js";

test("pickSchema enum ends with ask_user and done", () => {
  assert.deepEqual(pickSchema(["a", "b"]).properties.tool.enum, ["a", "b", "ask_user", "done"]);
});

test("fillSchema drops unsupported keys and keeps required", () => {
  const out = fillSchema({
    inputSchema: {
      type: "object", additionalProperties: false, required: ["q"],
      properties: { q: { type: "string", pattern: "^a" }, z: { oneOf: [{ type: "string" }, { type: "number" }] } },
    },
  });
  assert.deepEqual(out.required, ["q"]);
  assert.equal("pattern" in out.properties.q, false);
  assert.equal("oneOf" in out.properties.z, false);
  assert.equal(out.additionalProperties, false);
});

test("fillSchema drops min/max on non-integers only", () => {
  const out = fillSchema({ inputSchema: { type: "object", properties: { a: { type: "number", minimum: 0 }, b: { type: "integer", minimum: 1 } } } });
  assert.equal("minimum" in out.properties.a, false);
  assert.equal(out.properties.b.minimum, 1);
});

test("nativeTools makes safe names", () => {
  const menu = [{ id: "lens:physics.power", description: "d", inputSchema: { type: "object", additionalProperties: false, properties: {} } }];
  assert.equal(nativeTools(menu, "openai")[0].function.name, "lens_physics_power");
  assert.equal(nativeTools(menu, "openai")[0].function.strict, true);
  assert.equal(nativeTools(menu, "anthropic")[0].name, "lens_physics_power");
});
