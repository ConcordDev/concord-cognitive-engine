// Contract tests for server/domains/entity.js — entity-resolution math
// plus the knowledge-graph workbench (nodes / edges / schemas / merge-split
// / path-find / bulk + wikidata import / provenance).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEntityActions from "../domains/entity.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`entity.${name}`);
  assert.ok(fn, `entity.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerEntityActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("entity.entityResolution (pure-compute)", () => {
  it("detects near-duplicate records above threshold", () => {
    const r = call("entityResolution", ctxA, {
      id: "x", data: {
        records: [
          { id: "r1", fields: { name: "Jonathan Smith", email: "jsmith@x.com" } },
          { id: "r2", fields: { name: "Jon Smith", email: "jsmith@x.com" } },
          { id: "r3", fields: { name: "Alice Wong", email: "awong@y.com" } },
        ],
      },
    }, { threshold: 0.7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRecords, 3);
    assert.ok(r.result.matchesFound >= 1);
  });
});

describe("entity.node-* CRUD (per-user graph)", () => {
  it("creates a node with provenance-tagged attributes", () => {
    const r = call("node-create", ctxA, {
      name: "Ada Lovelace",
      entityType: "person",
      attributes: { occupation: { value: "mathematician", source: "manual" } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.node.name, "Ada Lovelace");
    assert.equal(r.result.node.attributes.occupation.source, "manual");
  });
  it("rejects nameless node", () => {
    assert.equal(call("node-create", ctxA, { name: "" }).ok, false);
  });
  it("scopes nodes per user", () => {
    call("node-create", ctxA, { name: "A" });
    assert.equal(call("graph-get", ctxA).result.nodes.length, 1);
    assert.equal(call("graph-get", ctxB).result.nodes.length, 0);
  });
  it("updates an attribute with new provenance", () => {
    const n = call("node-create", ctxA, { name: "N" }).result.node;
    const r = call("node-update", ctxA, { id: n.id, attributeKey: "born", attributeValue: 1815, attributeSource: "wikidata" });
    assert.equal(r.ok, true);
    assert.equal(r.result.node.attributes.born.source, "wikidata");
  });
  it("deletes a node and its incident edges", () => {
    const a = call("node-create", ctxA, { name: "A" }).result.node;
    const b = call("node-create", ctxA, { name: "B" }).result.node;
    call("edge-create", ctxA, { from: a.id, to: b.id });
    const r = call("node-delete", ctxA, { id: a.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.edgesRemoved, 1);
  });
});

describe("entity.edge-* CRUD", () => {
  it("links two nodes and rejects dangling / self / dup edges", () => {
    const a = call("node-create", ctxA, { name: "A" }).result.node;
    const b = call("node-create", ctxA, { name: "B" }).result.node;
    const e = call("edge-create", ctxA, { from: a.id, to: b.id, relType: "knows" });
    assert.equal(e.ok, true);
    assert.equal(call("edge-create", ctxA, { from: a.id, to: a.id }).ok, false);
    assert.equal(call("edge-create", ctxA, { from: a.id, to: "nope" }).ok, false);
    assert.equal(call("edge-create", ctxA, { from: a.id, to: b.id, relType: "knows" }).ok, false);
    assert.equal(call("edge-delete", ctxA, { id: e.result.edge.id }).ok, true);
  });
});

describe("entity.schema-* (typed entity classes)", () => {
  it("saves, updates and deletes a schema", () => {
    const r = call("schema-save", ctxA, {
      className: "Person",
      attributes: [{ name: "born", type: "integer", required: true }, { name: "bad", type: "weird" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.schema.attributes[1].type, "string"); // invalid type coerced
    const upd = call("schema-save", ctxA, { id: r.result.schema.id, className: "Human", attributes: [] });
    assert.equal(upd.result.schema.className, "Human");
    assert.equal(call("schema-list", ctxA).result.schemas.length, 1);
    assert.equal(call("schema-delete", ctxA, { id: r.result.schema.id }).ok, true);
  });
  it("rejects nameless class", () => {
    assert.equal(call("schema-save", ctxA, { className: "" }).ok, false);
  });
});

describe("entity.node-merge (duplicate reconciliation)", () => {
  it("merges source into target, fills gaps, rewires edges", () => {
    const tgt = call("node-create", ctxA, { name: "Jon Smith", attributes: { email: { value: "j@x.com" } } }).result.node;
    const src = call("node-create", ctxA, { name: "Jonathan Smith", attributes: { phone: { value: "555-1212" } } }).result.node;
    const other = call("node-create", ctxA, { name: "Other" }).result.node;
    call("edge-create", ctxA, { from: src.id, to: other.id, relType: "knows" });
    const r = call("node-merge", ctxA, { sourceId: src.id, targetId: tgt.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.node.attributes.phone.value, "555-1212"); // gap filled
    assert.equal(r.result.node.attributes.email.value, "j@x.com"); // kept target
    assert.equal(r.result.edgesRewired, 1);
    assert.equal(call("graph-get", ctxA).result.nodes.length, 2); // src removed
  });
  it("rejects self-merge", () => {
    const n = call("node-create", ctxA, { name: "N" }).result.node;
    assert.equal(call("node-merge", ctxA, { sourceId: n.id, targetId: n.id }).ok, false);
  });
  it("honors fieldChoices on attribute conflict", () => {
    const tgt = call("node-create", ctxA, { name: "T", attributes: { city: { value: "Lisbon" } } }).result.node;
    const src = call("node-create", ctxA, { name: "S", attributes: { city: { value: "Porto" } } }).result.node;
    const r = call("node-merge", ctxA, { sourceId: src.id, targetId: tgt.id, fieldChoices: { city: "source" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.node.attributes.city.value, "Porto");
  });
});

describe("entity.node-split", () => {
  it("splits attributes into a new node linked by split_from", () => {
    const n = call("node-create", ctxA, {
      name: "Combined",
      attributes: { a: { value: 1 }, b: { value: 2 } },
    }).result.node;
    const r = call("node-split", ctxA, { id: n.id, splitName: "Spun Off", attributeKeys: ["b"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.newNode.attributes.b.value, 2);
    assert.equal(r.result.original.attributes.b, undefined);
    assert.equal(r.result.edge.relType, "split_from");
  });
});

describe("entity.path-find (BFS shortest path)", () => {
  it("finds a multi-hop path", () => {
    const a = call("node-create", ctxA, { name: "A" }).result.node;
    const b = call("node-create", ctxA, { name: "B" }).result.node;
    const c = call("node-create", ctxA, { name: "C" }).result.node;
    call("edge-create", ctxA, { from: a.id, to: b.id });
    call("edge-create", ctxA, { from: b.id, to: c.id });
    const r = call("path-find", ctxA, { from: a.id, to: c.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.hops, 2);
  });
  it("reports no path when disconnected", () => {
    const a = call("node-create", ctxA, { name: "A" }).result.node;
    const b = call("node-create", ctxA, { name: "B" }).result.node;
    const r = call("path-find", ctxA, { from: a.id, to: b.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, false);
  });
  it("returns a zero-hop path for identical from/to", () => {
    const a = call("node-create", ctxA, { name: "A" }).result.node;
    const r = call("path-find", ctxA, { from: a.id, to: a.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.hops, 0);
  });
});

describe("entity.import-bulk (CSV/JSON rows)", () => {
  it("creates nodes from rows and skips nameless ones", () => {
    const r = call("import-bulk", ctxA, {
      source: "csv",
      rows: [
        { name: "Row One", type: "person", city: "Lisbon" },
        { city: "NoName" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.createdCount, 1);
    assert.equal(r.result.skippedCount, 1);
    assert.equal(r.result.created[0].attributes.city.source, "csv");
  });
  it("rejects empty row set", () => {
    assert.equal(call("import-bulk", ctxA, { rows: [] }).ok, false);
  });
});

describe("entity.import-wikidata", () => {
  it("imports an entity with wikidata provenance and blocks dup ids", () => {
    const r = call("import-wikidata", ctxA, {
      wikidataId: "Q7259",
      label: "Ada Lovelace",
      description: "English mathematician",
      claims: { fieldOfWork: "computing" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.node.wikidataId, "Q7259");
    assert.equal(r.result.node.attributes.description.source, "wikidata");
    assert.equal(call("import-wikidata", ctxA, { wikidataId: "Q7259", label: "Ada" }).ok, false);
  });
});

describe("entity.provenance-report", () => {
  it("aggregates attribute sources across the graph", () => {
    call("node-create", ctxA, { name: "N1", attributes: { a: { value: 1, source: "manual" } } });
    call("import-wikidata", ctxA, { wikidataId: "Q1", label: "W1", description: "d" });
    const r = call("provenance-report", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAttributes, 2);
    const sources = r.result.bySource.map(s => s.source).sort();
    assert.deepEqual(sources, ["manual", "wikidata"]);
  });
});
