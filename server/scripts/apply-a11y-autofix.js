#!/usr/bin/env node
/**
 * Mass-apply the a11y-button-label autofix across every finding from
 * ux-a11y-button-no-label. Iterates: find → fix → write → re-detect
 * until no more new fixes land (or a safety cap is hit).
 *
 * Usage:
 *   node scripts/apply-a11y-autofix.js [--dry-run] [--limit N]
 *
 * --dry-run     log changes without writing
 * --limit N     stop after N successful fixes (default: unlimited)
 */

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { runUxA11yButtonNoLabelDetector } from "../lib/detectors/ux-a11y-button-no-label-detector.js";
import { a11yButtonLabelFix } from "../lib/autofix/a11y-button-label.js";
import { safeApply } from "../lib/autofix/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT_ARG = args.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? Number(args[LIMIT_ARG + 1]) : Infinity;
const MAX_ITERATIONS = 20; // detector caps findings at 500 per pass

async function main() {
  let totalApplied = 0;
  let totalSkipped = 0;
  let iter = 0;

  while (iter < MAX_ITERATIONS && totalApplied < LIMIT) {
    iter++;
    const report = await runUxA11yButtonNoLabelDetector({ root: REPO_ROOT, opts: { findingCap: 1000 } });
    const findings = report.findings || [];
    if (findings.length === 0) {
      console.log(`[a11y-autofix] iteration ${iter}: 0 findings — done`);
      break;
    }
    console.log(`[a11y-autofix] iteration ${iter}: ${findings.length} findings`);

    let appliedThisPass = 0;
    const fileCache = new Map(); // path → current content

    for (const f of findings) {
      if (totalApplied >= LIMIT) break;
      const [relPath] = f.location.split(":");
      const abs = path.join(REPO_ROOT, relPath);
      let content = fileCache.get(abs);
      if (!content) {
        try { content = await readFile(abs, "utf-8"); } catch { totalSkipped++; continue; }
      }
      const result = safeApply(a11yButtonLabelFix, relPath, content, f);
      if (!result.ok) {
        totalSkipped++;
        continue;
      }
      fileCache.set(abs, result.content);
      totalApplied++;
      appliedThisPass++;
    }

    if (!DRY_RUN) {
      for (const [abs, content] of fileCache.entries()) {
        await writeFile(abs, content, "utf-8");
      }
    }
    console.log(`[a11y-autofix] iteration ${iter}: applied ${appliedThisPass}, total ${totalApplied}, skipped ${totalSkipped}`);
    if (appliedThisPass === 0) {
      console.log("[a11y-autofix] no progress this pass — exiting");
      break;
    }
  }

  console.log(`[a11y-autofix] FINAL: ${totalApplied} applied, ${totalSkipped} skipped${DRY_RUN ? " (dry-run)" : ""}`);
}

main().catch((e) => {
  console.error("[a11y-autofix] threw:", e);
  process.exit(1);
});
