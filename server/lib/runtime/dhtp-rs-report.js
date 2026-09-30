// server/lib/runtime/dhtp-rs-report.js
// Formatting helpers for DHTP-RS benchmark reports (spec §7, §18, §21)

import {
  SPEC_ID,
  SPEC_VERSION,
  BENCHMARK_VERSION,
  CURRENT_CLAIM,
  PHASE1_BASELINE,
  EXECUTION_ORDER,
} from "./dhtp-rs-spec.js";
import { buildStatisticalReport } from "./dhtp-rs-statistics.js";

export function formatConditionStats(label, stats) {
  const ci = stats.ciSuccessfulOnly || stats.ciAllTrials;
  return [
    `  ${label}`,
    `    N=${stats.nSuccessful ?? stats.n}  mean=${(stats.meanQualitySuccessfulOnly * 100).toFixed(1)}%  median=${(stats.medianQualitySuccessfulOnly * 100).toFixed(1)}%  stdev=${(stats.stdevQuality * 100).toFixed(1)}pp`,
    `    95% CI: ${(ci.low * 100).toFixed(1)}% – ${(ci.high * 100).toFixed(1)}%`,
    `    API fail: ${(stats.apiFailureRate * 100).toFixed(1)}%  timeout: ${(stats.timeoutRate * 100).toFixed(1)}%  success: ${(stats.successRate * 100).toFixed(1)}%`,
  ].join("\n");
}

export function formatPairedDelta(label, paired) {
  if (!paired?.n) return `  ${label}: insufficient paired trials`;
  const ci = paired.ci;
  return [
    `  ${label} (n=${paired.n})`,
    `    mean Δ=${(paired.meanDelta * 100).toFixed(1)}pp  median Δ=${(paired.medianDelta * 100).toFixed(1)}pp`,
    `    95% CI on Δ: ${(ci.low * 100).toFixed(1)}pp – ${(ci.high * 100).toFixed(1)}pp`,
  ].join("\n");
}

export function formatFailureBreakdown(breakdown) {
  const lines = ["FAILURE BREAKDOWN (spec §18)"];
  const entries = Object.entries(breakdown || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    lines.push("  (none)");
    return lines.join("\n");
  }
  for (const [cat, count] of entries) {
    lines.push(`  ${cat}: ${count}`);
  }
  return lines.join("\n");
}

export function buildPhase1AnalysisReport() {
  const b = PHASE1_BASELINE;
  const lines = [
    `${"=".repeat(72)}`,
    `DHTP-RS PHASE 1 ANALYSIS — ${SPEC_ID}`,
    `${"=".repeat(72)}`,
    `Run: ${b.runId}  trials=${b.trials}  probe=${b.probe}`,
    `Claim level: ${b.claimLevel} — ${CURRENT_CLAIM.levelLabel}`,
    "",
    "CONDITION SUMMARY (successful calls only, spec §6)",
    "",
  ];

  for (const [cond, r] of Object.entries(b.results)) {
    lines.push(`  ${cond.padEnd(22)} quality=${(r.quality * 100).toFixed(1)}%  tokens≈${r.tokensIn}  latency≈${(r.latencyMs / 1000).toFixed(1)}s  API fail=${(r.apiFailureRate * 100).toFixed(0)}%`);
  }

  lines.push(
    "",
    "PAIRED DELTAS (DHTP minus control, spec §7)",
    `  vs full raw:     +${(b.pairedDeltas.dhtp_minus_raw * 100).toFixed(1)}pp`,
    `  vs matched raw:  +${(b.pairedDeltas.dhtp_minus_matched * 100).toFixed(1)}pp`,
    `  vs random raw:   +${(b.pairedDeltas.dhtp_minus_random * 100).toFixed(1)}pp`,
    "",
    "INTERPRETATION (spec §6)",
    "  SUPPORTED: DHTP dramatically improves efficiency and operational reliability vs full raw.",
    "  NOT YET ESTABLISHED: universal superiority over same-budget raw at large margin.",
    "  The +4.8pp matched-budget delta is below the harness 5pp informal threshold.",
    "",
    "AUTHORIZED CLAIM (spec §22)",
    `  ${CURRENT_CLAIM.text}`,
    "",
    "NOT CLAIMED:",
    ...CURRENT_CLAIM.notClaimed.map((c) => `  • ${c}`),
    "",
    "EXECUTION ORDER",
    ...EXECUTION_ORDER.map((s, i) => `  ${i + 1}. ${s}`),
    `${"=".repeat(72)}`,
  );

  return lines.join("\n");
}

export function enrichBenchWithSpecAnalysis(bench) {
  const runsByCondition = {};
  for (const cond of bench.conditions || []) {
    runsByCondition[cond] = [];
  }
  for (const pr of Object.values(bench.probeResults || {})) {
    for (const [cond, runs] of Object.entries(pr.runs || {})) {
      runsByCondition[cond] = (runsByCondition[cond] || []).concat(runs);
    }
  }

  const statistics = buildStatisticalReport({
    runsByCondition,
    conditions: bench.conditions || [],
  });

  return {
    ...bench,
    spec: {
      id: SPEC_ID,
      version: SPEC_VERSION,
      benchmarkVersion: BENCHMARK_VERSION,
      claimLevel: bench.probes?.length >= 6 ? 2 : bench.probes?.length === 1 ? 1 : 1,
      currentClaim: CURRENT_CLAIM,
    },
    statistics,
  };
}

export function printSpecAnalysis(bench) {
  const enriched = enrichBenchWithSpecAnalysis(bench);
  console.log(`\n${"─".repeat(72)}`);
  console.log(`STATISTICAL REPORT — ${SPEC_ID}`);
  console.log(`${"─".repeat(72)}`);
  for (const [cond, stats] of Object.entries(enriched.statistics.byCondition)) {
    console.log(formatConditionStats(cond, stats));
  }
  console.log(`\nPAIRED DIFFERENCES (DHTP minus control)`);
  for (const [key, paired] of Object.entries(enriched.statistics.paired)) {
    console.log(formatPairedDelta(key, paired));
  }
  if (bench.failureBreakdown) {
    console.log(`\n${formatFailureBreakdown(bench.failureBreakdown)}`);
  }
  console.log(`\nClaim level estimate: ${enriched.spec.claimLevel}`);
}
