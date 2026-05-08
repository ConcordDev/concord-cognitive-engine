// server/scripts/cartographer/runtime-bridge.js
//
// Runs INSIDE a child node process spawned by runtime-introspect.js. This
// file imports server.js (which registers macros, heartbeats, lenses, etc.),
// waits briefly for any deferred registrations, then dumps the registries
// to the path in CONCORD_CARTOGRAPHER_DUMP_PATH and exits.
//
// Boot constraints (set by parent):
//   CONCORD_NO_LISTEN=true             — don't bind a TCP port
//   CONCORD_DB_PATH=/tmp/...sqlite     — isolated tmp DB
//   CONCORD_DISABLE_BRAINS=true        — skip Ollama init
//   CONCORD_DISABLE_GHOST_FLEET=true   — skip 52s ghost-fleet stagger
//   CONCORD_DISABLE_HEARTBEAT=true     — skip governor tick
//   CONCORD_CARTOGRAPHER=true          — informational
//
// On failure, exits with non-zero — parent treats `runtime.booted = false`.

import { writeFile } from "node:fs/promises";

const DUMP_PATH = process.env.CONCORD_CARTOGRAPHER_DUMP_PATH;
const DRAIN_MS = Number(process.env.CONCORD_CARTOGRAPHER_DRAIN_MS || 1500);

if (!DUMP_PATH) {
  console.error("[runtime-bridge] CONCORD_CARTOGRAPHER_DUMP_PATH not set");
  process.exit(2);
}

async function main() {
  // Side-effect import — populates globalThis.__CARTOGRAPHER__ + heartbeat-registry.
  await import("../../server.js");

  // Brief drain so any setTimeout-deferred registrations land.
  await new Promise(resolve => { setTimeout(resolve, DRAIN_MS); });

  const carto = globalThis.__CARTOGRAPHER__ || {};

  // Macros: flatten MACROS Map<domain, Map<name, {fn, spec}>>
  const macros = [];
  if (carto.MACROS && typeof carto.MACROS.entries === "function") {
    for (const [domain, byName] of carto.MACROS.entries()) {
      if (!byName || typeof byName.values !== "function") continue;
      for (const entry of byName.values()) {
        macros.push({
          domain,
          name: entry?.spec?.name ?? "(unknown)",
          spec: { ...(entry?.spec || {}) },
        });
      }
    }
  }

  // Heartbeats: import the registry export
  let heartbeats = [];
  try {
    const hb = await import("../../emergent/heartbeat-registry.js");
    if (typeof hb.listHeartbeatModules === "function") {
      heartbeats = hb.listHeartbeatModules();
    }
  } catch (err) {
    console.error("[runtime-bridge] heartbeat-registry import failed:", err?.message);
  }

  // Lens manifests
  let lensManifests = [];
  try {
    const lm = await import("../../lib/lens-manifest.js");
    if (typeof lm.getAllManifests === "function") {
      const all = lm.getAllManifests();
      lensManifests = Array.isArray(all) ? all : Object.values(all || {});
    }
  } catch (err) {
    console.error("[runtime-bridge] lens-manifest import failed:", err?.message);
  }

  // Module registry — already auto-generated, just import + flatten
  let moduleRegistry = [];
  try {
    const mr = await import("../../emergent/module-registry.js");
    const reg = mr.MODULE_REGISTRY ?? mr.default ?? {};
    moduleRegistry = Object.entries(reg).map(([id, meta]) => ({
      id,
      file: meta?.file ?? null,
      hardDeps: meta?.hardDeps ?? [],
      softDeps: meta?.softDeps ?? [],
      importedBy: meta?.importedBy ?? 0,
      subsystem: meta?.subsystem ?? null,
      exports: meta?.exports ?? [],
    }));
  } catch (err) {
    console.error("[runtime-bridge] module-registry import failed:", err?.message);
  }

  // Ghost fleet status (will be empty under DISABLE_GHOST_FLEET — that's OK)
  let ghostFleetStatus = [];
  if (carto.GHOST_FLEET_STATUS?.modules) {
    ghostFleetStatus = Object.entries(carto.GHOST_FLEET_STATUS.modules).map(([name, m]) => ({
      name,
      loaded: !!m?.loaded,
      loadedAt: m?.loadedAt ?? null,
      error: m?.error ?? null,
    }));
  }

  const dump = { macros, heartbeats, lensManifests, moduleRegistry, ghostFleetStatus };

  await writeFile(DUMP_PATH, JSON.stringify(dump, null, 2), "utf-8");

  // Force exit — server.js leaves intervals + listeners that won't unref.
  process.exit(0);
}

main().catch(err => {
  console.error("[runtime-bridge] fatal:", err?.stack || err?.message);
  process.exit(3);
});
