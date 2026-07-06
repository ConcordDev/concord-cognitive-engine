// Bidirectional pinning test for the guard.mjs assertion-counter fix.
//
// guard.mjs's ASSERT_RE matches a bare `expect` word, which also matches the
// "expect" substring inside the TypeScript compiler directive `@ts-expect-error`
// (word boundaries land on the surrounding hyphens). Before the fix, removing an
// unnecessary/incorrect @ts-expect-error comment — a real lint fix — was
// misread as deleting a test assertion and blocked the commit.
//
// This test proves the fix is bidirectional: (a) removing only a
// @ts-expect-error directive no longer trips "TEST WEAKENED", and (b) removing
// a REAL assertion (expect(...)) still does. Runs guard.mjs + lib.mjs copied
// into an isolated temp git repo — never touches this repo's real git state.
//
// Run: node --test server/tests/autoloop-guard-ts-expect-error.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL_GUARD = join(import.meta.dirname, "..", "..", "scripts", "autoloop", "guard.mjs");
const REAL_LIB = join(import.meta.dirname, "..", "..", "scripts", "autoloop", "lib.mjs");

const SAMPLE_TEST_FILE = `import { describe, it, expect } from "vitest";

describe("sample", () => {
  it("checks two things", () => {
    // @ts-expect-error deliberately-wrong type for the test
    const x = 1;
    expect(x).toBe(1);
    expect(x + 1).toBe(2);
  });
});
`;

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  mkdirSync(join(dir, "scripts", "autoloop"), { recursive: true });
  copyFileSync(REAL_GUARD, join(dir, "scripts", "autoloop", "guard.mjs"));
  copyFileSync(REAL_LIB, join(dir, "scripts", "autoloop", "lib.mjs"));
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, "tests", "sample.test.js"), SAMPLE_TEST_FILE);
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "t@t.com" && git config user.name "t"', { cwd: dir });
  execSync("git add -A && git commit -q -m init", { cwd: dir });
  return dir;
}

function runGuard(dir) {
  try {
    const out = execSync("node scripts/autoloop/guard.mjs", { cwd: dir, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}

let dir;
before(() => { dir = makeTempRepo(); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

describe("guard.mjs assertion-counter: @ts-expect-error vs real expect()", () => {
  it("does NOT flag removing only a @ts-expect-error directive", () => {
    const path = join(dir, "tests", "sample.test.js");
    const content = SAMPLE_TEST_FILE.replace(
      '    // @ts-expect-error deliberately-wrong type for the test\n',
      ''
    );
    assert.notEqual(content, SAMPLE_TEST_FILE, "sanity: the directive line must actually be removed");
    writeFileSync(path, content);
    const result = runGuard(dir);
    assert.equal(result.code, 0, `guard should pass, got:\n${result.out}`);
    assert.doesNotMatch(result.out, /TEST WEAKENED/);
    // restore for the next test
    writeFileSync(path, SAMPLE_TEST_FILE);
    execSync("git checkout -- tests/sample.test.js", { cwd: dir });
  });

  it("STILL flags removing a real expect(...) assertion", () => {
    const path = join(dir, "tests", "sample.test.js");
    const content = SAMPLE_TEST_FILE.replace("    expect(x + 1).toBe(2);\n", "");
    assert.notEqual(content, SAMPLE_TEST_FILE, "sanity: an assertion line must actually be removed");
    writeFileSync(path, content);
    const result = runGuard(dir);
    assert.equal(result.code, 1, `guard should block, got:\n${result.out}`);
    assert.match(result.out, /TEST WEAKENED/);
    execSync("git checkout -- tests/sample.test.js", { cwd: dir });
  });

  it("truly-empty diff (no changes at all) never fails", () => {
    const result = runGuard(dir);
    assert.equal(result.code, 0, `guard should pass on a clean tree, got:\n${result.out}`);
  });
});
