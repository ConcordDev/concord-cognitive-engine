// server/lib/conkay/safety-case/solvers.js
//
// The independence / common-cause screen and the order-≤2 cut sets as
// registry solvers, so they run through the same design graph, dependency
// tracking, iterate loop and receipts as every other ConKay check.
// Screening only: a PASS here means "no single support item found that
// defeats redundancy in this declared graph", never "safe".

import { registerSolver } from "../physics/registry.js";
import { independenceScreen, functionCutSets, validateSystem, METHOD, SCREEN_VERSION } from "./support-graph.js";

const list = (v) => (Array.isArray(v) ? [...v] : []);

/** Rebuild the plain system from the design graph, recording every read. */
export function systemFromContext(ctx) {
  const g = ctx.graph;
  const sys = { functions: {}, trains: {}, components: {}, supports: {} };
  for (const n of g.nodesOfKind("SafetyFunction")) sys.functions[n.id] = { name: n.name, trains: list(ctx.get(n.id, "props.trains")), successCriterion: ctx.get(n.id, "props.successCriterion") };
  for (const n of g.nodesOfKind("SafetyTrain")) sys.trains[n.id] = { function: ctx.get(n.id, "props.function"), components: list(ctx.get(n.id, "props.components")) };
  for (const n of g.nodesOfKind("SafetyComponent")) sys.components[n.id] = { train: ctx.get(n.id, "props.train"), requires: list(ctx.get(n.id, "props.requires")), anyOf: list(ctx.get(n.id, "props.anyOf")), dcBus: ctx.get(n.id, "props.dcBus") || null };
  for (const n of g.nodesOfKind("SupportItem")) sys.supports[n.id] = { supportKind: ctx.get(n.id, "props.supportKind"), requires: list(ctx.get(n.id, "props.requires")), anyOf: list(ctx.get(n.id, "props.anyOf")) };
  return sys;
}

const COMMON = {
  domains: ["safety.independence"],
  fidelity: 1,
  regime: "static, coherent Boolean dependency graph as declared (no timing, no partial degradation, no spurious actuation, no diversity credit); single-failure screening only",
  units: { inputs: "none (logic)", outputs: "item ids" },
  tolerance: "exact (Boolean logic)",
  screening: true,
  reference: "Single-failure context: 10 CFR 50 App. A definitions + GDC 17/21/22; IAEA SSR-2/1 (Rev. 1) Req. 21, 24, 25. Cut-set method: NUREG-0492 ch. VII.",
};

registerSolver({
  ...COMMON,
  id: "safety.single-failure",
  version: SCREEN_VERSION,
  domain: "safety.single-failure",
  method: `${METHOD.screen}; ${METHOD.cutSets}`,
  targets: (g) => g.nodesOfKind("SafetyFunction").map((n) => n.id),
  run(ctx, id) {
    const sys = systemFromContext(ctx);
    const errors = validateSystem(sys);
    if (errors.length) return { notComputed: `support graph invalid: ${errors.join("; ")}` };
    const cut = functionCutSets(sys, 2)[id];
    const findings = independenceScreen(sys).filter((f) => f.kind === "common-cause-trains" && f.function === id);
    const singles = cut.filter((c) => c.length === 1);
    const f = sys.functions[id];
    return {
      inputs: { system: { value: sys }, successCriterion: { value: `${f.successCriterion.k} of ${f.trains.length} trains` } },
      outputs: {
        cutSetsOrder1: { value: singles },
        cutSetsOrder2: { value: cut.filter((c) => c.length === 2) },
        cutSetCount: { value: cut.length, unit: "1" },
        commonCauseFindings: { value: findings },
      },
      failures: [
        ...findings.map((x) => x.message),
        ...singles.filter((s) => !findings.some((x) => x.support === s[0])).map((s) => `single item ${s[0]} alone defeats ${id} (order-1 cut set)`),
      ],
      assumptions: [
        "Every listed requirement of an item is needed; anyOf items are true alternatives each able to carry the load.",
        "Own-hardware failure of every component and support item is a basic event; operator actions, spurious actuation and diversity are not modelled.",
        "Order-2 cut sets are listed for review; their significance needs failure data and engineering judgement (Phase 2).",
      ],
    };
  },
});

registerSolver({
  ...COMMON,
  id: "safety.cross-function",
  version: SCREEN_VERSION,
  domain: "safety.cross-function",
  method: METHOD.screen,
  targets: (g) => g.nodesOfKind("SafetyCase").map((n) => n.id),
  run(ctx) {
    const sys = systemFromContext(ctx);
    const errors = validateSystem(sys);
    if (errors.length) return { notComputed: `support graph invalid: ${errors.join("; ")}` };
    const findings = independenceScreen(sys).filter((x) => x.kind === "cross-function");
    return {
      inputs: { system: { value: sys } },
      outputs: { crossFunctionFindings: { value: findings }, functionsScreened: { value: Object.keys(sys.functions).sort() } },
      failures: findings.map((x) => x.message),
      assumptions: ["A function is lost when more than n−k of its n trains are lost."],
    };
  },
});
