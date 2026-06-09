/**
 * Phase 1 contract tests — the code lens `lsp-*` macros now proxy a REAL
 * TypeScript LanguageService (type-aware + scope-correct), with the lexical
 * heuristics as a graceful fallback when no cursor position is supplied.
 *
 * These assert the SEMANTIC behavior the old regex path could not produce:
 *   - completions after `obj.` return only obj's real members (not every token)
 *   - hover shows inferred types
 *   - find-references is scope-correct (distinguishes two same-named bindings)
 *   - diagnostics surface a real type error
 *   - outline is nesting-aware
 * Plus: the symbol-only (no-position) path still works (lexical fallback).
 *
 * Run: node --test server/tests/code-lsp-semantic.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerCodeActions from "../domains/code.js";
import tsLang from "../lib/ts-language-service.js";

const ACTIONS = new Map();
before(() => {
  globalThis._concordSTATE = globalThis._concordSTATE || {};
  delete globalThis._concordSTATE.codeWorkspace;
  registerCodeActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
});

const ctx = { userId: "u_lsp", actor: { userId: "u_lsp" } };
function run(name, params) {
  const fn = ACTIONS.get(`code.${name}`);
  if (!fn) throw new Error(`code.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const PROJ = "p_lsp";
const FILE = "src/main.ts";
const SRC = [
  "interface User { name: string; age: number }",      // 1
  "function greet(p: User): string { return p.name }", // 2
  "const u: User = { name: 'x', age: 1 };",            // 3
  "u.;",                                                // 4  (cursor after u.)
  "const bad: number = 'oops';",                       // 5  (type error)
  "function outer() { const x = 1; return x; }",       // 6
  "function inner() { const x = 2; return x; }",       // 7
].join("\n");

function seedFile() {
  // projects-create then files-write puts the file in the in-memory workspace.
  const proj = run("projects-create", { name: "lsp" });
  const pid = proj.result?.project?.id || PROJ;
  run("files-write", { projectId: pid, path: FILE, content: SRC });
  return pid;
}

describe("TS LanguageService availability", () => {
  it("typescript is present (Phase 1 requires it)", () => {
    assert.equal(tsLang.tsAvailable("x.ts"), true);
  });
});

describe("code.lsp-completions — type-aware", () => {
  it("after `u.` returns only User's real members (name, age), not arbitrary tokens", () => {
    const pid = seedFile();
    // column after "u." on line 4 → column 3
    const r = run("lsp-completions", { projectId: pid, path: FILE, position: { line: 4, column: 3 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "typescript");
    const labels = r.result.completions.map((c) => c.label);
    assert.ok(labels.includes("name") && labels.includes("age"), "has the real members");
    // The lexical path would have leaked unrelated identifiers like 'greet'/'bad'.
    assert.ok(!labels.includes("greet"), "does NOT leak non-members");
  });

  it("falls back to the lexical scan when no position is given", () => {
    const pid = seedFile();
    const r = run("lsp-completions", { projectId: pid, path: FILE, prefix: "gr" });
    assert.equal(r.ok, true);
    assert.notEqual(r.result.source, "typescript");
    assert.ok(r.result.completions.some((c) => c.label === "greet"));
  });
});

describe("code.lsp-hover — inferred types", () => {
  it("hover on `greet` shows the inferred function type", () => {
    const pid = seedFile();
    const r = run("lsp-hover", { projectId: pid, path: FILE, position: { line: 2, column: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "typescript");
    assert.match(r.result.hover, /greet/);
    assert.match(r.result.hover, /User/);
    assert.match(r.result.hover, /string/);
  });
});

describe("code.find-references — scope-correct", () => {
  it("references to `x` in outer() do NOT include `x` in inner()", () => {
    const pid = seedFile();
    // 'x' declared on line 6 (outer). column of the `x` in `const x = 1`.
    const col = SRC.split("\n")[5].indexOf("x") + 1;
    const r = run("find-references", { projectId: pid, path: FILE, position: { line: 6, column: col } });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "typescript");
    const lines = r.result.references.map((ref) => ref.line).sort();
    assert.deepEqual([...new Set(lines)], [6], "only the outer() x — scope-correct, not the inner() x on line 7");
  });
});

describe("code.diagnostics — real type errors", () => {
  it("surfaces the string→number assignment error", () => {
    const pid = seedFile();
    const r = run("diagnostics", { projectId: pid, path: FILE });
    assert.equal(r.ok, true);
    const err = r.result.problems.find((p) => /not assignable/.test(p.message));
    assert.ok(err, "caught the type mismatch");
    assert.equal(err.severity, "error");
    assert.equal(err.line, 5);
  });
});

describe("code.symbols-outline — nesting-aware navigation tree", () => {
  it("lists the real top-level symbols via the TS nav tree", () => {
    const pid = seedFile();
    const r = run("symbols-outline", { projectId: pid, path: FILE });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "typescript");
    const names = r.result.symbols.map((s) => s.name);
    assert.ok(names.includes("User") && names.includes("greet"), "real symbols present");
  });
});
