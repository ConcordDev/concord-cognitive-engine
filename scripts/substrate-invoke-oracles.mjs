#!/usr/bin/env node
// scripts/substrate-invoke-oracles.mjs
//
// Invoke deterministic substrate oracles (CAS, FEA, engineering, physics, chem,
// accounting) through the REAL dual-registry dispatch and log each call to
// macro_call_log. Answers "did it run and return a computed result?" — not
// "how many macros exist in reflection."
//
// Usage:
//   node scripts/substrate-invoke-oracles.mjs
//   node scripts/substrate-invoke-oracles.mjs --covered   # also smoke all headless-safe macros
//   node scripts/substrate-invoke-oracles.mjs --json-out audit/substrate-oracles.json

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bootEngine, enumerateMacros, buildDefaultInput } from "./contracts/harness.mjs";
import { runSubstrateOracles } from "../server/lib/runtime/substrate-oracles.js";
import { recordMacroCall } from "../server/lib/macro-billing.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const wantCovered = args.includes("--covered");
const jsonOut = args.includes("--json-out")
  ? args[args.indexOf("--json-out") + 1] || "audit/substrate-oracles.json"
  : null;

async function main() {
  const boot = await bootEngine();
  const { dispatchLensRun, makeInternalCtx, MACROS, lensActions, brainBacked } = boot;
  const ctx = makeInternalCtx("substrate-invoke");
  const db = globalThis._concordDB;

  const oracleReport = await runSubstrateOracles({
    dispatch: dispatchLensRun,
    ctx,
    db,
    logCalls: !!db,
    userId: "substrate-oracle",
  });

  let coveredReport = null;
  if (wantCovered) {
    coveredReport = await invokeCoveredMacros({
      dispatch: dispatchLensRun,
      ctx,
      db,
      MACROS,
      lensActions,
      brainBacked,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    oracles: oracleReport,
    covered: coveredReport,
  };

  if (jsonOut) {
    const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`Wrote ${outPath}`);
  }

  console.log(`Oracles: ${oracleReport.passed}/${oracleReport.total} verified`);
  if (oracleReport.failures?.length) {
    console.error("Failures:", oracleReport.failures);
    process.exitCode = 1;
  }

  if (coveredReport) {
    console.log(
      `Covered macros: ${coveredReport.invoked} invoked, ${coveredReport.skipped} skipped, ` +
      `${coveredReport.errors} errors (${coveredReport.uniquePairs} unique pairs)`
    );
    if (coveredReport.errors > 0) process.exitCode = 1;
  }

  // Full server boot leaves heartbeats/workers alive — exit explicitly.
  setImmediate(() => process.exit(process.exitCode ?? 0));
}

async function invokeCoveredMacros({ dispatch, ctx, db, MACROS, lensActions, brainBacked }) {
  const macros = enumerateMacros(MACROS, lensActions, brainBacked);
  const toRun = macros.filter((m) => !m.skip);
  let invoked = 0;
  let errors = 0;
  const seen = new Set();

  for (const m of toRun) {
    const key = m.macroId;
    if (seen.has(key)) continue;
    seen.add(key);
    const t0 = Date.now();
    const input = buildDefaultInput(m.domain, m.name);
    let raw;
    try {
      raw = await dispatch(m.domain, m.name, input, ctx);
    } catch (e) {
      raw = { ok: false, error: String(e?.message || e) };
    }
    const ok = raw?.ok !== false;
    if (!ok) errors++;
    else invoked++;
    if (db) {
      recordMacroCall(db, {
        userId: "substrate-covered",
        domain: m.domain,
        name: m.name,
        durationMs: Date.now() - t0,
        status: ok ? "ok" : "error",
        costUnits: 0,
        refId: `covered:${key}:${t0}`,
      });
    }
  }

  return {
    uniquePairs: seen.size,
    invoked,
    skipped: macros.length - toRun.length,
    errors,
    totalEnumerated: macros.length,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
