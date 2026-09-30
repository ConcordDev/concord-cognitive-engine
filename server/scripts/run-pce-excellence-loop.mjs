#!/usr/bin/env node
// server/scripts/run-pce-excellence-loop.mjs
//
// Continuous PCE excellence loop for Cursor / CI:
//   regression gate → full ConcordBench → failure learning → promotion check
//
// Usage:
//   node server/scripts/run-pce-excellence-loop.mjs
//   node server/scripts/run-pce-excellence-loop.mjs --ci
//   node server/scripts/run-pce-excellence-loop.mjs --iterations 3
//   node server/scripts/run-pce-excellence-loop.mjs --suite concord_core

import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, "..");
const REPO_ROOT = join(SERVER_ROOT, "..");

function parseArgs(argv) {
  const args = { ci: false, iterations: 1, minPassRate: 0.75, suites: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--ci") args.ci = true;
    else if (argv[i] === "--iterations") { args.iterations = Number(argv[++i]) || 1; }
    else if (argv[i] === "--min-pass-rate") { args.minPassRate = Number(argv[++i]) || 0.75; }
    else if (argv[i] === "--suite") {
      args.suites = args.suites || [];
      args.suites.push(argv[++i]);
    }
  }
  return args;
}

async function migrateDb(db) {
  const migDir = join(SERVER_ROOT, "migrations");
  const nums = [423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434];
  for (const n of nums) {
    const files = (await import("node:fs")).readdirSync(migDir).filter((f) => f.startsWith(`${n}_`));
    if (!files[0]) continue;
    const mod = await import(join(migDir, files[0]));
    if (typeof mod.up === "function") mod.up(db);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const dataDir = join(SERVER_ROOT, "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.DB_PATH || join(dataDir, "pce-excellence-loop.db");
  const db = new Database(dbPath);
  await migrateDb(db);

  const { runRegressionGate } = await import("../lib/pce/pattern-regression.js");
  const { runPceExcellenceCycle, excellenceRunHistory } = await import("../lib/pce/pce-excellence-runner.js");

  const summary = { iterations: [], ok: true };

  for (let i = 0; i < args.iterations; i += 1) {
    const iter = { index: i + 1, startedAt: new Date().toISOString() };

    console.log(`\n=== PCE Excellence Loop iteration ${i + 1}/${args.iterations} ===`);

    console.log("→ Regression gate (baseline cases)...");
    const regression = await runRegressionGate(db, { concordRoot: REPO_ROOT });
    iter.regression = { ok: regression.ok, passed: regression.passed, failed: regression.failed };
    console.log(`  regression: ${regression.passed}/${regression.total || 0} passed`);

    console.log("→ Full excellence cycle (bench + learn + promote)...");
    const cycle = await runPceExcellenceCycle({
      db,
      concordRoot: REPO_ROOT,
      suiteIds: args.suites,
    });
    iter.cycle = {
      passRate: cycle.passRate,
      deltaPassRate: cycle.deltaPassRate,
      total: cycle.total,
      passed: cycle.passed,
      failed: cycle.failed,
      promoted: cycle.learning?.promoted?.length || 0,
      blocked: cycle.learning?.blocked?.length || 0,
      deterministicCoverage: cycle.deterministicCoverage,
    };
    console.log(`  bench: ${cycle.passed}/${cycle.total} (${(cycle.passRate * 100).toFixed(1)}%)`);
    if (cycle.deltaPassRate != null) {
      const sign = cycle.deltaPassRate >= 0 ? "+" : "";
      console.log(`  delta: ${sign}${(cycle.deltaPassRate * 100).toFixed(2)}pp vs prior run`);
    }
    console.log(`  learning: promoted=${iter.cycle.promoted} blocked=${iter.cycle.blocked}`);
    console.log(`  deterministic coverage: ${cycle.deterministicCoverage != null ? (cycle.deterministicCoverage * 100).toFixed(1) + "%" : "n/a"}`);

    const passOk = cycle.passRate >= args.minPassRate;
    const regOk = regression.ok !== false;
    iter.ok = passOk && regOk;
    if (!iter.ok) summary.ok = false;

    summary.iterations.push(iter);
  }

  const history = excellenceRunHistory(db, { limit: 5 });
  if (history.trend) {
    console.log(`\nTrend: ${(history.trend.latest * 100).toFixed(1)}% (prior ${(history.trend.prior * 100).toFixed(1)}%)`);
  }

  console.log(`\n=== Summary: ${summary.ok ? "PASS" : "FAIL"} ===`);
  if (args.ci && !summary.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
