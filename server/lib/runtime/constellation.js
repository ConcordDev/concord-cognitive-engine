// server/lib/runtime/constellation.js
//
// Concord Runtime — the sister-system constellation.
// Dila, Predict, Zuko, Pentester, Trading, Concordia, DTU sit on one bus.
// This module aggregates honest health and runs the observe cycle.
// Health ≠ authorization: a HEALTHY pentester/trader can still be LOCKED.

import { listCapabilities, checkCapabilityHealth } from "./capability-registry.js";
import { observeDilaTrading } from "./trading-observe.js";
import { observeZuko } from "./zuko-observe.js";
import { labHealth } from "./pentester-control.js";
import { concordiaPresence } from "./concordia-presence.js";
import { publish } from "./event-bus.js";

const CONSTELLATION_OWNERS = [
  "dila",
  "predict",
  "zuko",
  "pentester",
  "trading",
  "concordia",
];

function ownerHealth(owner) {
  const caps = listCapabilities({ owner });
  if (caps.length === 0) return { owner, registered: 0, reachable: 0, status: "ABSENT", reason: "no_capabilities_registered" };
  let reachable = 0;
  const locked = [];
  for (const cap of caps) {
    const h = checkCapabilityHealth(cap.capability);
    if (h.reachable) reachable += 1;
    if (cap.risk === "high" && /execute|promote/i.test(cap.capability)) locked.push(cap.capability);
  }
  let status = "HEALTHY";
  if (reachable === 0) status = "DEGRADED";
  else if (reachable < caps.length) status = "DEGRADED";
  return { owner, registered: caps.length, reachable, status, lockedExecute: locked };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.homes]
 * @param {boolean} [opts.probeLab]
 */
export async function collectConstellationHealth(opts = {}) {
  const homes = opts.homes;
  const trading = observeDilaTrading({ homes });
  const zuko = observeZuko({ homes });
  const pentester = await labHealth({ homes, probe: opts.probeLab !== false });
  const concordia = concordiaPresence({ homes });

  const registry = {};
  for (const owner of CONSTELLATION_OWNERS) {
    registry[owner] = ownerHealth(owner);
  }

  const domains = {
    dila: {
      status: registry.dila.status,
      role: "agent",
      note: "Dila is an agent inside the Runtime, not the Runtime.",
      capabilities: registry.dila,
    },
    predict: {
      status: registry.predict.status,
      role: "empirical_reasoning",
      capabilities: registry.predict,
    },
    zuko: {
      status: zuko.present ? (zuko.risk?.halted ? "DEGRADED" : "HEALTHY") : "ABSENT",
      role: "agent",
      present: zuko.present,
      halted: zuko.risk?.halted === true,
      executeLocked: true,
      reason: zuko.present ? undefined : zuko.reason,
      capabilities: registry.zuko,
    },
    pentester: {
      status: pentester.present ? "HEALTHY" : "ABSENT",
      role: "controlled_experiment",
      present: pentester.present,
      labUp: pentester.upCount,
      executeLocked: true,
      reason: pentester.present ? undefined : pentester.reason,
      note: "Health ≠ authorization. Execute stays locked.",
      capabilities: registry.pentester,
    },
    trading: {
      status: trading.present ? "HEALTHY" : "ABSENT",
      role: "monitored_economy",
      present: trading.present,
      inPosition: trading.ppo?.inPosition ?? 0,
      executeLocked: true,
      reason: trading.present ? undefined : trading.reason,
      capabilities: registry.trading,
    },
    concordia: {
      status: concordia.present ? "HEALTHY" : "ABSENT",
      role: "world_simulation",
      present: concordia.present,
      worldCount: concordia.worldCount,
      clients: {
        threeJs: !!concordia.clients?.threeJs?.present,
        godot: !!concordia.clients?.godot?.present,
        unity: !!concordia.clients?.unity?.present,
      },
      capabilities: registry.concordia,
    },
  };

  const statuses = Object.values(domains).map((d) => d.status);
  let overall = "RUNNING";
  if (statuses.includes("FAILED")) overall = "FAILED";
  else if (statuses.some((s) => s === "DEGRADED")) overall = "DEGRADED";
  // ABSENT sister homes (CI box, fresh laptop) do not make the Runtime look dead.

  return {
    ok: true,
    overall,
    domains,
    chain: ["dila", "predict", "pentester", "dtu", "zuko", "trading", "concordia"],
    observedAt: Date.now(),
    snapshots: { trading, zuko, pentester, concordia },
  };
}

export async function runConstellationObserveCycle(opts = {}) {
  try {
    const homes = opts.homes;
    const trading = observeDilaTrading({ homes, publishEvents: true });
    const zuko = observeZuko({ homes, publishEvents: true });
    const health = await collectConstellationHealth({ homes, probeLab: false });
    publish("constellation.observed", {
      overall: health.overall,
      present: {
        trading: trading.present,
        zuko: zuko.present,
        pentester: health.domains.pentester.present,
        concordia: health.domains.concordia.present,
      },
    });
    return { ok: true, overall: health.overall, tradingPresent: trading.present, zukoPresent: zuko.present };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

export function installConstellationBridges() {
  // The bus itself is the connection. Subscribers must not auto-elevate:
  // a finding is not authorization, a trade observation is not a new order,
  // a prediction is not trading authority.
  return { ok: true, note: "Domains publish; they do not grant each other authority." };
}
