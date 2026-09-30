#!/usr/bin/env node
// server/scripts/run-dhtp-rs.mjs
//
// Cloud-agent entry point for DHTP Representation Sufficiency benchmark.
// Auto-loads provider keys OR falls back to local Ollama.
//
// Usage:
//   node server/scripts/run-dhtp-rs.mjs run-all --provider ollama
//   node server/scripts/run-dhtp-rs.mjs resume
//   node server/scripts/run-dhtp-rs.mjs status
//
// Handoff: docs/DHTP_RS_CLOUD_AGENT.md

import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
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
import {
  loadProviderEnv,
  loadEnvFile,
  resolveConfiguredProviders,
  apiKeyForProvider,
} from "../lib/runtime/provider-env-loader.js";
import { PHASE2_CONFIG, SPEC_ID } from "../lib/runtime/dhtp-rs-spec.js";
import { buildPhase1AnalysisReport, printSpecAnalysis } from "../lib/runtime/dhtp-rs-report.js";
import {
  loadAgentState,
  saveAgentState,
  markStep,
  findNextStep,
  formatAgentStatus,
  DEFAULT_RESULTS_DIR,
  EXECUTION_ORDER,
} from "../lib/runtime/dhtp-rs-agent-state.js";
import {
  runRepresentationSufficiencyBench,
  REPRESENTATION_CONDITIONS,
  COGNITIVE_PROBES,
} from "../lib/runtime/representation-sufficiency-bench.js";
import {
  makeOllamaCallProvider,
  listOllamaModels,
  pickPortabilityModels,
} from "../lib/runtime/dhtp-rs-ollama-provider.js";
import { writeHumanValidationExport } from "../lib/runtime/dhtp-rs-human-export.js";
import { synthesizeFinalReport } from "../lib/runtime/dhtp-rs-freeze.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const RESULTS_DIR = DEFAULT_RESULTS_DIR;

function parseArgs(argv) {
  const opts = {
    command: "status",
    envFile: null,
    trials: null,
    probes: null,
    delaySec: null,
    dryRun: false,
    provider: null,
    model: null,
  };
  const args = argv.slice(2);
  if (args[0] && !args[0].startsWith("-")) {
    opts.command = args[0];
    args.shift();
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--env-file" && args[i + 1]) opts.envFile = args[++i];
    else if (a === "--trials" && args[i + 1]) opts.trials = Number(args[++i]);
    else if (a === "--probes" && args[i + 1]) {
      const val = args[++i];
      opts.probes = val === "all" ? Object.keys(COGNITIVE_PROBES) : val.split(",").map((s) => s.trim());
    } else if (a === "--delay" && args[i + 1]) opts.delaySec = Number(args[++i]);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--provider" && args[i + 1]) opts.provider = args[++i];
    else if (a === "--model" && args[i + 1]) opts.model = args[++i];
  }
  return opts;
}

function setupEnv(opts) {
  process.env.CONCORD_REPO_ROOT = REPO_ROOT;
  if (opts.envFile) {
    loadEnvFile(resolve(opts.envFile), { overwrite: true });
  } else {
    loadProviderEnv({ repoRoot: REPO_ROOT });
  }
}

function resolveBackend(opts) {
  setupEnv(opts);
  const forceOllama = opts.provider === "ollama";
  const googleKey = apiKeyForProvider("google");
  if (!forceOllama && googleKey) {
    return {
      apiKey: googleKey,
      callProvider: undefined,
      providerLabel: "google",
      model: opts.model || "gemini-3.6-flash",
    };
  }
  const model = opts.model || process.env.DHTP_RS_OLLAMA_MODEL || "qwen3.5:2b";
  return {
    apiKey: "ollama-local",
    callProvider: makeOllamaCallProvider(model),
    providerLabel: "ollama",
    model,
  };
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
  console.log(`\n${"Condition".padEnd(22)} ${"Quality".padStart(8)} ${"Tokens".padStart(8)} ${"API fail".padStart(8)}`);
  console.log(`${"─".repeat(52)}`);
  for (const [condId, agg] of Object.entries(aggregates)) {
    const label = REPRESENTATION_CONDITIONS[condId]?.label || condId;
    console.log(
      `${label.padEnd(22)} ${(agg.avgComposite * 100).toFixed(1).padStart(7)}% ${Math.round(agg.avgTokensIn).toString().padStart(8)} ${(agg.apiFailureRate * 100).toFixed(0).padStart(7)}%`,
    );
  }
}

