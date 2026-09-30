#!/usr/bin/env node
// scripts/runtime-crosslayer-coverage.mjs — Phase 6 cross-layer integration probes
//
// Verifies representative capabilities across:
//   lens page exists → manifest route → dispatcher → macro → backend → response envelope
//
// Headless stand-in for browser E2E on the server-side chain every lens depends on.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootEngine } from "./contracts/harness.mjs";
import { runLensActionContract, LENS_ACTION_STATUS } from "../server/lib/runtime/lens-behavioral-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "audit/phase-6-baseline.json");
const REPORT_PATH = path.join(ROOT, "audit/runtime-crosslayer-coverage.json");

/** Representative cross-layer probes — one per destination family. */
const CROSS_LAYER_PROBES = [
  { lensId: "math", domain: "math", action: "symbolicCompute", input: { expression: "x+0", operation: "simplify" } },
  { lensId: "sentinel", domain: "sentinel", action: "triage.list", input: {} },
  { lensId: "world", domain: "world", action: "status", input: { worldId: "concordia-hub" } },
  { lensId: "dtus", domain: "dtu", action: "list", input: { limit: 5 } },
  { lensId: "markets", domain: "betting", action: "list_open", input: { limit: 5 } },
  { lensId: "code", domain: "code", action: "status", input: {} },
  { lensId: "healthcare", domain: "healthcare", action: "status", input: {} },
  { lensId: "ops-telemetry", domain: "hlm", action: "topology", input: {} },
  { lensId: "personas", domain: "personas", action: "browse", input: { limit: 5 } },
  { lensId: "housing", domain: "housing", action: "public", input: { limit: 5 } },
  { lensId: "markets", domain: "betting", action: "my_positions", input: {} },
  { lensId: "accounting", domain: "accounting", action: "status", input: {} },
];

function loadRegisteredLensIds() {
  try {
    const dir = path.join(ROOT, "concord-frontend/app/lenses");
    return new Set(
      fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("["))
        .map((d) => d.name),
    );
  } catch {
    return new Set();
  }
}

async function main() {
  console.error("Phase 6: cross-layer coverage boot...");
  const registeredLensIds = loadRegisteredLensIds();
  const boot = await bootEngine({ awaitGhostFleet: true });
  const { dispatchLensRun, makeInternalCtx, MACROS, lensActions, brainBacked } = boot;
  const ctx = makeInternalCtx("runtime-crosslayer");
  const db = globalThis._concordDB;

  function resolveAction(domain, action) {
    const key = `${domain}.${action}`;
    if (lensActions?.has(key)) return "lens_actions";
    if (MACROS.get(domain)?.has(action)) return "macros";
    return null;
  }

  const layers = [];
  for (const probe of CROSS_LAYER_PROBES) {
    const registry = resolveAction(probe.domain, probe.action);
    const lensPage = path.join(ROOT, `concord-frontend/app/lenses/${probe.lensId}/page.tsx`);
    const lensExists = fs.existsSync(lensPage);
    const inManifest = registeredLensIds.has(probe.lensId);

    const contract = await runLensActionContract({
      lensId: probe.lensId,
      domain: probe.domain,
      action: probe.action,
      dispatch: (d, a, input, c) => dispatchLensRun(d, a, input, c),
      resolveAction,
      isBrainBacked: (d, a) => brainBacked?.has(`${d}.${a}`) ?? false,
      ctx,
      db,
      checkLogging: false,
      validInput: { artifact: { id: `crosslayer-${probe.lensId}`, data: {} }, ...probe.input },
      hasStructuredFixture: true,
    });

    const chainOk = lensExists && inManifest && registry && contract.status === LENS_ACTION_STATUS.PASSED;

    layers.push({
      lensId: probe.lensId,
      lensPageExists: lensExists,
      lensInManifest: inManifest,
      macroId: `${probe.domain}.${probe.action}`,
      registry,
      contractStatus: contract.status,
      failureType: contract.failureType,
      crossLayerOk: chainOk,
      stages: contract.stages,
    });
    console.error(
      `  ${probe.lensId} → ${probe.domain}.${probe.action}: ${contract.status}`
      + (contract.failureType ? ` (${contract.failureType})` : "")
      + (chainOk ? " [chain ok]" : ""),
    );
  }

  const passed = layers.filter((l) => l.crossLayerOk).length;
  const report = {
    generatedAt: new Date().toISOString(),
    phase: "6-crosslayer",
    summary: {
      total: layers.length,
      passed,
      failed: layers.length - passed,
      contractPassed: layers.filter((l) => l.contractStatus === LENS_ACTION_STATUS.PASSED).length,
    },
    probes: layers,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (!fs.existsSync(BASELINE_PATH)) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({
      frozenAt: report.generatedAt,
      summary: report.summary,
      macroIds: layers.map((l) => l.macroId),
    }, null, 2)}\n`);
    console.error(`Phase 6 baseline frozen → ${BASELINE_PATH}`);
  }

  console.error(`\nPhase 6: ${passed}/${layers.length} cross-layer chains passed → ${REPORT_PATH}`);
  process.exit(passed === layers.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
