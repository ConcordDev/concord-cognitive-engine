// server/lib/code/test-runner.js
//
// Code Sprint A — Item #1: real test runner.
//
// concord's code lens previously had `vm.run` (4s, JS-only, no FS) as
// its only "exec" path. Rival 2026 tools (Cursor, Windsurf, Copilot
// Workspace, Claude Code, Aider, Zed, Codex) all ship real test
// execution and an auto-retry loop. We add a spawn-sync wrapper that
// mirrors the voice.transcribe pattern in server.js:11069-11120:
// env-gated binary + structured result, never throws.
//
// Sandbox shape:
//   - `CONCORD_TEST_RUNNERS` env, comma-separated allowlist
//     (default "npm,pytest,cargo,jest,go,mocha,vitest,tap").
//   - workspace root pinned by `CONCORD_CODE_WORKSPACE_ROOT`
//     (defaults to cwd). Tests can ONLY run from a path inside it
//     and may NOT contain `..`.
//   - spawn-sync, never user-shell-interpolated args.
//   - 5 min wall-clock cap (`CONCORD_TEST_TIMEOUT_MS`).
//
// Output normalised to:
//   { ok, runner, exitCode, durationMs, passed, failed, skipped,
//     parsedFailures: [{file, line, msg}], stdout, stderr }
//
// Tier-2 contract test: server/tests/code-test-runner.test.js.

import { spawnSync } from "node:child_process";
import { resolve as pathResolve, normalize as pathNormalize } from "node:path";
import { existsSync, statSync } from "node:fs";

const DEFAULT_ALLOWED = "npm,pytest,cargo,jest,go,mocha,vitest,tap";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function allowedRunners() {
  const raw = process.env.CONCORD_TEST_RUNNERS || DEFAULT_ALLOWED;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function workspaceRoot() {
  const root = process.env.CONCORD_CODE_WORKSPACE_ROOT || process.cwd();
  return pathResolve(root);
}

export function isInsideWorkspace(p) {
  if (!p || typeof p !== "string") return false;
  if (p.includes("..")) return false;
  const root = workspaceRoot();
  const abs = pathResolve(root, p);
  const normalized = pathNormalize(abs);
  return normalized === root || normalized.startsWith(root + "/");
}

// Strip ANSI escape codes so parsers can match plain text.
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || "").replace(/\[[0-9;]*m/g, "");
}

// Per-runner output parser. Each returns { passed, failed, skipped, parsedFailures }.
// Designed to fail soft: when output doesn't match a known shape, return
// zeros and an empty failures array. Exit code drives the verdict.
export function parseRunnerOutput(runner, stdout, stderr) {
  const out = stripAnsi((stdout || "") + "\n" + (stderr || ""));
  const r = String(runner || "").toLowerCase();
  if (r === "jest" || r === "vitest") return parseJestLike(out);
  if (r === "mocha" || r === "tap") return parseMochaLike(out);
  if (r === "pytest") return parsePytest(out);
  if (r === "cargo") return parseCargo(out);
  if (r === "go") return parseGo(out);
  if (r === "npm") {
    // npm test delegates; try jest-like first, then mocha-like.
    const a = parseJestLike(out);
    if (a.passed + a.failed > 0) return a;
    return parseMochaLike(out);
  }
  return { passed: 0, failed: 0, skipped: 0, parsedFailures: [] };
}

function parseJestLike(out) {
  // Tests:       5 failed, 12 passed, 17 total
  // or `✓ test name` / `✗ test name (123 ms)`
  const summary = out.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/);
  const failed = summary ? Number(summary[1] || 0) : (out.match(/✗|×/g) || []).length;
  const passed = summary ? Number(summary[3] || 0) : (out.match(/✓/g) || []).length;
  const skipped = summary ? Number(summary[2] || 0) : 0;
  const parsedFailures = [];
  const failBlock = /(?:●|✗|FAIL)\s+([^\n]+)\n([\s\S]*?)(?=\n(?:●|✗|PASS|FAIL|Tests:|$))/g;
  let m;
  while ((m = failBlock.exec(out)) && parsedFailures.length < 50) {
    const name = m[1].trim();
    const fileMatch = m[2].match(/\bat\s+[^\s(]+\s+\(([^:]+):(\d+):\d+\)/) || m[2].match(/\bat\s+([^:\s]+):(\d+):\d+/);
    parsedFailures.push({
      file: fileMatch ? fileMatch[1] : null,
      line: fileMatch ? Number(fileMatch[2]) : null,
      msg: name,
    });
  }
  return { passed, failed, skipped, parsedFailures };
}

function parseMochaLike(out) {
  const passing = Number((out.match(/(\d+)\s+passing/) || [])[1] || 0);
  const failing = Number((out.match(/(\d+)\s+failing/) || [])[1] || 0);
  const pending = Number((out.match(/(\d+)\s+pending/) || [])[1] || 0);
  const parsedFailures = [];
  const re = /\d+\)\s+([^\n]+)\n\s+([^\n]+)/g;
  let m;
  while ((m = re.exec(out)) && parsedFailures.length < 50) {
    parsedFailures.push({ file: null, line: null, msg: `${m[1].trim()} — ${m[2].trim()}` });
  }
  return { passed: passing, failed: failing, skipped: pending, parsedFailures };
}

