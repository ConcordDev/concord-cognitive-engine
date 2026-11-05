// Full-build tests for the math lens (B8, build(math): full lens build).
// Pins the six slices from R2's first-pass review §7 as repriced by
// cross-check #28:
//   S3 — casIntegrate integration by parts (F2) + the honestly-scoped
//        no-closed-form error; fibonacci's two stated contracts (F3).
//   S4 — statisticalAnalysis discloses its conventions with the numbers
//        (F10): population σ vs sample s, modes, quartile rule.
//   S1 — the Notebook's persistence glue (F7/F8): the evaluator was never
//        broken; the panel's create payloads carried statuses the math
//        domain rule has never accepted ('verified'/'error'/'active'),
//        so every save died in validateArtifact. Pinned against the real
//        validator with the server's own merge semantics, plus the
//        registry bookkeeping (formula now listed as an FE-created type).
//   S2 — casHistory stores errored runs verbatim (the recorder half of
//        F4; the call-site half is pinned in the frontend tests).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMathActions from "../domains/math.js";
import { FRONTEND_ARTIFACT_TYPES, reconcileArtifactTypes } from "../lib/lens-artifact-types.js";
import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`math.${name}`);
  if (!fn) throw new Error(`math.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => {
  globalThis._concordSTATE = { mathCAS: new Map() };
  registerMathActions(register);
});

const ctxA = { actor: { userId: "math_build_user" }, userId: "math_build_user" };
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("S3 — symbolicCompute integral: integration by parts (F2)", () => {
  it("returns the elementary antiderivative for sin(x)*x^2 instead of a false no-closed-form claim", () => {
    const r = call("symbolicCompute", ctxA, { operation: "integral", expression: "sin(x)*x^2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.closedForm, true);
    // −x²·cos(x) + 2x·sin(x) + 2·cos(x), in the CAS's own string form
    assert.match(r.result.antiderivative, /cos\(x\)/);
    assert.match(r.result.antiderivative, /sin\(x\)/);
    assert.match(r.result.antiderivative, /x \^ 2/);
  });

  it("definite integral of sin(x)*x^2 over [0,1] is closed-form and exact", () => {
    const r = call("symbolicCompute", ctxA, { operation: "integral", expression: "sin(x)*x^2", lower: 0, upper: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.closedForm, true);
    // F(x) = −x²cos(x) + 2x·sin(x) + 2cos(x); F(1) − F(0) = cos(1) + 2·sin(1) − 2
    const expected = Math.cos(1) + 2 * Math.sin(1) - 2;
    assert.ok(approx(r.result.definite, expected, 1e-6), `definite ${r.result.definite} ≈ ${expected}`);
  });

  it("handles the factors in either order and a shifted polynomial", () => {
    const rev = call("symbolicCompute", ctxA, { operation: "integral", expression: "x^2*sin(x)", lower: 0, upper: 1 });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.closedForm, true);
    assert.ok(approx(rev.result.definite, Math.cos(1) + 2 * Math.sin(1) - 2, 1e-6));

    // ∫(x+1)·cos(x) dx = (x+1)·sin(x) + cos(x); F(1) − F(0) = 2·sin(1) + cos(1) − 1
    const shifted = call("symbolicCompute", ctxA, { operation: "integral", expression: "(x+1)*cos(x)", lower: 0, upper: 1 });
    assert.equal(shifted.ok, true);
    assert.equal(shifted.result.closedForm, true);
    assert.ok(approx(shifted.result.definite, 2 * Math.sin(1) + Math.cos(1) - 1, 1e-6));
  });

  it("handles polynomial × exp by parts", () => {
    // ∫x·e^x dx = (x−1)·e^x; F(1) − F(0) = 0 − (−1) = 1
    const r = call("symbolicCompute", ctxA, { operation: "integral", expression: "x*exp(x)", lower: 0, upper: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.closedForm, true);
    assert.ok(approx(r.result.definite, 1, 1e-6), `definite ${r.result.definite} ≈ 1`);
  });

  it("scopes the no-closed-form error to the engine's actual methods", () => {
    const r = call("symbolicCompute", ctxA, { operation: "integral", expression: "sin(x^2)" });
    assert.equal(r.ok, false);
    assert.match(r.error, /by this engine's methods/);
    assert.match(r.error, /integration by parts/);
  });
});

describe("S3 — numberTheory fibonacci contracts (F3)", () => {
  it("n returns the single term F(n) as value — F(10) = 55", () => {
    const r = call("numberTheory", ctxA, { tool: "fibonacci", n: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 55);
    assert.equal(r.result.n, 10);
    assert.match(r.result.semantics, /F\(0\)\.\.F\(count-1\)/);
  });

  it("count returns the first count terms F(0)..F(count-1)", () => {
    const r = call("numberTheory", ctxA, { tool: "fibonacci", count: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.sequence.length, 10);
    assert.equal(r.result.sequence[9], 34); // F(9) — the sequence form, labelled as such
    assert.equal(r.result.value, undefined);
  });

  it("n and count together return both halves, each labelled", () => {
    const r = call("numberTheory", ctxA, { tool: "fibonacci", n: 10, count: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.value, 55);
    assert.deepEqual(r.result.sequence, [0, 1, 1, 2, 3]);
  });
});

describe("S4 — statisticalAnalysis conventions disclosure (F10)", () => {
  it("generates the conventions with the numbers and exposes sample deviation + modes flat", () => {
    const artifact = { id: null, data: { values: [2, 4, 4, 4, 5, 5, 7, 9] }, meta: {} };
    const r = call("statisticalAnalysis", ctxA, artifact, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.stdDev, 2); // population σ for the classic dataset
    assert.ok(approx(r.result.sampleStdDev, 2.13809, 1e-5), `sampleStdDev ${r.result.sampleStdDev}`);
    assert.deepEqual(r.result.modes, [4]);
    assert.match(r.result.conventions, /POPULATION/);
    assert.match(r.result.conventions, /index-position/);
  });
});

describe("S1 — Notebook persistence glue (F7/F8)", () => {
  it("the evaluator itself computes the walk's fixture exactly (sin(pi/4) + sqrt(2) ≈ 2.1213)", () => {
    const r = call("naturalQuery", ctxA, { query: "sin(pi/4) + sqrt(2)" });
    assert.equal(r.ok, true);
    assert.ok(approx(Number(r.result.answer), Math.SQRT1_2 + Math.SQRT2, 1e-6), `answer ${r.result.answer}`);
  });

  it("the panel's create payloads validate under the server's effective math rule; the old ones did not", () => {
    // Replicates server.js's merge exactly: the extended rule for a domain
    // is used only when the base registry lacks the domain (math has a
    // base rule, so the extended one never applies), then the frontend
    // artifact types are reconciled in. The effective validStatuses are
    // therefore the base rule's: draft/conjecture/in-proof/proven/
    // published/archived.
    reconcileArtifactTypes(DOMAIN_RULES);
    const exprData = { expression: "sin(pi/4) + sqrt(2)", result: "2.12132034", verified: true, evaluatedAt: "2026-10-31T00:00:00.000Z" };
    assert.equal(validateArtifact("math", "expression", exprData, { status: "proven" }).ok, true);
    assert.equal(validateArtifact("math", "expression", exprData, { status: "draft" }).ok, true);
    assert.equal(validateArtifact("math", "formula", { name: "Pythagorean", latex: "a^2 + b^2 = c^2", description: "", category: "general" }, { status: "draft" }).ok, true);
    // The pre-build payloads — every Notebook save failed on these:
    assert.equal(validateArtifact("math", "expression", exprData, { status: "verified" }).ok, false);
    assert.equal(validateArtifact("math", "expression", exprData, { status: "error" }).ok, false);
    assert.equal(validateArtifact("math", "formula", { name: "x" }, { status: "active" }).ok, false);
  });

  it("formula is recorded in the frontend-created types registry", () => {
    assert.ok(FRONTEND_ARTIFACT_TYPES.math.includes("expression"));
    assert.ok(FRONTEND_ARTIFACT_TYPES.math.includes("formula"));
  });
});

describe("S2 — casHistory records errored runs (F4)", () => {
  it("an entry carrying an error round-trips through record/list and clear empties the record", () => {
    const rec = call("casHistory", ctxA, { action: "record", entry: { kind: "symbolic:integral", input: "sin(x^2)", error: "No closed-form antiderivative found by this engine's methods" } });
    assert.equal(rec.ok, true);
    const listed = call("casHistory", ctxA, { action: "list", limit: 50 });
    assert.equal(listed.ok, true);
    const entry = listed.result.history.find((e) => e.input === "sin(x^2)");
    assert.ok(entry, "errored run is present in history");
    assert.match(entry.error, /engine's methods/);
    const cleared = call("casHistory", ctxA, { action: "clear" });
    assert.equal(cleared.ok, true);
    const after = call("casHistory", ctxA, { action: "list", limit: 50 });
    assert.equal(after.result.history.length, 0);
  });
});
