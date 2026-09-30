#!/usr/bin/env node
// server/scripts/run-cognitive-mission-bench.mjs
//
// Run repeated cognitive mission iterations and print empirical evidence report.
// Usage:
//   node server/scripts/run-cognitive-mission-bench.mjs [--iterations N]
//   node server/scripts/run-cognitive-mission-bench.mjs --generalization
//   node server/scripts/run-cognitive-mission-bench.mjs --path-experiment
//   node server/scripts/run-cognitive-mission-bench.mjs --economics --economics-iterations N
//   node server/scripts/run-cognitive-mission-bench.mjs --blind-benchmark
//   node server/scripts/run-cognitive-mission-bench.mjs --blind-benchmark --billed
//   node server/scripts/run-cognitive-mission-bench.mjs --json

import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { up as upMission } from "../migrations/423_mission_runtime.js";
import { up as upPhases } from "../migrations/424_runtime_phases.js";
import { up as upTier } from "../migrations/425_runtime_tier.js";
import { up as upDila } from "../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../migrations/428_dila_executive_closure.js";
import { up as upCausal } from "../migrations/429_dila_tier2_brain.js";
import { up as upDhtp } from "../migrations/435_dhtp_metrics.js";
import { up as upCognitive } from "../migrations/436_dhtp_cognitive.js";
import { up as upSavings } from "../migrations/437_cognitive_savings_ledger.js";
import { up as upBilling } from "../migrations/438_provider_billing_telemetry.js";
import { up as upCompilerV2 } from "../migrations/439_cognitive_compiler_v2.js";
import {
  runCognitiveMissionBench,
  runGeneralizationBenchmark,
  runPathExperimentBench,
  runFullPipelineBenchmark,
  runFullDgbBenchmark,
} from "../lib/runtime/cognitive-mission-bench.js";
import { runCognitiveEconomicsBench } from "../lib/runtime/cognitive-economics-bench.js";
import { runDilaRawBlindBenchmark } from "../lib/runtime/dila-raw-blind-benchmark.js";
import { seedBenchDtuCorpus } from "../lib/runtime/cognitive-savings-ledger.js";

function parseArgs(argv) {
  const opts = {
    iterations: 10,
    minCacheUses: 3,
    json: false,
    generalization: false,
    dgbFull: false,
    economics: false,
    economicsIterations: 10,
    blindBenchmark: false,
    billed: false,
    pathExperiment: false,
    learningCurve: false,
    warmupIterations: 20,
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--iterations" && argv[i + 1]) opts.iterations = Number(argv[++i]);
    else if (argv[i] === "--min-cache-uses" && argv[i + 1]) opts.minCacheUses = Number(argv[++i]);
    else if (argv[i] === "--warmup" && argv[i + 1]) opts.warmupIterations = Number(argv[++i]);
    else if (argv[i] === "--json") opts.json = true;
    else if (argv[i] === "--generalization") opts.generalization = true;
    else if (argv[i] === "--dgb-full") opts.dgbFull = true;
    else if (argv[i] === "--economics") opts.economics = true;
    else if (argv[i] === "--economics-iterations" && argv[i + 1]) opts.economicsIterations = Number(argv[++i]);
    else if (argv[i] === "--blind-benchmark") opts.blindBenchmark = true;
    else if (argv[i] === "--billed") opts.billed = true;
    else if (argv[i] === "--learning-curve") opts.learningCurve = true;
    else if (argv[i] === "--path-experiment") opts.pathExperiment = true;
  }
  return opts;
}

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [
    upMission, upPhases, upTier, upDila, upV2, upExec, upCausal,
    upDhtp, upCognitive, upSavings, upBilling, upCompilerV2,
  ]) {
    up(db);
  }
  seedBenchDtuCorpus(db, { count: 50 });
  return db;
}

async function mockDispatch(tool) {
  return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
}

function pct(n) {
  return typeof n === "number" ? `${n.toFixed(1)}%` : "n/a";
}

function arrow(before, after, lowerIsBetter = true) {
  if (before == null || after == null) return "—";
  const diff = after - before;
  if (Math.abs(diff) < 0.001 * Math.max(Math.abs(before), 1)) return "→";
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  return improved ? "↓" : "↑";
}

