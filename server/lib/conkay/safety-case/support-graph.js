// server/lib/conkay/safety-case/support-graph.js
//
// Safety functions → trains → components → support items, and the
// independence / common-cause screen over them.
//
// System shape (plain data, also what the solvers rebuild from the design
// graph):
//   functions:  { [id]: { name, trains: [trainId], successCriterion: { k } } }   k trains of n must work
//   trains:     { [id]: { function, components: [componentId] } }
//   components: { [id]: { train, requires: [supportId], anyOf: [supportId], dcBus?: supportId } }
//   supports:   { [id]: { supportKind, requires: [supportId], anyOf: [supportId] } }
// Semantics (coherent, static, no time dependence): an item (component or
// support) is lost if its own hardware fails, OR any item in `requires` is
// lost, OR every item in `anyOf` is lost. `dcBus` is a required support
// held as a single design parameter so a repair can move it. A train is lost
// if any of its components is lost; a function is lost when more than n−k
// of its n trains are lost.

import { minimalCutSets, FT_VERSION } from "./fault-tree.js";

export const SUPPORT_KINDS = Object.freeze(["offsite-power", "emergency-generator", "ac-division", "battery", "battery-charger", "dc-bus", "ic-channel", "room-fire-area", "cooling", "hvac", "structure", "ultimate-heat-sink"]);
export const SCREEN_VERSION = "1.0.0";

const reqs = (it) => [...(it.requires || []), ...(it.dcBus ? [it.dcBus] : [])];

export function validateSystem(sys) {
  const errors = [];
  const items = { ...sys.supports, ...sys.components };
  for (const [id, s] of Object.entries(sys.supports || {})) if (!SUPPORT_KINDS.includes(s.supportKind)) errors.push(`support ${id}: kind "${s.supportKind}" not one of ${SUPPORT_KINDS.join(", ")}`);
  for (const [id, it] of Object.entries(items)) for (const r of [...reqs(it), ...(it.anyOf || [])]) if (!sys.supports[r]) errors.push(`${id} depends on unknown support ${r}`);
  for (const [id, f] of Object.entries(sys.functions || {})) {
    const k = f.successCriterion?.k;
    if (!Number.isInteger(k) || k < 1 || k > f.trains.length) errors.push(`function ${id}: successCriterion.k must be 1..${f.trains.length}`);
    for (const t of f.trains) if (!sys.trains[t]) errors.push(`function ${id}: unknown train ${t}`);
  }
  for (const [id, t] of Object.entries(sys.trains || {})) for (const c of t.components) if (!sys.components[c]) errors.push(`train ${id}: unknown component ${c}`);
  // Dependency cycles make "lost" ill-defined for a static screen.
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === 2 || !items[id]) return;
    if (state.get(id) === 1) { errors.push(`dependency cycle: ${[...stack, id].join(" → ")}`); return; }
    state.set(id, 1);
    for (const r of [...reqs(items[id]), ...(items[id].anyOf || [])]) visit(r, [...stack, id]);
    state.set(id, 2);
  };
  for (const id of Object.keys(items)) visit(id, []);
  return errors;
}

/** The fault tree of every function's loss. Basic events = every component and support id. */
export function buildFaultTree(sys) {
  const gates = {};
  const itemGate = (id) => `G:${id}`;
  const items = { ...sys.supports, ...sys.components };
  for (const [id, it] of Object.entries(items)) {
    const inputs = [id, ...reqs(it).map(itemGate)];
    const any = it.anyOf || [];
    if (any.length === 1) inputs.push(itemGate(any[0]));
    else if (any.length > 1) { gates[`A:${id}`] = { type: "and", inputs: any.map(itemGate) }; inputs.push(`A:${id}`); }
    gates[itemGate(id)] = { type: "or", inputs };
  }
  for (const [id, t] of Object.entries(sys.trains)) gates[`T:${id}`] = { type: "or", inputs: t.components.map(itemGate) };
  const tops = {};
  for (const [id, f] of Object.entries(sys.functions)) {
    const n = f.trains.length;
    const lose = n - f.successCriterion.k + 1;
    gates[`F:${id}`] = { type: "atleast", k: lose, inputs: f.trains.map((t) => `T:${t}`) };
    tops[id] = `F:${id}`;
  }
  return { gates, tops, basics: Object.keys(items).sort() };
}

