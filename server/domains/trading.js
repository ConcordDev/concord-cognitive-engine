// server/domains/trading.js
//
// Concord Runtime — trading as a monitored domain (master spec §7).
// Observe + advisory evaluate are real. trading.execute is permanently LOCKED.
// Runtime must not bypass Dila PPO / Zuko safety.

import { registerCapability } from "../lib/runtime/capability-registry.js";
import {
  evaluateObservedEdge,
  observeDilaTrading,
  tradingExecuteLocked,
} from "../lib/runtime/trading-observe.js";
import { observeZuko } from "../lib/runtime/zuko-observe.js";
import { resolveSisterHomes } from "../lib/runtime/sister-homes.js";

const CAPABILITY_DESCRIPTORS = [
  { capability: "trading.status", owner: "trading", risk: "read", description: "Presence + lock state of Dila AutoTrader and Zuko books.", dependencies: [] },
  { capability: "trading.observe", owner: "trading", risk: "read", description: "Read-only snapshot of Dila PPO/AutoTrader state files.", dependencies: [] },
  { capability: "trading.evaluate", owner: "trading", risk: "compute", description: "Advisory forecast-vs-market EV. Does not grant execution authority.", dependencies: [] },
  {
    capability: "trading.execute", owner: "trading", risk: "high",
    description: "LOCKED. No execution channel. Observing a market is not authorization.",
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

function homesFrom(p) {
  if (p.homes && typeof p.homes === "object") return resolveSisterHomes(p.homes);
  return resolveSisterHomes();
}

export default function registerTrading(registerLensAction) {
  registerLensAction("trading", "status", (ctx, artifact, params) => {
    const homes = homesFrom(payloadOf(artifact, params));
    const dila = observeDilaTrading({ homes });
    const zuko = observeZuko({ homes });
    return {
      ok: true,
      executeLocked: true,
      dila: { present: dila.present, reason: dila.reason, inPosition: dila.ppo?.inPosition ?? 0 },
      zuko: { present: zuko.present, reason: zuko.reason, halted: zuko.risk?.halted === true },
      note: "Dila Coinbase stays Dila. Zuko is Kalshi-only. Runtime monitors; it does not trade.",
    };
  });

  registerLensAction("trading", "observe", (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    return observeDilaTrading({ homes: homesFrom(p), publishEvents: p.publishEvents === true });
  });

  registerLensAction("trading", "evaluate", (ctx, artifact, params) => {
    return evaluateObservedEdge(payloadOf(artifact, params));
  });

  registerLensAction("trading", "execute", (ctx, artifact, params) => {
    return tradingExecuteLocked(payloadOf(artifact, params));
  });
}
