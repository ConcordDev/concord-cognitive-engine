// server/lib/pce/verification-pipeline.js
//
// PCE-4 — 12-gate verification pipeline (hard rejects + scored gates).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as acorn from "acorn";
import { parseAndIndexFile } from "./ast-cache.js";
import { critiqueResult } from "../runtime/critic.js";
import { verifyRepoTests } from "../runtime/coding-loop-closure.js";

const execFileAsync = promisify(execFile);

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];

export async function gateSyntax(changedFiles, repoRoot) {
  const failures = [];
  for (const fp of changedFiles) {
    try {
      const content = readFileSync(join(repoRoot, fp), "utf8");
      acorn.parse(content, { ecmaVersion: "latest", sourceType: "module" });
    } catch (e) {
      failures.push({ file: fp, error: e.message });
    }
  }
  return { gate: "syntax", ok: failures.length === 0, hardReject: failures.length > 0, failures };
}

export async function gateAstIntegrity(changedFiles, repoRoot) {
  const failures = [];
  for (const fp of changedFiles) {
    const content = readFileSync(join(repoRoot, fp), "utf8");
    const parsed = parseAndIndexFile(fp, content);
    if (!parsed.parseOk) failures.push({ file: fp, reason: "parse_error" });
  }
  return { gate: "ast_integrity", ok: failures.length === 0, hardReject: failures.length > 0, failures };
}

export async function gateAffectedTests({ testPattern, repoRoot }) {
  const verify = await verifyRepoTests({ testPattern, cwd: repoRoot });
  return {
    gate: "affected_tests",
    ok: verify.ok,
    hardReject: verify.testsPassed === false,
    details: verify,
  };
}

export async function gateStaticCheck(changedFiles, repoRoot) {
  const failures = [];
  for (const fp of changedFiles.filter((f) => /\.(js|mjs|cjs)$/.test(f))) {
    try {
      await execFileAsync("node", ["--check", join(repoRoot, fp)], { timeout: 10_000 });
    } catch (e) {
      failures.push({ file: fp, error: e.message });
    }
  }
  return { gate: "static_check", ok: failures.length === 0, hardReject: failures.length > 0, failures };
}

export function gateSecretScan(changedFiles, repoRoot) {
  const hits = [];
  for (const fp of changedFiles) {
    const content = readFileSync(join(repoRoot, fp), "utf8");
    for (const pat of SECRET_PATTERNS) {
      if (pat.test(content)) hits.push({ file: fp, pattern: pat.source });
    }
  }
  return { gate: "secret_scan", ok: hits.length === 0, hardReject: hits.length > 0, hits };
}

/** Reject fabricated progress / fake-data patterns in generated code. */
const HONESTY_PATTERNS = [
  { re: /\bsetInterval\s*\(/, label: "setInterval_fake_progress" },
  { re: /\bsetTimeout\s*\([^)]*,\s*\d+\s*\).*(?:progress|percent|loading)/i, label: "timed_fake_progress" },
  { re: /Math\.random\s*\(\s*\).*(?:progress|percent|match)/i, label: "random_fake_metric" },
];

export function gateHonestyScan(changedFiles, repoRoot) {
  const hits = [];
  for (const fp of changedFiles) {
    let content;
    try {
      content = readFileSync(join(repoRoot, fp), "utf8");
    } catch {
      continue;
    }
    for (const { re, label } of HONESTY_PATTERNS) {
      if (re.test(content)) hits.push({ file: fp, label });
    }
  }
  return { gate: "honesty_scan", ok: hits.length === 0, hardReject: hits.length > 0, hits };
}

const DANGEROUS_SQL = [
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\s+\w+\s*;/i,
];

export function gateDangerousSql(changedFiles, repoRoot) {
  const hits = [];
  for (const fp of changedFiles) {
    if (!/migration/i.test(fp)) continue;
    let content;
    try {
      content = readFileSync(join(repoRoot, fp), "utf8");
    } catch {
      continue;
    }
    for (const re of DANGEROUS_SQL) {
      if (re.test(content)) hits.push({ file: fp, pattern: re.source });
    }
  }
  return { gate: "dangerous_sql", ok: hits.length === 0, hardReject: hits.length > 0, hits };
}

export function gateTestDiffRisk({ productionFiles = [], testFiles = [] } = {}) {
  const risk = testFiles.length > 0 && productionFiles.length > 0
    ? testFiles.length / (productionFiles.length + testFiles.length)
    : 0;
  return {
    gate: "test_diff_risk",
    ok: risk < 0.5,
    hardReject: testFiles.length > 0 && productionFiles.length === 0,
    risk,
    testFiles,
    productionFiles,
  };
}

export function gateMissionCritic({ intent, verifyResult, testsPassed }) {
  const critic = critiqueResult({
    objective: intent,
    result: verifyResult,
    testsPassed,
    executionOutcome: testsPassed ? "SUCCESS" : "FAILED",
    evidence: [{ kind: "verification_pipeline" }],
  });
  return {
    gate: "mission_critic",
    ok: critic.verdict !== "reject",
    hardReject: critic.verdict === "reject" && testsPassed === false,
    critic,
  };
}

/**
 * Run verification pipeline with escalation: fast gates first, then slow.
 */
export async function runVerificationPipeline({
  changedFiles = [],
  repoRoot,
  intent,
  testPattern,
  productionFiles,
  testFiles,
} = {}) {
  const gates = [];
  const hardFailures = [];

  const syntax = await gateSyntax(changedFiles, repoRoot);
  gates.push(syntax);
  if (syntax.hardReject) hardFailures.push(syntax);

  const ast = await gateAstIntegrity(changedFiles, repoRoot);
  gates.push(ast);
  if (ast.hardReject) hardFailures.push(ast);

  const secrets = gateSecretScan(changedFiles, repoRoot);
  gates.push(secrets);
  if (secrets.hardReject) hardFailures.push(secrets);

  const honesty = gateHonestyScan(changedFiles, repoRoot);
  gates.push(honesty);
  if (honesty.hardReject) hardFailures.push(honesty);

  const dangerousSql = gateDangerousSql(changedFiles, repoRoot);
  gates.push(dangerousSql);
  if (dangerousSql.hardReject) hardFailures.push(dangerousSql);

  const testRisk = gateTestDiffRisk({ productionFiles, testFiles });
  gates.push(testRisk);

  let affected = { ok: true, gate: "affected_tests", skipped: !testPattern };
  if (testPattern && hardFailures.length === 0) {
    affected = await gateAffectedTests({ testPattern, repoRoot });
    gates.push(affected);
    if (affected.hardReject) hardFailures.push(affected);
  }

  if (hardFailures.length === 0) {
    const stat = await gateStaticCheck(changedFiles, repoRoot);
    gates.push(stat);
    if (stat.hardReject) hardFailures.push(stat);
  }

  const critic = gateMissionCritic({
    intent,
    verifyResult: affected.details || affected,
    testsPassed: affected.ok !== false,
  });
  gates.push(critic);

  const ok = hardFailures.length === 0 && critic.ok;
  return {
    ok,
    gates,
    hardFailures,
    testsPassed: affected.ok !== false,
    critic: critic.critic,
  };
}