function loadBenchFromState(stepId) {
  const state = loadAgentState(RESULTS_DIR);
  const step = state.steps?.[stepId];
  if (!step?.resultPath) return null;
  try {
    return JSON.parse(readFileSync(step.resultPath, "utf8"));
  } catch {
    return null;
  }
}

function strongestProbeFromPhase2(bench) {
  let best = { probeId: "fleet_health", score: 0 };
  for (const [probeId, pr] of Object.entries(bench?.probeResults || {})) {
    const dhtp = pr.aggregates?.dhtp_packet?.avgComposite ?? 0;
    if (dhtp > best.score) best = { probeId, score: dhtp };
  }
  return best.probeId;
}

async function runBench({
  trials,
  conditions,
  probes,
  delaySec,
  timeoutSec = 120,
  stepId,
  backend,
  runIdSuffix = "",
}) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  let state = loadAgentState(RESULTS_DIR);
  if (stepId) {
    state = markStep(state, stepId, { status: "running" });
    saveAgentState(state, RESULTS_DIR);
  }

  const db = setupDb();
  const total = trials * conditions.length * probes.length;
  console.log(`\n${SPEC_ID} — ${stepId}`);
  console.log(`  Provider: ${backend.providerLabel} (${backend.model})`);
  console.log(`  ${trials} trials × ${conditions.length} conditions × ${probes.length} probes = ${total} LLM calls`);
  console.log(`  Evaluator: blind rubric (NOT independent)\n`);

  let completed = 0;
  const bench = await runRepresentationSufficiencyBench({
    db,
    trials,
    conditions,
    probes,
    apiKey: backend.apiKey,
    callProvider: backend.callProvider,
    provider: backend.providerLabel,
    timeoutMs: timeoutSec * 1000,
    interCallDelayMs: (delaySec ?? 1) * 1000,
    onTrialComplete: ({ probeId, conditionId, trialIndex, run }) => {
      completed += 1;
      const q = ((run.evaluation?.composite ?? 0) * 100).toFixed(0);
      const tok = run.live?.tokensIn ?? 0;
      const flags = [
        run.live?.timedOut ? "TIMEOUT" : null,
        run.live?.apiFailure ? "API_FAIL" : null,
      ].filter(Boolean).join(" ");
      process.stdout.write(`  [${completed}/${total}] ${probeId}/${conditionId} t${trialIndex + 1}: q=${q}% tok=${tok} ${flags}\n`);
    },
  });

  if (backend.providerLabel === "ollama" && bench.manifest) {
    bench.manifest.provider = "ollama";
    bench.manifest.model = backend.model;
  }

  const outPath = resolve(RESULTS_DIR, `${bench.runId}${runIdSuffix}.json`);
  writeFileSync(outPath, JSON.stringify(bench, null, 2));
  console.log(`\nWrote ${outPath}`);

  printConditionTable(bench.overall.aggregates);
  printSpecAnalysis(bench);

  state = loadAgentState(RESULTS_DIR);
  if (stepId) {
    state = markStep(state, stepId, {
      status: bench.ok ? "complete" : "failed",
      runId: bench.runId,
      resultPath: outPath,
      note: `${backend.providerLabel}/${backend.model} trials=${trials} cost=$${bench.totalCostUsd?.toFixed(4)}`,
      error: bench.ok ? null : "bench_returned_not_ok",
    });
    saveAgentState(state, RESULTS_DIR);
  }

  return { bench, outPath };
}

function cmdTest() {
  const r = spawnSync("node", [
    "--test",
    "tests/depth/representation-sufficiency-bench.test.js",
    "tests/depth/dhtp-rs-statistics.test.js",
    "tests/depth/dhtp-rs-agent-state.test.js",
  ], { cwd: resolve(__dirname, ".."), stdio: "inherit" });
  process.exit(r.status ?? 1);
}

function cmdStatus(opts) {
  setupEnv(opts);
  const state = loadAgentState(RESULTS_DIR);
  const configured = resolveConfiguredProviders();
  const backend = resolveBackend(opts);
  console.log(formatAgentStatus(state, { resultsDir: RESULTS_DIR, configuredProviders: configured }));
  if (backend) {
    console.log(`\nResolved backend: ${backend.providerLabel} (${backend.model})`);
  }
}

function cmdAnalyze() {
  console.log(buildPhase1AnalysisReport());
}

