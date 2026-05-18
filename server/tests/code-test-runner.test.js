// server/tests/code-test-runner.test.js
//
// Tier-2 contract tests for Code Sprint A #1 — real test runner.
// No LLM, no Ollama; we exercise the spawn-sync wrapper end-to-end
// with real `node` (always present in CI) plus the per-runner output
// parsers against captured fixtures.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  allowedRunners, workspaceRoot, isInsideWorkspace,
  parseRunnerOutput, runTests,
} from "../lib/code/test-runner.js";

describe("code-test-runner: env gating", () => {
  it("allowedRunners() includes the documented defaults", () => {
    const got = allowedRunners();
    assert.ok(got.includes("npm"));
    assert.ok(got.includes("pytest"));
    assert.ok(got.includes("jest"));
  });

  it("allowedRunners() respects CONCORD_TEST_RUNNERS override", () => {
    const prev = process.env.CONCORD_TEST_RUNNERS;
    process.env.CONCORD_TEST_RUNNERS = "node,mocha";
    try {
      const got = allowedRunners();
      assert.deepEqual(got, ["node", "mocha"]);
    } finally {
      if (prev === undefined) delete process.env.CONCORD_TEST_RUNNERS;
      else process.env.CONCORD_TEST_RUNNERS = prev;
    }
  });

  it("isInsideWorkspace() rejects path traversal", () => {
    assert.equal(isInsideWorkspace("../etc"), false);
    assert.equal(isInsideWorkspace("foo/../../etc"), false);
  });

  it("isInsideWorkspace() accepts a real subdir of cwd", () => {
    assert.equal(isInsideWorkspace("."), true);
  });

  it("workspaceRoot() respects CONCORD_CODE_WORKSPACE_ROOT", () => {
    const prev = process.env.CONCORD_CODE_WORKSPACE_ROOT;
    process.env.CONCORD_CODE_WORKSPACE_ROOT = "/tmp";
    try {
      assert.equal(workspaceRoot(), "/tmp");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_CODE_WORKSPACE_ROOT;
      else process.env.CONCORD_CODE_WORKSPACE_ROOT = prev;
    }
  });
});

