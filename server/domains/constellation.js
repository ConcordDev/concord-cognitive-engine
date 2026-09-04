// server/domains/constellation.js
//
// Concord Runtime — constellation rollup. One designed surface for
// Dila / Predict / Zuko / Pentester / Trading / Concordia health.
// Health ≠ authorization.

import { registerCapability } from "../lib/runtime/capability-registry.js";
import { collectConstellationHealth, runConstellationObserveCycle } from "../lib/runtime/constellation.js";
import { resolveSisterHomes } from "../lib/runtime/sister-homes.js";
import { recentEvents } from "../lib/runtime/event-bus.js";

const CAPABILITY_DESCRIPTORS = [
  { capability: "constellation.status", owner: "constellation", risk: "read", description: "Aggregate sister-domain health on the Runtime bus.", dependencies: [] },
  { capability: "constellation.observe", owner: "constellation", risk: "read", description: "One observe cycle: publish market.observed, never execute.", dependencies: ["trading.observe", "zuko.observe"] },
];
for (const descriptor of CAPABILITY_DESCRIPTORS) registerCapability(descriptor);

function payloadOf(artifact, params) {
  const fromData = artifact && typeof artifact.data === "object" && artifact.data ? artifact.data : {};
  const fromParams = params && typeof params === "object" ? params : {};
  return { ...fromData, ...fromParams };
}

function homesFrom(p) {
  if (p.homes && typeof p.homes === "object") return resolveSisterHomes(p.homes);
  return resolveSisterHomes();
}

export default function registerConstellation(registerLensAction) {
  registerLensAction("constellation", "status", async (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    const health = await collectConstellationHealth({
      homes: homesFrom(p),
      probeLab: p.probeLab === true,
    });
    return { ...health, recent: recentEvents(12) };
  });

  registerLensAction("constellation", "observe", async (ctx, artifact, params) => {
    return runConstellationObserveCycle({ homes: homesFrom(payloadOf(artifact, params)) });
  });
}