function parsePytest(out) {
  const summary = out.match(/=+\s*(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(?:(\d+)\s+skipped,?\s*)?/);
  const failed = summary ? Number(summary[1] || 0) : 0;
  const passed = summary ? Number(summary[2] || 0) : 0;
  const skipped = summary ? Number(summary[3] || 0) : 0;
  const parsedFailures = [];
  // pytest: FAILED tests/foo.py::test_bar - assert 1 == 2
  const re = /FAILED\s+([^:]+):?:?([^\s]+)?\s*(?:-\s*(.*))?/g;
  let m;
  while ((m = re.exec(out)) && parsedFailures.length < 50) {
    parsedFailures.push({ file: m[1], line: null, msg: (m[3] || m[2] || "test failed").trim() });
  }
  return { passed, failed, skipped, parsedFailures };
}

function parseCargo(out) {
  // test result: FAILED. 3 passed; 2 failed; 1 ignored
  const summary = out.match(/test result:.*?(\d+)\s+passed;\s+(\d+)\s+failed;?\s*(?:(\d+)\s+ignored)?/);
  const passed = summary ? Number(summary[1]) : 0;
  const failed = summary ? Number(summary[2]) : 0;
  const skipped = summary ? Number(summary[3] || 0) : 0;
  const parsedFailures = [];
  const re = /---- ([^\s]+) stdout ----\n([\s\S]*?)(?=\n---- |\nfailures:|\ntest result)/g;
  let m;
  while ((m = re.exec(out)) && parsedFailures.length < 50) {
    parsedFailures.push({ file: null, line: null, msg: `${m[1]}: ${m[2].trim().slice(0, 200)}` });
  }
  return { passed, failed, skipped, parsedFailures };
}

function parseGo(out) {
  // --- FAIL: TestFoo (0.00s) / PASS / ok ...
  const passed = (out.match(/^--- PASS/gm) || []).length;
  const failed = (out.match(/^--- FAIL/gm) || []).length;
  const skipped = (out.match(/^--- SKIP/gm) || []).length;
  const parsedFailures = [];
  const re = /--- FAIL:\s+([^\s]+)\s+\([^)]+\)\n([\s\S]*?)(?=\n(?:---|PASS|FAIL|ok|$))/g;
  let m;
  while ((m = re.exec(out)) && parsedFailures.length < 50) {
    const body = m[2];
    const fileMatch = body.match(/\b([\w./-]+\.go):(\d+):/);
    parsedFailures.push({
      file: fileMatch ? fileMatch[1] : null,
      line: fileMatch ? Number(fileMatch[2]) : null,
      msg: `${m[1]}: ${body.trim().slice(0, 200)}`,
    });
  }
  return { passed, failed, skipped, parsedFailures };
}

/**
 * Run a test command. Never throws; always returns a structured result.
 *
 * @param {object} opts
 * @param {string} opts.runner — binary name; MUST be in allowedRunners()
 * @param {string} opts.projectPath — relative to workspace root or absolute inside it
 * @param {string[]} [opts.args] — args passed to the runner
 * @param {number} [opts.timeoutMs] — overrides CONCORD_TEST_TIMEOUT_MS / 5min
 */
export function runTests({ runner, projectPath, args = [], timeoutMs } = {}) {
  if (!runner || typeof runner !== "string") {
    return { ok: false, reason: "runner_required" };
  }
  if (!allowedRunners().includes(runner)) {
    return { ok: false, reason: "runner_not_allowed", runner, allowed: allowedRunners() };
  }
  if (!projectPath || typeof projectPath !== "string") {
    return { ok: false, reason: "project_path_required" };
  }
  if (!isInsideWorkspace(projectPath)) {
    return { ok: false, reason: "path_outside_workspace", projectPath, workspaceRoot: workspaceRoot() };
  }
  const abs = pathResolve(workspaceRoot(), projectPath);
  if (!existsSync(abs)) return { ok: false, reason: "path_not_found", projectPath };
  let stat;
  try { stat = statSync(abs); } catch (e) { return { ok: false, reason: "stat_failed", error: e?.message }; }
  if (!stat.isDirectory()) return { ok: false, reason: "path_not_directory" };
  if (!Array.isArray(args)) return { ok: false, reason: "args_must_be_array" };
  for (const a of args) {
    if (typeof a !== "string") return { ok: false, reason: "args_must_be_strings" };
  }

  const wall = Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : (Number(process.env.CONCORD_TEST_TIMEOUT_MS) > 0
      ? Number(process.env.CONCORD_TEST_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS);

  const startedAt = Date.now();
  const p = spawnSync(runner, [...args], {
    cwd: abs,
    encoding: "utf-8",
    timeout: wall,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    env: { ...process.env, CI: "1", NODE_ENV: process.env.NODE_ENV || "test" },
  });
  const durationMs = Date.now() - startedAt;
  if (p.error) {
    return {
      ok: false,
      reason: p.error.code === "ENOENT" ? "runner_not_found" : "spawn_error",
      error: String(p.error.message || p.error),
      runner, durationMs,
    };
  }
  if (p.signal === "SIGTERM" || p.status === null) {
    return { ok: false, reason: "timeout", runner, durationMs, timeoutMs: wall };
  }
  const exitCode = typeof p.status === "number" ? p.status : -1;
  const stdout = String(p.stdout || "").slice(0, 200_000);
  const stderr = String(p.stderr || "").slice(0, 200_000);
  const parsed = parseRunnerOutput(runner, stdout, stderr);
  return {
    ok: true,
    runner,
    projectPath,
    exitCode,
    durationMs,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    verdict: exitCode === 0 ? "pass" : "fail",
    parsedFailures: parsed.parsedFailures,
    stdout,
    stderr,
  };
}
