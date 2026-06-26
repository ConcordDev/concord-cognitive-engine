// Contract test for the verified semantic sandwich pipeline.
//
// All LLM touchpoints are mocked so the test is fully deterministic (no brains).
// Pins:
//   - parseIntent: mock llmFn returning a fixed {domain,name,input}; schema
//     validation rejects bad args; honest parse_failed on invalid output
//   - routeToPlan: deterministic intent → macro_dag plan + no_route honesty
//   - formatResult: the numeric/entity fact guard catches an invented number
//     and falls back to the deterministic template (verified:false)
//   - sandwich.run end-to-end: SAME query → SAME deterministic DAG result every
//     run; a real macro round-trips; honest no_route / parse_failed surfaces

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseIntent } from "../lib/sandwich/parse-gate.js";
import { routeToPlan } from "../lib/sandwich/router.js";
import { formatResult, factGuard, templateFormat } from "../lib/sandwich/format-gate.js";
import registerSandwichMacros, { DEFAULT_CANDIDATES } from "../domains/sandwich.js";

// ── helpers ──────────────────────────────────────────────────────────────

// A mock parse-LLM that always returns a fixed structured-output document.
function fixedParseLlm(doc) {
  return async () => ({ ok: true, text: JSON.stringify(doc) });
}

// A mock format-LLM that echoes a chosen prose string.
function fixedFormatLlm(prose) {
  return async () => ({ ok: true, text: prose });
}

const CANDIDATES = [
  {
    domain: "math",
    name: "symbolicCompute",
    description: "CAS",
    paramSchema: {
      operation: { type: "string", required: true, enum: ["simplify", "derivative", "integral"] },
      expression: { type: "string", required: true },
      variable: { type: "string" },
      simplify: { type: "boolean" },
    },
  },
];

// A tiny local macro registry so we can register + invoke sandwich.run without
// booting the server. Mirrors register(domain,name,fn,spec) + a dispatcher.
function makeRegistry() {
  const map = new Map();
  const register = (domain, name, fn) => map.set(`${domain}.${name}`, fn);
  const runMacro = async (domain, name, input, ctx) => {
    const fn = map.get(`${domain}.${name}`);
    if (!fn) return { ok: false, error: "macro_not_found" };
    return fn(ctx, input);
  };
  return { register, runMacro, map };
}

// ── parse gate ─────────────────────────────────────────────────────────────

test("parseIntent: mock llmFn → validated {domain,name,input}", async () => {
  const llmFn = fixedParseLlm({
    steps: [{ macro: "math.symbolicCompute", input: { operation: "derivative", expression: "x^2" } }],
  });
  const r = await parseIntent("differentiate x^2", { candidates: CANDIDATES, llmFn });
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps[0], {
    domain: "math",
    name: "symbolicCompute",
    input: { operation: "derivative", expression: "x^2" },
  });
});

test("parseIntent: schema-invalid args fail honestly after one retry", async () => {
  // operation enum violated + expression missing → schema_violation both attempts.
  const llmFn = fixedParseLlm({
    steps: [{ macro: "math.symbolicCompute", input: { operation: "bogus" } }],
  });
  const r = await parseIntent("do something", { candidates: CANDIDATES, llmFn });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "parse_failed");
});

test("parseIntent: hallucinated macro outside catalog is rejected", async () => {
  const llmFn = fixedParseLlm({
    steps: [{ macro: "evil.exfiltrate", input: {} }],
  });
  const r = await parseIntent("hack the db", { candidates: CANDIDATES, llmFn });
  assert.equal(r.ok, false);
});

