#!/usr/bin/env node
// scripts/runtime-capability-coverage.mjs — Phase 5 runtime capability coverage
//
// Reconciles unique runtime (domain, action) pairs against invocation + verification.
// Honest denominators: never claim 15,155 tested if brain-backed / external / interactive
// buckets were skipped.
//
// Usage:
//   node scripts/runtime-capability-coverage.mjs
//   node scripts/runtime-capability-coverage.mjs --class A
//   node scripts/runtime-capability-coverage.mjs --domain math --limit 20
//   node scripts/runtime-capability-coverage.mjs --no-check-logging

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootEngine, enumerateMacros } from "./contracts/harness.mjs";
import { buildLensBehavioralInput, LENS_BEHAVIORAL_FIXTURES } from "./lib/lens-behavioral-fixtures.mjs";
import { buildRuntimeCoverageInput, STATEFUL_COVERAGE_MACRO_IDS, RUNTIME_COVERAGE_FIXTURES, preflightCoverageSetup } from "./lib/runtime-coverage-fixtures.mjs";
import { classifyMacro } from "../server/lib/runtime/macro-capability-classifier.js";
import { deriveCompletionStatus } from "../server/lib/runtime/completion-status.js";
import {
  runLensActionContract,
  LENS_ACTION_STATUS,
} from "../server/lib/runtime/lens-behavioral-contract.js";
import { SUBSTRATE_ORACLE_CASES } from "../server/lib/runtime/substrate-oracles.js";
import { evaluateDomainAcceptance } from "../server/lib/runtime/domain-acceptance.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PHASE4_BASELINE = path.join(ROOT, "audit/phase-4b-baseline.json");
const PHASE5_BASELINE = path.join(ROOT, "audit/phase-5-baseline.json");

const args = process.argv.slice(2);
const classFilter = args.includes("--class") ? args[args.indexOf("--class") + 1]?.toUpperCase() : null;
const domainFilter = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : null;
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : null;
const checkLogging = !args.includes("--no-check-logging");
const jsonOut = args.includes("--json-out")
  ? args[args.indexOf("--json-out") + 1] || "audit/runtime-capability-coverage.json"
  : "audit/runtime-capability-coverage.json";

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function aggregateByDomain(rows) {
  const byDomain = {};
  for (const row of rows) {
    if (!byDomain[row.domain]) {
      byDomain[row.domain] = {
        total: 0,
        verified: 0,
        failed: 0,
        unexercised: 0,
        blocked: 0,
      };
    }
    const b = byDomain[row.domain];
    b.total++;
    if (row.completionStatus === "VERIFIED") b.verified++;
    else if (row.completionStatus === "FAILED_BUG" || row.completionStatus === "FAILED_INCORRECT_RESULT") b.failed++;
    else if (row.completionStatus === "UNEXERCISED" || row.completionStatus === "REGISTERED_ONLY") b.unexercised++;
    else b.blocked++;
  }
  return byDomain;
}