function printSavingsPipeline(e) {
  const p = e.efficiency.pipeline || {};
  const sb = e.efficiency.savingsBreakdown || {};
  console.log(`\n${"─".repeat(72)}`);
  console.log("SAVINGS LEDGER — token pipeline (per-invocation accounting)");
  console.log(`${"─".repeat(72)}`);
  console.log("  WORLD_STATE_TOKENS  →  DTU_RETRIEVED  →  DHTP_PACKET  →  MODEL_INPUT");
  console.log(`  ${String(p.worldState ?? "n/a").padStart(8)}        ${String(p.afterDtu ?? "n/a").padStart(8)}          ${String(p.dhtpPacket ?? "n/a").padStart(8)}       ${String(p.modelInput ?? "n/a").padStart(8)}`);
  console.log(`\n  DTU savings:    ${sb.dtu ?? 0}`);
  console.log(`  DHTP savings:   ${sb.dhtp ?? 0}`);
  console.log(`  Cache savings:  ${sb.cache ?? 0}`);
  console.log(`  PCE savings:    ${sb.pce ?? 0}`);
  console.log(`  Total avoided:  ${e.efficiency.tokensSavedTotal ?? 0}`);
  if (p.caveat) console.log(`  Note: ${p.caveat}`);
}

function printReport(bench, opts) {
  const s = bench.summary;
  const e = bench.empirical;
  const c = e.iterComparison;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`COGNITIVE MISSION BENCH — ${opts.iterations} iterations`);
  console.log(`${"=".repeat(72)}`);
  console.log(`Run ID:      ${s.runId}`);
  console.log(`Wall time:   ${(s.durationMs / 1000).toFixed(1)}s`);
  console.log(`Result:      ${bench.ok ? "PASS" : "FAIL"}`);

  console.log(`\n${"─".repeat(72)}`);
  console.log("RELIABILITY");
  console.log(`${"─".repeat(72)}`);
  console.log(`  Mission completion:     ${pct(e.reliability.missionCompletionPct)}`);
  console.log(`  Verification success:   ${pct(e.reliability.verificationSuccessPct)}`);
  console.log(`  F0 blocks:              ${e.reliability.f0Blocks.count}/${e.reliability.f0Blocks.total} — all unauthorized stopped: ${e.reliability.f0Blocks.allUnauthorizedStopped ? "YES" : "NO"}`);
  for (const p of e.reliability.f0Blocks.probes || []) {
    console.log(`    · ${p.name}: ${p.blocked ? "BLOCKED" : "LEAKED"} @ ${p.stage} (${p.reason || "ok"})`);
  }
  console.log(`  Recovery success:       ${pct(e.reliability.recoverySuccessPct)}`);
  console.log(`  Failures / regressions: ${e.reliability.failureCount}`);

  console.log(`\n${"─".repeat(72)}`);
  console.log("INTELLIGENCE");
  console.log(`${"─".repeat(72)}`);
  console.log(`  Cache hit rate:         ${pct(e.intelligence.cacheHitRatePct)}`);
  console.log(`  LLM calls avoided:      ${e.intelligence.llmCallsAvoidedTotal} total`);
  console.log(`  Cache promotions:       ${e.intelligence.cachePromotions}`);
  console.log(`  Recurring recognized:   ${e.intelligence.recurringRecognized} iterations`);

  printSavingsPipeline(e);

  console.log(`\n${"─".repeat(72)}`);
  console.log("EFFICIENCY");
  console.log(`${"─".repeat(72)}`);
  console.log(`  Context full (world+DTU corpus): ${e.efficiency.rawContextTokensTotal}`);
  console.log(`  After DTU retrieval:             ${e.efficiency.tokensAfterDtuTotal ?? "n/a"}`);
  console.log(`  DHTP packet tokens:              ${e.efficiency.dhtpTokensTotal}`);
  console.log(`  Actual model input tokens:       ${e.efficiency.actualModelInputTokensTotal ?? "n/a"}`);
  console.log(`  PCE deterministic cov:           ${e.efficiency.pceDeterministicCoverage != null ? pct(e.efficiency.pceDeterministicCoverage * 100) : "n/a (no PCE bench rows)"}`);
  console.log(`  Latency median:                  ${e.efficiency.latencyMs.median.toFixed(0)}ms`);
  console.log(`  Latency p95:                     ${e.efficiency.latencyMs.p95.toFixed(0)}ms`);
  console.log(`  Latency mean:                    ${e.efficiency.latencyMs.mean.toFixed(0)}ms`);

  console.log(`\n${"─".repeat(72)}`);
  console.log("SUBSTRATES WRITTEN");
  console.log(`${"─".repeat(72)}`);
  console.log(`  Causal chains:          ${e.substrates.causalChainsTotal}`);
  console.log(`  Cognitive outcomes:     ${e.substrates.cognitiveOutcomesTotal}`);
  console.log(`  Memory nodes:           ${e.substrates.memoryNodesTotal}`);
  console.log(`  DHTP metric rows:       ${e.substrates.dhtpMetricRows}`);

  console.log(`\n${"─".repeat(72)}`);
  console.log("DHTP POLICY CHANGES");
  console.log(`${"─".repeat(72)}`);
  if (e.learning.dhtpPolicyChanges.length === 0) {
    console.log("  (none yet — need more field outcome samples)");
  } else {
    for (const ch of e.learning.dhtpPolicyChanges) {
      console.log(`  · ${ch.field} [${ch.taskClass}]: ${ch.from || "new"} → ${ch.to}`);
    }
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log(`ITER 1  vs  ITER ${opts.iterations}`);
  console.log(`${"─".repeat(72)}`);
  console.log(`                    ITER 1      ITER ${opts.iterations}     TREND`);
  console.log(`  Model input tok   ${String(c.iter1.modelInput ?? c.iter1.rawTokens).padStart(6)}      ${String(c.iter100.modelInput ?? c.iter100.rawTokens).padStart(6)}       ${arrow(c.first5Avg.modelInput ?? c.first5Avg.rawTokens, c.last5Avg.modelInput ?? c.last5Avg.rawTokens)}`);
  console.log(`  LLM avoided       ${String(c.iter1.llmCallsAvoided).padStart(6)}      ${String(c.iter100.llmCallsAvoided).padStart(6)}       ${arrow(c.first5Avg.llmCallsAvoided, c.last5Avg.llmCallsAvoided, false)}`);
  console.log(`  Latency (ms)      ${String(c.iter1.latencyMs.toFixed(0)).padStart(6)}      ${String(c.iter100.latencyMs.toFixed(0)).padStart(6)}       ${arrow(c.first5Avg.latencyMs, c.last5Avg.latencyMs)}`);
  console.log(`  Cache hits        ${String(c.iter1.cacheHits).padStart(6)}      ${String(c.iter100.cacheHits).padStart(6)}       ${arrow(c.first5Avg.cacheHits, c.last5Avg.cacheHits, false)}`);
  console.log(`  Verification      ${pct(c.iter1.verification * 100).padStart(6)}      ${pct(c.iter100.verification * 100).padStart(6)}       →`);
  console.log(`  Mission success   ${pct(c.iter1.missionSuccess * 100).padStart(6)}      ${pct(c.iter100.missionSuccess * 100).padStart(6)}       →`);

  console.log(`\n${"─".repeat(72)}`);
  console.log("TRAJECTORY (by quarter)");
  console.log(`${"─".repeat(72)}`);
  for (const q of e.trajectory.quarters) {
    console.log(`  Q${q.quarter}: cache=${pct(q.cacheHitRate * 100)} latency=${q.avgLatencyMs.toFixed(0)}ms success=${pct(q.missionSuccess * 100)}`);
  }
  console.log(`  Overall: latency ${e.trajectory.latency}, cache ${e.trajectory.cacheHits}, combined ${e.trajectory.overall}`);

  console.log(`\n${"─".repeat(72)}`);
  console.log("EVIDENCE QUALITY — repetition vs learning");
  console.log(`${"─".repeat(72)}`);
  console.log(`  Evidence class:         ${e.evidenceQuality.evidenceClass}`);
  console.log(`  Generalization proven:  ${e.evidenceQuality.generalizationProven ? "YES" : "NO"}`);
  console.log(`  Verdict:                ${e.evidenceQuality.learningVsRepetition.verdict}`);
  console.log(`  Caveat:                 ${e.evidenceQuality.caveat}`);

  console.log(`\n${"=".repeat(72)}`);
  if (!e.evidenceQuality.generalizationProven) {
    console.log("NEXT BAR: node server/scripts/run-cognitive-mission-bench.mjs --generalization");
    console.log("Passing DGB separates memorization from genuine capability transfer.");
  }
  console.log(`${"=".repeat(72)}\n`);
}

