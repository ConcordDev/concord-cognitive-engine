// Concordia Wave6 — World/Asset Composition MVP
// Composes a scene graph from evo-asset registry rows + procedural humanoids.
// Not a remix marketplace — a deterministic composition graph for Hub/Realm fill.

import { assembleHumanoid } from "./concordia-humanoid-gait.js";

/**
 * Compose a world scene from asset descriptors + optional humanoid NPCs.
 * @param {object} opts
 * @param {Array} [opts.assets] - [{id,kind,source,sourceId,transform}]
 * @param {number} [opts.humanoids=1]
 * @param {string} [opts.worldId='concordia-hub']
 */
export function composeWorldScene(opts = {}) {
  const worldId = opts.worldId || "concordia-hub";
  const assets = Array.isArray(opts.assets) ? opts.assets : [
    { id: "plaza_floor", kind: "terrain", source: "seed", sourceId: "hub_plaza" },
    { id: "spawn_pad", kind: "prop", source: "seed", sourceId: "spawn" },
    { id: "market_stall", kind: "building", source: "seed", sourceId: "stall_a" },
  ];
  const nodes = [];
  for (const a of assets) {
    nodes.push({
      id: a.id,
      kind: a.kind || "prop",
      source: a.source || "seed",
      sourceId: a.sourceId || a.id,
      transform: a.transform || { x: nodes.length * 2, y: 0, z: 0, rotY: 0 },
      role: "asset",
    });
  }
  const humanoidCount = Math.max(0, Number(opts.humanoids ?? 1));
  const humanoids = [];
  for (let i = 0; i < humanoidCount; i++) {
    const h = assembleHumanoid({
      description: `hub npc humanoid ${i}`,
      worldId,
      massKg: 70 + i * 3,
      heightM: 1.7 + i * 0.02,
    });
    humanoids.push(h);
    nodes.push({
      id: h.id || `humanoid_${i}`,
      kind: "humanoid",
      source: "procedural",
      sourceId: h.id,
      transform: { x: i * 1.5, y: 0, z: 3, rotY: i * 0.4 },
      role: "actor",
      gait: h.gait,
      parts: h.parts?.length || 0,
    });
  }
  const edges = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ from: nodes[0].id, to: nodes[i].id, rel: "contains" });
  }
  // Cross-system collision hooks (emergence flywheel MVP): terrain↔prop↔actor
  const kinds = new Set(nodes.map((n) => n.kind));
  const collisions = [];
  if (kinds.has("terrain") && kinds.has("prop")) collisions.push("terrain×prop");
  if (kinds.has("prop") && kinds.has("humanoid")) collisions.push("prop×actor");
  if (kinds.has("terrain") && kinds.has("humanoid")) collisions.push("terrain×actor");
  if (kinds.has("building") && kinds.has("humanoid")) collisions.push("building×actor");

  return {
    ok: nodes.length >= 3 && edges.length >= 1,
    worldId,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    humanoids: humanoids.length,
    kinds: [...kinds],
    collisions,
    systems_collide: collisions.length >= 3,
    graph: { nodes, edges },
  };
}

/**
 * Compose from evo-asset registry DB rows when available.
 */
export function composeFromRegistry(db, opts = {}) {
  let assets = opts.assets;
  if (db && !assets) {
    try {
      const rows = db.prepare(`
        SELECT id, kind, source, source_id as sourceId
        FROM evo_assets ORDER BY evolution_score DESC LIMIT ?
      `).all(opts.limit || 5);
      if (rows?.length) {
        assets = rows.map((r, i) => ({
          id: r.id,
          kind: r.kind || "prop",
          source: r.source || "evo",
          sourceId: r.sourceId || r.id,
          transform: { x: i * 2, y: 0, z: 0, rotY: 0 },
        }));
      }
    } catch {
      // table may be absent in ephemeral dbs — fall through to seeds
    }
  }
  return composeWorldScene({ ...opts, assets });
}
