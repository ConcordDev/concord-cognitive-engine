// Contract tests for server/domains/commonsense.js — the seven
// knowledge-base macros backing the commonsense lens backlog:
// factAdd/factList/factDelete, knowledgeGraph, inferChain,
// contradictionScan, relationTaxonomy, confidenceQuery, extractFacts,
// provenanceChain. ConceptNet network paths are exercised offline-safe.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCommonsenseActions from "../domains/commonsense.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`commonsense.${name}`);
  if (!fn) throw new Error(`commonsense.${name} not registered`);
  const artifact = { id: null, domain: "commonsense", type: "domain_action", data: params, meta: {} };
  return fn(ctx, artifact, params);
}

before(() => { registerCommonsenseActions(register); });

// Disable the network so ConceptNet-backed macros take their graceful path.
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  // Wipe the per-user fact store between tests.
  const STATE = globalThis._concordSTATE;
  if (STATE && STATE.commonsenseLens) STATE.commonsenseLens.facts.clear();
});

const ctx = { actor: { userId: "cs_user" }, userId: "cs_user" };

async function seed(facts) {
  for (const f of facts) {
    const r = await call("factAdd", ctx, f);
    assert.equal(r.ok, true);
  }
}

describe("commonsense.factAdd / factList / factDelete", () => {
  it("adds a fact and returns the stored triple", async () => {
    const r = await call("factAdd", ctx, { subject: "dog", relation: "is_a", object: "animal" });
    assert.equal(r.ok, true);
    assert.equal(r.result.fact.subject, "dog");
    assert.equal(r.result.fact.relation, "is_a");
    assert.equal(r.result.total, 1);
  });

  it("rejects a fact missing subject or object", async () => {
    const r = await call("factAdd", ctx, { subject: "dog" });
    assert.equal(r.ok, false);
  });

  it("lists then deletes a fact", async () => {
    const add = await call("factAdd", ctx, { subject: "cat", relation: "is_a", object: "animal" });
    const list = await call("factList", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const del = await call("factDelete", ctx, { id: add.result.fact.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
  });
});

describe("commonsense.knowledgeGraph", () => {
  it("builds nodes + edges from the fact store", async () => {
    await seed([
      { subject: "dog", relation: "is_a", object: "mammal" },
      { subject: "mammal", relation: "is_a", object: "animal" },
    ]);
    const r = await call("knowledgeGraph", ctx, { depth: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.nodeCount, 3);
    assert.equal(r.result.stats.edgeCount, 2);
  });

  it("scopes the graph to a focus concept via BFS", async () => {
    await seed([
      { subject: "dog", relation: "is_a", object: "mammal" },
      { subject: "fish", relation: "is_a", object: "animal" },
    ]);
    const r = await call("knowledgeGraph", ctx, { focus: "dog", depth: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.focus, "dog");
    assert.ok(r.result.nodes.some((n) => n.id === "dog"));
    assert.ok(!r.result.nodes.some((n) => n.id === "fish"));
  });
});

describe("commonsense.inferChain", () => {
  it("derives transitive IsA facts", async () => {
    await seed([
      { subject: "poodle", relation: "is_a", object: "dog", confidence: 0.9 },
      { subject: "dog", relation: "is_a", object: "mammal", confidence: 0.9 },
      { subject: "mammal", relation: "is_a", object: "animal", confidence: 0.9 },
    ]);
    const r = await call("inferChain", ctx, { maxHops: 3, minConfidence: 0.2 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.ok(r.result.inferences.some((i) => i.subject === "poodle" && i.object === "animal"));
  });
});

describe("commonsense.contradictionScan", () => {
  it("flags antonymic property conflicts", async () => {
    await seed([
      { subject: "ice", relation: "has_property", object: "cold" },
      { subject: "ice", relation: "has_property", object: "hot" },
    ]);
    const r = await call("contradictionScan", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.consistent, false);
    assert.ok(r.result.count >= 1);
  });

  it("reports consistency when no conflicts exist", async () => {
    await seed([{ subject: "dog", relation: "is_a", object: "animal" }]);
    const r = await call("contradictionScan", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.consistent, true);
  });
});

describe("commonsense.relationTaxonomy", () => {
  it("returns the grouped taxonomy with usage counts", async () => {
    await seed([{ subject: "dog", relation: "is_a", object: "animal" }]);
    const r = await call("relationTaxonomy", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.taxonomy));
    assert.ok(r.result.totalRelationTypes > 0);
    const isA = r.result.taxonomy
      .flatMap((g) => g.relations)
      .find((rel) => rel.id === "is_a");
    assert.equal(isA.usageCount, 1);
  });
});

describe("commonsense.confidenceQuery", () => {
  it("returns local matches above the confidence threshold", async () => {
    await seed([
      { subject: "dog", relation: "is_a", object: "animal", confidence: 0.9 },
      { subject: "dog", relation: "has_property", object: "loyal", confidence: 0.3 },
    ]);
    const r = await call("confidenceQuery", ctx, { subject: "dog", minConfidence: 0.5, useConceptNet: false });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.matches[0].object, "animal");
  });

  it("rejects an empty subject", async () => {
    const r = await call("confidenceQuery", ctx, { useConceptNet: false });
    assert.equal(r.ok, false);
  });
});

describe("commonsense.extractFacts", () => {
  it("extracts triples from declarative text", async () => {
    const r = await call("extractFacts", ctx, { text: "A dog is a kind of animal. Fire causes smoke." });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 1);
    assert.equal(r.result.committed, 0);
  });

  it("commits extracted triples to the store when commit is true", async () => {
    const r = await call("extractFacts", ctx, { text: "A cat is a kind of animal.", commit: true });
    assert.equal(r.ok, true);
    assert.ok(r.result.committed >= 1);
    const list = await call("factList", ctx, {});
    assert.ok(list.result.count >= 1);
  });

  it("rejects empty text", async () => {
    const r = await call("extractFacts", ctx, {});
    assert.equal(r.ok, false);
  });
});

describe("commonsense.provenanceChain", () => {
  it("traces the citation chain for a stored fact", async () => {
    const add = await call("factAdd", ctx, { subject: "dog", relation: "is_a", object: "animal", source: "user" });
    const r = await call("provenanceChain", ctx, { factId: add.result.fact.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.chain.length >= 1);
    assert.equal(r.result.chain[0].kind, "assertion");
  });

  it("flags an independently derivable fact", async () => {
    await seed([
      { subject: "dog", relation: "is_a", object: "mammal" },
      { subject: "mammal", relation: "is_a", object: "animal" },
    ]);
    const add = await call("factAdd", ctx, { subject: "dog", relation: "is_a", object: "animal" });
    const r = await call("provenanceChain", ctx, { factId: add.result.fact.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.independentlyVerified, true);
  });

  it("returns an error for an unknown fact id", async () => {
    const r = await call("provenanceChain", ctx, { factId: "nope" });
    assert.equal(r.ok, false);
  });
});
