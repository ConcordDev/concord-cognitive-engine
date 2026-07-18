// server/tests/code-ast-complexity.test.js
//
// Contract tests for server/lib/code-ast-complexity.js — the real
// TypeScript-compiler AST walker that replaced the `repos` lens's regex
// decision-point heuristic (docs/WAVE4_INVENTORY.md: "codeComplexity's
// heuristic is a regex count, not a real AST parse").
//
// Every expected number below is hand-derived from the STANDARD cyclomatic-
// complexity formula (McCabe: complexity = 1 + decision points) using the
// same decision-point node set ESLint's `complexity` rule uses (IfStatement,
// non-default SwitchCase, CatchClause, for/for-in/for-of/while/do loops,
// ConditionalExpression, and each individual `&&`/`||` operator) — verified
// by hand-tracing each snippet's AST below the assertion, not pasted from
// running the code under test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeSourceComplexity, astEngineAvailable } from "../lib/code-ast-complexity.js";

describe("code-ast-complexity — engine availability", () => {
  it("the typescript compiler package is loadable (hard server dependency)", () => {
    assert.equal(astEngineAvailable(), true);
  });
});

describe("code-ast-complexity — per-function boundary detection", () => {
  it("a file with 3 real functions (declaration / for-of / arrow) reports 3 separate function records, not 1 whole-file blob", () => {
    const src = `
function checkAll(a, b, c, items) {
  let total = 0;
  if (a) { total += 1; }
  if (b) { total += 2; }
  if (c) { total += 3; }
  for (let i = 0; i < items.length; i++) {
    total += items[i];
  }
  return total;
}

function evaluate(x, y) {
  if (x > 0) {
    if (y > 0 && x > y) {
      return x;
    }
  }
  return x > y ? x : y;
}

const double = (n) => n * 2;
`;
    const mod = analyzeSourceComplexity("sample.js", src);
    assert.ok(mod, "AST engine should be available in this environment");
    assert.equal(mod.functions.length, 3, "expected exactly 3 function-level records — no module-level blob because there's no top-level decision code");

    const byName = Object.fromEntries(mod.functions.map((f) => [f.name, f]));
    assert.ok(byName.checkAll, "checkAll should be its own record");
    assert.ok(byName.evaluate, "evaluate should be its own record");
    assert.ok(byName.double, "double (arrow fn bound via const) should be its own record");

    // ── checkAll: 3 sibling if-statements + 1 for-loop, none nested inside
    // each other (all direct children of the function body block).
    // Decision points = 3 (if) + 1 (for) = 4  →  cyclomatic = 1 + 4 = 5.
    assert.equal(byName.checkAll.branches, 3, "checkAll: 3 if-statements");
    assert.equal(byName.checkAll.loops, 1, "checkAll: 1 for-loop");
    assert.equal(byName.checkAll.conditions, 0, "checkAll: no &&/||/ternary");
    assert.equal(byName.checkAll.nesting, 1, "checkAll: if/for are siblings, none nested inside another — max depth 1");
    assert.equal(1 + byName.checkAll.branches + byName.checkAll.loops + byName.checkAll.conditions, 5);

    // ── evaluate: outer `if (x>0)` (1 branch) wrapping an inner
    // `if (y>0 && x>y)` (1 branch + 1 condition for the `&&`), plus a
    // trailing ternary `x>y?x:y` (1 condition).
    // Decision points = 2 (if) + 0 (loops) + 2 (&&, ternary) = 4  →  cyclomatic = 5.
    assert.equal(byName.evaluate.branches, 2, "evaluate: 2 if-statements (outer + nested)");
    assert.equal(byName.evaluate.loops, 0);
    assert.equal(byName.evaluate.conditions, 2, "evaluate: 1 && + 1 ternary");
    assert.equal(byName.evaluate.nesting, 2, "evaluate: inner if is nested one level inside the outer if");
    assert.equal(1 + byName.evaluate.branches + byName.evaluate.loops + byName.evaluate.conditions, 5);

    // ── double: no decision points at all → cyclomatic = 1 (the floor).
    assert.equal(byName.double.branches, 0);
    assert.equal(byName.double.loops, 0);
    assert.equal(byName.double.conditions, 0);
    assert.equal(byName.double.nesting, 0);
    assert.equal(1 + byName.double.branches + byName.double.loops + byName.double.conditions, 1);
  });
});

