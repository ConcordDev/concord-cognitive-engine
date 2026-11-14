// FIX-import-005 leg (founder ruling, 2026-11-13) — field names are
// capped at 120 characters, the standing field-name limit. The base
// fix (muse-b11) named this leg as an unpriced product call: no limit
// existed anywhere in code and field names land as row keys. The
// ruling prices it at 120. Enforced server-side in the two actions
// that take field-name lists (mapFields source+target lists,
// detectDuplicates key fields); the FE refuses first with the same
// limit named.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerImportActions from "../domains/importdomain.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, data = {}) {
  const fn = ACTIONS.get(`import.${name}`);
  if (!fn) throw new Error(`import.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, {});
}

before(() => { registerImportActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const LONG = "f".repeat(121);
const AT_LIMIT = "f".repeat(120);

describe("import field-name limit (FIX-import-005 leg)", () => {
  it("mapFields refuses a target field name over 120 characters, naming the limit", () => {
    const r = call("mapFields", ctxA, { sourceFields: ["title"], targetFields: [LONG] });
    assert.equal(r.ok, false);
    assert.match(r.error, /120 characters/);
    assert.match(r.error, /121/);
  });

  it("mapFields refuses an over-limit SOURCE field name too", () => {
    const r = call("mapFields", ctxA, { sourceFields: [LONG], targetFields: ["title"] });
    assert.equal(r.ok, false);
    assert.match(r.error, /120 characters/);
  });

  it("mapFields accepts names at exactly 120 characters", () => {
    const r = call("mapFields", ctxA, { sourceFields: [AT_LIMIT], targetFields: [AT_LIMIT] });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.mappings));
  });

  it("detectDuplicates refuses an over-limit key field, naming the limit", () => {
    const r = call("detectDuplicates", ctxA, { rows: [{ a: 1 }, { a: 1 }], keyFields: [LONG] });
    assert.equal(r.ok, false);
    assert.match(r.error, /120 characters/);
  });

  it("detectDuplicates runs normally with ordinary key fields", () => {
    const r = call("detectDuplicates", ctxA, { rows: [{ a: 1 }, { a: 1 }, { a: 2 }], keyFields: ["a"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.duplicateGroupCount, 1);
    assert.equal(r.result.uniqueRows, 2);
  });
});
