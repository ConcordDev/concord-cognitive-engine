// Repos F6 — the Analysis tab's handler error, diagnosed and pinned.
//
// Diagnosis (B5, 2026-11-01): server/package.json declares
// typescript ^7.0.2. TypeScript v7's package root resolves to a
// version-only module ({ version, versionMajorMinor }) — the classic
// compiler API (createSourceFile / ScriptTarget / SyntaxKind / …) is
// not exposed there. code-ast-complexity's loader checked only that
// the module loaded (truthiness), so the AST walker received a
// non-compiler and threw "Cannot read properties of undefined
// (reading 'Latest')" on first use; codeComplexity's catch-all then
// mislabelled it "handler_error" — the exact toast R2's passes saw
// live while commit patterns (no parser) worked in the same window.
//
// The fix validates the compiler-API surface at load
// (hasCompilerApi): a module without the API is a load failure, the
// walker reports unavailable, and the macro returns its designed
// honest error (ast_engine_unavailable) instead of handler_error.
// These tests pin that contract in BOTH worlds: with a working
// compiler API the sourceFiles path returns real metrics; without
// one it returns the named honest error — never handler_error.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { analyzeSourceComplexity, astEngineAvailable, hasCompilerApi } from "../lib/code-ast-complexity.js";

globalThis._concordSTATE = {};

const { default: registerReposActions } = await import("../domains/repos.js");
const handlers = new Map();
registerReposActions((domain, name, fn) => handlers.set(`${domain}:${name}`, fn));

const U1 = { actor: { userId: "user-f6" } };
// The /api/lens/run dispatcher's exact argument construction:
// a virtual artifact whose data IS the (peeled) input, params the same.
const dispatch = (name, input) =>
  handlers.get(`repos:${name}`)(U1, { id: null, domain: "repos", type: "domain_action", data: input, meta: {} }, input);

const installedTs = (() => {
  try { return createRequire(import.meta.url)("typescript"); } catch { return null; }
})();
const apiHere = hasCompilerApi(installedTs);

const SEEDED_FILES = [
  { path: "src/index.ts", content: "export function main(): void {\n  console.log('hello');\n}\n" },
  { path: "src/util.ts", content: "export const noop = (): void => {};\n" },
];

describe("F6: hasCompilerApi — surface validation, not truthiness", () => {
  it("rejects the typescript v7 version-only module shape", () => {
    assert.equal(hasCompilerApi({ version: "7.0.2", versionMajorMinor: "7.0" }), false);
  });

  it("rejects null, undefined, and non-objects", () => {
    assert.equal(hasCompilerApi(null), false);
    assert.equal(hasCompilerApi(undefined), false);
    assert.equal(hasCompilerApi("typescript"), false);
  });

  it("rejects a module missing any single member the walker calls", () => {
    const full = {
      createSourceFile() {}, forEachChild() {}, getLineAndCharacterOfPosition() {},
      isIdentifier() {}, isBinaryExpression() {}, isVariableDeclaration() {},
      isPropertyAssignment() {}, isPropertyDeclaration() {},
      ScriptTarget: {}, ScriptKind: {}, SyntaxKind: {},
    };
    assert.equal(hasCompilerApi(full), true);
    for (const key of Object.keys(full)) {
      const partial = { ...full };
      delete partial[key];
      assert.equal(hasCompilerApi(partial), false, `missing ${key} must read as unavailable`);
    }
  });

  it("agrees with the installed typescript package, whichever world this is", () => {
    assert.equal(astEngineAvailable(), apiHere);
    const rec = analyzeSourceComplexity("src/index.ts", SEEDED_FILES[0].content);
    if (apiHere) {
      assert.ok(rec && Array.isArray(rec.functions), "API present: real per-function records");
    } else {
      assert.equal(rec, null, "API absent: honest null, never a throw");
    }
  });
});

describe("F6: codeComplexity — the parser path never reports handler_error", () => {
  it("sourceFiles (the Analysis tab's live shape) resolves to metrics or the named honest error", async () => {
    const r = await dispatch("codeComplexity", { sourceFiles: SEEDED_FILES });
    assert.notEqual(r.error, "handler_error", JSON.stringify(r));
    if (apiHere) {
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.result.totalModules, 2);
      const names = r.result.modules.flatMap((m) => m.functions.map((f) => f.name));
      assert.ok(names.includes("main") && names.includes("noop"), `real functions named, got ${names}`);
    } else {
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.equal(r.error, "ast_engine_unavailable");
      assert.match(r.message, /compiler API is not available/);
    }
  });

  it("the legacy modules shape computes regardless of the parser", async () => {
    const r = await dispatch("codeComplexity", {
      modules: [{ name: "m", functions: [{ name: "f", branches: 2, loops: 1, conditions: 1, nesting: 0, lines: 10 }] }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.totalFunctions, 1);
  });
});

describe("F6: dependencyAudit — the lodash-naming sub-check (NOT RUN across two re-passes)", () => {
  it("names lodash@4.17.20 from a manifest that declares it", async () => {
    const r = await dispatch("dependencyAudit", {
      dependencies: [{ name: "lodash", version: "4.17.20" }],
      liveVulnCheck: true,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.totalDependencies, 1);
    const entry = r.result.dependencyList.find((d) => d.name === "lodash");
    assert.ok(entry, "the audit names lodash, not just a count");
    assert.equal(entry.version, "4.17.20");
    // The vulnerability surface is the same OSV source the Security tab
    // scans with: a count when the feed answered, an honest
    // unreachable flag when it didn't — never a fabricated zero.
    const v = r.result.vulnerabilities;
    assert.equal(v.source, "osv.dev");
    assert.ok(typeof v.total === "number" || v.unreachable === true, JSON.stringify(v));
    if (typeof v.total === "number") {
      for (const d of v.details) assert.ok(d.osvId, "each live advisory carries its OSV/GHSA id");
    }
  });

  it("an empty dependency list is an honest no-op, not an error", async () => {
    const r = await dispatch("dependencyAudit", { dependencies: [] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.result.message || "", /No dependencies to audit/);
  });
});
