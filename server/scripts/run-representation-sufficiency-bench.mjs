#!/usr/bin/env node
// server/scripts/run-representation-sufficiency-bench.mjs
//
// Blind repeated representation sufficiency benchmark (DHTP-RS-MASTER-001).
//
// Usage:
//   GEMINI_API_KEY=... node server/scripts/run-representation-sufficiency-bench.mjs --trials 30
//   GEMINI_API_KEY=... node server/scripts/run-representation-sufficiency-bench.mjs --phase2
//   GEMINI_API_KEY=... node server/scripts/run-representation-sufficiency-bench.mjs --trials 20 --probes all --skip-raw --json
//   node server/scripts/run-dhtp-rs-analyze.mjs --phase1

import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { seedBenchDtuCorpus } from "../lib/runtime/cognitive-savings-ledger.js";
import { loadProviderEnv } from "../lib/runtime/provider-env-loader.js";
import { PHASE2_CONFIG, SPEC_ID } from "../lib/runtime/dhtp-rs-spec.js";
import { printSpecAnalysis } from "../lib/runtime/dhtp-rs-report.js";
import {
  runRepresentationSufficiencyBench,
  REPRESENTATION_CONDITIONS,
  COGNITIVE_PROBES,
  DEFAULT_CONDITIONS,
  EVALUATOR_CAVEAT,
} from "../lib/runtime/representation-sufficiency-bench.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const RESULTS_DIR = resolve(__dirname, "../results/dhtp-rs");

const ALL_PROBE_IDS = Object.keys(COGNITIVE_PROBES);

