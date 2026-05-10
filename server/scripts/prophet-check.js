/**
 * Prophet Pre-Build Check — Repair Cortex Phase 1
 *
 * Runs preventive analysis before a build to catch known failure patterns.
 * Exit code 0 = clear to build, exit code 1 = blockers found.
 *
 * Usage: node server/scripts/prophet-check.js [projectRoot]
 */

import { runProphet } from "../emergent/repair-cortex.js";

const projectRoot = process.argv[2] || process.cwd();

try {
  const report = await runProphet(projectRoot);

  if (report?.blockers?.length) {
    console.error("[Prophet] Build blockers found:");
    for (const b of report.blockers) {
      console.error(`  - ${b.pattern || b.message || b}`);
    }
    process.exit(1);
  }

  const warningCount = report?.warnings?.length || 0;
  console.log(`[Prophet] Pre-flight clear. ${warningCount} warning${warningCount !== 1 ? "s" : ""}.`);
  if (warningCount > 0) {
    for (const w of report.warnings) {
      console.warn(`  ⚠ ${w.pattern || w.message || w}`);
    }
  }
  process.exit(0);
} catch (e) {
  // Prophet failure should not block builds — exit clean. But it must
  // not be silent: a Prophet bug that consistently throws would mask
  // real build blockers from the operator.
  console.error("\n[Prophet] ⚠ PROPHET-CHECK-ERROR — pre-flight skipped");
  console.error(`[Prophet] reason: ${e?.message || e}`);
  if (e?.stack) console.error(`[Prophet] stack:\n${e.stack}`);

  // Persist the trace so CI can grep for it without scraping logs.
  try {
    const fs = await import("node:fs");
    const path = "/tmp/prophet-check-error.log";
    const stamp = new Date().toISOString();
    fs.appendFileSync(path, `${stamp}\n${e?.stack || e?.message || String(e)}\n---\n`);
    console.error(`[Prophet] trace appended to ${path}`);
  } catch { /* trace write is best-effort */ }

  process.exit(0);
}