describe("code-ast-complexity — real syntax, not a regex-count", () => {
  it("switch: only non-default CaseClauses count as branches", () => {
    const src = `
function classify(x) {
  switch (x) {
    case 1: return 'one';
    case 2: return 'two';
    default: return 'other';
  }
}
`;
    const mod = analyzeSourceComplexity("classify.js", src);
    const fn = mod.functions.find((f) => f.name === "classify");
    assert.ok(fn);
    // 2 non-default case clauses → branches = 2, default excluded (matches
    // ESLint's `complexity` rule semantics) → cyclomatic = 1 + 2 = 3.
    assert.equal(fn.branches, 2);
    assert.equal(1 + fn.branches + fn.loops + fn.conditions, 3);
  });

  it("try/catch: only the CatchClause counts as a branch, not the try block itself", () => {
    const src = `
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}
`;
    const mod = analyzeSourceComplexity("safe-parse.js", src);
    const fn = mod.functions.find((f) => f.name === "safeParse");
    assert.equal(fn.branches, 1, "1 catch clause");
    assert.equal(1 + fn.branches + fn.loops + fn.conditions, 2);
  });

  it("a comment or string literal containing 'if (' text is NOT counted — proves this is a real parse, not a regex match", () => {
    const src = `
// if (fakeCondition) this is just a comment, not code
function noop() {
  const s = "if (x) { do something }"; // string literal, not a real if
  return s;
}
`;
    const mod = analyzeSourceComplexity("noop.js", src);
    const fn = mod.functions.find((f) => f.name === "noop");
    assert.ok(fn, "noop should still be detected as a real function");
    assert.equal(fn.branches, 0, "the 'if (' inside the comment and the string literal must not be counted — a regex over raw text would have matched both");
    assert.equal(1 + fn.branches + fn.loops + fn.conditions, 1);
  });

  it("class method: MethodDeclaration is its own function boundary, named from its own identifier", () => {
    const src = `
class Foo {
  bar(x) {
    if (x) return 1;
    return 0;
  }
}
`;
    const mod = analyzeSourceComplexity("foo.js", src);
    const fn = mod.functions.find((f) => f.name === "bar");
    assert.ok(fn, "method bar() should be its own record");
    assert.equal(fn.branches, 1);
    assert.equal(1 + fn.branches + fn.loops + fn.conditions, 2);
  });

  it("TSX file with JSX + a ternary parses without error and counts the ternary as a condition", () => {
    const src = `
function Widget({ show }) {
  return show ? <div>Yes</div> : <div>No</div>;
}
`;
    const mod = analyzeSourceComplexity("widget.tsx", src);
    assert.ok(mod, "TSX should parse via ts.ScriptKind.TSX");
    const fn = mod.functions.find((f) => f.name === "Widget");
    assert.ok(fn);
    assert.equal(fn.conditions, 1, "the JSX ternary is a real ConditionalExpression");
    assert.equal(1 + fn.branches + fn.loops + fn.conditions, 2);
  });
});

describe("code-ast-complexity — top-level (module-scope) code is not silently dropped", () => {
  it("real top-level `if` outside any function is attributed to a synthetic <module> entry", () => {
    const src = `
const DEBUG = true;
if (DEBUG) {
  console.log('debug mode');
}
`;
    const mod = analyzeSourceComplexity("config.js", src);
    assert.equal(mod.functions.length, 1);
    assert.equal(mod.functions[0].name, "<module>");
    assert.equal(mod.functions[0].branches, 1);
    assert.equal(1 + mod.functions[0].branches + mod.functions[0].loops + mod.functions[0].conditions, 2);
  });

  it("a file with no decision points anywhere and no functions still reports one all-zero <module> record, never an empty result", () => {
    const mod = analyzeSourceComplexity("empty.js", "const x = 1;\nconst y = 2;\n");
    assert.equal(mod.functions.length, 1);
    assert.equal(mod.functions[0].name, "<module>");
    assert.equal(mod.functions[0].branches, 0);
    assert.equal(mod.functions[0].loops, 0);
    assert.equal(mod.functions[0].conditions, 0);
  });
});