async function cmdPhase2(opts) {
  const backend = resolveBackend(opts);
  if (opts.dryRun) {
    console.log(`DRY RUN phase2 via ${backend.providerLabel}/${backend.model}`);
    return;
  }
  await runBench({
    trials: opts.trials ?? PHASE2_CONFIG.trials,
    conditions: PHASE2_CONFIG.conditions,
    probes: opts.probes ?? PHASE2_CONFIG.probes,
    delaySec: opts.delaySec ?? (backend.providerLabel === "ollama" ? 0.5 : 4),
    stepId: "STEP_2_phase2_generalization",
    backend,
  });
}

async function cmdAblation(opts) {
  const backend = resolveBackend(opts);
  if (opts.dryRun) return;
  await runBench({
    trials: opts.trials ?? 20,
    conditions: ["dhtp_full", "selection_only", "structure_only", "matched_budget_raw", "random_budget_raw"],
    probes: opts.probes ?? ["fleet_health", "planning"],
    delaySec: opts.delaySec ?? (backend.providerLabel === "ollama" ? 0.5 : 4),
    stepId: "STEP_3_selection_ablations",
    backend,
  });
}

async function cmdLocalModels(opts) {
  const available = await listOllamaModels();
  const models = pickPortabilityModels(available);
  console.log(`Local models available: ${available.join(", ") || "(none)"}`);
  console.log(`Portability sweep: ${models.map((m) => `${m.tier}=${m.model}`).join(", ") || "fallback"}`);

  if (!models.length) {
    console.error("No Ollama models found. Install qwen3.5:2b or similar.");
    process.exit(1);
  }

  const summaries = [];
  for (const { tier, model } of models) {
    const backend = {
      apiKey: "ollama-local",
      callProvider: makeOllamaCallProvider(model),
      providerLabel: "ollama",
      model,
    };
    console.log(`\n--- Local model tier ${tier}: ${model} ---`);
    const { bench, outPath } = await runBench({
      trials: opts.trials ?? 10,
      conditions: PHASE2_CONFIG.conditions,
      probes: opts.probes ?? ["fleet_health", "decision"],
      delaySec: 0.5,
      stepId: null,
      backend,
      runIdSuffix: `_${tier.replace(/[^a-z0-9]/gi, "")}`,
    });
    summaries.push({ tier, model, path: outPath, dhtp: bench.overall?.aggregates?.dhtp_packet?.avgComposite });
  }

  const state = markStep(loadAgentState(RESULTS_DIR), "STEP_4_local_model_portability", {
    status: "complete",
    note: summaries.map((s) => `${s.tier}:${s.model}=${((s.dhtp ?? 0) * 100).toFixed(0)}%`).join("; "),
  });
  saveAgentState(state, RESULTS_DIR);
}

async function cmdFullRaw(opts) {
  const backend = resolveBackend(opts);
  const phase2 = loadBenchFromState("STEP_2_phase2_generalization");
  const probe = strongestProbeFromPhase2(phase2) || "fleet_health";
  console.log(`Full raw selective on strongest probe: ${probe}`);

  await runBench({
    trials: opts.trials ?? 5,
    conditions: ["raw_corpus", "dhtp_packet", "matched_budget_raw"],
    probes: [probe],
    delaySec: opts.delaySec ?? (backend.providerLabel === "ollama" ? 1 : 4),
    timeoutSec: 180,
    stepId: "STEP_5_full_raw_selective",
    backend,
    runIdSuffix: "_fullraw",
  });
}

async function cmdHumanValidation(opts) {
  const phase2 = loadBenchFromState("STEP_2_phase2_generalization");
  if (!phase2) {
    console.error("Phase 2 results required. Run phase2 first.");
    process.exit(1);
  }
  const outPath = resolve(RESULTS_DIR, `human_validation_${phase2.runId}.json`);
  const packet = writeHumanValidationExport(phase2, outPath, { sampleSize: 30 });
  console.log(`Exported ${packet.sampleSize} blind items to ${outPath}`);

  const state = markStep(loadAgentState(RESULTS_DIR), "STEP_6_human_blind_validation", {
    status: "complete",
    resultPath: outPath,
    note: `${packet.sampleSize} items exported for human scoring`,
  });
  saveAgentState(state, RESULTS_DIR);
}

