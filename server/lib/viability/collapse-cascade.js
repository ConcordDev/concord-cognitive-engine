// server/lib/viability/collapse-cascade.js
//
// Wave 5 — corpus #22 (collapse-cascade: debt / brittleness / over-extraction).
// A faction that is over-extended (low viability) and loses the support it
// depended on doesn't fail in isolation — its fall drags its allies and
// tributaries toward collapse too (a domino along the dependency graph). This
// composes two already-shipped cores, no new math:
//   - the viability spine (#8): factionViability(momentum) = how close to the
//     collapse boundary → a faction's RESILIENCE (healthy resists, brittle falls).
//   - the N3 network core: giantComponentSize() reports the systemic-risk
//     cluster (the largest bloc of mutually-allied factions that can chain).
// The cascade itself is a per-node-threshold fixpoint (the linear-threshold
// primitive with a per-faction threshold = its resilience, which the
// homogeneous lib/network primitive can't express). Pure + deterministic.
// Behind CONCORD_COLLAPSE_CASCADE at the caller.

import { factionViability, FACTION_COLLAPSE_MOMENTUM } from "./adapters/scalar-viability.js";
import { giantComponentSize } from "../network/graph.js";

export function collapseCascadeEnabled() {
  return process.env.CONCORD_COLLAPSE_CASCADE !== "0";
}

/** Brittleness 0..1 (1 = at the collapse boundary). The complement of viability. */
export function factionFragility(momentum) {
  return 1 - factionViability(momentum);
}

/**
 * Undirected dependency adjacency from relation rows. Only alliance + tribute
 * edges transmit collapse (you lean on your allies / patrons); war + tension +
 * neutral edges do NOT — an enemy's fall doesn't drag you down. Returns
 * { node: [neighbor, …] }.
 */
export function buildDependencyGraph(relations = []) {
  const adj = {};
  const add = (a, b) => {
    if (!a || !b) return;
    (adj[a] ||= new Set()).add(b);
    (adj[b] ||= new Set()).add(a);
  };
  for (const r of relations) {
    if (r.kind === "alliance" || r.kind === "tribute") add(r.faction_a, r.faction_b);
  }
  const out = {};
  for (const k of Object.keys(adj)) out[k] = [...adj[k]];
  return out;
}

/**
 * Run the collapse cascade.
 *   seeds        = factions already collapsing (momentum ≤ FACTION_COLLAPSE_MOMENTUM)
 *   propagation  = a dependent collapses when the FRACTION of its dependency-
 *                  neighbors that have collapsed ≥ its RESILIENCE
 *                  (= factionViability, floored). Diversified healthy factions
 *                  resist; over-extended single-patron ones fall.
 *
 * @param {{faction_id:string, momentum:number}[]} factions
 * @param {{faction_a:string, faction_b:string, kind:string}[]} relations
 * @returns {{ seeds:string[], collapsed:string[], cascaded:string[], rounds:number, systemicRiskClusterSize:number }}
 */
export function cascadeCollapse(factions = [], relations = [], { resilienceFloor = 0.15 } = {}) {
  const vById = new Map(factions.map((f) => [f.faction_id, Number(f.momentum ?? 0)]));
  const adj = buildDependencyGraph(relations);
  const seeds = factions
    .filter((f) => Number(f.momentum ?? 0) <= FACTION_COLLAPSE_MOMENTUM)
    .map((f) => f.faction_id);
  const collapsed = new Set(seeds);

  let changed = true;
  let rounds = 0;
  while (changed) {
    changed = false;
    rounds++;
    for (const f of factions) {
      const id = f.faction_id;
      if (collapsed.has(id)) continue;
      const nb = adj[id] || [];
      if (nb.length === 0) continue;
      const frac = nb.filter((n) => collapsed.has(n)).length / nb.length;
      const resilience = Math.max(resilienceFloor, factionViability(vById.get(id) ?? 0));
      if (frac >= resilience) { collapsed.add(id); changed = true; }
    }
    if (rounds > factions.length + 2) break; // belt-and-suspenders bound
  }

  const seedSet = new Set(seeds);
  return {
    seeds,
    collapsed: [...collapsed],
    cascaded: [...collapsed].filter((id) => !seedSet.has(id)),
    rounds,
    systemicRiskClusterSize: giantComponentSize(adj),
  };
}
