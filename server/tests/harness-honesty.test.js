/**
 * Harness Honesty — meta-verification (2026-07-25)
 *
 * Proves that a genuinely FAILING test is REPORTED as failing under every
 * test-harness shape this repo runs `node --test` through. This is the
 * highest-value meta-test class because its failure mode is silent AND
 * inverted: a broken harness doesn't crash loudly, it prints a clean "all
 * green" and exits 0 while quietly hiding a real defect.
 *
 * Concrete, reproduced defect (not hypothetical): `server/tests/lib/
 * server-clean-exit.js` called `process.exit(0)` SYNCHRONOUSLY inside a
 * node:test `after()` hook. That pre-empts node:test's own completion path
 * before it can emit `not ok` / `# fail` for a failure that already
 * happened, or set a non-zero `process.exitCode`. Reproduced on a bare
 * `assert.equal(1, 2)`, no server involved:
 *
 *   process.exit(0) synchronously in after()   -> "ok 1" / # fail 0 / exit 0
 *   setTimeout(..., 200).unref() watchdog      -> "not ok 1" / # fail 1 / exit 1
 *
 * Same assertion, opposite verdicts. `tests/depth/_harness.js` got this fix
 * on 2026-07-11; `server-clean-exit.js` had drifted out of sync and still
 * carried the bug across all 13 `registerServerCleanExit` callers until
 * 2026-07-25. Nothing short of an out-of-band probe like this file would
 * have caught that drift — the suite itself reported green throughout.
 *
 * Method: for each harness shape, spawn a CHILD `node --test` process
 * (argv only, via spawnSync — never a shell) against a synthetic temp-dir
 * test file containing a guaranteed-failing assertion, and assert the
 * child's TAP output + exit code report the failure honestly. The real
 * server is never booted here (explicitly out of scope for this file —
 * slow, and this box runs a parallel full-suite job); a bare failing
 * assertion is exactly how the original defect was proven, and it is
 * enough to exercise every harness's reporting path.
 *
 * This file does NOT edit server-clean-exit.js or tests/depth/_harness.js —
 * both were already fixed. It proves the fixes hold and will regress-catch
 * if either drifts again.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const SERVER_CLEAN_EXIT_PATH = path.join(__dirname, "lib", "server-clean-exit.js");
const DEPTH_HARNESS_PATH = path.join(__dirname, "depth", "_harness.js");
const BEHAVIOR_SUITE_PATH = path.join(__dirname, "behavior", "lens-behavior-smoke.behavior.js");

// ── synthetic fixtures ───────────────────────────────────────────────────

const tmpDir = mkdtempSync(path.join(tmpdir(), "concord-harness-honesty-"));
after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

function writeSyntheticTest(name, source) {
  const filePath = path.join(tmpDir, name);
  writeFileSync(filePath, source, "utf8");
  return filePath;
}

/**
 * Force the TAP reporter explicitly rather than relying on `node --test`'s
 * default output format. On older Node versions the default reporter was
 * TAP whenever stdout wasn't a TTY; current Node (verified on v24.11.1)
 * defaults to the human-readable "spec" reporter (`✔`/`✖`/`ℹ` lines)
 * regardless of TTY-ness, which silently broke every `assertReportsPass`/
 * `assertReportsFailure` regex below (they look for `^ok \d+`/`^not ok \d+`).
 * Pinning the reporter makes this meta-test's anchor format stable across
 * Node versions instead of riding an undocumented default.
 */
const TAP_REPORTER_FLAGS = ["--test-reporter=tap", "--test-reporter-destination=stdout"];

/** Spawn a CHILD `node --test [...flags] <file>`, argv only (no shell). */
function spawnNodeTest(flags, filePath) {
  // node:test sets NODE_TEST_CONTEXT=child-v8 in its own process env, and
  // spawnSync inherits the parent's env by default. Since this whole file
  // itself runs under `node --test`, that var leaks into every child we
  // spawn here and trips node:test's OWN recursion guard ("run() is being
  // called recursively within a test file") — the child then silently
  // skips running the target file entirely: status 0, empty stdout, no
  // error. That would have made every "does a failure surface" assertion
  // below vacuously true for the wrong reason (nothing ran) rather than
  // because the harness actually reported honestly. Strip it so each
  // child is a genuinely independent `node --test` invocation.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", ...TAP_REPORTER_FLAGS, ...flags, filePath], {
    encoding: "utf8",
    timeout: 30_000,
    env: childEnv,
  });
}

