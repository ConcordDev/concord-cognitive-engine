// server/domains/concordia.js
//
// Concord Runtime — Concordia as a world/simulation capability (master spec
// §2 names: concordia.world / concordia.simulation / concordia.asset).
// Reports the clients and seeded worlds that already live in this repo.
// Does not fabricate a running scene.

import { registerCapability } from "../lib/runtime/capability-registry.js";
import { concordiaPresence } from "../lib/runtime/concordia-presence.js";
import { resolveSisterHomes } from "../lib/runtime/sister-homes.js";

const CAPABILITY_DESCRIPTORS = [
  { capability: "concordia.status", owner: "concordia", risk: "read", description: "Presence of Three.js / Godot / Unity clients + seeded worlds.", dependencies: [] },
  { capability: "concordia.world", owner: "concordia", risk: "read", description: "List seeded Concordia worlds from content/world.", dependencies: [] },
  { capability: "concordia.simulation", owner: "concordia", risk: "read", description: "Honest handle for the in-repo simulation clients.", dependencies: ["concordia.status"] },
  { capability: "concordia.asset", owner: "concordia", risk: "read", description: "Which Concordia clients (Three.js / Godot / Unity) are in tree.", dependencies: [] },
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

export default function registerConcordia(registerLensAction) {
  registerLensAction("concordia", "status", (ctx, artifact, params) => {
    return concordiaPresence({ homes: homesFrom(payloadOf(artifact, params)) });
  });

  registerLensAction("concordia", "world", (ctx, artifact, params) => {
    const snap = concordiaPresence({ homes: homesFrom(payloadOf(artifact, params)) });
    return { ok: true, worlds: snap.worlds, worldCount: snap.worldCount, present: snap.present };
  });

  registerLensAction("concordia", "simulation", (ctx, artifact, params) => {
    const snap = concordiaPresence({ homes: homesFrom(payloadOf(artifact, params)) });
    return {
      ok: true,
      present: snap.present,
      clients: snap.clients,
      godotGateway: snap.godotGateway,
      note: snap.note,
    };
  });

  registerLensAction("concordia", "asset", (ctx, artifact, params) => {
    const snap = concordiaPresence({ homes: homesFrom(payloadOf(artifact, params)) });
    return { ok: true, clients: snap.clients, godotGateway: snap.godotGateway };
  });
}