function printPathExperiment(exp) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("COGNITIVE PATH EXPERIMENT — A/B/C/D");
  console.log(`${"=".repeat(72)}`);
  console.log(`Conclusion: ${exp.conclusion}`);
  console.log(`\n${"Variant".padEnd(6)} ${"Path".padEnd(18)} ${"Context".padStart(8)} ${"AfterDTU".padStart(9)} ${"DHTP".padStart(7)} ${"ModelIn".padStart(8)} ${"Avoided".padStart(8)} ${"Latency".padStart(8)}`);
  for (const v of exp.variants) {
    console.log(
      `${v.variant.padEnd(6)} ${v.path.padEnd(18)} ${String(v.contextFull).padStart(8)} ${String(v.tokensAfterDtu).padStart(9)} ${String(v.dhtpTokens).padStart(7)} ${String(v.inputTokens).padStart(8)} ${String(v.totalAvoided).padStart(8)} ${String(v.latencyMs).padStart(7)}ms`,
    );
  }
  console.log(`${"=".repeat(72)}\n`);
}

function printFullDgb(dgb) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("DILA GENERALIZATION BENCHMARK (DGB) — FULL LEVELS 1–5");
  console.log(`${"=".repeat(72)}`);
  console.log(`Result:     ${dgb.ok ? "PASS" : "FAIL"}`);
  console.log(`Verdict:    ${dgb.verdict}`);
  console.log(`Evidence:   ${dgb.evidenceClass}`);
  console.log(`Duration:   ${(dgb.durationMs / 1000).toFixed(1)}s`);
  console.log(`\nAcceptance: ${dgb.acceptance?.rule}`);
  console.log(`Capability learned: ${dgb.acceptance?.capabilityLearned ? "YES" : "NO"}`);
  console.log(`Learning levels passed: ${dgb.acceptance?.levelsPassed}/${dgb.acceptance?.levelsRequired}`);
  console.log(`\nScores:`);
  for (const [level, score] of Object.entries(dgb.scores)) {
    const lvl = score.level || (score.pass ? "pass" : "fail");
    console.log(`  ${level}: ${lvl}${score.note ? ` — ${score.note}` : ""}`);
  }
  if (dgb.scores.semanticTransfer?.cold) {
    console.log(`\nL3 semantic: verified=${dgb.scores.semanticTransfer.cold.verified} cacheHit=${dgb.scores.semanticTransfer.cold.cacheHit}`);
  }
  if (dgb.scores.novelComposition?.cold) {
    console.log(`L4 compose: verified=${dgb.scores.novelComposition.cold.verified} steps=${dgb.scores.novelComposition.cold.stepsCompleted}`);
  }
  if (dgb.scores.adversarialTransfer?.deltaBattery) {
    const b = dgb.scores.adversarialTransfer.deltaBattery;
    console.log(`L5 adversarial: deltaBattery=${b.passed}/${b.total} mission=${dgb.scores.adversarialTransfer.mission?.verified}`);
  }
  console.log(`${"=".repeat(72)}\n`);
}

