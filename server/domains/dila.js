// server/domains/dila.js
//
// Concord Runtime — Dila as an agent inside the Runtime, not the Runtime
// itself (docs/CONCORD_RUNTIME_MASTER_SPEC.md §4). Registers the live
// observation / capability-index surfaces that already exist in
// lib/runtime. Does not grant Dila root authority.

import { registerCapability } from "../lib/runtime/capability-registry.js";
import { publish as publishRuntimeEvent } from "../lib/runtime/event-bus.js";
import { computeDilaCapabilityIndex } from "../lib/runtime/dila-capability-index.js";
import { gatherObservationSnapshot } from "../lib/runtime/continuous-observation.js";
import { DILA_AGENT_ID } from "../lib/runtime/constants.js";
import { operatorOnlyRegistrar } from "../lib/runtime/operator-gate.js";
import {
  runConcordBench,
  runPceImprovementCycle,
  pceMetricsSummary,
  runCodingPipeline,
} from "../lib/pce/index.js";

const CAPABILITY_DESCRIPTORS = [
  { capability: "dila.status", owner: "dila", risk: "read", description: "Dila agent health + capability index + observation snapshot.", dependencies: ["db"] },
  { capability: "dila.observation", owner: "dila", risk: "read", description: "Continuous observation snapshot (incidents, missions, predictions).", dependencies: ["db"] },
  { capability: "dila.capabilities", owner: "dila", risk: "compute", description: "Measured Dila capability index (evidence per dimension).", dependencies: ["db"] },
  { capability: "agent.dila", owner: "dila", risk: "read", description: "Runtime agent handle for Dila — same payload as dila.status.", dependencies: ["dila.status"] },
  { capability: "dila.concord_bench", owner: "dila", risk: "compute", description: "Run the ConcordBench empirical excellence suite.", dependencies: ["db"] },
  { capability: "dila.pce_improvement_cycle", owner: "dila", risk: "compute", description: "Run one PCE improvement cycle (bench → gap analysis → pattern learning).", dependencies: ["db"] },
  { capability: "dila.pce_metrics", owner: "dila", risk: "read", description: "PCE metrics summary over a recent window.", dependencies: ["db"] },
  { capability: "dila.coding_pipeline", owner: "dila", risk: "write", description: "Run the closed procedural coding pipeline for an intent.", dependencies: ["db"] },
];
for (const descriptor of CAPABILITY_DESCRIPTORS) registerCapability(descriptor);

function payloadOf(artifact, params) {
  const fromData = artifact && typeof artifact.data === "object" && artifact.data ? artifact.data : {};
  const fromParams = params && typeof params === "object" ? params : {};
  return { ...fromData, ...fromParams };
}

function dilaStatus(ctx) {
  const db = ctx?.db || null;
  const caps = computeDilaCapabilityIndex(db);
  const obs = gatherObservationSnapshot(db);
  const body = {
    ok: true,
    agentId: DILA_AGENT_ID,
    role: "agent",
    note: "Dila is an agent inside the Concord Runtime. It does not own authorization.",
    capabilityIndex: caps,
    observation: obs.snapshot,
    observationOk: obs.ok !== false,
  };
  publishRuntimeEvent("agent.task.completed", { agent: "dila", kind: "status", ok: true });
  return body;
}

export default function registerDila(rawRegistrar) {
  // Operator-only: private sister-system state (lib/runtime/operator-gate.js).
  const registerLensAction = operatorOnlyRegistrar(rawRegistrar);
  registerLensAction("dila", "status", (ctx) => dilaStatus(ctx));
  registerLensAction("dila", "observation", (ctx) => gatherObservationSnapshot(ctx?.db));
  registerLensAction("dila", "capabilities", (ctx) => computeDilaCapabilityIndex(ctx?.db));
  registerLensAction("agent", "dila", (ctx, artifact, params) => {
    payloadOf(artifact, params);
    return dilaStatus(ctx);
  });

  // Empirical excellence surfaces — Dila runs its own PCE bench + improvement
  // loop (docs/CONCORD_RUNTIME_MASTER_SPEC.md §11). Thin delegations to the
  // existing lib/pce engine; each returns the engine's own {ok, ...} shape.
  registerLensAction("dila", "concord_bench", (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    return runConcordBench(ctx?.db, {
      caseIds: p.caseIds, categories: p.categories, suites: p.suites, concordRoot: p.concordRoot,
    });
  });
  registerLensAction("dila", "pce_improvement_cycle", (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    return runPceImprovementCycle({
      db: ctx?.db, concordRoot: p.concordRoot,
      runToyBench: p.runToyBench === true, fullSurface: p.fullSurface !== false,
    });
  });
  registerLensAction("dila", "pce_metrics", (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    return pceMetricsSummary(ctx?.db, { sinceDays: Number(p.sinceDays) || 30 });
  });
  registerLensAction("dila", "coding_pipeline", (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    if (!p.intent) return { ok: false, error: "intent_required" };
    return runCodingPipeline({
      db: ctx?.db, intent: p.intent, repoRoot: p.repoRoot,
      missionId: p.missionId, params: p.params || {}, manualSteps: p.manualSteps || null,
    });
  });
}
