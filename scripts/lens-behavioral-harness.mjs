#!/usr/bin/env node
// scripts/lens-behavioral-harness.mjs — Phase 4B full lens behavioral verification
//
// Usage:
//   node scripts/lens-behavioral-harness.mjs
//   node scripts/lens-behavioral-harness.mjs --lens sentinel
//   node scripts/lens-behavioral-harness.mjs --no-check-logging

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootEngine, enumerateMacros } from "./contracts/harness.mjs";
import {
  collectMacroDomains,
  listLensIds,
  scanLens,
} from "./lib/lens-backend-scan.mjs";
import {
  buildLensBehavioralInput,
  LENS_BEHAVIORAL_FIXTURES,
} from "./lib/lens-behavioral-fixtures.mjs";
import { classifyMacro } from "../server/lib/runtime/macro-capability-classifier.js";
import {
  isExemptLens,
  runLensActionContract,
  LENS_ACTION_STATUS,
  failurePriority,
} from "../server/lib/runtime/lens-behavioral-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "audit/phase-4b-baseline.json");
const args = process.argv.slice(2);
const lensFilter = args.includes("--lens") ? args[args.indexOf("--lens") + 1] : null;
const jsonOut = args.includes("--json-out")
  ? args[args.indexOf("--json-out") + 1] || "audit/lens-behavioral-report.json"
  : "audit/lens-behavioral-report.json";
const checkLogging = !args.includes("--no-check-logging");

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function aggregateByDomain(actionRows) {
  const byDomain = {};
  for (const row of actionRows) {
    if (!row.domain) continue;
    if (!byDomain[row.domain]) {
      byDomain[row.domain] = { passed: 0, failed: 0, skipped: 0, actions: [] };
    }
    const bucket = byDomain[row.domain];
    if (row.status === LENS_ACTION_STATUS.PASSED) bucket.passed++;
    else if (row.status === LENS_ACTION_STATUS.FAILED) bucket.failed++;
    else bucket.skipped++;
    bucket.actions.push(row);
  }
  return byDomain;
}

function aggregateByClass(actionRows) {
  const byClass = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const row of actionRows) {
    if (row.classification) byClass[row.classification] = (byClass[row.classification] || 0) + 1;
  }
  return byClass;
}

function probeActionsForDomains(calledDomains, resolveAction, MACROS, lensActions) {
  const staticProbes = [
    "list",
    "status",
    "get",
    "mine",
    "browse",
    "catalog",
    "crewList",
    "techList",
    "repo-list",
    "photoLogList",
    "clientList",
    "scheduleList",
  ];
  const out = [];
  for (const domain of calledDomains) {
    let found = false;
    for (const action of staticProbes) {
      if (resolveAction(domain, action)) {
        out.push({ domain, action });
        found = true;
        break;
      }
    }
    if (found) continue;

    const candidates = [];
    if (lensActions instanceof Map) {
      for (const key of lensActions.keys()) {
        if (key.startsWith(`${domain}.`)) candidates.push(key.slice(domain.length + 1));
      }
    }
    const macroMap = MACROS?.get?.(domain);
    if (macroMap) {
      for (const name of macroMap.keys()) candidates.push(name);
    }
    const preferred = candidates.find((a) =>
      /^(list|.*List|.*-list|status|get|catalog|browse|mine|metrics|traces)$/i.test(a),
    );
    const action = preferred || candidates[0] || "list";
    if (resolveAction(domain, action)) out.push({ domain, action });
  }
  return out.slice(0, 5);
}

