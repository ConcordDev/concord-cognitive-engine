/**
 * Wave-2 shared lens input schemas: compact rule DSL, form-friendly
 * coercion (numeric strings, blank = absent, epoch dates), and the
 * lensActionSpec fallback/merge in lens-action-dispatch.
 *
 * Run: NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/lens-input-schemas.test.js
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compileRule, compileSpec, lensInputSpec, lensInputSpecKeys } from "../lib/lens-input-schemas.js";
import { validateLensActionInput } from "../lib/macro-param-schema.js";
import { lensActionSpec, rememberLensActionSpec, invokeLensHandler } from "../lib/lens-action-dispatch.js";

const v = (compact, input) => validateLensActionInput(compileSpec(compact), input, {});

describe("compileRule", () => {
  test("enum / date / ranges", () => {
    assert.deepEqual(compileRule(["a", "b"]), { type: "enum", enum: ["a", "b"], blankOk: true });
    assert.equal(compileRule("date").type, "isoDate");
    assert.deepEqual(compileRule("num>=0"), { type: "number", numericString: true, blankOk: true, min: 0 });
    assert.deepEqual(compileRule("num:0..100"), { type: "number", numericString: true, blankOk: true, min: 0, max: 100 });
    assert.equal(compileRule("int>=1").type, "int");
    assert.equal(compileRule("num").min, undefined);
    assert.equal(compileRule("lat").min, -90);
    assert.throws(() => compileRule("number please"));
  });
});

describe("validation semantics", () => {
  test("negative / non-numeric / Infinity refused, naming the field", () => {
    assert.deepEqual(v({ qty: "num>=0" }, { qty: -5 }), { ok: false, error: "invalid_input", field: "qty", reason: "min_0" });
    assert.equal(v({ qty: "num>=0" }, { qty: "abc" }).field, "qty");
    assert.equal(v({ qty: "num>=0" }, { qty: "Infinity" }).reason, "expected_number");
  });
  test("form shapes accepted: numeric strings, blanks, absent, null", () => {
    for (const qty of [3, "3", " 2.5 ", "0", "", null, undefined]) assert.equal(v({ qty: "num>=0" }, { qty, name: "x" }), null, String(qty));
  });
  test("ranges", () => {
    assert.equal(v({ p: "num:0..100" }, { p: 101 }).reason, "max_100");
    assert.equal(v({ lat: "lat" }, { lat: -33.9 }), null);
    assert.equal(v({ lat: "lat" }, { lat: 91 }).field, "lat");
    assert.equal(v({ t: "num" }, { t: -5 }), null);
  });
  test("dates: ISO / datetime-local / epoch ok; nonsense refused", () => {
    for (const d of ["2026-10-27", "2026-10-27T14:30", "2026-10-27T14:30:00.000Z", Date.now(), ""]) assert.equal(v({ d: "date" }, { d }), null, String(d));
    assert.equal(v({ d: "date" }, { d: "whenever" }).field, "d");
    assert.equal(v({ d: "date" }, { d: "2026-02-30" }).field, "d");
  });
  test("enums: exact values only, blank allowed", () => {
    assert.equal(v({ k: ["a", "b"] }, { k: "a" }), null);
    assert.equal(v({ k: ["a", "b"] }, { k: "" }), null);
    assert.equal(v({ k: ["a", "b"] }, { k: "zz_bogus" }).reason, "unknown_enum");
  });
  test("$empty refuses {} and blank-only bodies", () => {
    assert.equal(v({ $empty: true }, {}).reason, "empty_create");
    assert.equal(v({ $empty: true, n: "num>=0" }, { title: "  " }).reason, "empty_create");
    assert.equal(v({ $empty: true }, { title: "ok" }), null);
  });
  test("str! requires a non-blank string", () => {
    assert.equal(v({ name: "str!" }, { name: "  " }).reason, "required");
    assert.equal(v({ name: "str!" }, {}).reason, "required");
    assert.equal(v({ name: "str!" }, { name: "Bob" }), null);
  });
});

describe("registry + dispatch", () => {
  test("every wave-2 entry compiles", () => {
    assert.ok(lensInputSpecKeys().length > 100);
  });
  test("observe monitorSave allows the UI's 'count' aggregation", () => {
    const s = lensInputSpec("observe", "monitorSave");
    assert.equal(validateLensActionInput(s, { metric: "m", agg: "count", threshold: -1 }, {}), null);
  });
  test("education courses-create refuses durationHours=Infinity", () => {
    const s = lensInputSpec("education", "courses-create");
    assert.equal(validateLensActionInput(s, { title: "c", durationHours: "Infinity" }, {}).field, "durationHours");
    assert.equal(validateLensActionInput(s, { title: "c", durationHours: "12" }, {}), null);
  });
  test("lensActionSpec falls back to the shared table and merges with registered specs", () => {
    assert.ok(lensActionSpec("realestate", "listings-add"));
    rememberLensActionSpec("accounting.item-create", { paramSchema: { name: { type: "string" } } });
    const merged = lensActionSpec("accounting", "item-create");
    assert.ok(merged.paramSchema.name && merged.paramSchema.reorderPoint);
  });
  test("invokeLensHandler returns invalid_input before the handler runs", async () => {
    let ran = false;
    const spec = lensActionSpec("realestate", "listings-add");
    const r = await invokeLensHandler(() => { ran = true; return { ok: true }; }, {}, null, { address: "1 A St", beds: -5 }, spec);
    assert.equal(ran, false);
    assert.equal(r.error, "invalid_input");
    assert.equal(r.field, "beds");
  });
});
