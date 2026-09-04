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

const CAPABILITY_DESCRIPTORS = [
  { capability: "dila.status", owner: "dila", risk: "read", description: "Dila agent health + capability index + observation snapshot.", dependencies: ["db"] },
  { capability: "dila.observation", owner: "dila", risk: "read", description: "Continuous observation snapshot (incidents, missions, predictions).", dependencies: ["db"] },
  { capability: "dila.capabilities", owner: "dila", risk: "compute", description: "Measured Dila capability index (evidence per dimension).", dependencies: ["db"] },
  { capability: "agent.dila", owner: "dila", risk: "read", description: "Runtime agent handle for Dila — same payload as dila.status.", dependencies: ["dila.status"] },
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

export default function registerDila(registerLensAction) {
  registerLensAction("dila", "status", (ctx) => dilaStatus(ctx));
  registerLensAction("dila", "observation", (ctx) => gatherObservationSnapshot(ctx?.db));
  registerLensAction("dila", "capabilities", (ctx) => computeDilaCapabilityIndex(ctx?.db));
  registerLensAction("agent", "dila", (ctx, artifact, params) => {
    payloadOf(artifact, params);
    return dilaStatus(ctx);
  });
}
