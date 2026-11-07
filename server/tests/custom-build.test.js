// Build tests for the Custom lens build (B2) — S4: evaluateSchema counts
// and names unnamed fields instead of dropping them silently (or passing
// them on a truthy object name). Mirrors the parity harness.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCustomActions from "../domains/custom.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`custom.${name}`);
  if (!fn) throw new Error(`custom.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerCustomActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("custom build — S4 unnamed schema fields are named, not dropped", () => {
  it("an unnamed third field is counted, invalid, and named in issues", () => {
    const r = call("evaluateSchema", ctxA, {
      data: {
        schema: [
          { name: "title", type: "string", required: true },
          { name: "count", type: "number" },
          { name: "", type: "string" },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFields, 3);
    assert.equal(r.result.validFields, 2);
    assert.equal(r.result.schemaValid, false);
    assert.deepEqual(r.result.issues, ["field 3 has no name"]);
    assert.equal(r.result.fields[2].valid, false);
    assert.equal(r.result.fields[2].name, "");
  });

  it("a field object with no name key at all is equally named", () => {
    const r = call("evaluateSchema", ctxA, {
      data: { schema: [{ type: "string" }] },
    }, {});
    assert.equal(r.result.totalFields, 1);
    assert.equal(r.result.validFields, 0);
    assert.deepEqual(r.result.issues, ["field 1 has no name"]);
  });

  it("named fields are untouched: counts, validity, and no issues", () => {
    const r = call("evaluateSchema", ctxA, {
      data: {
        schema: [
          { name: "title", type: "string", required: true },
          { name: "count", type: "number" },
        ],
      },
    }, {});
    assert.equal(r.result.totalFields, 2);
    assert.equal(r.result.validFields, 2);
    assert.equal(r.result.requiredCount, 1);
    assert.equal(r.result.schemaValid, true);
    assert.deepEqual(r.result.issues, []);
  });

  it("object-shaped schemas still normalize with their keys as names", () => {
    const r = call("evaluateSchema", ctxA, {
      data: { schema: { title: "string", count: "number" } },
    }, {});
    assert.equal(r.result.totalFields, 2);
    assert.equal(r.result.schemaValid, true);
    assert.deepEqual(r.result.fields.map((f) => f.name), ["title", "count"]);
  });

  it("whitespace-only names count as unnamed; padded names trim", () => {
    const r = call("evaluateSchema", ctxA, {
      data: { schema: [{ name: "  title  ", type: "string" }, { name: "   ", type: "string" }] },
    }, {});
    assert.equal(r.result.fields[0].name, "title");
    assert.equal(r.result.fields[0].valid, true);
    assert.deepEqual(r.result.issues, ["field 2 has no name"]);
  });
});
