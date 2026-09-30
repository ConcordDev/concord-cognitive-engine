// server/lib/runtime/coding-loop-closure.js
//
// Closed coding loop — search → patch → test → critic → retry (no external keys).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isWithinRoot } from "../safe-path.js";
import { verifyCodingTests } from "../coding-loop.js";
import { critiqueResult } from "./critic.js";

const execFileAsync = promisify(execFile);
const MAX_ITERATIONS = Number(process.env.CONCORD_CODING_LOOP_MAX_ITER) || 5;

function repoRoot(cwd) {
  const root = cwd || process.cwd();
  return root.endsWith("/server") ? root.replace(/\/server$/, "") : root;
}

/**
 * Apply a single search/replace patch to a file within repo bounds.
 */
export async function applySearchReplacePatch({
  repoRoot: rootIn, filePath, search, replace,
} = {}) {
  const root = repoRoot(rootIn);
  const abs = join(root, filePath);
  if (!isWithinRoot(root, abs)) {
    return { ok: false, reason: "path_outside_repo", filePath };
  }
  try {
    const prior = await readFile(abs, "utf8");
    if (!prior.includes(search)) {
      return { ok: false, reason: "search_not_found", filePath };
    }
    const next = prior.replace(search, replace);
    if (next === prior) {
      return { ok: false, reason: "no_change", filePath };
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, next, "utf8");
    return { ok: true, filePath, bytesBefore: prior.length, bytesAfter: next.length };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e), filePath };
  }
}

/**
 * Run targeted tests — any file under server/tests matching pattern.
 */
export async function verifyRepoTests({ testPattern, cwd, testGlob } = {}) {
  const pattern = String(testPattern || "").trim();
  if (!pattern) return { ok: false, reason: "missing_test_pattern" };

  const root = repoRoot(cwd);
  const { existsSync } = await import("node:fs");
  const serverDir = join(root, "server");
  const runDir = existsSync(join(serverDir, "tests")) ? serverDir : root;
  const glob = testGlob || (runDir === serverDir
    ? `tests/**/*${pattern}*.test.js`
    : `tests/**/*.test.js`);

  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["--test", "--test-name-pattern", pattern, glob],
      { cwd: runDir, timeout: 180_000, env: { ...process.env, NODE_ENV: "test" } },
    );
    const combined = `${stdout}\n${stderr}`;
    const failed = /not ok/i.test(combined) && !/# pass \d+/.test(combined);
    return { ok: !failed, pattern, testsPassed: !failed, outputTail: combined.slice(-3000) };
  } catch (e) {
    const out = `${e.stdout || ""}\n${e.stderr || ""}`;
    const passed = e.code === 0;
    return {
      ok: passed,
      pattern,
      testsPassed: passed,
      outputTail: out.slice(-3000),
      error: e.message,
    };
  }
}

/**
 * Closed loop: apply patches, verify tests, critic gate, retry until pass or max iter.
 */
export async function runClosedCodingLoop({
  db, goal, patches = [], testPattern, repoRoot: rootIn, maxIterations = MAX_ITERATIONS,
} = {}) {
  const root = repoRoot(rootIn);
  const iterations = [];
  let applied = [];
  let verify = { ok: false, testsPassed: false };
  const pattern = testPattern || String(goal || "").match(/[a-z][a-z0-9_-]{2,}/gi)?.[0] || "mission";

  for (let i = 0; i < maxIterations; i++) {
    const batchResults = [];
    if (i === 0) {
      for (const p of patches) {
        if (!p?.filePath || p.search == null || p.replace == null) continue;
        const r = await applySearchReplacePatch({
          repoRoot: root, filePath: p.filePath, search: p.search, replace: p.replace,
        });
        batchResults.push(r);
        if (r.ok) applied.push({ ...p, iteration: i });
      }
    }

    verify = await verifyRepoTests({ testPattern: pattern, cwd: root });
    if (!verify.ok && verify.reason === "missing_test_pattern") {
      verify = await verifyCodingTests({ testPattern: pattern, cwd: root });
    }

    const critic = critiqueResult({
      objective: goal,
      result: { ok: verify.ok, applied: batchResults.filter((r) => r.ok).length },
      testsPassed: verify.testsPassed,
      executionOutcome: verify.ok ? "SUCCESS" : "FAILED",
      evidence: batchResults.length ? [{ kind: "patch_apply", count: batchResults.length }] : [],
    });

    iterations.push({
      iteration: i,
      applied: batchResults,
      verify: { ok: verify.ok, testsPassed: verify.testsPassed },
      critic: critic.verdict,
      progression: critic.progression,
    });

    if (verify.ok && verify.testsPassed) {
      return {
        ok: true,
        goal,
        iterations: i + 1,
        applied,
        verify,
        critic,
        history: iterations,
      };
    }

    if (critic.progression === "rollback" || !patches.length) break;
  }

  return {
    ok: false,
    goal,
    iterations: iterations.length,
    applied,
    verify,
    history: iterations,
    reason: verify.ok ? "critic_rejected" : "tests_failed",
  };
}

/**
 * Mission internal tool handler — args.patches[], args.testPattern, args.goal
 */
export async function runCodingLoopClosureStep({ db, mission, step, repoRoot: rootIn } = {}) {
  const patches = step?.args?.patches || [];
  const goal = step?.args?.goal || mission?.goal || mission?.title;
  const testPattern = step?.args?.testPattern || step?.args?.query;
  const result = await runClosedCodingLoop({
    db,
    goal,
    patches,
    testPattern,
    repoRoot: rootIn || step?.args?.repoRoot,
    maxIterations: step?.args?.maxIterations,
  });
  return { ok: result.ok, result };
}