async function cmdFreeze(opts) {
  const state = loadAgentState(RESULTS_DIR);
  const artifacts = [];
  for (const stepId of EXECUTION_ORDER) {
    const step = state.steps?.[stepId];
    if (step?.resultPath) {
      artifacts.push({ stepId, path: step.resultPath, runId: step.runId });
    }
  }

  const report = synthesizeFinalReport({ resultsDir: RESULTS_DIR, agentState: state, artifacts });
  const outPath = resolve(RESULTS_DIR, "DHTP_RS_FINAL_REPORT.md");
  writeFileSync(outPath, report.markdown);
  console.log(`Wrote ${outPath}`);
  console.log(`\nClaim level: ${report.claimLevel} — frozen.`);

  const nextState = markStep(state, "STEP_7_freeze_and_publish", {
    status: "complete",
    resultPath: outPath,
    note: `claim_level=${report.claimLevel}`,
  });
  saveAgentState(nextState, RESULTS_DIR);
}

async function dispatchStep(cmd, opts) {
  switch (cmd) {
    case "analyze": cmdAnalyze(); break;
    case "phase2": await cmdPhase2(opts); break;
    case "ablation": await cmdAblation(opts); break;
    case "local-models": await cmdLocalModels(opts); break;
    case "full-raw": await cmdFullRaw(opts); break;
    case "human-validation": await cmdHumanValidation(opts); break;
    case "freeze": await cmdFreeze(opts); break;
    default:
      console.error(`Unknown step command: ${cmd}`);
      process.exit(1);
  }
}

async function cmdResume(opts) {
  setupEnv(opts);
  const state = loadAgentState(RESULTS_DIR);
  const next = findNextStep(state);
  if (!next) {
    console.log("All steps complete. Run: node server/scripts/run-dhtp-rs.mjs freeze");
    return;
  }
  console.log(`Resuming: ${next.stepId} → ${next.step.command}\n`);
  await dispatchStep(next.step.command, opts);
}

async function cmdRunAll(opts) {
  setupEnv(opts);
  const backend = resolveBackend(opts);
  console.log(`run-all via ${backend.providerLabel}/${backend.model}`);
  if (opts.dryRun) {
    for (const stepId of EXECUTION_ORDER) {
      const state = loadAgentState(RESULTS_DIR);
      const step = state.steps?.[stepId];
      if (step?.status !== "complete") {
        console.log(`  would run: ${stepId} → ${step?.command}`);
      }
    }
    return;
  }

  for (const stepId of EXECUTION_ORDER) {
    const state = loadAgentState(RESULTS_DIR);
    const step = state.steps?.[stepId];
    if (step?.status === "complete") {
      console.log(`Skipping ${stepId} (complete)`);
      continue;
    }
    console.log(`\n${"=".repeat(60)}\nExecuting ${stepId}\n${"=".repeat(60)}`);
    await dispatchStep(step.command, opts);
  }

  console.log("\nrun-all complete.");
  cmdStatus(opts);
}

function printHelp() {
  console.log(`
DHTP-RS cloud agent runner — ${SPEC_ID}

Commands:
  run-all            Execute all pending steps end-to-end
  resume             Run the next pending step
  status             Show progress
  analyze            Phase 1 report
  phase2             Phase 2 generalization
  ablation           Phase 3 selection/structure ablations
  local-models       Phase 4 Ollama portability sweep
  full-raw           Phase 5 full raw on strongest probe
  human-validation   Phase 6 export blind scoring packet
  freeze             Phase 7 final report
  test               Unit tests (no API key)

Options:
  --provider ollama|google   Force backend (default: google if key set, else ollama)
  --model NAME               Model override
  --env-file PATH            Load keys from file
  --trials N                 Override trial count
  --probes all|...           Override probes
  --delay N                  Seconds between calls
  --dry-run

Handoff: docs/DHTP_RS_CLOUD_AGENT.md
`);
}

async function main() {
  const opts = parseArgs(process.argv);

  switch (opts.command) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    case "status":
      cmdStatus(opts);
      break;
    case "analyze":
    case "phase1":
      cmdAnalyze();
      break;
    case "phase2":
      await cmdPhase2(opts);
      break;
    case "ablation":
      await cmdAblation(opts);
      break;
    case "local-models":
      await cmdLocalModels(opts);
      break;
    case "full-raw":
      await cmdFullRaw(opts);
      break;
    case "human-validation":
      await cmdHumanValidation(opts);
      break;
    case "freeze":
      await cmdFreeze(opts);
      break;
    case "resume":
      await cmdResume(opts);
      break;
    case "run-all":
      await cmdRunAll(opts);
      break;
    case "test":
      cmdTest();
      break;
    default:
      console.error(`Unknown command: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