describe("code-test-runner: runTests gating", () => {
  it("rejects when runner is missing", () => {
    const r = runTests({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "runner_required");
  });

  it("rejects runner not in allowlist", () => {
    const r = runTests({ runner: "rm", projectPath: "." });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "runner_not_allowed");
    assert.ok(Array.isArray(r.allowed));
  });

  it("rejects path outside workspace", () => {
    const r = runTests({ runner: "npm", projectPath: "../outside" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "path_outside_workspace");
  });

  it("rejects path not found", () => {
    const prev = process.env.CONCORD_TEST_RUNNERS;
    process.env.CONCORD_TEST_RUNNERS = "node";
    try {
      const r = runTests({ runner: "node", projectPath: "definitely_not_a_real_dir_for_tests" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "path_not_found");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_TEST_RUNNERS;
      else process.env.CONCORD_TEST_RUNNERS = prev;
    }
  });

  it("real spawn end-to-end: a node project that exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctr-pass-"));
    try {
      writeFileSync(join(dir, "ok.js"), "process.exit(0)");
      const prev = process.env.CONCORD_TEST_RUNNERS;
      const prevRoot = process.env.CONCORD_CODE_WORKSPACE_ROOT;
      process.env.CONCORD_TEST_RUNNERS = "node";
      process.env.CONCORD_CODE_WORKSPACE_ROOT = tmpdir();
      try {
        const r = runTests({ runner: "node", projectPath: dir, args: ["ok.js"] });
        assert.equal(r.ok, true);
        assert.equal(r.exitCode, 0);
        assert.equal(r.verdict, "pass");
      } finally {
        if (prev === undefined) delete process.env.CONCORD_TEST_RUNNERS; else process.env.CONCORD_TEST_RUNNERS = prev;
        if (prevRoot === undefined) delete process.env.CONCORD_CODE_WORKSPACE_ROOT; else process.env.CONCORD_CODE_WORKSPACE_ROOT = prevRoot;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("real spawn end-to-end: a node project that exits 1 → verdict fail", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctr-fail-"));
    try {
      writeFileSync(join(dir, "fail.js"), "console.error('nope'); process.exit(1)");
      const prev = process.env.CONCORD_TEST_RUNNERS;
      const prevRoot = process.env.CONCORD_CODE_WORKSPACE_ROOT;
      process.env.CONCORD_TEST_RUNNERS = "node";
      process.env.CONCORD_CODE_WORKSPACE_ROOT = tmpdir();
      try {
        const r = runTests({ runner: "node", projectPath: dir, args: ["fail.js"] });
        assert.equal(r.ok, true);
        assert.equal(r.exitCode, 1);
        assert.equal(r.verdict, "fail");
        assert.ok(r.stderr.includes("nope"));
      } finally {
        if (prev === undefined) delete process.env.CONCORD_TEST_RUNNERS; else process.env.CONCORD_TEST_RUNNERS = prev;
        if (prevRoot === undefined) delete process.env.CONCORD_CODE_WORKSPACE_ROOT; else process.env.CONCORD_CODE_WORKSPACE_ROOT = prevRoot;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("code-test-runner: parseRunnerOutput per-runner shapes", () => {
  it("parses Jest-style summary lines", () => {
    const out = "Tests:       2 failed, 1 skipped, 5 passed, 8 total\n● MyTest\n    at /path/file.js:42:7";
    const r = parseRunnerOutput("jest", out, "");
    assert.equal(r.passed, 5);
    assert.equal(r.failed, 2);
    assert.equal(r.skipped, 1);
    assert.ok(r.parsedFailures.length >= 1);
    assert.equal(r.parsedFailures[0].file, "/path/file.js");
    assert.equal(r.parsedFailures[0].line, 42);
  });

  it("parses Mocha-style passing/failing", () => {
    const out = "  3 passing (10ms)\n  2 failing\n  1 pending\n\n  1) MySuite my test\n     AssertionError: oops";
    const r = parseRunnerOutput("mocha", out, "");
    assert.equal(r.passed, 3);
    assert.equal(r.failed, 2);
    assert.equal(r.skipped, 1);
    assert.ok(r.parsedFailures.length >= 1);
  });

  it("parses pytest summary line", () => {
    const out = "============ 2 failed, 10 passed, 1 skipped ============\nFAILED tests/foo.py::test_bar - AssertionError: 1 != 2";
    const r = parseRunnerOutput("pytest", out, "");
    assert.equal(r.failed, 2);
    assert.equal(r.passed, 10);
    assert.equal(r.skipped, 1);
    assert.ok(r.parsedFailures.length >= 1);
    assert.equal(r.parsedFailures[0].file, "tests/foo.py");
  });

  it("parses cargo test result line", () => {
    const out = "test result: FAILED. 3 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out";
    const r = parseRunnerOutput("cargo", out, "");
    assert.equal(r.passed, 3);
    assert.equal(r.failed, 2);
    assert.equal(r.skipped, 1);
  });

  it("parses go test markers", () => {
    const out = "--- PASS: TestFoo (0.01s)\n--- FAIL: TestBar (0.02s)\n    bar_test.go:14: oops\n--- SKIP: TestBaz (0.00s)";
    const r = parseRunnerOutput("go", out, "");
    assert.equal(r.passed, 1);
    assert.equal(r.failed, 1);
    assert.equal(r.skipped, 1);
    assert.ok(r.parsedFailures.length >= 1);
    assert.equal(r.parsedFailures[0].file, "bar_test.go");
    assert.equal(r.parsedFailures[0].line, 14);
  });

  it("returns zeros on unknown runner output", () => {
    const r = parseRunnerOutput("npm", "random gibberish output\nno test marker here", "");
    assert.equal(r.passed, 0);
    assert.equal(r.failed, 0);
    assert.equal(r.parsedFailures.length, 0);
  });
});
