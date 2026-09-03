// server/domains/zuko.js
//
// Concord Runtime — Zuko as an agent inside the Runtime (master spec §4).
// Observe + evaluate (risk snapshot) are real. zuko.execute is LOCKED.
// Does not place Kalshi orders. Does not touch Dila's Coinbase book.

import { registerCapability } from "../lib/runtime/capability-registry.js";
import { observeZuko, zukoExecuteLocked } from "../lib/runtime/zuko-observe.js";
import { resolveSisterHomes } from "../lib/runtime/sister-homes.js";

const CAPABILITY_DESCRIPTORS = [
  { capability: "zuko.status", owner: "zuko", risk: "read", description: "Zuko home presence + risk/halt snapshot.", dependencies: [] },
  { capability: "zuko.observe", owner: "zuko", risk: "read", description: "Read-only Kalshi lane / risk / public config (auth stripped).", dependencies: [] },
  { capability: "zuko.evaluate", owner: "zuko", risk: "compute", description: "Surface the live risk gate. Does not place an order.", dependencies: [] },
  {
    capability: "zuko.execute", owner: "zuko", risk: "high",
    description: "LOCKED. Concord observes Zuko; it does not become a second trader.",
    authorization: "none — permanently locked",
    dependencies: [],
  },
  { capability: "agent.zuko", owner: "zuko", risk: "read", description: "Runtime agent handle for Zuko — same payload as zuko.status.", dependencies: ["zuko.status"] },
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

function statusOf(homes) {
  const snap = observeZuko({ homes });
  return {
    ok: true,
    agentId: "zuko",
    role: "agent",
    present: snap.present,
    reason: snap.reason,
    halted: snap.risk?.halted === true,
    executeLocked: true,
    note: "Zuko is an agent inside the Concord Runtime. Dila Coinbase stays Dila.",
    snapshot: snap,
  };
}

export default function registerZuko(registerLensAction) {
  registerLensAction("zuko", "status", (ctx, artifact, params) => statusOf(homesFrom(payloadOf(artifact, params))));
  registerLensAction("zuko", "observe", (ctx, artifact, params) => {
    const p = payloadOf(artifact, params);
    return observeZuko({ homes: homesFrom(p), publishEvents: p.publishEvents === true });
  });
  registerLensAction("zuko", "evaluate", (ctx, artifact, params) => {
    const snap = observeZuko({ homes: homesFrom(payloadOf(artifact, params)) });
    if (!snap.present) return { ok: true, present: false, reason: snap.reason, grantsAuthority: false };
    return {
      ok: true,
      present: true,
      grantsAuthority: false,
      halted: snap.risk?.halted === true,
      haltReason: snap.risk?.haltReason || "",
      caps: snap.risk?.caps || null,
      config: snap.config,
      note: "Risk snapshot only. A passing gate is not authorization to zuko.execute.",
    };
  });
  registerLensAction("zuko", "execute", (ctx, artifact, params) => zukoExecuteLocked(payloadOf(artifact, params)));
  registerLensAction("agent", "zuko", (ctx, artifact, params) => statusOf(homesFrom(payloadOf(artifact, params))));
}
