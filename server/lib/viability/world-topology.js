// server/lib/viability/world-topology.js
//
// Wave 5 #11 — adjacent-feasibility topology: "worlds connect through a shared
// core Ω." Two worlds are adjacent — a player/creature can cross between them
// without leaving the viable set — when their HABITABLE BIOME sets overlap
// (something viable spans both, so the transition is survivable). This composes
// two already-shipped engines: #24 biome classification (the per-world viable
// core) + the N3 network core (connectedComponents → the reachable clusters).
// Pure; the formal layer under the Concord Link travel gates.

import { classifyBiome } from "./biome.js";
import { connectedComponents } from "../network/graph.js";

/** Adjacent iff the two worlds' habitable-biome sets intersect. */
export function worldsAdjacent(climateA, climateB) {
  const a = new Set(classifyBiome(climateA || {}).habitable);
  if (a.size === 0) return false;
  return classifyBiome(climateB || {}).habitable.some((b) => a.has(b));
}

/**
 * Build the undirected adjacency over a set of worlds.
 * @param {{[worldId:string]: object}} worldClimates  worldId → climate signals
 * @returns {{[worldId:string]: string[]}}
 */
export function buildWorldAdjacency(worldClimates = {}) {
  const ids = Object.keys(worldClimates);
  const adj = {};
  for (const id of ids) adj[id] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (worldsAdjacent(worldClimates[ids[i]], worldClimates[ids[j]])) {
        adj[ids[i]].push(ids[j]);
        adj[ids[j]].push(ids[i]);
      }
    }
  }
  return adj;
}

/** The reachable clusters (connected components) of the world-adjacency graph. */
export function reachableClusters(worldClimates = {}) {
  return connectedComponents(buildWorldAdjacency(worldClimates));
}

/**
 * The set of worlds reachable from `originId` (its connected component, minus
 * itself). The travel-gate query: "where can I go from here?" Returns [] for an
 * unknown origin or an isolated world.
 */
export function worldsReachableFrom(worldClimates = {}, originId) {
  if (!originId || !(originId in worldClimates)) return [];
  for (const comp of reachableClusters(worldClimates)) {
    if (comp.includes(originId)) return comp.filter((id) => id !== originId);
  }
  return [];
}
