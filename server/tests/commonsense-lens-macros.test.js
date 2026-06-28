// Behavioral macro tests for the commonsense lens CALCULATOR surface in
// server/domains/commonsense.js — the three pure-compute reasoning actions the
// /lenses/commonsense page drives (CommonsenseActionPanel.tsx + the page.tsx
// inline "Commonsense Actions" panel):
//   plausibilityCheck · analogyMapping · defaultReasoning
//
// COMPLEMENT to commonsense-domain-parity.test.js (which pins the per-user
// fact-store substrate: factAdd/knowledgeGraph/inferChain/contradictionScan/
// relationTaxonomy/confidenceQuery/extractFacts/provenanceChain). This file
// pins the PATH-3 calculator surface the component reaches via:
//   callMacro(action, { artifact: { data } })
//     → apiHelpers.lens.runDomain('commonsense', action, { input })
//     → POST /api/lens/run { domain:'commonsense', action, artifact:{data} }
//     → _peelRedundantArtifactWrapper(body input) collapses {artifact:{data:X}} → X
//     → LENS_ACTIONS handler(ctx, virtualArtifact={...,data:X}, X)   [3-ARG]
//
// THE COMPONENT-EXACT-SHAPE CONTRACT (the dead-calculator class this gate
// targets): every test drives the EXACT inner-data object the component sends
// THROUGH the real dispatch peel, then asserts the EXACT fields the component
// renders from r.result. The field map, component → handler, was diffed both
// directions. TWO DEAD SURFACES were found + fixed in CommonsenseActionPanel.tsx:
//
//   plausibilityCheck
//     was IN  { statement: "<string>" }            (handler reads statement.text → undefined)
//     now IN  { statement: { text: "<string>" } }
//     was OUT r.result.{verdict,reasoning}          (NEVER returned → blank card)
//     now OUT r.result.{plausibilityScore,plausibilityLabel,violations:{count,items[{type,description,severity}]},constraintsSatisfied,eventsAnalyzed}
//
//   analogyMapping
//     was IN  { source:"<string>", target:"<string>" }   (handler reads source.entities → [] → "must have entities" message)
//     now IN  { source:{domain,entities,relations}, target:{...} }   (panel parses JSON, free-text degrades to one entity)
//     was OUT r.result.{source,target,mappings[{sourceConcept,targetConcept}],coherence}   (NEVER returned → blank card)
//     now OUT r.result.{sourceDomain,targetDomain,entityMapping[{source,target,similarity}],systematicityScore,systematicityLabel,candidateInferences[{predictedRelation,from,to}],coverage}
//
//   defaultReasoning (page.tsx inline panel — already aligned, asserted both directions here)
//     IN  { classes:[{name,parent?,defaults,overrides?}], instance:{class,properties?} }
//     OUT r.result.{instanceClass,inheritanceChain,resolvedProperties,propertySources,totalProperties,conflicts:{inheritanceOverrides,siblingConflicts},warnings}
//
// NOT shape-only: every test feeds KNOWN inputs and asserts the EXACT computed
// value (causal/temporal/physical violation detection + severity-adjusted score,
// structure-mapping entity alignment + systematicity + candidate inference,
// default-inheritance resolution with override precedence).
//
// FAIL-CLOSED POISON: these calculators are string/structure driven (no wallet,
// no mint), but plausibilityCheck parses event `time` strings through
// `new Date(t).getTime()` — a poisoned "Infinity"/"NaN" time yields NaN, guarded
// by `!isNaN(...)`, so the plausibility score must stay FINITE and never leak NaN
// into the UI score render. The poison block pins Number.isFinite on the score.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCommonsenseActions from "../domains/commonsense.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "commonsense", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Drive a calculator EXACTLY like the live dispatch does for the component's
// `callMacro(action, { artifact: { data } })` shape: the body input is
// `{ artifact: { data: <inner> } }`, the dispatch peels one redundant layer,
// then invokes handler(ctx, virtualArtifact, peeled) with virtualArtifact.data
// === peeled. `inner` here is the object the component sends.
function callViaComponentShape(name, ctx, inner) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`commonsense.${name} not registered`);
  const bodyInput = { artifact: { data: inner } };          // what callMacro wraps
  const peeled = peelRedundantArtifactWrapper(bodyInput);    // dispatch peel
  const virtualArtifact = { id: null, domain: "commonsense", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, virtualArtifact, peeled);
}

