// Contract tests for the maker-lens additions to server/domains/appmaker.js:
// data binding, branching quest authoring and the component marketplace.
// Pattern mirrors tests/travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAppmakerActions from "../domains/appmaker.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`app-maker.${name}`);
  if (!fn) throw new Error(`app-maker.${name} not registered`);
  return await fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAppmakerActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctx = { actor: { userId: "user_maker" }, userId: "user_maker" };
const ctxB = { actor: { userId: "user_maker_b" }, userId: "user_maker_b" };

async function freshProject() {
  const r = await call("projectCreate", ctx, { name: "Maker App" });
  assert.equal(r.ok, true);
  return r.result.project;
}

// ── Data binding ─────────────────────────────────────────────────────
describe("maker — data binding", () => {
  it("binds a canvas element to a table, lists and unbinds it", async () => {
    const proj = await freshProject();
    const pageId = proj.pages[0].id;

    const tbl = await call("dataAddTable", ctx, { projectId: proj.id, name: "Customers" });
    assert.equal(tbl.ok, true);

    const saved = await call("editorSavePage", ctx, {
      projectId: proj.id, pageId,
      elements: [{ id: "el1", type: "table", x: 0, y: 0, w: 400, h: 200 }],
    });
    assert.equal(saved.ok, true);

    const bind = await call("dataBindElement", ctx, {
      projectId: proj.id, pageId, elementId: "el1",
      source: { kind: "table", refId: tbl.result.table.id, query: "all" },
    });
    assert.equal(bind.ok, true);
    assert.equal(bind.result.binding.kind, "table");
    assert.equal(bind.result.binding.label, "Customers");

    const list = await call("dataBindings", ctx, { projectId: proj.id });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const unbind = await call("dataUnbindElement", ctx, { projectId: proj.id, pageId, elementId: "el1" });
    assert.equal(unbind.ok, true);

    const after = await call("dataBindings", ctx, { projectId: proj.id });
    assert.equal(after.result.count, 0);
  });

  it("rejects binding to an unknown table", async () => {
    const proj = await freshProject();
    const pageId = proj.pages[0].id;
    await call("editorSavePage", ctx, {
      projectId: proj.id, pageId,
      elements: [{ id: "el1", type: "table", x: 0, y: 0, w: 100, h: 100 }],
    });
    const r = await call("dataBindElement", ctx, {
      projectId: proj.id, pageId, elementId: "el1",
      source: { kind: "table", refId: "missing" },
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "table_not_found");
  });
});

// ── Quest authoring — branching node graph ──────────────────────────
describe("maker — quest graph authoring", () => {
  it("creates a graph with a start node, adds nodes and edges", async () => {
    const g = await call("questGraphCreate", ctx, { title: "Lost Crown" });
    assert.equal(g.ok, true);
    assert.equal(g.result.graph.nodes.length, 1);
    assert.equal(g.result.graph.nodes[0].kind, "start");
    const graphId = g.result.graph.id;

    const list = await call("questGraphList", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const node = await call("questNodeSave", ctx, {
      graphId, node: { kind: "ending", title: "Victory", reward: "100 gold" },
    });
    assert.equal(node.ok, true);
    assert.equal(node.result.nodes.length, 2);

    const startId = g.result.graph.nodes[0].id;
    const endId = node.result.node.id;
    const edge = await call("questEdgeAdd", ctx, { graphId, from: startId, to: endId, label: "succeed" });
    assert.equal(edge.ok, true);
    assert.equal(edge.result.edges.length, 1);
  });

  it("rejects self-edges and duplicate edges", async () => {
    const g = await call("questGraphCreate", ctx, { title: "Q" });
    const graphId = g.result.graph.id;
    const startId = g.result.graph.nodes[0].id;
    const n = await call("questNodeSave", ctx, { graphId, node: { kind: "step", title: "S" } });
    const stepId = n.result.node.id;

    const self = await call("questEdgeAdd", ctx, { graphId, from: startId, to: startId });
    assert.equal(self.ok, false);

    await call("questEdgeAdd", ctx, { graphId, from: startId, to: stepId });
    const dup = await call("questEdgeAdd", ctx, { graphId, from: startId, to: stepId });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "edge_exists");
  });

  it("validates structure — flags dead ends and missing ending", async () => {
    const g = await call("questGraphCreate", ctx, { title: "Q" });
    const graphId = g.result.graph.id;
    const v = await call("questGraphValidate", ctx, { graphId });
    assert.equal(v.ok, true);
    assert.ok(v.result.issues.some((i) => i.type === "no_ending"));
    assert.ok(v.result.issues.some((i) => i.type === "dead_end"));
  });

  it("cannot delete the start node; deletes other nodes + incident edges", async () => {
    const g = await call("questGraphCreate", ctx, { title: "Q" });
    const graphId = g.result.graph.id;
    const startId = g.result.graph.nodes[0].id;
    const cantDelete = await call("questNodeDelete", ctx, { graphId, nodeId: startId });
    assert.equal(cantDelete.ok, false);

    const n = await call("questNodeSave", ctx, { graphId, node: { kind: "step", title: "S" } });
    await call("questEdgeAdd", ctx, { graphId, from: startId, to: n.result.node.id });
    const del = await call("questNodeDelete", ctx, { graphId, nodeId: n.result.node.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.edges.length, 0);
  });

  it("deletes a whole graph", async () => {
    const g = await call("questGraphCreate", ctx, { title: "Q" });
    const del = await call("questGraphDelete", ctx, { graphId: g.result.graph.id });
    assert.equal(del.ok, true);
    const list = await call("questGraphList", ctx, {});
    assert.equal(list.result.count, 0);
  });
});

// ── Component marketplace ───────────────────────────────────────────
describe("maker — component marketplace", () => {
  it("publishes a library component and another user can browse + install it", async () => {
    const proj = await freshProject();
    const lib = await call("librarySave", ctx, {
      projectId: proj.id,
      component: { name: "Primary Button", baseType: "button", props: { label: "Go" }, style: { color: "pink" } },
    });
    assert.equal(lib.ok, true);

    const pub = await call("marketPublish", ctx, {
      projectId: proj.id, componentId: lib.result.component.id, category: "buttons",
    });
    assert.equal(pub.ok, true);

    // A second user browses the shared marketplace.
    const browse = await call("marketBrowse", ctxB, {});
    assert.equal(browse.ok, true);
    assert.equal(browse.result.count, 1);
    assert.ok(browse.result.categories.includes("buttons"));

    // ...and installs into their own project.
    const projB = (await call("projectCreate", ctxB, { name: "B App" })).result.project;
    const install = await call("marketInstall", ctxB, {
      projectId: projB.id, listingId: browse.result.listings[0].id,
    });
    assert.equal(install.ok, true);
    assert.equal(install.result.library.length, 1);
    assert.equal(install.result.component.fromMarketplace, browse.result.listings[0].id);

    // Install count increments.
    const browse2 = await call("marketBrowse", ctxB, {});
    assert.equal(browse2.result.listings[0].installs, 1);
  });

  it("only the publisher can unpublish a listing", async () => {
    const proj = await freshProject();
    const lib = await call("librarySave", ctx, {
      projectId: proj.id, component: { name: "Card", baseType: "card" },
    });
    const pub = await call("marketPublish", ctx, {
      projectId: proj.id, componentId: lib.result.component.id,
    });
    const wrongUser = await call("marketUnpublish", ctxB, { listingId: pub.result.listing.id });
    assert.equal(wrongUser.ok, false);
    assert.equal(wrongUser.error, "not_publisher");

    const owner = await call("marketUnpublish", ctx, { listingId: pub.result.listing.id });
    assert.equal(owner.ok, true);
  });

  it("category filter narrows the browse result", async () => {
    const proj = await freshProject();
    for (const [name, cat] of [["A", "forms"], ["B", "charts"]]) {
      const lib = await call("librarySave", ctx, { projectId: proj.id, component: { name, baseType: "container" } });
      await call("marketPublish", ctx, { projectId: proj.id, componentId: lib.result.component.id, category: cat });
    }
    const all = await call("marketBrowse", ctx, {});
    assert.equal(all.result.count, 2);
    const forms = await call("marketBrowse", ctx, { category: "forms" });
    assert.equal(forms.result.count, 1);
  });
});
