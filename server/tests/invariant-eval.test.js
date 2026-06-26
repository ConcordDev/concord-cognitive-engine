// server/tests/invariant-eval.test.js
//
// Unit tests for the shared SAFE invariant evaluator. The load-bearing
// guarantee is that evalInvariant NEVER throws — every error path resolves to a
// structured { ok:false, reason } object. The runner and the future runtime
// wrapper both lean on that.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evalInvariant,
  compileInvariant,
  _clearInvariantCache,
} from "../lib/invariant-eval.js";

describe("invariant-eval", () => {
  it("evaluates a true invariant over output", () => {
    const r = evalInvariant("output.ok === true", {}, { ok: true });
    assert.equal(r.ok, true);
    assert.equal(r.value, true);
    assert.equal(r.reason, null);
  });

  it("evaluates a false invariant as a failure (not a throw)", () => {
    const r = evalInvariant("output.ok === true", {}, { ok: false });
    assert.equal(r.ok, false);
    assert.equal(r.value, false);
    assert.equal(r.reason, "invariant_false");
  });

  it("can reference both input and output", () => {
    const pass = evalInvariant("output.count <= input.limit", { limit: 10 }, { count: 5 });
    assert.equal(pass.ok, true);
    const fail = evalInvariant("output.count <= input.limit", { limit: 3 }, { count: 5 });
    assert.equal(fail.ok, false);
    assert.equal(fail.reason, "invariant_false");
  });

  it("does NOT throw on a missing field — undefined comparison is a clean failure", () => {
    const r = evalInvariant("output.nope.deep === 1", {}, { ok: true });
    assert.equal(r.ok, false);
    assert.match(r.reason, /^eval_throw:/);
  });

  it("does NOT throw on a syntactically invalid expression", () => {
    const r = evalInvariant("output.ok ===", {}, { ok: true });
    assert.equal(r.ok, false);
    assert.match(r.reason, /^compile_error:/);
  });

  it("rejects a non-string / empty expression without throwing", () => {
    for (const bad of [null, undefined, "", "   ", 42, {}]) {
      const r = evalInvariant(bad, {}, {});
      assert.equal(r.ok, false);
      assert.equal(r.value, false);
      assert.ok(typeof r.reason === "string" && r.reason.length > 0);
    }
  });

  it("treats a falsy non-boolean result as failure and truthy as success", () => {
    assert.equal(evalInvariant("0", {}, {}).ok, false);
    assert.equal(evalInvariant("''", {}, {}).ok, false);
    assert.equal(evalInvariant("undefined", {}, {}).ok, false);
    assert.equal(evalInvariant("1", {}, {}).ok, true);
    assert.equal(evalInvariant("'x'", {}, {}).ok, true);
  });

  it("caches compilation — same expression compiles once", () => {
    _clearInvariantCache();
    const first = compileInvariant("output.ok === true");
    const second = compileInvariant("output.ok === true");
    assert.strictEqual(first.fn, second.fn, "expected the cached compiled fn to be reused");
  });

  it("compiled invariant cannot reach implicit globals (strict mode body)", () => {
    // In strict mode an assignment to an undeclared identifier throws — proving
    // the body runs strict. We surface it as a clean eval_throw, never a crash.
    const r = evalInvariant("(undeclaredGlobalLeak = 1), true", {}, {});
    assert.equal(r.ok, false);
    assert.match(r.reason, /^eval_throw:/);
  });
});
