#!/usr/bin/env node
// server/scripts/causal-closure-analyze.mjs
//
// Offline runner for the causal-closure / residual experiment. Reads a JSONL log
// of in-basis tick states (written by runAwarenessLoop when CONCORD_CAUSAL_LOG is
// set — see lib/awareness-loop.js) and asks: does the in-basis state determine
// its own future, or is it short by a hidden axis? Grounded in
// dtu_008_irreversible_constraint_cones; bridge probe = agent-awareness-index.
//
// Usage:
//   CONCORD_CAUSAL_LOG=/tmp/causal.jsonl  # capture (set before running the server)
//   node scripts/causal-closure-analyze.mjs [logPath] [--target=surprise] [--history=1]
//
// Default target is `surprise` (prediction-error — a behavior_{t+1} proxy). The
// in-basis features are the 9 awareness modules (affect, drives, goal, memory,
// forwardSim, drift, salience, selfModel, behavior).

import { causalClosure, basisCompletionCurve, loadLog } from "../lib/causal-closure.js";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const logPath = args.find((a) => !a.startsWith("--")) || process.env.CONCORD_CAUSAL_LOG;

if (!logPath) {
  console.error("usage: node scripts/causal-closure-analyze.mjs <logPath> [--target=surprise] [--history=1]");
  console.error("  (or set CONCORD_CAUSAL_LOG). Capture data by running the server with CONCORD_CAUSAL_LOG set");
  console.error("  and CONCORD_AWARENESS_LOOP=1 so the awareness loop fires.");
  process.exit(2);
}

const FEATURES_9 = ["affect", "drives", "goal", "memory", "forwardSim", "drift", "salience", "selfModel", "behavior"];
const META = new Set(["awarenessIndex", "integration", "differentiation", "_t", "tick", "agentId", "worldId"]);
const historyWindow = Number(flags.history ?? 1);

const rows = await loadLog(logPath);
const first = rows[0] || {};
// Resolve the target first (so it can be excluded from auto-detected features).
const targetKey = flags.target
  || ("surprise" in first ? "surprise" : "dtuDelta" in first ? "dtuDelta" : "awarenessIndex");
// Feature keys: explicit --features wins; else the 9 cognitive modules if this
// is an awareness-loop log; else auto-detect numeric columns (system tick log).
let FEATURES;
if (flags.features) FEATURES = String(flags.features).split(",").map((s) => s.trim()).filter(Boolean);
else if (FEATURES_9.every((k) => k in first)) FEATURES = FEATURES_9;
else FEATURES = Object.keys(first).filter((k) => typeof first[k] === "number" && !META.has(k) && k !== targetKey);

console.log(`\n● Causal-closure analysis — ${rows.length} logged in-basis states`);
console.log(`  log:     ${logPath}`);
console.log(`  basis:   [${FEATURES.join(", ")}]  (history window ${historyWindow})`);
console.log(`  target:  ${targetKey} (next-tick)\n`);

if (!FEATURES.length) {
  console.error("  ✗ no numeric feature columns found — pass --features=a,b,c");
  process.exit(1);
}

if (rows.length < 50) {
  console.log("  ⚠ Few samples — the determinism (surrogate) test needs a few hundred ticks to be meaningful.");
  console.log("    Keep the server running with CONCORD_CAUSAL_LOG + CONCORD_AWARENESS_LOOP=1 to accumulate more.\n");
}

const out = causalClosure(rows, { featureKeys: FEATURES, targetKey, historyWindow });
if (!out.ok) {
  console.error(`  ✗ ${out.reason}`, out);
  process.exit(1);
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log("── Step 2-3: ceiling in-basis predictor (capacity ladder, out-of-sample) ──");
console.log(`  aligned rows:        ${out.aligned}`);
console.log(`  validation:          ${out.predictor.validation}`);
for (const r of out.predictor.ladder) console.log(`    ${r.name.padEnd(14)} oos R²=${r.r2.toFixed(4)}${r.name === out.predictor.ceiling ? "  ← ceiling" : ""}`);
console.log(`  ceiling R²:          ${out.prediction.r2.toFixed(4)}  (${pct(out.prediction.fractionUnexplained)} unexplained)`);
console.log("── Step 3: residual structure (surrogate determinism test) ──");
console.log(`  residual AR self-R²: ${out.residual.structure.arSelfR2.toFixed(4)}`);
console.log(`  surrogate z:         ${out.residual.structure.z.toFixed(2)}  → ${out.residual.structure.deterministic ? "DETERMINISTIC (structured)" : "white noise"}`);
console.log("── Step 4: bridge probe (awareness coupling) ──");
console.log(`  corr(|residual|, awarenessIndex): ${out.awarenessCoupling.absResidualVsAwareness.toFixed(3)}`);

console.log("\n── Step 5 control: basis-completion curve ──");
for (const c of basisCompletionCurve(rows, { featureKeys: FEATURES, targetKey, historyWindow })) {
  console.log(`  +${String(c.axes).padStart(2)} axes  R²=${c.r2.toFixed(4)}  unexplained=${pct(c.fractionUnexplained)}`);
}

console.log(`\n★ VERDICT: ${out.verdict.toUpperCase()}`);
console.log(`  ${out.interpretation}`);
console.log(`\n  caveat: ${out.caveat}\n`);