function printLearningCurve(full) {
  const lc = full.learningCurve;
  const ps = full.pipelineStages;
  console.log(`\n${"─".repeat(72)}`);
  console.log("LEARNING CURVE — cold novel → 100-iter warmup → warm novel");
  console.log(`${"─".repeat(72)}`);
  console.log(`  Cold novel:  ok=${lc.novelTask.cold.ok} verified=${lc.novelTask.cold.verified} cache=${lc.novelTask.cold.cacheHit} modelIn=${lc.novelTask.cold.modelInput} latency=${lc.novelTask.cold.latencyMs}ms`);
  console.log(`  Warm novel:  ok=${lc.novelTask.warm.ok} verified=${lc.novelTask.warm.verified} cache=${lc.novelTask.warm.cacheHit} modelIn=${lc.novelTask.warm.modelInput} latency=${lc.novelTask.warm.latencyMs}ms`);
  console.log(`  Transfer:    ${lc.novelTask.transferObserved ? "YES" : "NO"}  memorization-only=${lc.novelTask.memorizationOnly}`);
  console.log(`  Latency Δ:   ${lc.novelTask.latencyDeltaMs}ms  model-input Δ: ${lc.novelTask.modelInputDelta}`);
  if (ps) {
    console.log(`\n${"─".repeat(72)}`);
    console.log(`PIPELINE STAGES — ${ps.stages}`);
    console.log(`${"─".repeat(72)}`);
    console.log(`  Iter 1:  world=${ps.iter1.world} → dtu=${ps.iter1.dtu} → dhtp=${ps.iter1.dhtp} → model=${ps.iter1.modelInput}`);
    console.log(`  Iter N:  world=${ps.iterN.world} → dtu=${ps.iterN.dtu} → dhtp=${ps.iterN.dhtp} → model=${ps.iterN.modelInput}`);
    console.log(`  Totals:  cache=${ps.totals.cache} pce=${ps.totals.pce} llm=${ps.totals.llm} delta=${ps.totals.delta} memory=${ps.totals.memory}`);
  }
  if (full.savings?.ok) {
    console.log(`\n  Savings total avoided: ${full.savings.savings?.total ?? 0}`);
  }
}

function printGeneralization(dgb) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("DILA GENERALIZATION BENCHMARK (DGB) — Level 2 structural");
  console.log(`${"=".repeat(72)}`);
  console.log(`Run ID:     ${dgb.runId}`);
  console.log(`Result:     ${dgb.ok ? "PASS" : "FAIL"}`);
  console.log(`Verdict:    ${dgb.verdict}`);
  console.log(`Evidence:   ${dgb.evidenceClass}`);
  console.log(`\nScores:`);
  for (const [level, score] of Object.entries(dgb.scores)) {
    console.log(`  ${level}: ${score.level}${score.note ? ` — ${score.note}` : ""}`);
  }
  console.log(`\nVariant cold: success=${dgb.variantCold.ok} cacheHit=${dgb.variantCold.metrics?.intelligence?.cacheHit === 1}`);
  console.log(`Variant warm: success=${dgb.variantWarm.ok} cacheHit=${dgb.variantWarm.metrics?.intelligence?.cacheHit === 1}`);
  if (dgb.savings?.ok) {
    console.log(`\nSavings total avoided: ${dgb.savings.savings?.total ?? 0}`);
  }
  console.log(`${"=".repeat(72)}\n`);
}

