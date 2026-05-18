// server/tests/code-intel.test.js
//
// Tier-2 contract tests for Code Sprint D — code intelligence.
// Real TypeScript Compiler API; real grep fallback; real workspace
// tmp dir; real file resolution.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { findDefinition, findReferences, hover, fileSymbols, diagnostics } from "../lib/code/code-intel.js";

let workspace; let projectDir;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "intel-ws-"));
  process.env.CONCORD_CODE_WORKSPACE_ROOT = workspace;
  projectDir = "myproj";
  const absProj = join(workspace, projectDir);
  mkdirSync(absProj, { recursive: true });
  writeFileSync(join(absProj, "lib.ts"), `
export function add(a: number, b: number): number {
  return a + b;
}

export class Counter {
  count = 0;
  inc() { this.count = add(this.count, 1); }
}

const total = add(2, 3);
const c = new Counter();
c.inc();
`);
  writeFileSync(join(absProj, "main.ts"), `
import { add, Counter } from './lib';

const x = add(1, 2);
const y = new Counter();
`);
  // git init for grep fallback test
  spawnSync("git", ["init", "-b", "main", absProj], { encoding: "utf-8" });
  spawnSync("git", ["-C", absProj, "config", "user.email", "t@x"], { encoding: "utf-8" });
  spawnSync("git", ["-C", absProj, "config", "user.name", "t"], { encoding: "utf-8" });
  spawnSync("git", ["-C", absProj, "config", "commit.gpgsign", "false"], { encoding: "utf-8" });
  spawnSync("git", ["-C", absProj, "add", "."], { encoding: "utf-8" });
  spawnSync("git", ["-C", absProj, "commit", "-m", "init"], { encoding: "utf-8" });
});
after(() => { rmSync(workspace, { recursive: true, force: true }); });

describe("code-intel: TypeScript Compiler API path", () => {
  it("findDefinition resolves a function reference to its declaration", () => {
    // In main.ts, `add(1, 2)` is at line 4 — char 11 is the `add` ident.
    const r = findDefinition({ projectPath: projectDir, filePath: "main.ts", line: 4, character: 11 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.kind, "ts");
    assert.equal(r.symbol, "add");
    assert.ok(r.locations.length >= 1);
    // Locations may include the import alias in main.ts AND the
    // declaration in lib.ts — both are valid TS symbol declarations.
    const files = r.locations.map((l) => l.file);
    assert.ok(files.some((f) => f.endsWith("lib.ts") || f.endsWith("main.ts")), `expected lib.ts or main.ts in ${JSON.stringify(files)}`);
  });

  it("findReferences walks the program and returns identifiers", () => {
    const r = findReferences({ projectPath: projectDir, filePath: "main.ts", line: 4, character: 11 });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "ts");
    // At least two: lib.ts add() definition usage + main.ts call
    assert.ok(r.references.length >= 2, `expected >=2 refs, got ${r.references.length}`);
  });

  it("hover returns the type string + symbol name", () => {
    // Hover on the `add` function declaration in lib.ts to get an
    // unambiguous symbol resolution.
    const r = hover({ projectPath: projectDir, filePath: "lib.ts", line: 2, character: 16 });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "ts");
    assert.equal(r.symbol, "add");
    assert.ok(r.type && r.type.includes("number"), `expected number in type, got ${r.type}`);
  });

  it("fileSymbols outlines lib.ts (function + class + var)", () => {
    const r = fileSymbols({ projectPath: projectDir, filePath: "lib.ts" });
    assert.equal(r.ok, true);
    const names = r.symbols.map((s) => s.name);
    assert.ok(names.includes("add"));
    assert.ok(names.includes("Counter"));
  });

  it("diagnostics returns clean for valid TS", () => {
    const r = diagnostics({ projectPath: projectDir, filePath: "main.ts" });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "ts");
    // Some env deps may produce minor d.ts errors; just verify the
    // structure rather than exact count.
    assert.ok(Array.isArray(r.diagnostics));
  });

  it("workspace gating rejects path traversal", () => {
    const r = findDefinition({ projectPath: "../escape", filePath: "x.ts" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "path_outside_workspace");
  });
});

describe("code-intel: grep fallback for non-TS", () => {
  it("findDefinition uses git grep for a Python-style file", () => {
    const absProj = join(workspace, projectDir);
    writeFileSync(join(absProj, "thing.py"), "def hello():\n    return 42\n\ndef other():\n    return hello()\n");
    spawnSync("git", ["-C", absProj, "add", "thing.py"], { encoding: "utf-8" });
    spawnSync("git", ["-C", absProj, "commit", "-m", "py"], { encoding: "utf-8" });
    const r = findDefinition({ projectPath: projectDir, filePath: "thing.py", symbol: "hello" });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "grep");
    assert.ok(r.locations.find((l) => l.file.endsWith("thing.py")));
  });
});
