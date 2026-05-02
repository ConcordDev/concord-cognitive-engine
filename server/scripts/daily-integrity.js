#!/usr/bin/env node
// server/scripts/daily-integrity.js
// Phase 15: Continuous integrity verification.
// Runs the full audit suite and reports results.
// Schedule: 0 4 * * * node server/scripts/daily-integrity.js
// Can also be run manually: node server/scripts/daily-integrity.js [--json] [--fail-fast]

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");
const REPORTS_DIR = path.join(ROOT, "reports", "production-integrity");
const execFileAsync = promisify(execFile);

const JSON_MODE = process.argv.includes("--json");
const FAIL_FAST = process.argv.includes("--fail-fast");

async function runScript(scriptPath, args = []) {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [scriptPath, "--json", ...args],
      { cwd: ROOT, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }
    );
    const durationMs = Date.now() - start;
    try {
      return { ok: true, data: JSON.parse(stdout), durationMs };
    } catch {
      return { ok: true, raw: stdout, durationMs };
    }
  } catch (e) {
    const durationMs = Date.now() - start;
    let data = null;
    try { data = JSON.parse(e.stdout || ""); } catch {}
    return { ok: false, error: e.message, data, durationMs };
  }
}

async function runProvenance() {
  // Run provenance check as a small inline script since it needs DB context
  const start = Date.now();
  try {
    const { provenance, registerConcordClaims } = await import("../lib/audit/provenance.js");
    registerConcordClaims({});
    const results = await provenance.verifyAll();
    const report = provenance.getReport();
    return {
      ok: report.failed === 0 && report.errors === 0,
      data: report,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return { ok: false, error: e.message, durationMs: Date.now() - start };
  }
}

async function main() {
  log("╔══════════════════════════════════════════════════════╗");
  log("║       CONCORD DAILY INTEGRITY SWEEP                  ║");
  log(`║       ${new Date().toISOString()}       ║`);
  log("╚══════════════════════════════════════════════════════╝\n");

  const results = {};

  // ── Phase 1: Provenance ──────────────────────────────────────────────────
  log("Running provenance audit...");
  results.provenance = await runProvenance();
  logResult("Provenance", results.provenance);
  if (FAIL_FAST && !results.provenance.ok) process.exit(1);

  // ── Phase 2: Wiring ──────────────────────────────────────────────────────
  log("Running wiring audit...");
  results.wiring = await runScript(path.join(__dirname, "audit-wiring.js"));
  logResult("Wiring audit", results.wiring);
  if (FAIL_FAST && !results.wiring.ok) process.exit(1);

  // ── Phase 3: Silent failures ─────────────────────────────────────────────
  log("Running silent failure detection...");
  results.silentFailures = await runScript(path.join(__dirname, "audit-silent-failures.js"));
  // Silent failures aren't a hard blocker, just a warning
  logResult("Silent failures", {
    ...results.silentFailures,
    ok: (results.silentFailures.data?.critical || 0) === 0,
  });

  // ── Phase 4: Import audit ────────────────────────────────────────────────
  log("Running import audit...");
  results.imports = await runScript(path.join(__dirname, "audit-imports.js"));
  logResult("Import audit", results.imports);
  if (FAIL_FAST && !results.imports.ok) process.exit(1);

  // ── Summary ─────────────────────────────────────────────────────────────
  const allOk = results.provenance.ok && results.wiring.ok && results.imports.ok;
  const criticalSilentFailures = results.silentFailures.data?.critical || 0;

  const report = {
    timestamp: new Date().toISOString(),
    allOk: allOk && criticalSilentFailures === 0,
    provenance: results.provenance.ok,
    wiring: results.wiring.ok,
    silentFailures: {
      critical: criticalSilentFailures,
      total: results.silentFailures.data?.totalFindings || 0,
    },
    imports: results.imports.ok,
    details: results,
  };

  log("\n══ DAILY INTEGRITY REPORT ══");
  log(`Status: ${report.allOk ? "✅ PASSING" : "❌ ISSUES DETECTED"}`);
  log(`Provenance: ${report.provenance ? "✓" : "✗"}`);
  log(`Wiring: ${report.wiring ? "✓" : "✗"}`);
  log(`Silent failures (critical): ${criticalSilentFailures}`);
  log(`Import audit: ${report.imports ? "✓" : "✗"}`);

  // Persist report
  try {
    await mkdir(REPORTS_DIR, { recursive: true });
    const filename = `integrity-${new Date().toISOString().slice(0, 10)}.json`;
    await writeFile(path.join(REPORTS_DIR, filename), JSON.stringify(report, null, 2));
    log(`\nReport saved: reports/production-integrity/${filename}`);
  } catch {}

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(report, null, 2));
  }

  if (!report.allOk) process.exit(1);
}

function log(...args) {
  if (!JSON_MODE) console.log(...args);
}

function logResult(name, result) {
  const icon = result.ok ? "✓" : "✗";
  const duration = result.durationMs ? ` (${result.durationMs}ms)` : "";
  log(`  ${icon} ${name}${duration}`);
  if (!result.ok && result.error) log(`    Error: ${result.error}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