function printBlindBenchmark(bench) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("DILA-vs-RAW BLIND BENCHMARK — independent evaluator");
  console.log(`${"=".repeat(72)}`);
  console.log(`Run ID:     ${bench.runId}`);
  console.log(`Result:     ${bench.ok ? "PASS" : "FAIL"}`);
  console.log(`Workloads:  ${bench.workloads.join(", ")}`);
  console.log(`\n${"Path".padEnd(6)} ${"Label".padEnd(18)} ${"Quality".padStart(8)} ${"Correct".padStart(8)} ${"Verify".padStart(8)} ${"Tokens".padStart(8)} ${"Latency".padStart(8)} ${"$/miss".padStart(10)}`);
  for (const row of bench.pathQualityTable) {
    console.log(
      `${row.pathId.padEnd(6)} ${row.label.padEnd(18)} ${(row.avgComposite * 100).toFixed(1).padStart(7)}% ${(row.correctness * 100).toFixed(0).padStart(7)}% ${(row.verification * 100).toFixed(0).padStart(7)}% ${Math.round(row.avgTokens).toString().padStart(8)} ${row.avgLatencyMs.toFixed(0).padStart(7)}ms ${row.avgCostUsd.toFixed(6).padStart(10)}`,
    );
  }
  console.log(`\nDHTP isolation (quality score by path):`);
  for (const row of bench.dhtpIsolation) {
    console.log(`  ${row.path} ${row.label}: quality=${row.quality}% tokens=${row.tokens}`);
  }
  console.log(`\nHead-to-head (Raw A vs Full Dila E):`);
  console.log(`  Raw composite:   ${(bench.headline.rawComposite * 100).toFixed(1)}%`);
  console.log(`  Dila composite:  ${(bench.headline.dilaComposite * 100).toFixed(1)}%`);
  console.log(`  Quality delta:   ${bench.headline.qualityDelta >= 0 ? "+" : ""}${(bench.headline.qualityDelta * 100).toFixed(1)}pp`);
  if (bench.headline.tokenSavingsPct != null) {
    console.log(`  Token savings:   ${bench.headline.tokenSavingsPct.toFixed(1)}%`);
  }
  if (bench.headline.costSavingsPct != null) {
    console.log(`  Cost savings:    ${bench.headline.costSavingsPct.toFixed(1)}%`);
  }
  console.log(`  Dila win rate:   ${bench.headToHead.total > 0 ? `${bench.headToHead.dilaWins}/${bench.headToHead.total}` : "n/a"}`);
  console.log(`  Target met:      ${bench.headline.targetMet ? "YES" : "NO"}`);
  console.log(`  Verdict:         ${bench.headline.verdict}`);
  console.log(`  Evaluator:       ${bench.headline.principle}`);
  if (bench.headline.caveat) console.log(`  Note: ${bench.headline.caveat}`);

  if (bench.claims?.segments) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("SEGMENTED CLAIMS (Raw A → Full Dila E)");
    const s = bench.claims.segments;
    const fmt = (v) => (v != null ? `${v.toFixed(1)}%` : "n/a");
    const ci = (seg) => {
      const p = seg?.perWorkload;
      if (!p || p.n < 2) return "";
      return ` [CI95: ${p.ci95Low.toFixed(1)}–${p.ci95High.toFixed(1)}%]`;
    };
    console.log(`  Token reduction:        ${fmt(s.tokenReduction.pointEstimate)}${ci(s.tokenReduction)}`);
    console.log(`  Inference cost reduction: ${fmt(s.inferenceCostReduction.pointEstimate)}${ci(s.inferenceCostReduction)}`);
    console.log(`  Latency reduction:      ${fmt(s.latencyReduction.pointEstimate)}${ci(s.latencyReduction)}`);
    console.log(`  Quality retention:      ${fmt(s.qualityRetention.pointEstimate)}`);
    console.log(`  Reliability (success):  Raw ${(s.reliability.rawSuccessRate * 100).toFixed(0)}% → Dila ${(s.reliability.dilaSuccessRate * 100).toFixed(0)}%`);
    console.log(`  Human intervention:     Raw ${s.humanIntervention.rawRate} → Dila ${s.humanIntervention.dilaRate}`);
  }

  if (bench.commercial?.ok) {
    const c = bench.commercial;
    console.log(`\n${"─".repeat(72)}`);
    console.log(`PRIMARY METRIC: ${bench.primaryMetric?.label || "Cost per Verified Success"}`);
    console.log(`  ${bench.primaryMetric?.brutalRule || c.brutalRule.message}`);
    console.log(`\n  ${"Baseline".padEnd(28)} ${"$ / verified success".padStart(18)} ${"Quality".padStart(8)} ${"Tokens".padStart(10)}`);
    for (const b of c.baselines) {
      const cps = b.costPerVerifiedSuccessUsd != null ? `$${b.costPerVerifiedSuccessUsd.toFixed(6)}` : "n/a";
      console.log(`  ${b.label.padEnd(28)} ${cps.padStart(18)} ${((b.avgQuality ?? 0) * 100).toFixed(0).padStart(7)}% ${Math.round(b.avgTokens ?? 0).toString().padStart(10)}`);
    }
    if (c.primaryMetric.dilaVsRawReductionPct != null) {
      console.log(`\n  Dila vs Raw cost reduction:            ${c.primaryMetric.dilaVsRawReductionPct.toFixed(1)}%`);
    }
    if (c.primaryMetric.dilaVsProviderCacheReductionPct != null) {
      console.log(`  Dila vs Raw+provider-cache reduction:  ${c.primaryMetric.dilaVsProviderCacheReductionPct.toFixed(1)}%`);
      console.log(`  Still wins after provider cache:       ${c.dilaStillWinsVsProviderCache ? "YES" : "NO"}`);
    }
    console.log(`  Ideal result matrix:                   ${c.idealScore}`);
    console.log(`  Brutal rule:                         ${c.brutalRule.message}`);
  }

  if (bench.publishability) {
    console.log(`\n${"─".repeat(72)}`);
    console.log(`PUBLICATION STATUS: ${bench.publishability.status.toUpperCase()}`);
    for (const g of bench.publishability.gates) {
      console.log(`  ${g.passed ? "✓" : "✗"} ${g.label}${g.detail ? ` — ${g.detail}` : ""}`);
    }
    if (bench.publishability.refusalReason) {
      console.log(`\n  ${bench.publishability.refusalReason}`);
    }
    if (bench.publishability.headlineClaim) {
      console.log(`\n  Publishable claim: ${bench.publishability.headlineClaim.statement}`);
    }
  }

  if (bench.illustrativeEconomics?.ok) {
    const e = bench.illustrativeEconomics;
    console.log(`\n${"─".repeat(72)}`);
    console.log(`ILLUSTRATIVE ECONOMICS ($100k/mo inference spend)`);
    console.log(`  ${e.disclaimer}`);
    console.log(`  Projected spend:  $${e.projectedMonthlySpendUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`);
    console.log(`  Projected savings: $${e.projectedMonthlySavingsUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo ($${e.annualSavingsUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr)`);
  }

  if (bench.moat?.pathComparison?.ok) {
    const m = bench.moat;
    console.log(`\n${"─".repeat(72)}`);
    console.log("INFORMATION PATH — the moat equation");
    console.log(`  Raw:  ${m.pathComparison.raw.narrative}`);
    console.log(`  Dila: ${m.pathComparison.dila.narrative}`);
    if (m.pathComparison.inferenceReductionPct != null) {
      console.log(`  Inference reduction: ${m.pathComparison.inferenceReductionPct.toFixed(1)}%`);
    }
    if (m.layerAttribution) {
      console.log(`  Verdict: ${m.layerAttribution.verdict}`);
      if (m.layerAttribution.regressions?.length > 0) {
        console.log("  Quality regressions detected:");
        for (const r of m.layerAttribution.regressions) {
          console.log(`    · ${r.label}: −${r.qualityLossPp.toFixed(1)}pp — ${r.recommendation}`);
        }
      } else if (m.layerAttribution.overallAtoE) {
        const o = m.layerAttribution.overallAtoE;
        console.log(`  A→E quality: ${o.qualityDeltaPp >= 0 ? "+" : ""}${o.qualityDeltaPp.toFixed(1)}pp | token reduction: ${o.tokenReductionPct?.toFixed(1) ?? "?"}%`);
        console.log(`  80% inference target: ${o.target80PctInferenceReduction ? "MET" : "NOT YET"}`);
      }
      for (const t of m.layerAttribution.transitions || []) {
        const qSign = t.qualityDeltaPp >= 0 ? "+" : "";
        console.log(`  ${t.from}→${t.to} ${t.label}: quality ${qSign}${t.qualityDeltaPp.toFixed(1)}pp, tokens −${t.tokenDeltaPct?.toFixed(0) ?? "?"}%`);
      }
    }
  }

  if (bench.swe) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("SWE MINI HARNESS (objective test verification)");
    console.log(`  Passed: ${bench.swe.passed}/${bench.swe.total} (${(bench.swe.passRate * 100).toFixed(0)}%)`);
  }

  if (bench.counterfactual?.paths?.length) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("COUNTERFACTUAL CONTEXT TESTS (FULL vs COMPRESSED promotion gate)");
    for (const cf of bench.counterfactual.paths) {
      console.log(`  Path ${cf.pathId}: promoted=${cf.promoted} fields=${cf.fields} promotionRate=${cf.promotionRate != null ? `${(cf.promotionRate * 100).toFixed(0)}%` : "n/a"} tokenSavings=${cf.tokenSavingsPct?.toFixed(1) ?? "n/a"}%`);
    }
    if (bench.counterfactual.overallPromotionRate != null) {
      console.log(`  Overall promotion rate: ${(bench.counterfactual.overallPromotionRate * 100).toFixed(0)}%`);
    }
  }

  if (bench.compilerV2) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("COGNITIVE COMPILER V2");
    console.log(`  Governor paths: ${bench.compilerV2.pathsWithGovernor}`);
    if (bench.compilerV2.avgPromotionRate != null) {
      console.log(`  Avg promotion rate: ${(bench.compilerV2.avgPromotionRate * 100).toFixed(0)}%`);
    }
    console.log(`  Recoverable fields: ${bench.compilerV2.recoverableFieldsTotal}`);
    if (bench.compilerV2.reasoningLevels?.length) {
      console.log(`  Reasoning levels: ${bench.compilerV2.reasoningLevels.map((r) => `${r.pathId}=L${r.level}`).join(", ")}`);
    }
  }

  if (bench.cognitiveCompiler && Object.keys(bench.cognitiveCompiler).length) {
    console.log(`\n${"─".repeat(72)}`);
    console.log("DHTP COGNITIVE COMPILER TIERS");
    for (const [tier, count] of Object.entries(bench.cognitiveCompiler)) {
      console.log(`  ${tier}: ${count}`);
    }
  }

  console.log(`${"=".repeat(72)}\n`);
}

