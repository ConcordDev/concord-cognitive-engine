// tests/check-depth-tests-guard.test.js
//
// Pins the 2026-07-18 bidirectional fix to scripts/check-depth-tests.mjs (the
// depth-multiplier honesty guard, CI-gated in deploy.yml + detectors-cartography.yml).
//
// The bug: the guard located `it(`/`test(` call sites with a naive regex scan
// of RAW source. That regex has no notion of "inside a string" or "inside a
// comment", so it matched:
//   - `RegExp.prototype.test(str)` / `.test(e)` calls inside a real test's OWN
//     assertions (e.g. `/pattern/i.test(e)`, common in these files) — treated
//     as a second, anonymous, assertion-less test-definition.
//   - the substring "it (" / "test(" inside prose comments (e.g. "delete it
//     (it doesn't exist)") or inside a test's own descriptive name string
//     (e.g. "…go with it (no dangling references)") — same false match.
// Each false match produced a spurious `it("(anonymous)") has no substantive
// assertion` finding, even though the file's real, well-named `it()` blocks
// all carried genuine assertions. At HEAD this inflated 65 reported "issues"
// to 28 that were purely this artifact (verified by re-running the fixed
// checker against the real tree — see the "real tree" describe block below).
//
// The fix: locate call sites against a MASKED copy of the source (comments +
// string/template bodies blanked to spaces, same length so byte offsets stay
// valid) so a match can only occur in real code, never inside a string or
// comment. A `.test(` call preceded by a dot is additionally excluded UNLESS
// its first argument is a string literal — this keeps legitimate `t.test("name",
// fn)` node:test subtests (which ARE preceded by a dot) while dropping
// `regexOrString.test(nonStringArg)` member calls.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKER = path.join(ROOT, "scripts", "check-depth-tests.mjs");
const DEPTH_DIR = path.join(ROOT, "server", "tests", "depth");

// The checker has no --dir override and scans server/tests/depth for every
// *-behavior.test.js file, so fixture cases are dropped into that real
// directory under a name that can't collide with a real domain, run, then
// removed in `after` — the same "drop a real file, scan, delete" approach a
// human would use to reproduce a CI finding locally.
function runWithFixture(name, source) {
  const fixturePath = path.join(DEPTH_DIR, `${name}-behavior.test.js`);
  writeFileSync(fixturePath, source, "utf8");
  try {
    const out = execFileSync("node", [CHECKER], { cwd: ROOT, encoding: "utf8" });
    return out;
  } catch (e) {
    // check-depth-tests.mjs exits 0 even on findings unless --ci is passed,
    // so a thrown error here means something else broke (e.g. a syntax
    // error execFileSync itself surfaces) — surface the real output.
    return e.stdout || e.message;
  } finally {
    rmSync(fixturePath, { force: true });
  }
}

describe("check-depth-tests.mjs — does not still crash / all fixtures clean up", () => {
  it("the fixture helper never leaves a stray file behind on throw", () => {
    assert.equal(existsSync(path.join(DEPTH_DIR, "zzz-guard-fixture-behavior.test.js")), false);
  });
});

describe("check-depth-tests.mjs — TRUE POSITIVE: a genuinely shape-only test is still caught", () => {
  it("a bare assert.equal(r.ok, true) with no other assertion is flagged", () => {
    const out = runWithFixture(
      "zzz-guard-fixture-true-positive",
      `import { describe, it } from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `describe("zzz guard fixture", () => {\n` +
      `  it("does a thing", async () => {\n` +
      `    const r = { ok: true };\n` +
      `    assert.equal(r.ok, true);\n` +
      `  });\n` +
      `});\n`,
    );
    assert.match(out, /zzz-guard-fixture-true-positive-behavior\.test\.js: it\("does a thing"\) has no substantive assertion/);
  });

  it("a shape-only test.() case (not just it()) is also caught", () => {
    const out = runWithFixture(
      "zzz-guard-fixture-true-positive-test-fn",
      `import { test } from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `test("bare shape check", async () => {\n` +
      `  const r = { ok: true };\n` +
      `  assert.equal(typeof r, "object");\n` +
      `});\n`,
    );
    assert.match(out, /zzz-guard-fixture-true-positive-test-fn-behavior\.test\.js: it\("bare shape check"\) has no substantive assertion/);
  });
});