/** Propagate the loss of a set of items. Returns { lost:Set(items), trains:Set, functions:Set, explain(id) }. */
export function propagate(sys, failed) {
  const items = { ...sys.supports, ...sys.components };
  const memo = new Map();
  const lost = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, false); // static graph is acyclic (validated by the fault-tree builder)
    const it = items[id];
    const v = failed.has(id) || reqs(it).some(lost) || ((it.anyOf || []).length > 0 && it.anyOf.every(lost));
    memo.set(id, v);
    return v;
  };
  const explain = (id) => {
    if (failed.has(id)) return [{ id, why: "fails" }];
    const it = items[id];
    for (const r of reqs(it)) if (lost(r)) return [...explain(r), { id, why: `requires ${r}` }];
    if ((it.anyOf || []).length && it.anyOf.every(lost)) return [...explain(it.anyOf[0]), { id, why: `all of ${it.anyOf.join(", ")} lost` }];
    return [];
  };
  const lostTrains = new Set(Object.entries(sys.trains).filter(([, t]) => t.components.some(lost)).map(([id]) => id));
  const lostFunctions = new Set(Object.entries(sys.functions).filter(([, f]) => f.trains.filter((t) => lostTrains.has(t)).length > f.trains.length - f.successCriterion.k).map(([id]) => id));
  const trainPath = (tid) => {
    const c = sys.trains[tid].components.find(lost);
    return [...explain(c), { id: tid, why: `train needs ${c}` }];
  };
  return { lost: new Set(Object.keys(items).filter(lost)), trains: lostTrains, functions: lostFunctions, trainPath };
}

const fmtPath = (p) => p.map((s) => s.id).join(" → ");

/**
 * Single-item screen: for every support item, the trains and functions its
 * loss alone defeats. Findings:
 *   common-cause-trains: one support item defeats ≥2 trains of the same function
 *   cross-function:      one support item defeats ≥2 safety functions
 */
export function independenceScreen(sys) {
  const findings = [];
  for (const sid of Object.keys(sys.supports).sort()) {
    const r = propagate(sys, new Set([sid]));
    for (const [fid, f] of Object.entries(sys.functions)) {
      const hit = f.trains.filter((t) => r.trains.has(t));
      if (hit.length >= 2) {
        findings.push({
          kind: "common-cause-trains", support: sid, supportKind: sys.supports[sid].supportKind, function: fid,
          trainsDefeated: hit, functionLost: r.functions.has(fid),
          paths: hit.map((t) => ({ train: t, path: r.trainPath(t), text: fmtPath(r.trainPath(t)) })),
          message: `single loss of ${sid} (${sys.supports[sid].supportKind}) defeats ${hit.length} trains of ${fid} (${hit.join(", ")})${r.functions.has(fid) ? ` → ${fid} lost` : ""}`,
        });
      }
    }
    if (r.functions.size >= 2) {
      const fns = [...r.functions].sort();
      findings.push({
        kind: "cross-function", support: sid, supportKind: sys.supports[sid].supportKind, functionsLost: fns,
        paths: fns.flatMap((fid) => sys.functions[fid].trains.filter((t) => r.trains.has(t)).map((t) => ({ function: fid, train: t, path: r.trainPath(t), text: fmtPath(r.trainPath(t)) }))),
        message: `single loss of ${sid} (${sys.supports[sid].supportKind}) defeats ${fns.length} safety functions (${fns.join(", ")})`,
      });
    }
  }
  return findings;
}

/** Minimal cut sets of order ≤ maxOrder for each function's loss. */
export function functionCutSets(sys, maxOrder = 2) {
  const ft = buildFaultTree(sys);
  return Object.fromEntries(Object.keys(sys.functions).sort().map((fid) => [fid, minimalCutSets(ft, ft.tops[fid], { maxOrder })]));
}

export const METHOD = {
  screen: `independence screen ${SCREEN_VERSION}: remove one support item at a time, propagate the loss through requires/anyOf to components, trains and functions (k-of-n), report any item defeating ≥2 trains of one function or ≥2 functions, with the dependency path`,
  cutSets: `minimal cut sets ${FT_VERSION}: fault tree generated from the support graph (item = own failure OR required support lost OR all anyOf alternatives lost; train = OR of components; function = at-least-(n−k+1)-of-n trains), bottom-up Boolean substitution with absorption (NUREG-0492 ch. VII), truncated at order 2`,
};
