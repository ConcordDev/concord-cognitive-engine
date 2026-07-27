// server/tests/invariant-expression-injection.test.js
//
// Pins the fix for the authenticated RCE in server/domains/invariant.js
// (found 2026-07-27 during the Aikido security triage).
//
// THE BUG: `validateExpressionAST` (acorn whitelist) ran against the ORIGINAL
// expression, but `new Function` compiled a DIFFERENT string — the result of a
// regex pass that substituted resolved state values into the expression text.
// The regex had no lexer, so it rewrote identifier-shaped tokens inside string
// literals, and string values were spliced in with `JSON.stringify`, which
// emits its own quotes. Replacing a token inside `"AAA"` produced
// `"" + <attacker text> + ""` — executable JS assembled from caller data.
//
// Confirmed PoC (this file's first test): expression `s === "AAA"` passes the
// AST whitelist (no CallExpression), and state
// `{ s: "2", AAA: "+(Function('...')())+" }` compiled to
// `"2" === ""+(Function('...')())+""`, executing the injected Function().
//
// THE FIX: free identifiers are bound as Function PARAMETERS and their values
// passed as arguments. The AST-validated string is compiled byte-identically,
// so caller data can never become code. If someone reintroduces a substitution
// pass, the first test here goes red.
//
// Run: node --test server/tests/invariant-expression-injection.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

// Canary the injected payload would flip if it ever executed again.
before(() => { globalThis.__INVARIANT_RCE_CANARY__ = false; });
after(() => { delete globalThis.__INVARIANT_RCE_CANARY__; });

const PAYLOAD = "+(Function('globalThis.__INVARIANT_RCE_CANARY__ = true; return 1')())+";

describe("invariant expression evaluator — code injection is closed", () => {
  it("the exact RCE PoC no longer executes attacker code (canary stays false)", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { s: "2", AAA: PAYLOAD },
        invariants: [{ name: "poc", expression: 's === "AAA"', severity: "critical" }],
      },
    });

    assert.equal(
      globalThis.__INVARIANT_RCE_CANARY__, false,
      "attacker-supplied Function() executed — the injection is NOT closed"
    );
    // The comparison itself must still evaluate honestly: the state value of
    // `s` is "2" and the literal is the string "AAA", so this is simply false.
    assert.equal(r.result?.results?.[0]?.error ?? null, null);
    assert.equal(r.result?.results?.[0]?.evaluatedValue, false);
  });

  it("a payload in a NON-string position also cannot execute", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { a: PAYLOAD, b: 1 },
        invariants: [{ name: "poc2", expression: "a === b", severity: "high" }],
      },
    });
    assert.equal(globalThis.__INVARIANT_RCE_CANARY__, false);
    assert.equal(r.result?.results?.[0]?.evaluatedValue, false);
  });

  it("safeEval-backed macros (registerMonitor path) reject calls at the AST layer", async () => {
    const r = await lensRun("invariant", "registerMonitor", {
      params: { name: "evil", expression: "eval(x)" },
    }, await depthCtx("invariant-injection"));
    assert.equal(r.result?.ok, false);
    assert.ok(String(r.result?.error || "").includes("unsafe_expression"));
  });
});

describe("invariant expression evaluator — legitimate semantics preserved", () => {
  it("scalar comparisons still evaluate correctly", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { balance: 5, count: 0 },
        invariants: [
          { name: "balance ok", expression: "balance >= 0", severity: "critical" },
          { name: "count positive", expression: "count > 0", severity: "low" },
        ],
      },
    });
    const byName = Object.fromEntries((r.result.results || []).map((x) => [x.name, x]));
    assert.equal(byName["balance ok"].evaluatedValue, true);
    assert.equal(byName["count positive"].evaluatedValue, false);
  });

  it("string equality against a literal still works", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { status: "ok" },
        invariants: [{ name: "status", expression: 'status === "ok"', severity: "low" }],
      },
    });
    assert.equal(r.result.results[0].evaluatedValue, true);
  });

  it("dotted member access resolves through the bound object", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { cfg: { limit: 10 } },
        invariants: [{ name: "limit", expression: "cfg.limit > 5", severity: "low" }],
      },
    });
    assert.equal(r.result.results[0].error, null);
    assert.equal(r.result.results[0].evaluatedValue, true);
  });

  it("legacy coercion preserved: a bare array collapses to its length", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { items: [1, 2, 3] },
        invariants: [{ name: "len", expression: "items === 3", severity: "low" }],
      },
    });
    assert.equal(r.result.results[0].evaluatedValue, true);
  });

  it("legacy coercion preserved: a bare plain object is truthy-as-true", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { obj: { a: 1 } },
        invariants: [{ name: "obj", expression: "obj === true", severity: "low" }],
      },
    });
    assert.equal(r.result.results[0].evaluatedValue, true);
  });

  it("an identifier used BOTH bare and as a member object stays the real object", async () => {
    // Regression guard on the coercion rule: coercing `cfg` to `true` here
    // would break `cfg.limit`.
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: { cfg: { limit: 10 } },
        invariants: [{ name: "both", expression: "cfg && cfg.limit > 5", severity: "low" }],
      },
    });
    assert.equal(r.result.results[0].error, null);
    assert.equal(r.result.results[0].evaluatedValue, true);
  });

  it("an unknown identifier resolves to undefined, not an error", async () => {
    const r = await lensRun("invariant", "invariantCheck", {
      data: {
        state: {},
        invariants: [{ name: "missing", expression: "nope === undefined", severity: "low" }],
      },
    });
    assert.equal(r.result.results[0].evaluatedValue, true);
  });
});
