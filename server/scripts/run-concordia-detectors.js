#!/usr/bin/env node
/**
 * Run the Concordia substrate detector against the live world.
 *
 * Usage:
 *   node server/scripts/run-concordia-detectors.js
 *   DB_PATH=/var/lib/concord/concord.db node server/scripts/run-concordia-detectors.js
 *
 * Exits 1 if any critical/high findings; 0 otherwise. Suitable for CI.
 *
 * If no DB_PATH is set, runs in static-only mode (authored content
 * checks only; cross-phase + distribution skip).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConcordiaSubstrateDetector } from "../lib/detectors/concordia-substrate-detector.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "../..");

async function loadDb() {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) return null;
  try {
    const { default: Database } = await import("better-sqlite3");
    return new Database(dbPath, { readonly: true });
  } catch (err) {
    console.error(`Could not open DB at ${dbPath}:`, err.message);
    return null;
  }
}

const SEVERITY_GLYPH = {
  critical: "[!]",
  high:     "[H]",
  medium:   "[M]",
  low:      "[ ]",
  info:     "[ ]",
};

async function main() {
  const db = await loadDb();
  const mode = db ? "live" : "static-only";

  console.log(`Concordia substrate detector — mode: ${mode}`);
  if (mode === "static-only") {
    console.log("(set DB_PATH to enable cross-phase + distribution checks)");
  }
  console.log("");

  const t0 = Date.now();
  const report = await runConcordiaSubstrateDetector({ db, root: REPO_ROOT });
  const elapsed = Date.now() - t0;

  if (!report.ok) {
    console.error(`Detector failed: ${report.reason} ${report.error || ""}`);
    process.exit(1);
  }

  const { summary, findings } = report;

  console.log(`Findings: total=${summary.total}  critical=${summary.critical}  high=${summary.high}  medium=${summary.medium}  low=${summary.low}  info=${summary.info}`);
  console.log(`(${elapsed}ms)`);
  console.log("");

  // Group by severity, descending.
  const bySev = { critical: [], high: [], medium: [], low: [], info: [] };
  for (const f of findings) (bySev[f.severity] || bySev.info).push(f);

  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    if (bySev[sev].length === 0) continue;
    console.log(`── ${sev.toUpperCase()} (${bySev[sev].length}) ──`);
    for (const f of bySev[sev]) {
      const loc = f.location ? ` ${f.location}` : "";
      console.log(`  ${SEVERITY_GLYPH[sev]} ${f.id}${loc}`);
      console.log(`     ${f.message}`);
      if (f.fixHint) console.log(`     hint: ${f.fixHint}`);
    }
    console.log("");
  }

  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }

  if (summary.critical > 0 || summary.high > 0) {
    console.error(`FAIL: ${summary.critical} critical + ${summary.high} high findings`);
    process.exit(1);
  }
  if (summary.medium > 0) {
    console.warn(`WARN: ${summary.medium} medium findings`);
    process.exit(0);
  }
  console.log("PASS — zero critical/high/medium findings");
  process.exit(0);
}

main().catch(err => {
  console.error("crashed:", err);
  process.exit(1);
});
