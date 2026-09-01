#!/usr/bin/env node
// server/scripts/run-cognitive-mission-bench.mjs
//
// Run repeated cognitive mission iterations and print empirical evidence report.
// Usage:
//   node server/scripts/run-cognitive-mission-bench.mjs [--iterations N]
//   node server/scripts/run-cognitive-mission-bench.mjs --generalization
//   node server/scripts/run-cognitive-mission-bench.mjs --path-experiment
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
import {
  runCognitiveMissionBench,
  runGeneralizationBenchmark,
  runPathExperimentBench,
  runFullPipelineBenchmark,
  runFullDgbBenchmark,
} from "../lib/runtime/cognitive-mission-bench.js";
import { seedBenchDtuCorpus } from "../lib/runtime/cognitive-savings-ledger.js";

function parseArgs(argv) {
  const opts = {
    iterations: 10,
    minCacheUses: 3,
    json: false,
    generalization: false,
    dgbFull: false,
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
    else if (argv[i] === "--learning-curve") opts.learningCurve = true;
    else if (argv[i] === "--path-experiment") opts.pathExperiment = true;
  }
  return opts;
}

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [
    upMission, upPhases, upTier, upDila, upV2, upExec, upCausal,
    upDhtp, upCognitive, upSavings,
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
