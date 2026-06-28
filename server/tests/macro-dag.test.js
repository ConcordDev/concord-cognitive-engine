// Missing-coverage contract test for server/lib/macro-dag.js
//
// Pins the deterministic DAG executor that the verified-sandwich pipeline
// stands on:
//   - validateDag: detects missing ids, bad macro shape, unknown deps, cycles
//   - runDag: executes in topological order, threads ${steps.X.result.field}
//             between steps, halts on error per failOnError/haltOnError flags
//   - describeDag: read-only edge/order report
//
// Uses a fake runMacro (no server, no brains) so it is fully deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runDag, validateDag, describeDag } from "../lib/macro-dag.js";

// A fake dispatcher that records call order and returns predictable shapes.
function makeFakeRunMacro(behaviors = {}) {
  const calls = [];
  const runMacro = async (domain, name, input, _ctx) => {
    calls.push({ macro: `${domain}.${name}`, input });
    const key = `${domain}.${name}`;
    if (typeof behaviors[key] === "function") return behaviors[key](input);
    return { ok: true, result: { echo: input } };
  };
  return { runMacro, calls };
}

test("validateDag: rejects missing id, bad macro shape, unknown dep, cycle", () => {
  assert.equal(validateDag(null).ok, false);
  assert.equal(validateDag({ steps: "nope" }).ok, false);

  const noId = validateDag({ steps: [{ macro: "a.b" }] });
  assert.equal(noId.ok, false);
  assert.ok(noId.errors.some((e) => e.includes("missing id")));

  const badMacro = validateDag({ steps: [{ id: "x", macro: "noseparator" }] });
  assert.equal(badMacro.ok, false);

  const unknownDep = validateDag({ steps: [{ id: "x", macro: "a.b", dependsOn: ["ghost"] }] });
  assert.equal(unknownDep.ok, false);
  assert.ok(unknownDep.errors.some((e) => e.includes("unknown step")));

  const cycle = validateDag({
    steps: [
      { id: "a", macro: "x.y", dependsOn: ["b"] },
      { id: "b", macro: "x.y", dependsOn: ["a"] },
    ],
  });
  assert.equal(cycle.ok, false);
  assert.ok(cycle.errors.some((e) => e.includes("cycle")));
});

test("validateDag: accepts a valid plan and returns a topological order", () => {
  const v = validateDag({
    steps: [
      { id: "second", macro: "x.y", dependsOn: ["first"] },
      { id: "first", macro: "x.y" },
    ],
  });
  assert.equal(v.ok, true);
  // 'first' has no deps so it must come before 'second'.
  assert.ok(v.order.indexOf("first") < v.order.indexOf("second"));
});

test("runDag: executes steps in topological order", async () => {
  const { runMacro, calls } = makeFakeRunMacro();
  const plan = {
    steps: [
      { id: "c", macro: "d.c", dependsOn: ["b"] },
      { id: "b", macro: "d.b", dependsOn: ["a"] },
      { id: "a", macro: "d.a" },
    ],
  };
  const out = await runDag(plan, {}, runMacro);
  assert.equal(out.ok, true);
  assert.deepEqual(
    calls.map((c) => c.macro),
    ["d.a", "d.b", "d.c"],
  );
});

test("runDag: threads ${steps.X.result.field} into a successor's input", async () => {
  const { runMacro, calls } = makeFakeRunMacro({
    "math.deriv": () => ({ ok: true, result: { derivative: "2*x" } }),
  });
  const plan = {
    steps: [
      { id: "deriv", macro: "math.deriv", input: { expr: "x^2" } },
      {
        id: "simplify",
        macro: "math.simplify",
        input: { expression: "${steps.deriv.result.derivative}" },
        dependsOn: ["deriv"],
      },
    ],
  };
  const out = await runDag(plan, {}, runMacro);
  assert.equal(out.ok, true);
  // The second step must have received the threaded derivative string.
  const simplifyCall = calls.find((c) => c.macro === "math.simplify");
  assert.equal(simplifyCall.input.expression, "2*x");
});

test("runDag: same plan + deterministic macros → identical results every run", async () => {
  const plan = {
    steps: [
      { id: "deriv", macro: "math.deriv", input: { expr: "x^2" } },
      {
        id: "simplify",
        macro: "math.simplify",
        input: { expression: "${steps.deriv.result.derivative}" },
        dependsOn: ["deriv"],
      },
    ],
  };
  const behaviors = {
    "math.deriv": () => ({ ok: true, result: { derivative: "2*x" } }),
    "math.simplify": (input) => ({ ok: true, result: { simplified: input.expression } }),
  };
  const a = await runDag(plan, {}, makeFakeRunMacro(behaviors).runMacro);
  const b = await runDag(plan, {}, makeFakeRunMacro(behaviors).runMacro);
  assert.deepEqual(a.results, b.results);
});

test("runDag: halts on error by default and surfaces the failing step", async () => {
  const { runMacro, calls } = makeFakeRunMacro({
    "d.boom": () => ({ ok: false, error: "kaboom" }),
  });
  const plan = {
    steps: [
      { id: "first", macro: "d.boom" },
      { id: "second", macro: "d.ok", dependsOn: ["first"] },
    ],
  };
  const out = await runDag(plan, {}, runMacro);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("first") && e.includes("ok:false")));
  // 'second' must not have run (halt-on-error default).
  assert.equal(calls.find((c) => c.macro === "d.ok"), undefined);
});

test("runDag: failOnError:false lets the DAG continue past an ok:false step", async () => {
  const { runMacro, calls } = makeFakeRunMacro({
    "d.softfail": () => ({ ok: false, error: "ignored" }),
  });
  const plan = {
    steps: [
      { id: "first", macro: "d.softfail", failOnError: false },
      { id: "second", macro: "d.ok", dependsOn: ["first"] },
    ],
  };
  const out = await runDag(plan, {}, runMacro);
  assert.equal(out.ok, true);
  assert.ok(calls.find((c) => c.macro === "d.ok"));
});

test("runDag: a thrown macro is captured, not propagated, and halts the DAG", async () => {
  const { runMacro, calls } = makeFakeRunMacro({
    "d.throws": () => {
      throw new Error("explode");
    },
  });
  const plan = {
    steps: [
      { id: "first", macro: "d.throws" },
      { id: "second", macro: "d.ok", dependsOn: ["first"] },
    ],
  };
  const out = await runDag(plan, {}, runMacro);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("threw")));
  assert.equal(calls.find((c) => c.macro === "d.ok"), undefined);
});

test("runDag: requires a runMacro injection", async () => {
  const out = await runDag({ steps: [{ id: "a", macro: "x.y" }] }, {}, null);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("runMacro injection")));
});

test("describeDag: returns ordered steps + dependency edges", () => {
  const d = describeDag({
    steps: [
      { id: "b", macro: "x.y", dependsOn: ["a"] },
      { id: "a", macro: "x.z" },
    ],
  });
  assert.equal(d.ok, true);
  assert.equal(d.stepCount, 2);
  assert.deepEqual(d.edges, [{ from: "a", to: "b" }]);
});
