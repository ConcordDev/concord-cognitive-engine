#!/usr/bin/env node
// server/scripts/repair-cortex-scan.js
//
// Phase 5 — list candidate auto-fix tasks.
// Runs the detector suite, ingests the delta into repair-cortex's bridge,
// and prints the pending task queue WITHOUT applying anything.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAllDetectors } from "../lib/detectors/index.js";
import { loadBaseline, diffAgainstBaseline } from "../lib/detectors/baseline.js";
import { ingestDetectorDelta, pendingTasks } from "../emergent/repair-cortex/detector-bridge.js";
import { listFixes } from "../lib/autofix/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

async function main() {
  console.log("[repair-cortex:scan] running detectors…");
  const report = await runAllDetectors({ root: REPO_ROOT });
  console.log(`[repair-cortex:scan] ${report.detectorCount} detectors; ${report.totals.total} findings`);

  const baseline = await loadBaseline(REPO_ROOT);
  const delta = baseline.fingerprints ? diffAgainstBaseline(report, baseline) : null;
  console.log(`[repair-cortex:scan] vs baseline: +${delta?.addedCount || 0} new, -${delta?.removedCount || 0} retired`);

  const result = await ingestDetectorDelta(report, delta);
  console.log(`[repair-cortex:scan] enqueued ${result.enqueued} tasks, observed ${result.observed} findings`);

  const tasks = pendingTasks();
  if (tasks.length === 0) {
    console.log("\nNo pending fix tasks. Nothing to do.");
    return;
  }
  console.log(`\nPending fix tasks (${tasks.length}):`);
  for (const t of tasks) {
    console.log(`  [${t.fix} / ${t.riskTier}] ${t.finding.detector} :: ${t.finding.message}`);
    console.log(`     ${t.finding.location || "(no location)"}`);
  }

  console.log(`\nFix registry has ${listFixes().length} registered patterns:`);
  for (const f of listFixes()) {
    console.log(`  ${f.id}  (${f.riskTier})  — ${f.label}`);
  }
  console.log("\nRun `npm run repair-cortex:apply` (with --dry-run first) to act.");
}

main().catch((err) => {
  console.error("[repair-cortex:scan] failed:", err);
  process.exit(1);
});