before(() => { registerCommonsenseActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  // Network disabled — none of the three calculators touch ConceptNet, but pin it.
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const CALCULATORS = ["plausibilityCheck", "analogyMapping", "defaultReasoning"];

describe("commonsense calculators — registration", () => {
  it("registers every calculator the commonsense lens reaches", () => {
    for (const m of CALCULATORS) assert.ok(ACTIONS.has(m), `commonsense.${m} not registered`);
  });
});

describe("commonsense.plausibilityCheck — component-exact shape + values", () => {
  it("flags a causal violation + scores an implausible statement (component reads label/score/violations)", () => {
    // CommonsenseActionPanel sends { statement: { text } } — NOT a bare string.
    const r = callViaComponentShape("plausibilityCheck", ctxA, { statement: { text: "The dead man spoke clearly to the crowd." } });
    assert.equal(r.ok, true);
    // EXACT fields the result card reads:
    assert.equal(r.result.plausibilityScore, 0);
    assert.equal(r.result.plausibilityLabel, "implausible");
    assert.equal(r.result.violations.count, 1);
    assert.equal(r.result.violations.items[0].type, "causal");
    assert.equal(r.result.violations.items[0].severity, "high");
    assert.equal(r.result.eventsAnalyzed, 0);
    assert.equal(typeof r.result.violations.items[0].description, "string");
  });

  it("scores a mundane statement as highly plausible with zero violations", () => {
    const r = callViaComponentShape("plausibilityCheck", ctxA, { statement: { text: "The cat sat on the warm mat." } });
    assert.equal(r.ok, true);
    assert.equal(r.result.plausibilityScore, 80);
    assert.equal(r.result.plausibilityLabel, "highly plausible");
    assert.equal(r.result.violations.count, 0);
    assert.deepEqual(r.result.violations.items, []);
  });

  it("detects an out-of-order temporal sequence across events", () => {
    const r = callViaComponentShape("plausibilityCheck", ctxA, {
      statement: {
        text: "trip log",
        events: [
          { action: "arrive", time: "2026-01-02T10:00:00Z" },
          { action: "depart", time: "2026-01-01T10:00:00Z" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.eventsAnalyzed, 2);
    assert.equal(r.result.violations.count, 1);
    assert.equal(r.result.violations.items[0].type, "temporal");
    assert.equal(r.result.violations.items[0].severity, "high");
    assert.equal(r.result.plausibilityScore, 0);
  });

  it("degrade-graceful: empty data does not throw, returns a moderate default the card can render", () => {
    const r = callViaComponentShape("plausibilityCheck", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.plausibilityScore, 80);
    assert.equal(r.result.plausibilityLabel, "highly plausible");
    assert.equal(r.result.eventsAnalyzed, 0);
    assert.equal(r.result.violations.count, 0);
  });

  it("fail-CLOSED poison: Infinity/NaN event times keep the plausibility score FINITE (no NaN in the UI)", () => {
    const r = callViaComponentShape("plausibilityCheck", ctxA, {
      statement: { text: "x", events: [{ action: "a", time: "Infinity" }, { action: "b", time: "NaN" }] },
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.plausibilityScore), `score not finite: ${r.result.plausibilityScore}`);
    assert.ok(Number.isFinite(r.result.eventsAnalyzed));
    assert.ok(Number.isFinite(r.result.constraintsSatisfied));
    assert.ok(Number.isFinite(r.result.totalChecksPerformed));
  });
});

describe("commonsense.analogyMapping — component-exact shape + structure-mapping values", () => {
  // The classic solar-system → atom analogy. The panel parses each domain field
  // as JSON { domain, entities:[{name,type}], relations:[{type,from,to}] }.
  const SOURCE = {
    domain: "solar system",
    entities: [{ name: "sun", type: "object" }, { name: "planet", type: "object" }],
    relations: [{ type: "attracts", from: "sun", to: "planet" }, { type: "heavier", from: "sun", to: "planet" }],
  };
  const TARGET = {
    domain: "atom",
    entities: [{ name: "nucleus", type: "object" }, { name: "electron", type: "object" }],
    relations: [{ type: "attracts", from: "nucleus", to: "electron" }],
  };

  it("aligns entities + computes systematicity + a candidate inference (component reads these EXACT fields)", () => {
    const r = callViaComponentShape("analogyMapping", ctxA, { source: SOURCE, target: TARGET });
    assert.equal(r.ok, true);
    // sourceDomain/targetDomain — header read.
    assert.equal(r.result.sourceDomain, "solar system");
    assert.equal(r.result.targetDomain, "atom");
    // entityMapping[].{source,target,similarity} — EXACT component read.
    assert.deepEqual(
      r.result.entityMapping.map((m) => ({ source: m.source, target: m.target, similarity: m.similarity })),
      [
        { source: "sun", target: "nucleus", similarity: 1 },
        { source: "planet", target: "electron", similarity: 1 },
      ],
    );
    // systematicityScore + label — score read.
    assert.equal(r.result.systematicityScore, 30);
    assert.equal(r.result.systematicityLabel, "low");
    // coverage block — the 2-column stat read.
    assert.equal(r.result.coverage.entitiesMapped, 2);
    assert.equal(r.result.coverage.totalSourceEntities, 2);
    assert.equal(r.result.coverage.relationsMapped, 1);
    assert.equal(r.result.coverage.totalSourceRelations, 2);
    // candidateInferences[].{predictedRelation,from,to} — the "heavier" prediction read.
    assert.equal(r.result.candidateInferences.length, 1);
    assert.equal(r.result.candidateInferences[0].predictedRelation, "heavier");
    assert.equal(r.result.candidateInferences[0].from, "nucleus");
    assert.equal(r.result.candidateInferences[0].to, "electron");
  });

  it("free-text-degraded single entities still produce a 1:1 entity mapping the card renders", () => {
    // What parseAnalogDomain produces for a plain label: one entity, no relations.
    const r = callViaComponentShape("analogyMapping", ctxA, {
      source: { domain: "heart", entities: [{ name: "heart", type: "entity" }], relations: [] },
      target: { domain: "pump", entities: [{ name: "pump", type: "entity" }], relations: [] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sourceDomain, "heart");
    assert.equal(r.result.targetDomain, "pump");
    assert.equal(r.result.entityMapping.length, 1);
    assert.equal(r.result.entityMapping[0].source, "heart");
    assert.equal(r.result.entityMapping[0].target, "pump");
    assert.ok(Number.isFinite(r.result.systematicityScore));
  });

  it("validation: empty entity sets return a guidance message, not a broken entityMapping render", () => {
    const r = callViaComponentShape("analogyMapping", ctxA, { source: { entities: [] }, target: { entities: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.entityMapping, undefined);
    assert.match(r.result.message, /entities/i);
  });

  it("degrade-graceful: missing source/target keys default to empty + return guidance (no throw)", () => {
    const r = callViaComponentShape("analogyMapping", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });

  it("fail-CLOSED: every emitted similarity/score is FINITE", () => {
    const r = callViaComponentShape("analogyMapping", ctxA, { source: SOURCE, target: TARGET });
    assert.ok(Number.isFinite(r.result.systematicityScore), `sysScore not finite: ${r.result.systematicityScore}`);
    for (const m of r.result.entityMapping) assert.ok(Number.isFinite(m.similarity), `similarity not finite: ${m.similarity}`);
    for (const rm of r.result.relationMappings) assert.ok(Number.isFinite(rm.alignmentScore));
    for (const c of r.result.candidateInferences) assert.ok(Number.isFinite(c.confidence));
  });
});

describe("commonsense.defaultReasoning — component-exact shape + inheritance resolution", () => {
  // Penguin: bird overrides animal's legs+canFly; penguin overrides canFly back to false.
  const CLASSES = [
    { name: "animal", defaults: { legs: 4, canFly: false } },
    { name: "bird", parent: "animal", defaults: { canFly: true, legs: 2 } },
    { name: "penguin", parent: "bird", overrides: { canFly: false } },
  ];

  it("resolves properties through the inheritance chain with override precedence (page.tsx inline panel reads these)", () => {
    const r = callViaComponentShape("defaultReasoning", ctxA, { classes: CLASSES, instance: { class: "penguin" } });
    assert.equal(r.ok, true);
    // instanceClass + inheritanceChain — the chain breadcrumb read.
    assert.equal(r.result.instanceClass, "penguin");
    assert.deepEqual(r.result.inheritanceChain, ["penguin", "bird", "animal"]);
    // resolvedProperties — most-specific wins: bird's legs:2 over animal's legs:4,
    // penguin override canFly:false over bird's canFly:true.
    assert.deepEqual(r.result.resolvedProperties, { legs: 2, canFly: false });
    assert.equal(r.result.totalProperties, 2);
    // propertySources — the "← source" annotation read.
    assert.equal(r.result.propertySources.legs, "bird (default)");
    assert.equal(r.result.propertySources.canFly, "penguin (override)");
    // conflicts counters — the 3-stat row read.
    assert.ok(Number.isFinite(r.result.conflicts.inheritanceOverrides));
    assert.ok(r.result.conflicts.inheritanceOverrides >= 1);
    assert.equal(r.result.conflicts.siblingConflicts, 0);
    assert.ok(Array.isArray(r.result.warnings));
  });

  it("flags sibling conflicts among classes that share a parent", () => {
    const r = callViaComponentShape("defaultReasoning", ctxA, {
      classes: [
        { name: "vehicle", defaults: {} },
        { name: "car", parent: "vehicle", defaults: { wheels: 4 } },
        { name: "motorcycle", parent: "vehicle", defaults: { wheels: 2 } },
      ],
      instance: { class: "car" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.conflicts.siblingConflicts, 1);
    assert.match(r.result.warnings.join(" "), /conflicting default/i);
  });

  it("instance-level properties take highest priority over inherited defaults", () => {
    const r = callViaComponentShape("defaultReasoning", ctxA, {
      classes: [{ name: "dog", defaults: { sound: "bark" } }],
      instance: { class: "dog", properties: { sound: "howl" } },
    });
    assert.equal(r.result.resolvedProperties.sound, "howl");
    assert.equal(r.result.propertySources.sound, "instance");
  });

  it("validation: empty class hierarchy returns a guidance message (page renders r.message)", () => {
    const r = callViaComponentShape("defaultReasoning", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.resolvedProperties, undefined);
    assert.match(r.result.message, /class hierarchy/i);
  });

  it("degrade-graceful: a cycle in the hierarchy is detected, not infinite-looped", () => {
    const r = callViaComponentShape("defaultReasoning", ctxA, {
      classes: [
        { name: "a", parent: "b", defaults: {} },
        { name: "b", parent: "a", defaults: {} },
      ],
      instance: { class: "a" },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.cycles && r.result.cycles.length > 0);
    assert.match(r.result.warnings.join(" "), /cycle/i);
  });
});