function assertReportsFailure(res, label) {
  assert.notEqual(res.status, 0, `${label}: a genuinely failing test must exit non-zero (got ${res.status})`);
  assert.match(res.stdout, /^not ok \d+/m, `${label}: TAP output must contain a "not ok" line for the failing test`);
  assert.match(res.stdout, /^# fail 1$/m, `${label}: TAP summary must report "# fail 1"`);
}

function assertReportsPass(res, label) {
  assert.equal(res.status, 0, `${label}: a genuinely passing test must exit 0 (got ${res.status})`);
  assert.match(res.stdout, /^ok \d+/m, `${label}: TAP output must contain an "ok" line for the passing test`);
  assert.match(res.stdout, /^# pass 1$/m, `${label}: TAP summary must report "# pass 1"`);
  assert.match(res.stdout, /^# fail 0$/m, `${label}: TAP summary must report "# fail 0"`);
}

const FAIL_TEST_SRC = `import { test } from "node:test";
import assert from "node:assert/strict";
test("deliberately failing", () => {
  assert.equal(1, 2);
});
`;

const PASS_TEST_SRC = `import { test } from "node:test";
import assert from "node:assert/strict";
test("deliberately passing", () => {
  assert.equal(1, 1);
});
`;

// ── shape 1: plain `node --test`, no flags, no custom teardown ──────────────

describe("harness honesty — a real failure surfaces under every shape this repo runs tests through", () => {
  it("shape 1: plain `node --test`, no flags, no custom teardown reports a real failure", () => {
    const file = writeSyntheticTest("shape1-fail.test.mjs", FAIL_TEST_SRC);
    const res = spawnNodeTest([], file);
    assertReportsFailure(res, "shape 1 (plain node --test)");
  });

  it("shape 1 inverse: a genuinely passing test reports pass + exit 0 (so this meta-test can't trivially pass by everything looking broken)", () => {
    const file = writeSyntheticTest("shape1-pass.test.mjs", PASS_TEST_SRC);
    const res = spawnNodeTest([], file);
    assertReportsPass(res, "shape 1 (plain node --test)");
  });

  it("shape 2: the real, unedited registerServerCleanExit() teardown (server/tests/lib/server-clean-exit.js) reports a real failure", () => {
    // Imports the ACTUAL repo module, not a copy, so this proves the real
    // fixed file rather than a stand-in. Passes a fake getTestSurface — no
    // server boot needed — which exercises exactly registerServerCleanExit's
    // own try/catch-tolerant path for a surface with no teardown methods.
    const src = `import { test } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from ${JSON.stringify(SERVER_CLEAN_EXIT_PATH)};
registerServerCleanExit(async () => ({}));
test("deliberately failing", () => {
  assert.equal(1, 2);
});
`;
    const file = writeSyntheticTest("shape2-fail.test.mjs", src);
    const res = spawnNodeTest([], file);
    assertReportsFailure(res, "shape 2 (registerServerCleanExit)");
    // The precise defect this file exists to catch: the old buggy shape
    // called process.exit(0) SYNCHRONOUSLY inside after(), which reported a
    // failing test as `ok 1` with exit 0. Assert we are not looking at that.
    assert.doesNotMatch(
      res.stdout,
      /^ok 1 - deliberately failing$/m,
      "shape 2: must not silently report the failing test as passing (the exact 2026-07-25 defect)",
    );
  });

  it("shape 2 inverse: registerServerCleanExit reports a genuine pass correctly", () => {
    const src = `import { test } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from ${JSON.stringify(SERVER_CLEAN_EXIT_PATH)};
registerServerCleanExit(async () => ({}));
test("deliberately passing", () => {
  assert.equal(1, 1);
});
`;
    const file = writeSyntheticTest("shape2-pass.test.mjs", src);
    const res = spawnNodeTest([], file);
    assertReportsPass(res, "shape 2 (registerServerCleanExit)");
  });

  it("shape 5: --test-force-exit does not itself mask a real failure, even with a lingering ref'd handle after the test", () => {
    // The flag's whole job is to reap a process that would otherwise hang on
    // a dangling handle. The risk this test rules out: does reaping the
    // process also clip the TAP output/exit-code before they're fully
    // emitted? A ref'd (non-unref'd) 60s timer registered AFTER the failing
    // test guarantees the process would hang for a minute without the flag;
    // we never wait out that branch (too slow for this box) — we only
    // assert that WITH the flag the run still exits promptly and correctly.
    const src = `import { test } from "node:test";
import assert from "node:assert/strict";
test("deliberately failing with a lingering ref'd timer after it", () => {
  assert.equal(1, 2);
});
setTimeout(() => {}, 60000);
`;
    const file = writeSyntheticTest("shape5-fail-hang.test.mjs", src);
    const start = Date.now();
    const res = spawnNodeTest(["--test-force-exit"], file);
    const elapsedMs = Date.now() - start;
    assertReportsFailure(res, "shape 5 (--test-force-exit + lingering handle)");
    assert.equal(
      elapsedMs < 10_000,
      true,
      `shape 5: --test-force-exit should reap the lingering 60s timer promptly, not wait it out (took ${elapsedMs}ms)`,
    );
  });

  it("shape 4: the behavior-suite harness introduces no bespoke exit mechanism of its own", () => {
    // tests/depth/_harness.js and tests/lib/server-clean-exit.js both carry
    // a documented after()-hook exit fix. The behavior suite
    // (tests/behavior/lens-behavior-smoke.behavior.js) has no such hook: it
    // has zero process.exit() call sites, so it has nothing of its own that
    // could reintroduce the failure-masking bug. Its only exit path is the
    // bare --test-force-exit flag set in its npm script (server/package.json's
    // test:behavior), which shape 5 above already proves reports failures
    // correctly.
    const src = readFileSync(BEHAVIOR_SUITE_PATH, "utf8");
    assert.doesNotMatch(
      src,
      /process\.exit\(/,
      "behavior-suite harness must not define its own process.exit() teardown " +
        "(if one is ever added, it needs the same unref'd-watchdog fix as " +
        "server-clean-exit.js / _harness.js, or it risks the same masking bug)",
    );
  });
});

// ── static source pins ───────────────────────────────────────────────────
//
// Strip comments before pattern-matching "no bare process.exit() outside the
// watchdog" — both files' own doc comments quote the OLD buggy
// `process.exit(0)` shape verbatim as prose (to explain the bug they fixed),
// which would otherwise false-positive a naive text match. This is a plain
// regex-based stripper (not a JS parser) — good enough for well-formatted
// source, verified against both target files below.

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// The watchdog shape both fixed files converged on: an unref'd, delayed
// process.exit() inside a setTimeout callback, itself scheduled from inside
// after() rather than invoked synchronously in the hook's own continuation.
const WATCHDOG_RE =
  /setTimeout\(\s*\(\)\s*=>\s*\{\s*process\.exit\([^)]*\)\s*;?\s*\}\s*,\s*\d+\s*\)\s*;\s*\n\s*\S+\.unref\(\)/;

function assertOnlyExitsViaUnrefdWatchdog(filePath, label) {
  const code = stripComments(readFileSync(filePath, "utf8"));
  assert.match(code, WATCHDOG_RE, `${label}: must exit only via an unref'd, delayed watchdog timer`);
  const withoutWatchdog = code.replace(new RegExp(WATCHDOG_RE, "g"), "");
  assert.doesNotMatch(
    withoutWatchdog,
    /process\.exit\(/,
    `${label}: must not call process.exit() anywhere outside the unref'd watchdog — a bare ` +
      "synchronous call in the after() hook's own continuation is exactly the 2026-07-11/" +
      "2026-07-25 failure-masking defect this file exists to catch",
  );
}

describe("harness honesty — static pins on the exact code shape (backs the dynamic proofs above)", () => {
  it("server/tests/lib/server-clean-exit.js exits only via the unref'd watchdog pattern", () => {
    assertOnlyExitsViaUnrefdWatchdog(SERVER_CLEAN_EXIT_PATH, "server-clean-exit.js");
  });

  it("shape 3: server/tests/depth/_harness.js (the depth harness) exits only via the unref'd watchdog pattern", () => {
    // This is the one shape this file cannot cheaply exercise dynamically:
    // _harness.js#load() imports the real server.js at module top level
    // regardless of which exported helper is called, and booting the real
    // server here is explicitly out of scope (slow; the box already runs a
    // parallel full-suite job). The static-pin technique used above is an
    // honest substitute, not a full behavioral proof — recorded plainly
    // rather than faked.
    assertOnlyExitsViaUnrefdWatchdog(DEPTH_HARNESS_PATH, "tests/depth/_harness.js");
  });
});

// ── no permanently-pending teardown promise ──────────────────────────────

describe("harness honesty — no harness leaves a permanently-pending teardown promise (static proof; a dynamic proof would require booting server.js, out of scope here)", () => {
  it("server.js's terminateCognitiveWorkerForTest() unconditionally resolves its wrapping Promise even if the worker never emits 'exit'", () => {
    const serverPath = path.join(REPO_ROOT, "server", "server.js");
    const src = readFileSync(serverPath, "utf8");
    const fnMatch = src.match(/async function terminateCognitiveWorkerForTest\(\) \{[\s\S]*?\n\}\n/);
    assert.ok(fnMatch, "terminateCognitiveWorkerForTest() not found in server.js (renamed or moved?) — update this pin");
    const fnBody = fnMatch[0];
    assert.match(
      fnBody,
      /\bw\.once\(\s*["']exit["']\s*,\s*done\s*\)/,
      "terminateCognitiveWorkerForTest: expected the worker's 'exit' event to resolve the promise on the happy path",
    );
    // The load-bearing invariant: the fallback timer calls done()
    // UNCONDITIONALLY, not merely `w.terminate()`. If a future edit guards
    // that call behind a condition, a worker that never emits "exit" would
    // leave this Promise — and anything awaiting
    // terminateCognitiveWorkerForTest() as part of a clean-exit teardown —
    // pending forever.
    assert.match(
      fnBody,
      /setTimeout\(\s*\(\)\s*=>\s*\{\s*w\.terminate\(\)\.catch\(\(\)\s*=>\s*\{\s*\}\);\s*done\(\);\s*\},\s*\d+\)/,
      "terminateCognitiveWorkerForTest: the fallback timer must call done() unconditionally " +
        "so the wrapping Promise can never stay pending forever",
    );
  });
});