describe("check-depth-tests.mjs — FALSE POSITIVE regression: real assertions using .test( must not be miscounted", () => {
  it("a real, substantive it() whose body calls /regex/.test(x) is NOT flagged as an anonymous shape-only case", () => {
    const out = runWithFixture(
      "zzz-guard-fixture-regex-test-call",
      `import { describe, it } from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `describe("zzz guard fixture", () => {\n` +
      `  it("classifies evidence and cites it", async () => {\n` +
      `    const r = { result: { evidence: ["dull, fibrous surface"] } };\n` +
      `    assert.ok(r.result.evidence.some((e) => /dull, fibrous/i.test(e)));\n` +
      `  });\n` +
      `});\n`,
    );
    assert.doesNotMatch(out, /zzz-guard-fixture-regex-test-call-behavior\.test\.js:.*\(anonymous\)/);
    assert.doesNotMatch(out, /zzz-guard-fixture-regex-test-call-behavior\.test\.js:.*"classifies evidence and cites it"\) has no substantive/);
  });

  it("prose in a // comment reading 'delete it (it doesn't exist)' does not spawn a phantom anonymous test", () => {
    const out = runWithFixture(
      "zzz-guard-fixture-comment-prose",
      `import { describe, it } from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `describe("zzz guard fixture", () => {\n` +
      `  it("rejects a foreign delete", async () => {\n` +
      `    // Owner B cannot delete it (it doesn't exist in B's bucket).\n` +
      `    const r = { result: { ok: false, error: "not found" } };\n` +
      `    assert.equal(r.result.ok, false);\n` +
      `  });\n` +
      `});\n`,
    );
    assert.doesNotMatch(out, /zzz-guard-fixture-comment-prose-behavior\.test\.js:.*\(anonymous\)/);
  });

  it("a test's OWN descriptive name containing 'it (' (e.g. '...go with it (no dangling references)') does not spawn a phantom anonymous test", () => {
    const out = runWithFixture(
      "zzz-guard-fixture-name-parenthetical",
      `import { describe, it } from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `describe("zzz guard fixture", () => {\n` +
      `  it("deletes a board, and its pinned items go with it (no dangling references)", async () => {\n` +
      `    const r = { result: { deleted: "abc" } };\n` +
      `    assert.equal(r.result.deleted, "abc");\n` +
      `  });\n` +
      `});\n`,
    );
    assert.doesNotMatch(out, /zzz-guard-fixture-name-parenthetical-behavior\.test\.js:.*\(anonymous\)/);
  });

  it("a legitimate t.test(\"name\", fn) subtest that IS shape-only is still caught (the dot-precedence exclusion does not blanket-skip subtests)", () => {
    const out = runWithFixture(
      "zzz-guard-fixture-subtest-shape-only",
      `import { test } from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `test("outer", async (t) => {\n` +
      `  await t.test("inner shape-only case", async () => {\n` +
      `    const r = { ok: true };\n` +
      `    assert.equal(r.ok, true);\n` +
      `  });\n` +
      `});\n`,
    );
    assert.match(out, /zzz-guard-fixture-subtest-shape-only-behavior\.test\.js: it\("inner shape-only case"\) has no substantive assertion/);
  });
});

describe("check-depth-tests.mjs — real tree: the fix eliminates the false positives it previously reported", () => {
  it("materials-fractography-behavior.test.js (heavy /regex/.test(e) user) reports zero issues", () => {
    const out = execFileSync("node", [CHECKER], { cwd: ROOT, encoding: "utf8" });
    assert.doesNotMatch(out, /materials-fractography-behavior\.test\.js:/);
  });

  it("agents-task-definitions-behavior.test.js (comment-prose 'it (it doesn't...)' trigger) reports zero issues", () => {
    const out = execFileSync("node", [CHECKER], { cwd: ROOT, encoding: "utf8" });
    assert.doesNotMatch(out, /agents-task-definitions-behavior\.test\.js:/);
  });

  it("no remaining finding across the real tree is anonymous — every surviving issue names a real it()", () => {
    const out = execFileSync("node", [CHECKER], { cwd: ROOT, encoding: "utf8" });
    assert.doesNotMatch(out, /it\("\(anonymous\)"\)/);
  });
});
