#!/usr/bin/env node
// server/scripts/run-detectors.js
//
// CLI entry for the code-quality detector suite. Runs every registered
// detector in parallel and prints a markdown report. Used by:
//   - the npm cartograph step
//   - manual ad-hoc audits ("what's the state of stale code right now?")
//   - CI scheduled lint sweeps
//
// Usage:
//   node server/scripts/run-detectors.js                 # all detectors, markdown
//   node server/scripts/run-detectors.js --json          # JSON to stdout
//   node server/scripts/run-detectors.js --id stale-code # single detector
//   node server/scripts/run-detectors.js --consumer repair-cortex
//   node server/scripts/run-detectors.js --severity high # filter findings
//   node server/scripts/run-detectors.js --out audit/detectors/REPORT.md

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runAllDetectors,
  runDetector,
  filterFindings,
  listDetectors,
} from "../lib/detectors/index.js";
import {
  loadBaseline,
  saveBaseline,
  diffAgainstBaseline,
  appendHistory,
  loadBudget,
  ciDecision,
} from "../lib/detectors/baseline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? true;
}

const flags = {
  json: process.argv.includes("--json"),
  list: process.argv.includes("--list"),
  diff: process.argv.includes("--diff"),
  rewriteBaseline: process.argv.includes("--rewrite-baseline"),
  appendHistory: process.argv.includes("--append-history"),
  ci: process.argv.includes("--ci"),
  id: arg("--id"),
  consumer: arg("--consumer"),
  severity: arg("--severity", "info"),
  kinds: arg("--kinds"),
  out: arg("--out"),
};

function severityIcon(s) {
  return ({
    critical: "🛑", high: "⚠️ ", medium: "•", low: "·", info: "·",
  })[s] || "·";
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Detector report`);
  lines.push("");
  lines.push(`Generated: \`${report.generatedAt}\`  Consumer: \`${report.consumer}\`  Total findings: **${report.totals.total}**`);
  lines.push("");
  lines.push(`| severity | count |`);
  lines.push(`|---|---|`);
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    lines.push(`| ${sev} | ${report.totals[sev]} |`);
  }
  lines.push("");
  lines.push(`## Detectors`);
  lines.push("");
  lines.push(`| id | ok | total | critical | high | medium | low | duration |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const r of report.reports) {
    lines.push(`| ${r.id} | ${r.ok ? "yes" : `no (${r.reason || "?"})`} | ${r.summary.total} | ${r.summary.critical} | ${r.summary.high} | ${r.summary.medium} | ${r.summary.low} | ${r.durationMs}ms |`);
  }
  lines.push("");

  for (const r of report.reports) {
    lines.push(`### ${r.id}`);
    if (!r.ok) {
      lines.push(`> ⚠ failed: ${r.reason || "unknown"} ${r.error ? `— ${r.error}` : ""}`);
    }
    lines.push("");
    if (!r.findings.length) {
      lines.push("_No findings._");
      lines.push("");
      continue;
    }
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sorted = [...r.findings].sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]));
    for (const f of sorted.slice(0, 50)) {
      const loc = f.location ? ` \`${f.location}\`` : "";
      lines.push(`- ${severityIcon(f.severity)} **${f.severity}** \`${f.id}\` — ${f.message}${loc}`);
    }
    if (sorted.length > 50) lines.push(`- _…and ${sorted.length - 50} more_`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  if (flags.list) {
    if (flags.json) {
      process.stdout.write(JSON.stringify(listDetectors(), null, 2));
    } else {
      console.log("Registered detectors:");
      for (const d of listDetectors()) {
        console.log(`  ${d.id.padEnd(24)} ${d.label.padEnd(28)} consumers=${d.consumers.join(",")}`);
      }
    }
    return;
  }

  let report;
  if (flags.id) {
    const single = await runDetector(flags.id, { root: REPO_ROOT });
    report = {
      generatedAt: new Date().toISOString(),
      consumer: flags.consumer || "all",
      detectorCount: 1,
      totals: { ...single.summary },
      durationMs: single.durationMs,
      reports: [single],
    };
  } else {
    report = await runAllDetectors({
      root: REPO_ROOT,
      consumer: flags.consumer,
    });
  }

  // ── Phase 1 modes: --rewrite-baseline / --diff / --ci / --append-history
  if (flags.rewriteBaseline) {
    const r = await saveBaseline(REPO_ROOT, report);
    console.log(`Wrote BASELINE.json with ${r.fingerprintCount} fingerprints → ${r.path}`);
    return;
  }

  if (flags.diff || flags.ci) {
    const baseline = await loadBaseline(REPO_ROOT);
    const delta = diffAgainstBaseline(report, baseline);
    const budget = await loadBudget(REPO_ROOT);

    if (flags.json) {
      process.stdout.write(JSON.stringify({
        report: { generatedAt: report.generatedAt, totals: report.totals },
        delta, budget,
      }, null, 2));
      return;
    }

    console.log(`Detector diff vs BASELINE.json (${baseline.generatedAt || "no baseline"}):`);
    console.log(`  added:     ${delta.addedCount} (critical=${delta.addedBySeverity.critical}, high=${delta.addedBySeverity.high}, medium=${delta.addedBySeverity.medium}, low=${delta.addedBySeverity.low}, info=${delta.addedBySeverity.info})`);
    console.log(`  removed:   ${delta.removedCount}`);
    console.log(`  unchanged: ${delta.unchangedCount}`);
    if (delta.addedCount > 0) {
      console.log("\nNew findings:");
      for (const a of delta.added.slice(0, 50)) {
        console.log(`  [${a.finding.severity}] ${a.detector}: ${a.finding.message} ${a.finding.location || ""}`);
      }
      if (delta.added.length > 50) console.log(`  …and ${delta.added.length - 50} more`);
    }

    if (flags.ci) {
      const decision = ciDecision(delta, report.totals, budget);
      if (!decision.pass) {
        console.error(`\nCI check FAILED: ${decision.reason}`, decision);
        process.exit(1);
      }
      console.log("\nCI check PASSED");
    }
    return;
  }

  if (flags.appendHistory) {
    const baseline = await loadBaseline(REPO_ROOT);
    const delta = baseline.fingerprints ? diffAgainstBaseline(report, baseline) : null;
    const r = await appendHistory(REPO_ROOT, report, { delta });
    console.log(`Appended history row → ${r.path}`);
    return;
  }

  if (flags.severity && flags.severity !== "info") {
    const findings = filterFindings(report, {
      minSeverity: flags.severity,
      kinds: flags.kinds ? flags.kinds.split(",") : undefined,
    });
    report = { ...report, filteredFindings: findings };
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }

  const md = renderMarkdown(report);
  if (flags.out) {
    const outAbs = path.resolve(REPO_ROOT, flags.out);
    await mkdir(path.dirname(outAbs), { recursive: true });
    await writeFile(outAbs, md, "utf-8");
    console.log(`Wrote ${outAbs}`);
  } else {
    process.stdout.write(md);
  }
}

main().catch((err) => {
  console.error("[run-detectors] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