function printEconomics(econ) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("COGNITIVE ECONOMICS MULTIPLIER — A/B/C/D/E");
  console.log(`${"=".repeat(72)}`);
  console.log(`Run ID:     ${econ.runId}`);
  console.log(`Result:     ${econ.ok ? "PASS" : "FAIL"}`);
  console.log(`Model:      ${econ.pricing.model} (${econ.pricing.mode})`);
  console.log(`Rates:      $${econ.pricing.inputPer1M}/1M in · $${econ.pricing.outputPer1M}/1M out`);
  console.log(`\n${"Path".padEnd(6)} ${"Label".padEnd(18)} ${"$/success".padStart(10)} ${"vs Raw".padStart(8)} ${"Success".padStart(8)} ${"Quality".padStart(8)} ${"In tok".padStart(10)} ${"Latency".padStart(8)}`);
  for (const row of econ.comparison) {
    console.log(
      `${row.pathId.padEnd(6)} ${(row.label || "").padEnd(18)} ${String(row.costPerSuccessfulMissionUsd?.toFixed(6) ?? "n/a").padStart(10)} ${row.savingsPctVsRaw != null ? `${row.savingsPctVsRaw.toFixed(1)}%`.padStart(8) : "n/a".padStart(8)} ${(row.successRate * 100).toFixed(0).padStart(7)}% ${row.avgQualityScore.toFixed(2).padStart(8)} ${String(row.billedInputTokens).padStart(10)} ${row.avgLatencyMs.toFixed(0).padStart(7)}ms`,
    );
  }
  console.log(`\nCompile probes (single cognitive_probe invocation):`);
  for (const p of econ.compileProbes) {
    console.log(`  ${p.pathId}: world=${p.pipeline?.world} → dtu=${p.pipeline?.afterDtu} → dhtp=${p.pipeline?.dhtp} → model=${p.pipeline?.modelInput} ($${p.cost?.totalUsd?.toFixed(6) ?? 0})`);
  }
  console.log(`\nHeadline: ${econ.headline.verdict}`);
  if (econ.headline.economicMultiplier) {
    console.log(`  Economic multiplier (A→E): ${econ.headline.economicMultiplier.toFixed(1)}× cheaper per successful mission`);
  } else if (econ.headline.savingsPctFullVsRaw != null) {
    console.log(`  Savings vs raw (A→E): ${econ.headline.savingsPctFullVsRaw.toFixed(1)}% lower $/successful mission`);
  }
  if (econ.headline.caveat) console.log(`  Note: ${econ.headline.caveat}`);
  console.log(`${"=".repeat(72)}\n`);
}

