// server/domains/polymarket.js
//
// Concord Runtime — the Polymarket live-favorites bot (~/.polymarket) as an
// observed sister system, same contract as Zuko: status/observe are real and
// read-only, polymarket.execute is permanently LOCKED. Operator-only.

import { registerCapability } from "../lib/runtime/capability-registry.js";
import { observePolymarket, polymarketExecuteLocked } from "../lib/runtime/polymarket-observe.js";
import { resolveSisterHomes } from "../lib/runtime/sister-homes.js";
import { operatorOnlyRegistrar } from "../lib/runtime/operator-gate.js";

const CAPABILITY_DESCRIPTORS = [
  { capability: "polymarket.status", owner: "polymarket", risk: "read", description: "Polymarket bot presence, activity and position counts.", dependencies: [] },
  { capability: "polymarket.observe", owner: "polymarket", risk: "read", description: "Read-only Polymarket bot state (counts/timestamps; credentials never read).", dependencies: [] },
  {
    capability: "polymarket.execute", owner: "polymarket", risk: "high",
    description: "LOCKED. Concord observes the Polymarket bot; it does not trade.",
    authorization: "none — permanently locked",
    dependencies: [],
  },
];
for (const descriptor of CAPABILITY_DESCRIPTORS) registerCapability(descriptor);

function payloadOf(artifact, params) {
  const fromData = artifact && typeof artifact.data === "object" && artifact.data ? artifact.data : {};
  const fromParams = params && typeof params === "object" ? params : {};
  return { ...fromData, ...fromParams };
}

const homesFrom = (p) => resolveSisterHomes(p.homes && typeof p.homes === "object" ? p.homes : {});

export default function registerPolymarket(rawRegistrar) {
  // Operator-only: private sister-system state (lib/runtime/operator-gate.js).
  const registerLensAction = operatorOnlyRegistrar(rawRegistrar);
  registerLensAction("polymarket", "status", (ctx, artifact, params) => {
    const snap = observePolymarket({ homes: homesFrom(payloadOf(artifact, params)) });
    return { ...snap, agentId: "polymarket", executeLocked: true };
  });
  registerLensAction("polymarket", "observe", (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    return observePolymarket({ homes: homesFrom(p), publishEvents: p.publishEvents === true });
  });
  registerLensAction("polymarket", "execute", (ctx, artifact, params) => polymarketExecuteLocked(payloadOf(artifact, params)));
}