function parseArgs(argv) {
  const opts = {
    trials: 10,
    skipRaw: false,
    json: false,
    timeoutSec: 120,
    delaySec: 3,
    envFile: null,
    probes: ["fleet_health"],
    phase2: false,
    ablation: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--trials" && argv[i + 1]) opts.trials = Number(argv[++i]);
    else if (a === "--skip-raw") opts.skipRaw = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--phase2") opts.phase2 = true;
    else if (a === "--ablation") opts.ablation = true;
    else if (a === "--timeout" && argv[i + 1]) opts.timeoutSec = Number(argv[++i]);
    else if (a === "--delay" && argv[i + 1]) opts.delaySec = Number(argv[++i]);
    else if (a === "--env-file" && argv[i + 1]) opts.envFile = argv[++i];
    else if (a === "--probes" && argv[i + 1]) {
      const val = argv[++i];
      opts.probes = val === "all" ? ALL_PROBE_IDS : val.split(",").map((s) => s.trim());
    }
  }

  if (opts.phase2) {
    opts.trials = PHASE2_CONFIG.trials;
    opts.probes = [...PHASE2_CONFIG.probes];
    opts.skipRaw = true;
    opts.delaySec = PHASE2_CONFIG.interCallDelayMs / 1000;
    opts.json = true;
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

function printConditionTable(aggregates) {
  console.log(`\n${"Condition".padEnd(22)} ${"Quality".padStart(8)} ${"Correct".padStart(8)} ${"Schema".padStart(8)} ${"Tokens".padStart(8)} ${"$/call".padStart(10)} ${"Lat(s)".padStart(8)} ${"API fail".padStart(8)}`);
  console.log(`${"─".repeat(72)}`);
  for (const [condId, agg] of Object.entries(aggregates)) {
    const label = REPRESENTATION_CONDITIONS[condId]?.label || condId;
    console.log(
      `${label.padEnd(22)} ${(agg.avgComposite * 100).toFixed(1).padStart(7)}% ${(agg.avgTaskCorrectness * 100).toFixed(0).padStart(7)}% ${(agg.avgSchemaAdherence * 100).toFixed(0).padStart(7)}% ${Math.round(agg.avgTokensIn).toString().padStart(8)} $${agg.avgCostUsd.toFixed(6).padStart(9)} ${(agg.avgLatencyMs / 1000).toFixed(1).padStart(8)} ${(agg.apiFailureRate * 100).toFixed(0).padStart(7)}%`,
    );
  }
}

function printHeadline(h) {
  console.log(`\n${"─".repeat(72)}`);
  console.log("PRIMARY CLAIMS");
  if (h.primaryClaim) console.log(`  ${h.primaryClaim}`);
  if (h.controlClaim) console.log(`  Matched-budget control: ${h.controlClaim}`);
  if (h.randomControlClaim) console.log(`  Random-budget control:  ${h.randomControlClaim}`);
  if (h.dhtpVsMatchedBudget) {
    console.log(`  DHTP vs truncated (+${(h.dhtpVsMatchedBudget.qualityDelta * 100).toFixed(1)}pp)`);
  }
  if (h.dhtpVsRandomBudget) {
    console.log(`  DHTP vs random sample (+${(h.dhtpVsRandomBudget.qualityDelta * 100).toFixed(1)}pp, selection wins: ${h.dhtpVsRandomBudget.selectionBeatsRandom ? "YES" : "NO"})`);
  }
  if (h.secondaryMetric) {
    console.log(`\n  Secondary: ${h.secondaryMetric.usefulPerTokenMultiplier?.toFixed(0)}× useful/token (${h.secondaryMetric.note})`);
  }
  if (h.dhtpVsRaw) {
    console.log(`\n  Raw API failure rate: ${(h.dhtpVsRaw.rawApiFailureRate * 100).toFixed(0)}%  timeout: ${(h.dhtpVsRaw.rawTimeoutRate * 100).toFixed(0)}%`);
  }
  console.log(`\n  Thesis: ${h.thesis}`);
  console.log(`\n  Evaluator: ${h.evaluatorCaveat?.note || EVALUATOR_CAVEAT.note}`);
}

function printReport(bench) {
  console.log(`\n${"=".repeat(72)}`);
  console.log("REPRESENTATION SUFFICIENCY BENCH");
  console.log(`${"=".repeat(72)}`);
  console.log(`Run ID:    ${bench.runId}`);
  console.log(`Trials:    ${bench.trials} per condition`);
  console.log(`Probes:    ${bench.probes.join(", ")}`);
  console.log(`Duration:  ${(bench.durationMs / 1000).toFixed(1)}s`);
  console.log(`Total $:   $${bench.totalCostUsd.toFixed(6)}`);
  console.log(`Target met: ${bench.targetMet ? "YES" : "NO"}`);

  if (bench.probes.length === 1) {
    const pr = bench.probeResults[bench.probes[0]];
    printConditionTable(pr.aggregates);
    const highFail = Object.values(pr.aggregates).some((a) => a.apiFailureRate > 0.1);
    if (highFail && pr.aggregatesSuccessfulOnly) {
      console.log(`\n  (API failures detected — successful calls only:)`);
      printConditionTable(pr.aggregatesSuccessfulOnly);
      printHeadline(pr.headlineSuccessfulOnly || pr.headline);
    } else {
      for (const [cond, ci] of Object.entries(pr.compositeCIs)) {
        const label = REPRESENTATION_CONDITIONS[cond]?.label || cond;
        console.log(`  CI ${label}: ${(ci.low * 100).toFixed(1)}% – ${(ci.high * 100).toFixed(1)}%`);
      }
      printHeadline(pr.headline);
    }
  } else {
    console.log(`\n${"─".repeat(72)}`);
    console.log("OVERALL (all probes pooled)");
    printConditionTable(bench.overall.aggregates);
    printHeadline(bench.overall.headline);

    for (const probeId of bench.probes) {
      const pr = bench.probeResults[probeId];
      console.log(`\n${"─".repeat(72)}`);
      console.log(`PROBE: ${pr.probeLabel}`);
      printConditionTable(pr.aggregates);
      const dhtp = pr.aggregates.dhtp_packet;
      const raw = pr.aggregates.raw_corpus;
      const matched = pr.aggregates.matched_budget_raw;
      const random = pr.aggregates.random_budget_raw;
      if (dhtp && raw) {
        console.log(`  DHTP ${(dhtp.avgComposite * 100).toFixed(1)}% vs Raw ${(raw.avgComposite * 100).toFixed(1)}% | vs Matched ${matched ? (matched.avgComposite * 100).toFixed(1) : "n/a"}% | vs Random ${random ? (random.avgComposite * 100).toFixed(1) : "n/a"}%`);
      }
    }
  }

  console.log(`${"=".repeat(72)}\n`);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.envFile) {
    const { loadEnvFile } = await import("../lib/runtime/provider-env-loader.js");
    loadEnvFile(opts.envFile, { overwrite: true });
  } else {
    loadProviderEnv({ repoRoot: REPO_ROOT });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.CONCORD_PLATFORM_GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY required — rotate any previously exposed keys before use");
    process.exit(1);
  }

  let conditions = [...DEFAULT_CONDITIONS];
  if (opts.skipRaw) {
    conditions = conditions.filter((c) => c !== "raw_corpus");
  }
  if (opts.phase2) {
    conditions = [...PHASE2_CONFIG.conditions];
  }
  if (opts.ablation) {
    conditions = [
      "dhtp_full",
      "selection_only",
      "structure_only",
      "matched_budget_raw",
      "random_budget_raw",
    ];
  }

  process.env.CONCORD_REPO_ROOT = REPO_ROOT;
  const totalTrials = opts.trials * conditions.length * opts.probes.length;
  console.log(`\nRepresentation sufficiency bench — ${SPEC_ID}`);
  console.log(`  ${opts.trials} trials × ${conditions.length} conditions × ${opts.probes.length} probes = ${totalTrials} LLM calls`);
  console.log(`  Conditions: ${conditions.join(", ")}`);
  console.log(`  Evaluator: blind rubric (NOT independent — see report caveat)\n`);

  const db = setupDb();
  let completed = 0;

  const bench = await runRepresentationSufficiencyBench({
    db,
    trials: opts.trials,
    conditions,
    probes: opts.probes,
    apiKey,
    timeoutMs: opts.timeoutSec * 1000,
    interCallDelayMs: opts.delaySec * 1000,
    onTrialComplete: ({ probeId, conditionId, trialIndex, run }) => {
      completed += 1;
      const q = ((run.evaluation?.composite ?? 0) * 100).toFixed(0);
      const tok = run.live?.tokensIn ?? 0;
      const lat = ((run.live?.latencyMs ?? 0) / 1000).toFixed(1);
      const flags = [
        run.live?.timedOut ? "TIMEOUT" : null,
        run.live?.apiFailure ? "API_FAIL" : null,
      ].filter(Boolean).join(" ");
      process.stdout.write(`  [${completed}/${totalTrials}] ${probeId}/${conditionId} t${trialIndex + 1}: q=${q}% tok=${tok} ${lat}s ${flags}\n`);
    },
  });

  if (opts.json) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const outPath = resolve(RESULTS_DIR, `${bench.runId}.json`);
    writeFileSync(outPath, JSON.stringify(bench, null, 2));
    console.log(`Wrote ${outPath}`);
  }

  printReport(bench);
  printSpecAnalysis(bench);

  process.exit(bench.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