async function main() {
  const opts = parseArgs(process.argv);
  const db = setupDb();

  if (opts.pathExperiment) {
    const exp = await runPathExperimentBench({ db });
    if (opts.json) {
      console.log(JSON.stringify(exp, null, 2));
    } else {
      printPathExperiment(exp);
    }
    process.exit(exp.ok !== false ? 0 : 1);
    return;
  }

  if (opts.blindBenchmark) {
    if (opts.billed) process.env.COGNITIVE_ECON_MODE = "billed";
    console.log(`Starting Dila-vs-Raw blind benchmark (A–E paths, independent evaluator${opts.billed ? ", billed mode" : ""})...`);
    const blind = await runDilaRawBlindBenchmark({
      db,
      dispatchMCP: mockDispatch,
      minCacheUses: opts.minCacheUses,
      pricing: opts.billed ? { mode: "billed" } : undefined,
    });
    if (opts.json) {
      const outPath = `dila-raw-blind-${blind.runId}.json`;
      writeFileSync(outPath, JSON.stringify(blind, null, 2));
      console.log(`Wrote ${outPath}`);
    } else {
      printBlindBenchmark(blind);
    }
    process.exit(blind.ok ? 0 : 1);
    return;
  }

  if (opts.economics) {
    console.log(`Starting economics bench: ${opts.economicsIterations} missions/path × 5 paths...`);
    const econ = await runCognitiveEconomicsBench({
      db,
      dispatchMCP: mockDispatch,
      iterationsPerPath: opts.economicsIterations,
      minCacheUses: opts.minCacheUses,
    });
    if (opts.json) {
      const outPath = `cognitive-economics-${econ.runId}.json`;
      writeFileSync(outPath, JSON.stringify(econ, null, 2));
      console.log(`Wrote ${outPath}`);
    } else {
      printEconomics(econ);
    }
    process.exit(econ.ok ? 0 : 1);
    return;
  }

  if (opts.dgbFull) {
    console.log(`Starting DGB full (levels 1–5): ${opts.warmupIterations} warmup...`);
    const dgb = await runFullDgbBenchmark({
      db,
      dispatchMCP: mockDispatch,
      warmupIterations: opts.warmupIterations,
      minCacheUses: opts.minCacheUses,
    });
    if (opts.json) {
      const outPath = `cognitive-dgb-full-${Date.now()}.json`;
      writeFileSync(outPath, JSON.stringify(dgb, null, 2));
      console.log(`Wrote ${outPath}`);
    } else {
      printFullDgb(dgb);
    }
    process.exit(dgb.ok ? 0 : 1);
    return;
  }

  if (opts.generalization) {
    console.log(`Starting DGB: ${opts.warmupIterations} warmup + variant transfer...`);
    const dgb = await runGeneralizationBenchmark({
      db,
      dispatchMCP: mockDispatch,
      warmupIterations: opts.warmupIterations,
      minCacheUses: opts.minCacheUses,
    });
    if (opts.json) {
      const outPath = `cognitive-dgb-${dgb.runId}.json`;
      writeFileSync(outPath, JSON.stringify(dgb, null, 2));
      console.log(`Wrote ${outPath}`);
    } else {
      printGeneralization(dgb);
    }
    process.exit(dgb.ok ? 0 : 1);
    return;
  }

  const useLearningCurve = opts.learningCurve || opts.iterations >= 100;

  if (useLearningCurve) {
    console.log(`Starting full pipeline bench: cold novel → ${opts.iterations} iterations → warm novel...`);
    const full = await runFullPipelineBenchmark({
      db,
      dispatchMCP: mockDispatch,
      iterations: opts.iterations,
      minCacheUses: opts.minCacheUses,
    });
    if (opts.json) {
      const outPath = `cognitive-mission-bench-${opts.iterations}iter-${full.runId}.json`;
      writeFileSync(outPath, JSON.stringify(full, null, 2));
      console.log(`Wrote ${outPath}`);
    } else {
      printReport({ ok: full.ok, runId: full.runId, summary: full.bench.summary, empirical: full.empirical }, opts);
      printLearningCurve(full);
    }
    process.exit(full.ok ? 0 : 1);
    return;
  }

  console.log(`Starting cognitive mission bench: ${opts.iterations} iterations (min cache uses: ${opts.minCacheUses})...`);

  const bench = await runCognitiveMissionBench({
    db,
    dispatchMCP: mockDispatch,
    iterations: opts.iterations,
    minCacheUses: opts.minCacheUses,
  });

  if (opts.json) {
    const outPath = `cognitive-mission-bench-${opts.iterations}iter-${bench.runId}.json`;
    writeFileSync(outPath, JSON.stringify({ bench: { ok: bench.ok, runId: bench.runId, summary: bench.summary, empirical: bench.empirical } }, null, 2));
    console.log(`Wrote ${outPath}`);
  } else {
    printReport(bench, opts);
  }

  process.exit(bench.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