async function main() {
  const baseline = loadBaseline();
  const macroDomains = collectMacroDomains();
  const lensIds = listLensIds().filter((id) => !lensFilter || id === lensFilter);

  const staticScan = [];
  for (const lensId of lensIds) {
    const scan = scanLens(lensId);
    let staticVerdict;
    if (isExemptLens(lensId)) staticVerdict = "EXEMPT_NO_BACKEND";
    else if (!scan.hasPage) staticVerdict = "NO_PAGE";
    else if (scan.macroActions.length === 0 && scan.apiPaths.size === 0 && !scan.usesGeneric && scan.calledDomains.size === 0) {
      staticVerdict = "NO_BACKEND";
    } else {
      const badDomains = [...scan.calledDomains].filter((d) => !macroDomains.has(d));
      staticVerdict = badDomains.length ? "PARTIAL" : "WIRED";
    }
    staticScan.push({ ...scan, staticVerdict });
  }

  const wiredLenses = staticScan.filter((s) => s.staticVerdict === "WIRED");
  const partialLenses = staticScan.filter((s) => s.staticVerdict === "PARTIAL");
  const toTest = [...wiredLenses, ...partialLenses];
  const exempt = staticScan.filter((s) => s.staticVerdict === "EXEMPT_NO_BACKEND");

  console.error(`Phase 4B: booting engine for ${toTest.length} wired/partial lens(es)...`);
  const boot = await bootEngine({ awaitGhostFleet: true });
  const { dispatchLensRun, makeInternalCtx, MACROS, lensActions, brainBacked } = boot;
  const ctx = makeInternalCtx("lens-behavioral-harness");
  const db = globalThis._concordDB;

  function resolveAction(domain, action) {
    const key = `${domain}.${action}`;
    if (lensActions?.has(key)) return "lens_actions";
    if (MACROS.get(domain)?.has(action)) return "macros";
    return null;
  }

  function isBrainBacked(domain, action) {
    return brainBacked?.has(`${domain}.${action}`) ?? false;
  }

  const enumerated = enumerateMacros(MACROS, lensActions, brainBacked);
  const classCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const m of enumerated) {
    const { class: cls } = classifyMacro(m.domain, m.name);
    classCounts[cls]++;
  }

  const lensResults = [];
  const allActionRows = [];
  const failureByType = {};
  const failureByPriority = {};
  const statusCounts = {};

  for (const lens of toTest) {
    const actionResults = [];

    if (lens.macroActions.length === 0 && lens.usesGeneric) {
      const row = {
        lensId: lens.lensId,
        domain: null,
        action: null,
        status: LENS_ACTION_STATUS.SKIPPED_GENERIC_HOOK,
        ok: true,
        backendKind: "generic_hook",
        stages: {
          load: { pass: true },
          action_resolution: { pass: true, note: "useLensData/generic hook" },
        },
      };
      actionResults.push(row);
      allActionRows.push(row);
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    } else if (lens.macroActions.length === 0 && lens.apiPaths.size > 0) {
      const row = {
        lensId: lens.lensId,
        domain: null,
        action: null,
        status: LENS_ACTION_STATUS.SKIPPED_REST_ONLY,
        ok: true,
        backendKind: "rest_only",
        stages: {
          load: { pass: true },
          action_resolution: { pass: true, note: [...lens.apiPaths].slice(0, 3).join(", ") },
        },
      };
      actionResults.push(row);
      allActionRows.push(row);
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    } else {
      const actions = lens.macroActions.length
        ? lens.macroActions
        : probeActionsForDomains(lens.calledDomains, resolveAction, MACROS, lensActions);

      for (const { domain, action } of actions) {
        const fixtureKey = `${domain}.${action}`;
        const validInput = buildLensBehavioralInput(domain, action);
        const hasStructuredFixture = fixtureKey in LENS_BEHAVIORAL_FIXTURES;

        const result = await runLensActionContract({
          lensId: lens.lensId,
          domain,
          action,
          dispatch: dispatchLensRun,
          resolveAction,
          isBrainBacked,
          ctx,
          db,
          checkLogging,
          validInput,
          hasStructuredFixture,
        });

        const status = result.status || (result.ok ? LENS_ACTION_STATUS.PASSED : LENS_ACTION_STATUS.FAILED);
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        if (status === LENS_ACTION_STATUS.FAILED && result.failureType) {
          failureByType[result.failureType] = (failureByType[result.failureType] || 0) + 1;
          const pri = result.priority || failurePriority(result.failureType);
          failureByPriority[pri] = (failureByPriority[pri] || 0) + 1;
        }

        const row = { lensId: lens.lensId, domain, action, status, ...result };
        actionResults.push(row);
        allActionRows.push(row);
      }
    }

    const deterministicActions = actionResults.filter(
      (a) => a.status === LENS_ACTION_STATUS.PASSED || a.status === LENS_ACTION_STATUS.FAILED,
    );
    const lensOk = actionResults.every((a) => a.status !== LENS_ACTION_STATUS.FAILED);
    lensResults.push({
      lensId: lens.lensId,
      staticVerdict: lens.staticVerdict,
      behavioralStatus: lensOk ? "COMPLETE" : "FAILED",
      complete: lensOk,
      macroActionCount: lens.macroActions.length,
      actionsPassed: actionResults.filter((a) => a.status === LENS_ACTION_STATUS.PASSED).length,
      actionsFailed: actionResults.filter((a) => a.status === LENS_ACTION_STATUS.FAILED).length,
      actionsSkipped: actionResults.filter((a) => a.status?.startsWith("SKIPPED")).length,
      actions: actionResults,
      deterministicCoverage: deterministicActions.length
        ? `${actionResults.filter((a) => a.status === LENS_ACTION_STATUS.PASSED).length}/${deterministicActions.length}`
        : "n/a",
    });
  }

  const deterministicPassed = statusCounts[LENS_ACTION_STATUS.PASSED] || 0;
  const deterministicFailed = statusCounts[LENS_ACTION_STATUS.FAILED] || 0;
  const brainBackedSkipped = statusCounts[LENS_ACTION_STATUS.SKIPPED_BRAIN_BACKED] || 0;
  const externalSkipped = statusCounts[LENS_ACTION_STATUS.SKIPPED_EXTERNAL_DEPENDENCY] || 0;
  const destructiveSkipped = statusCounts[LENS_ACTION_STATUS.SKIPPED_DESTRUCTIVE] || 0;

  const unresolvedFailures = allActionRows
    .filter((r) => r.status === LENS_ACTION_STATUS.FAILED)
    .map((r) => ({
      lensId: r.lensId,
      domain: r.domain,
      action: r.action,
      failureType: r.failureType,
      priority: r.priority || failurePriority(r.failureType),
      note: r.stages
        ? Object.entries(r.stages).find(([, v]) => v.pass === false)?.[1]?.note
        : null,
    }))
    .sort((a, b) => (a.priority || "P9").localeCompare(b.priority || "P9"));

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "4B",
    baseline: baseline || { note: "audit/phase-4b-baseline.json not found" },
    summary: {
      totalLenses: lensIds.length,
      wiredLenses: wiredLenses.length,
      partialLenses: partialLenses.length,
      intentionalNoBackend: exempt.length,
      exemptLensIds: exempt.map((e) => e.lensId),
      behaviorallyInspected: toTest.length,
      lensesComplete: lensResults.filter((l) => l.complete).length,
      lensesFailed: lensResults.filter((l) => !l.complete).length,
      actionsDiscovered: allActionRows.length,
      actionsPassed: deterministicPassed,
      actionsFailed: deterministicFailed,
      actionsSkipped: allActionRows.length - deterministicPassed - deterministicFailed,
      byStatus: statusCounts,
      failureByType,
      failureByPriority,
      coverageDenominator: {
        note: "Never claim all wired lenses were deterministically proven",
        totalWiredLenses: wiredLenses.length,
        behaviorallyTested: toTest.length,
        deterministicPassed,
        deterministicFailed,
        headlessTestableRuntimePairs: enumerated.filter(
          (m) => !m.skip && classifyMacro(m.domain, m.name).headlessSafe,
        ).length,
        brainBackedSkipped,
        externalDependencySkipped: externalSkipped,
        destructiveSkipped,
        runtimeUniquePairs: enumerated.length,
        runtimeClassification: classCounts,
      },
      beforeAfter: baseline
        ? {
            baselineWired: baseline.lensWiring?.WIRED,
            currentWired: wiredLenses.length,
            baselinePartial: baseline.lensWiring?.PARTIAL,
            currentPartial: partialLenses.length,
          }
        : null,
    },
    byFailureCategory: failureByType,
    byCapabilityClass: aggregateByClass(allActionRows),
    byDomain: aggregateByDomain(allActionRows),
    lenses: lensResults,
    exempt,
    unresolvedFailures,
  };

  const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log(`Wrote ${outPath}`);
  console.log(
    `Lenses: ${report.summary.lensesComplete}/${report.summary.behaviorallyInspected} complete ` +
    `(${report.summary.intentionalNoBackend} exempt)`
  );
  console.log(
    `Deterministic actions: ${deterministicPassed} passed, ${deterministicFailed} failed, ` +
    `${brainBackedSkipped} brain-backed skipped, ${externalSkipped} external skipped`
  );
  if (deterministicFailed > 0) {
    console.error("Failures by type:", failureByType);
    console.error("Top unresolved:", unresolvedFailures.slice(0, 10));
    process.exitCode = 1;
  }

  setImmediate(() => process.exit(process.exitCode ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