test("parseIntent: empty query → honest empty_query", async () => {
  const r = await parseIntent("   ", { candidates: CANDIDATES, llmFn: fixedParseLlm({}) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty_query");
});

// ── router ───────────────────────────────────────────────────────────────

test("routeToPlan: single intent → passthrough plan", () => {
  const parsed = { ok: true, steps: [{ domain: "math", name: "symbolicCompute", input: { operation: "simplify", expression: "x+x" } }] };
  const r = routeToPlan(parsed);
  assert.equal(r.ok, true);
  assert.equal(r.plan.steps.length, 1);
  assert.equal(r.plan.steps[0].macro, "math.symbolicCompute");
  assert.equal(r.ruleId, null);
});

test("routeToPlan: derivative+simplify hint → chained 2-step plan with threading", () => {
  const parsed = {
    ok: true,
    steps: [{ domain: "math", name: "symbolicCompute", input: { operation: "derivative", expression: "x^3", simplify: true } }],
  };
  const r = routeToPlan(parsed);
  assert.equal(r.ok, true);
  assert.equal(r.ruleId, "cas_derivative_then_simplify");
  assert.equal(r.plan.steps.length, 2);
  // step 2 threads step 1's derivative output.
  assert.match(r.plan.steps[1].input.expression, /\$\{steps\.deriv\.result\.derivative\}/);
});

test("routeToPlan: empty intent → honest no_route", () => {
  assert.equal(routeToPlan({ ok: true, steps: [] }).reason, "no_route");
  assert.equal(routeToPlan({ ok: false }).reason, "no_route");
});

// ── format gate: the verified-not-trusted core ─────────────────────────────

test("factGuard: passes when every number/entity traces to the data", () => {
  const data = { derivative: "2*x", value: 42, id: "dtu-abc" };
  const g = factGuard("The derivative is 2*x with value 42 (dtu-abc).", data);
  assert.equal(g.ok, true);
});

test("factGuard: flags an invented number", () => {
  const data = { value: 42 };
  const g = factGuard("The value is 99.", data);
  assert.equal(g.ok, false);
  assert.ok(g.invented.some((i) => i.kind === "number" && i.value === "99"));
});

test("formatResult: invented number → falls back to template, verified:false", async () => {
  const resultData = { operation: "derivative", derivative: "2*x" };
  // Mock formatter injects a fabricated number not present in the data.
  const llmFn = fixedFormatLlm("The derivative is 2*x and the magic constant is 7777.");
  const r = await formatResult(resultData, { llmFn, db: null });
  assert.equal(r.verified, false);
  assert.equal(r.usedTemplate, true);
  assert.equal(r.verdict, "formatter_added_facts");
  // The template path must contain the real field.
  assert.match(r.prose, /2\*x/);
});

test("formatResult: faithful prose passes the guard, verified:true", async () => {
  const resultData = { derivative: "2*x" };
  const llmFn = fixedFormatLlm("The derivative is 2*x.");
  const r = await formatResult(resultData, { llmFn, db: null });
  assert.equal(r.verified, true);
  assert.equal(r.usedTemplate, false);
});

test("formatResult: useLlm:false uses the deterministic template (honest default)", async () => {
  const r = await formatResult({ a: 1, b: "x" }, { useLlm: false });
  assert.equal(r.usedTemplate, true);
  assert.equal(r.verified, true);
});

test("templateFormat: stringifies key fields deterministically", () => {
  const out = templateFormat({ derivative: "2*x", definite: 9 });
  assert.match(out, /derivative: 2\*x/);
  assert.match(out, /definite: 9/);
});

// ── end-to-end sandwich.run ────────────────────────────────────────────────

test("sandwich.run: deterministic — SAME query → SAME DAG result every run", async () => {
  const { register, runMacro, map } = makeRegistry();
  // A deterministic stand-in CAS macro.
  map.set("math.symbolicCompute", async (_ctx, input) => {
    if (input.operation === "derivative") return { ok: true, result: { operation: "derivative", derivative: "2*x", input: input.expression } };
    return { ok: true, result: { operation: input.operation, output: input.expression } };
  });

  registerSandwichMacros(register, {
    runMacro,
    candidates: CANDIDATES,
    parseLlmFn: fixedParseLlm({
      steps: [{ macro: "math.symbolicCompute", input: { operation: "derivative", expression: "x^2" } }],
    }),
    // Pure-structured: skip the format LLM (template path) for determinism.
  });

  const sandwich = map.get("sandwich.run");
  const ctx = { db: null, actor: { userId: "u1" } };
  const a = await sandwich(ctx, { query: "differentiate x^2", useLlm: false });
  const b = await sandwich(ctx, { query: "differentiate x^2", useLlm: false });

  assert.equal(a.ok, true);
  assert.deepEqual(a.result, b.result); // reproducible deterministic middle
  assert.equal(a.result.derivative, "2*x");
  assert.equal(a.verified, true);
  assert.equal(a.usedTemplate, true);
});

test("sandwich.run: a real macro round-trips through parse→route→dag→format", async () => {
  const { register, runMacro, map } = makeRegistry();
  map.set("math.symbolicCompute", async (_ctx, input) => ({ ok: true, result: { operation: input.operation, output: input.expression === "x+x" ? "2*x" : input.expression } }));

  registerSandwichMacros(register, {
    runMacro,
    candidates: CANDIDATES,
    parseLlmFn: fixedParseLlm({
      steps: [{ macro: "math.symbolicCompute", input: { operation: "simplify", expression: "x+x" } }],
    }),
    formatLlmFn: fixedFormatLlm("The simplified form is 2*x."),
  });

  const r = await map.get("sandwich.run")({ db: null }, { query: "simplify x+x" });
  assert.equal(r.ok, true);
  assert.equal(r.result.output, "2*x");
  assert.equal(r.verified, true); // prose "2*x" traces to data
  assert.match(r.prose, /2\*x/);
});

test("sandwich.run: parse_failed surfaces honestly", async () => {
  const { register, runMacro, map } = makeRegistry();
  registerSandwichMacros(register, {
    runMacro,
    candidates: CANDIDATES,
    // returns malformed JSON → parse gate fails twice
    parseLlmFn: async () => ({ ok: true, text: "not json at all" }),
  });
  const r = await map.get("sandwich.run")({}, { query: "anything" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "parse_failed");
  assert.equal(r.stage, "parse");
});

test("sandwich.run: a single valid intent passthrough-routes and executes", async () => {
  const { register, runMacro, map } = makeRegistry();
  map.set("math.symbolicCompute", async (_ctx, input) => ({ ok: true, result: { operation: input.operation, output: input.expression } }));
  registerSandwichMacros(register, {
    runMacro,
    candidates: CANDIDATES,
    parseLlmFn: fixedParseLlm({
      steps: [{ macro: "math.symbolicCompute", input: { operation: "simplify", expression: "x" } }],
    }),
  });
  const r = await map.get("sandwich.run")({ db: null }, { query: "simplify x", useLlm: false });
  assert.equal(r.ok, true); // passthrough routes + executes a single valid intent
  assert.equal(r.ruleId, null); // passthrough, not a chain rule
  assert.equal(r.result.output, "x");
});

test("routeToPlan: no_route is honest and reachable (no silent mis-pick)", () => {
  // Direct router assertion — the gate returns no_route rather than guessing.
  const r = routeToPlan({ ok: true, steps: [{ domain: "", name: "", input: {} }] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_route");
});

test("sandwich.run: empty query → honest empty_query", async () => {
  const { register, runMacro, map } = makeRegistry();
  registerSandwichMacros(register, { runMacro, candidates: CANDIDATES });
  const r = await map.get("sandwich.run")({}, { query: "" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty_query");
});

test("DEFAULT_CANDIDATES are well-formed (domain/name/paramSchema)", () => {
  for (const c of DEFAULT_CANDIDATES) {
    assert.equal(typeof c.domain, "string");
    assert.equal(typeof c.name, "string");
    assert.equal(typeof c.paramSchema, "object");
  }
});
