#!/usr/bin/env node
// server/scripts/repair-cortex-apply.js
//
// Phase 5 — apply registered low-risk auto-fixes.
//
// Default mode is --dry-run (prints the diff without writing). Add
// `--apply` to actually rewrite. `--apply-all-low-risk` shortcut applies
// every registered low-risk fix in order.
//
// Each rewrite is rolled back if the rewritten file fails `node --check`.

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAllDetectors } from "../lib/detectors/index.js";
import { loadBaseline, diffAgainstBaseline } from "../lib/detectors/baseline.js";
import { ingestDetectorDelta, pendingTasks, _flushPendingTasks } from "../emergent/repair-cortex/detector-bridge.js";
import { listFixes, getFix, safeApply } from "../lib/autofix/index.js";

const exec = promisify(execCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

const args = process.argv.slice(2);
const flags = {
  dryRun: !args.includes("--apply") && !args.includes("--apply-all-low-risk"),
  applyAllLowRisk: args.includes("--apply-all-low-risk"),
  fixId: (() => { const i = args.indexOf("--fix"); return i >= 0 ? args[i + 1] : null; })(),
};

async function syntaxOk(filePath) {
  try {
    await exec(`node --check "${filePath}"`);
    return true;
  } catch { return false; }
}

async function main() {
  console.log(`[repair-cortex:apply] mode=${flags.dryRun ? "dry-run" : flags.applyAllLowRisk ? "apply-all-low-risk" : "apply"}`);

  // Build the task queue.
  const report = await runAllDetectors({ root: REPO_ROOT });
  const baseline = await loadBaseline(REPO_ROOT);
  const delta = baseline.fingerprints ? diffAgainstBaseline(report, baseline) : null;
  await ingestDetectorDelta(report, delta);
  const tasks = _flushPendingTasks();
  if (tasks.length === 0) {
    console.log("[repair-cortex:apply] no pending tasks");
    return;
  }

  // Filter by fixId if requested.
  const filtered = flags.fixId ? tasks.filter(t => t.fix === flags.fixId) : tasks;
  // Apply only low-risk by default.
  const applicable = flags.applyAllLowRisk
    ? filtered.filter(t => t.riskTier === "low")
    : filtered;

  console.log(`[repair-cortex:apply] ${applicable.length} candidate task(s)`);

  // Group by file path so we make at most one write per file.
  const byFile = new Map();
  for (const task of applicable) {
    const loc = (task.finding.location || "").split(":")[0];
    if (!loc) continue;
    if (!byFile.has(loc)) byFile.set(loc, []);
    byFile.get(loc).push(task);
  }

  let appliedFiles = 0;
  let appliedTasks = 0;
  let rolledBack = 0;
  let skipped = 0;

  for (const [relPath, fileTasks] of byFile.entries()) {
    const absPath = path.resolve(REPO_ROOT, relPath);
    let original;
    try { original = await readFile(absPath, "utf-8"); }
    catch { skipped += fileTasks.length; continue; }

    let working = original;
    const log = [];
    for (const task of fileTasks) {
      const fix = getFix(task.fix);
      if (!fix) { skipped++; continue; }
      const r = safeApply(fix, relPath, working, task.finding);
      if (r.ok) {
        working = r.content;
        appliedTasks++;
        log.push({ fix: task.fix, finding: task.finding.id });
      } else {
        skipped++;
        log.push({ fix: task.fix, finding: task.finding.id, skipped: r.reason });
      }
    }

    if (working === original) {
      console.log(`  ${relPath}: no changes`);
      continue;
    }

    if (flags.dryRun) {
      console.log(`  ${relPath}: would apply ${log.filter(l => !l.skipped).length} fix(es) [DRY RUN]`);
      for (const l of log) {
        const tag = l.skipped ? `skipped:${l.skipped}` : "applied";
        console.log(`     ${tag}  ${l.fix}  (${l.finding})`);
      }
    } else {
      // Write, syntax-check, rollback if broken.
      await writeFile(absPath, working, "utf-8");
      const ok = await syntaxOk(absPath);
      if (!ok) {
        await writeFile(absPath, original, "utf-8");
        rolledBack++;
        console.log(`  ${relPath}: ROLLED BACK (syntax check failed)`);
      } else {
        appliedFiles++;
        console.log(`  ${relPath}: applied ${log.filter(l => !l.skipped).length} fix(es)`);
      }
    }
  }

  console.log(`\n[repair-cortex:apply] applied=${appliedTasks} files=${appliedFiles} skipped=${skipped} rolledBack=${rolledBack}`);
  console.log(`[repair-cortex:apply] registry: ${listFixes().map(f => f.id).join(", ")}`);
}

main().catch((err) => {
  console.error("[repair-cortex:apply] failed:", err);
  process.exit(1);
});
