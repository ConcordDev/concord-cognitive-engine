#!/usr/bin/env node
// scripts/runtime-interactive-coverage.mjs — Phase 5b stateful / destructive harness
//
// Exercises class-D interactive mutations, class-E destructive actions (isolated),
// and heavy deterministic macros excluded from the bulk sweep.
// Brain-backed and external-dependency macros stay out of scope here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootEngine, enumerateMacros } from "./contracts/harness.mjs";
import { classifyMacro } from "../server/lib/runtime/macro-capability-classifier.js";
import { runLensActionContract, LENS_ACTION_STATUS } from "../server/lib/runtime/lens-behavioral-contract.js";
import { STATEFUL_COVERAGE_MACRO_IDS } from "./lib/runtime-coverage-fixtures.mjs";
import {
  seedInteractiveSession,
  buildInteractiveInput,
} from "./lib/runtime-interactive-fixtures.mjs";
import { INTERACTIVE_DILA_FIXTURES } from "./lib/runtime-coverage-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonOut = process.argv.includes("--json-out")
  ? process.argv[process.argv.indexOf("--json-out") + 1]
  : "audit/runtime-interactive-coverage.json";

async function main() {
  console.error("Interactive coverage: booting engine...");
  const boot = await bootEngine({ awaitGhostFleet: true });
  const { dispatchLensRun, makeInternalCtx, MACROS, lensActions, brainBacked } = boot;
  const { ctx, seeds } = await seedInteractiveSession(boot);
  const db = globalThis._concordDB;
  const timeoutMs = Number(process.env.CONCORD_INTERACTIVE_TIMEOUT_MS || 30000);

  async function timedDispatch(domain, action, input, dispatchCtx) {
    let timer;
    try {
      return await Promise.race([
        dispatchLensRun(domain, action, input, dispatchCtx),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("interactive_timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const enumerated = enumerateMacros(MACROS, lensActions, brainBacked);
  const targets = enumerated.filter((m) => STATEFUL_COVERAGE_MACRO_IDS.has(m.macroId));

  function resolveAction(domain, action) {
    const key = `${domain}.${action}`;
    if (lensActions?.has(key)) return "lens_actions";
    if (MACROS.get(domain)?.has(action)) return "macros";
    return null;
  }

  function isBrainBacked(domain, action) {
    return brainBacked?.has(`${domain}.${action}`) ?? false;
  }

  const rows = [];
  for (const m of targets) {
    const classification = classifyMacro(m.domain, m.name);
    const baseInput = buildInteractiveInput(m.macroId, seeds);
    const validInput = INTERACTIVE_DILA_FIXTURES[m.macroId]
      ? { ...baseInput, ...INTERACTIVE_DILA_FIXTURES[m.macroId] }
      : baseInput;
    const result = await runLensActionContract({
      lensId: "runtime-interactive",
      domain: m.domain,
      action: m.name,
      dispatch: timedDispatch,
      resolveAction,
      isBrainBacked,
      ctx,
      db,
      checkLogging: false,
      validInput,
      hasStructuredFixture: true,
    });
    rows.push({
      macroId: m.macroId,
      classification: classification.class,
      contractStatus: result.status,
      failureType: result.failureType,
      ok: result.ok,
      durationMs: result.durationMs,
      seedsUsed: Object.keys(seeds),
    });
    console.error(`  ${m.macroId}: ${result.status}${result.failureType ? ` (${result.failureType})` : ""}`);
  }

  const passed = rows.filter((r) => r.contractStatus === LENS_ACTION_STATUS.PASSED).length;
  const failed = rows.filter((r) => r.contractStatus === LENS_ACTION_STATUS.FAILED).length;
  const skipped = rows.length - passed - failed;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "5b-interactive",
    summary: { total: rows.length, passed, failed, skipped },
    seeds,
    actions: rows,
  };

  const outPath = path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`\nInteractive coverage: ${passed}/${rows.length} passed, ${failed} failed → ${outPath}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