async function main() {
  const phase4 = loadJson(PHASE4_BASELINE);
  console.error("Phase 5: booting engine for runtime capability enumeration...");
  const boot = await bootEngine({ awaitGhostFleet: true });
  const { dispatchLensRun, makeInternalCtx, MACROS, lensActions, brainBacked } = boot;
  const ctx = makeInternalCtx("runtime-capability-coverage");
  const db = globalThis._concordDB;
  const dispatchTimeoutMs = Number(process.env.CONCORD_COVERAGE_TIMEOUT_MS || 8000);

  async function timedDispatch(domain, action, input, dispatchCtx) {
    let timer;
    try {
      return await Promise.race([
        dispatchLensRun(domain, action, input, dispatchCtx),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("coverage_timeout")), dispatchTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  await preflightCoverageSetup(timedDispatch, ctx);

  const enumerated = enumerateMacros(MACROS, lensActions, brainBacked);
  const oracleByKey = new Map(SUBSTRATE_ORACLE_CASES.map((c) => [`${c.domain}.${c.action}`, c]));

  function resolveAction(domain, action) {
    const key = `${domain}.${action}`;
    if (lensActions?.has(key)) return "lens_actions";
    if (MACROS.get(domain)?.has(action)) return "macros";
    return null;
  }

  function isBrainBacked(domain, action) {
    return brainBacked?.has(`${domain}.${action}`) ?? false;
  }

  const registeredKeys = new Set(enumerated.map((m) => m.macroId));
  const actionRows = [];
  const statusCounts = {};
  const classCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const completionCounts = {};
  const failureByType = {};

  let processed = 0;
  for (const m of enumerated) {
    if (domainFilter && m.domain !== domainFilter) continue;
    const classification = classifyMacro(m.domain, m.name);
    if (classFilter && classification.class !== classFilter) continue;
    if (limit != null && processed >= limit) break;

    classCounts[classification.class] = (classCounts[classification.class] || 0) + 1;
    const key = m.macroId;
    const hasStructuredFixture = key in LENS_BEHAVIORAL_FIXTURES || key in RUNTIME_COVERAGE_FIXTURES;
    const oracleCase = oracleByKey.get(key);

    let row = {
      domain: m.domain,
      action: m.name,
      macroId: key,
      path: m.path,
      classification: classification.class,
      classificationReason: classification.reason,
      headlessSafe: classification.headlessSafe,
      registered: true,
      skipReason: m.skip ? m.skipReason : null,
    };

    if (classification.class === "D") {
      row = {
        ...row,
        invoked: false,
        contractStatus: "SKIPPED_INTERACTIVE",
        completionStatus: deriveCompletionStatus({ skippedClassD: true }),
      };
      actionRows.push(row);
      statusCounts.SKIPPED_INTERACTIVE = (statusCounts.SKIPPED_INTERACTIVE || 0) + 1;
      completionCounts[row.completionStatus] = (completionCounts[row.completionStatus] || 0) + 1;
      processed++;
      continue;
    }

    if (STATEFUL_COVERAGE_MACRO_IDS.has(key) && key.startsWith("dila.")) {
      row = {
        ...row,
        invoked: false,
        contractStatus: "SKIPPED_STRUCTURED_FIXTURE",
        completionStatus: deriveCompletionStatus({
          contractStatus: LENS_ACTION_STATUS.SKIPPED_STRUCTURED_FIXTURE,
        }),
        skipReason: "stateful_heavy_runtime",
      };
      actionRows.push(row);
      statusCounts[LENS_ACTION_STATUS.SKIPPED_STRUCTURED_FIXTURE] =
        (statusCounts[LENS_ACTION_STATUS.SKIPPED_STRUCTURED_FIXTURE] || 0) + 1;
      completionCounts[row.completionStatus] = (completionCounts[row.completionStatus] || 0) + 1;
      processed++;
      continue;
    }

    if (m.skip && m.skipReason === "brain_backed") {
      row = {
        ...row,
        invoked: false,
        contractStatus: LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED,
        completionStatus: deriveCompletionStatus({
          contractStatus: LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED,
        }),
      };
      actionRows.push(row);
      statusCounts[LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED] =
        (statusCounts[LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED] || 0) + 1;
      completionCounts[row.completionStatus] = (completionCounts[row.completionStatus] || 0) + 1;
      processed++;
      continue;
    }

    const validInput = buildRuntimeCoverageInput(
      m.domain,
      m.name,
      oracleCase
        ? { artifact: { id: `coverage-oracle-${key}`, data: {} }, ...oracleCase.params }
        : buildLensBehavioralInput(m.domain, m.name),
    );
    const result = await runLensActionContract({
      lensId: "runtime-coverage",
      domain: m.domain,
      action: m.name,
      dispatch: timedDispatch,
      resolveAction,
      isBrainBacked,
      ctx,
      db,
      checkLogging,
      validInput,
      hasStructuredFixture,
    });

    let oracleVerified = false;
    if (oracleCase && result.status === LENS_ACTION_STATUS.PASSED) {
      try {
        const raw = await timedDispatch(m.domain, m.name, validInput, ctx);
        oracleVerified = oracleCase.verify(raw);
      } catch {
        oracleVerified = false;
      }
    }

    row = {
      ...row,
      invoked: true,
      contractStatus: result.status,
      ok: result.ok,
      failureType: result.failureType,
      priority: result.priority,
      durationMs: result.durationMs,
      oracleVerified,
      completionStatus: deriveCompletionStatus({
        contractStatus: result.status,
        failureType: result.failureType,
        oracleVerified,
      }),
    };

    if (!oracleVerified && result.status === LENS_ACTION_STATUS.FAILED && result.failureType) {
      failureByType[result.failureType] = (failureByType[result.failureType] || 0) + 1;
    }

    actionRows.push(row);
    statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;
    completionCounts[row.completionStatus] = (completionCounts[row.completionStatus] || 0) + 1;
    processed++;

    if (processed % 500 === 0) {
      console.error(`  ... ${processed} actions processed`);
    }
  }

  const invocationByKey = new Map();
  for (const row of actionRows) {
    if (!row.invoked) continue;
    const key = row.macroId;
    invocationByKey.set(key, {
      ok: row.contractStatus === LENS_ACTION_STATUS.PASSED,
      verified: row.oracleVerified,
      logged: row.contractStatus === LENS_ACTION_STATUS.PASSED,
    });
    if (row.contractStatus === LENS_ACTION_STATUS.FAILED) {
      invocationByKey.set(`${key}@invalid`, { ok: false, threw: false });
    }
  }

  const domainAcceptance = [];
  const domainsSeen = new Set(actionRows.map((r) => r.domain));
  for (const domain of [...domainsSeen].sort()) {
    const reps = SUBSTRATE_ORACLE_CASES.filter((c) => c.domain === domain).map((c) => c.action);
    domainAcceptance.push(
      evaluateDomainAcceptance(domain, {
        registeredKeys,
        invocationByKey,
        representativeActions: reps.length ? reps : undefined,
      })
    );
  }

  const headlessSafe = enumerated.filter((m) => classifyMacro(m.domain, m.name).headlessSafe).length;
  const verified = actionRows.filter((r) => r.completionStatus === "VERIFIED").length;
  const failed = actionRows.filter(
    (r) => r.completionStatus === "FAILED_BUG" || r.completionStatus === "FAILED_INCORRECT_RESULT"
  ).length;
  const brainBackedSkipped = statusCounts[LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED] || 0;
  const externalSkipped = statusCounts[LENS_ACTION_STATUS.SKIPPED_EXTERNAL_DEPENDENCY] || 0;
  const destructiveSkipped = statusCounts[LENS_ACTION_STATUS.SKIPPED_DESTRUCTIVE] || 0;
  const interactiveSkipped = statusCounts.SKIPPED_INTERACTIVE || 0;
  const invoked = actionRows.filter((r) => r.invoked).length;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "5",
    baseline: {
      phase4b: phase4,
      note: "Phase 5 reconciles unique runtime pairs — do not sum with static registration or lens-action counts",
    },
    summary: {
      runtimeUniquePairs: enumerated.length,
      processed: actionRows.length,
      registered: enumerated.length,
      invoked,
      verified,
      failed,
      headlessSafeEstimate: headlessSafe,
      byClass: classCounts,
      byContractStatus: statusCounts,
      byCompletionStatus: completionCounts,
      failureByType,
      skipped: {
        brainBacked: brainBackedSkipped,
        externalDependency: externalSkipped,
        destructive: destructiveSkipped,
        interactiveStateful: interactiveSkipped,
      },
      coverageDenominator: {
        note: "Never claim all runtime pairs were deterministically verified",
        runtimeUniquePairs: enumerated.length,
        headlessInvoked: invoked,
        deterministicVerified: verified,
        brainBackedSkipped,
        externalDependencySkipped: externalSkipped,
        interactiveSkipped,
        destructiveSkipped,
        failed,
        oracleCases: SUBSTRATE_ORACLE_CASES.length,
        oracleVerified: actionRows.filter((r) => r.oracleVerified).length,
      },
      domainsCompleteAF: domainAcceptance.filter((d) => d.complete).length,
      domainsTotal: domainAcceptance.length,
    },
    byDomain: aggregateByDomain(actionRows),
    domainAcceptance,
    unresolvedFailures: actionRows
      .filter((r) => r.completionStatus === "FAILED_BUG" || r.completionStatus === "FAILED_INCORRECT_RESULT")
      .slice(0, 200)
      .map((r) => ({
        macroId: r.macroId,
        failureType: r.failureType,
        priority: r.priority,
        contractStatus: r.contractStatus,
      })),
    actions: actionRows,
  };

  const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log(`Wrote ${outPath}`);
  console.log(
    `Runtime pairs: ${report.summary.runtimeUniquePairs} | invoked: ${invoked} | verified: ${verified} | failed: ${failed}`
  );
  console.log(
    `Skipped — brain: ${brainBackedSkipped} external: ${externalSkipped} interactive: ${interactiveSkipped} destructive: ${destructiveSkipped}`
  );

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
