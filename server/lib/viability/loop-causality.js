// server/lib/viability/loop-causality.js
//
// Engine N10 (time/causality) × the time-loop mechanic. Temporal logic over loop
// memories: you cannot remember an event from a loop you have not yet lived (no
// information from the future of its own origin), and a set of memories with
// explicit dependencies must form an acyclic, topologically-orderable causal
// graph — no grandfather paradox. Composes the shipped N10 core
// (hasCausalCycle / happensBefore). Pure.

import { hasCausalCycle, happensBefore } from "../temporal/causality.js";

const loopOf = (m) => Number(m?.first_loop_number ?? 1);

/**
 * Memories carriable into `currentLoop` — those that originated at or before it.
 * A memory from a later loop is a future-memory paradox and is dropped.
 */
export function carriableMemories(memories = [], currentLoop = Infinity) {
  const cur = Number(currentLoop);
  return memories.filter((m) => loopOf(m) <= cur);
}

/** True if this memory claims to predate a loop it couldn't have been formed in. */
export function isFutureMemory(memory, currentLoop) {
  return loopOf(memory) > Number(currentLoop);
}

/** Memories in causal (origin-loop) order — stable. */
export function orderMemoriesCausal(memories = []) {
  return [...memories].sort((a, b) => loopOf(a) - loopOf(b) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Validate explicit dependency edges between memories: no memory may depend on
 * one from a strictly-later loop, and the dependency graph must be acyclic.
 * @param {object[]} memories  rows with {id, first_loop_number}
 * @param {Object<string,string[]>} deps  memoryId → ids it causally depends on
 * @returns {{ consistent:boolean, paradoxes:object[], cyclic:boolean }}
 */
export function validateMemoryDeps(memories = [], deps = {}) {
  const loop = new Map(memories.map((m) => [m.id, loopOf(m)]));
  const edges = [];
  const paradoxes = [];
  for (const [id, ds] of Object.entries(deps)) {
    for (const d of ds || []) {
      edges.push([d, id]); // d happens-before id
      if ((loop.get(d) ?? 1) > (loop.get(id) ?? 1)) paradoxes.push({ memory: id, dependsOn: d, reason: "depends_on_future_loop" });
    }
  }
  const cyclic = hasCausalCycle(edges, memories.map((m) => m.id));
  return { consistent: paradoxes.length === 0 && !cyclic, paradoxes, cyclic };
}

/** Does memory `a` causally precede `b` given dependency edges? (N10 passthrough.) */
export function memoryPrecedes(aId, bId, deps = {}) {
  const edges = [];
  for (const [id, ds] of Object.entries(deps)) for (const d of ds || []) edges.push([d, id]);
  return happensBefore(aId, bId, edges);
}
