// server/lib/runtime/concordia-presence.js
//
// Concord Runtime — honest presence of Concordia's already-shipped clients
// and seeded worlds. Does not invent a world, does not boot Unity/Godot.
// @sync-fs-ok: local repository presence checks are bounded diagnostics, not hot request IO.

import fs from "node:fs";
import path from "node:path";
import { fileExists, listDirNames, resolveSisterHomes } from "./sister-homes.js";

const CLIENT_PATHS = {
  threeJs: "concord-frontend/lib/world-lens",
  godot: "world-lens-godot",
  unity: "apps/concordia-living-world/unity-client",
};

function clientPresence(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  const present = fileExists(abs);
  return { present, path: rel, absolute: present ? abs : undefined };
}

export function listSeededWorlds(repoRoot) {
  const worldRoot = path.join(repoRoot, "content", "world");
  const names = listDirNames(worldRoot).filter((n) => !n.startsWith("_") && n !== "[parent]");
  const worlds = [];
  for (const name of names) {
    const dir = path.join(worldRoot, name);
    const hasNpcs = fileExists(path.join(dir, "npcs.json"));
    const hasFactions = fileExists(path.join(dir, "factions.json"));
    const hasLore = fileExists(path.join(dir, "lore.json"));
    worlds.push({ id: name, hasNpcs, hasFactions, hasLore });
  }
  return worlds.sort((a, b) => a.id.localeCompare(b.id));
}

export function concordiaPresence(opts = {}) {
  const homes = opts.homes || resolveSisterHomes();
  const repoRoot = homes.repoRoot;
  let repoOk = false;
  try {
    repoOk = fs.existsSync(path.join(repoRoot, "server", "server.js"));
  } catch {
    repoOk = false;
  }
  const clients = {
    threeJs: clientPresence(repoRoot, CLIENT_PATHS.threeJs),
    godot: clientPresence(repoRoot, CLIENT_PATHS.godot),
    unity: clientPresence(repoRoot, CLIENT_PATHS.unity),
  };
  const worlds = repoOk ? listSeededWorlds(repoRoot) : [];
  const godotGateway = fileExists(path.join(repoRoot, "server", "lib", "godot-gateway.js"));
  return {
    ok: true,
    present: repoOk,
    repoRoot,
    clients,
    godotGateway,
    worlds,
    worldCount: worlds.length,
    note: "Concordia is already in-repo (Three.js + Godot + Unity). This capability reports presence; it does not spawn a world.",
  };
}
