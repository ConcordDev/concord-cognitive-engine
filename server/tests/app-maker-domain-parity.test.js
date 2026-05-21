// Contract tests for server/domains/appmaker.js — the no-code builder
// substrate: visual editor, data-model designer, workflow builder, live
// preview, deploy, component library, connectors and version history.

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
  // Isolate per-test STATE so projects don't leak between cases.
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctx = { actor: { userId: "user_appmaker" }, userId: "user_appmaker" };

async function freshProject() {
  const r = await call("projectCreate", ctx, { name: "Test App" });
  assert.equal(r.ok, true);
  return r.result.project;
}

describe("app-maker — project lifecycle", () => {
  it("creates, lists, gets, duplicates and deletes a project", async () => {
    const proj = await freshProject();
    assert.ok(proj.id);
    assert.equal(proj.name, "Test App");
    assert.equal(proj.pages.length, 1);

    const list = await call("projectList", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const got = await call("projectGet", ctx, { projectId: proj.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.project.id, proj.id);

    const dup = await call("projectDuplicate", ctx, { projectId: proj.id });
    assert.equal(dup.ok, true);
    assert.match(dup.result.project.name, /copy/);

    const del = await call("projectDelete", ctx, { projectId: dup.result.project.id });
    assert.equal(del.ok, true);
  });

  it("returns ok:false for unknown projectId", async () => {
    const r = await call("projectGet", ctx, { projectId: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("app-maker — visual editor", () => {
  it("exposes an element palette", async () => {
    const r = await call("editorPalette", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.palette) && r.result.palette.length > 0);
  });

  it("adds a page, saves a layout and deletes a page", async () => {
    const proj = await freshProject();
    const added = await call("editorAddPage", ctx, { projectId: proj.id, name: "About" });
    assert.equal(added.ok, true);
    assert.equal(added.result.pages.length, 2);

    const saved = await call("editorSavePage", ctx, {
      projectId: proj.id, pageId: proj.pages[0].id,
      elements: [{ type: "button", x: 10, y: 10, w: 120, h: 40, props: { label: "Go" } }],
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.elementCount, 1);

    const removed = await call("editorDeletePage", ctx, { projectId: proj.id, pageId: added.result.page.id });
    assert.equal(removed.ok, true);
    assert.equal(removed.result.pages.length, 1);
  });
});

describe("app-maker — data-model designer", () => {
  it("lists field types and builds tables + relations", async () => {
    const ft = await call("dataFieldTypes", ctx, {});
    assert.equal(ft.ok, true);
    assert.ok(ft.result.fieldTypes.includes("text"));

    const proj = await freshProject();
    const t1 = await call("dataAddTable", ctx, { projectId: proj.id, name: "Users" });
    const t2 = await call("dataAddTable", ctx, { projectId: proj.id, name: "Orders" });
    assert.equal(t1.ok, true);
    assert.equal(t2.ok, true);

    const saved = await call("dataSaveTable", ctx, {
      projectId: proj.id, tableId: t1.result.table.id,
      fields: [{ name: "id", type: "text", primary: true, required: true }, { name: "email", type: "email", required: true }],
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.table.fields.length, 2);

    const rel = await call("dataAddRelation", ctx, {
      projectId: proj.id, fromTable: t1.result.table.id, toTable: t2.result.table.id, kind: "one-to-many",
    });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.relation.kind, "one-to-many");

    const delRel = await call("dataDeleteRelation", ctx, { projectId: proj.id, relationId: rel.result.relation.id });
    assert.equal(delRel.ok, true);

    const delTbl = await call("dataDeleteTable", ctx, { projectId: proj.id, tableId: t2.result.table.id });
    assert.equal(delTbl.ok, true);
  });
});

describe("app-maker — workflow builder", () => {
  it("lists trigger/action vocab and saves a workflow", async () => {
    const opts = await call("workflowOptions", ctx, {});
    assert.equal(opts.ok, true);
    assert.ok(opts.result.triggers.length > 0 && opts.result.actions.length > 0);

    const proj = await freshProject();
    const saved = await call("workflowSave", ctx, {
      projectId: proj.id,
      workflow: { name: "Submit form", trigger: "form_submit", steps: [{ action: "create_row", target: "Users" }] },
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.workflow.steps.length, 1);

    const del = await call("workflowDelete", ctx, { projectId: proj.id, workflowId: saved.result.workflow.id });
    assert.equal(del.ok, true);
  });
});

describe("app-maker — live preview", () => {
  it("renders a self-contained HTML document for an iframe", async () => {
    const proj = await freshProject();
    await call("editorSavePage", ctx, {
      projectId: proj.id, pageId: proj.pages[0].id,
      elements: [{ type: "heading", x: 0, y: 0, w: 200, h: 40, props: { label: "Welcome" } }],
    });
    const r = await call("previewRender", ctx, { projectId: proj.id });
    assert.equal(r.ok, true);
    assert.match(r.result.html, /<!doctype html>/i);
    assert.match(r.result.html, /Welcome/);
  });
});

describe("app-maker — deploy", () => {
  it("publishes to a hosted URL and reports status", async () => {
    const proj = await freshProject();
    const pub = await call("deployPublish", ctx, { projectId: proj.id });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.deployment.status, "live");
    assert.match(pub.result.deployment.url, /^https:\/\/.*apps\.concord-os\.org$/);

    const status = await call("deployStatus", ctx, { projectId: proj.id });
    assert.equal(status.ok, true);
    assert.equal(status.result.deployment.status, "live");
  });
});

describe("app-maker — component library", () => {
  it("saves, lists and deletes reusable components", async () => {
    const proj = await freshProject();
    const saved = await call("librarySave", ctx, {
      projectId: proj.id,
      component: { name: "Primary Card", baseType: "card", style: { background: "#123456" } },
    });
    assert.equal(saved.ok, true);

    const list = await call("libraryList", ctx, { projectId: proj.id });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const del = await call("libraryDelete", ctx, { projectId: proj.id, componentId: saved.result.component.id });
    assert.equal(del.ok, true);
  });
});

describe("app-maker — connectors", () => {
  it("lists kinds, saves, tests and deletes a connector", async () => {
    const kinds = await call("connectorKinds", ctx, {});
    assert.equal(kinds.ok, true);
    assert.ok(kinds.result.kinds.some((k) => k.kind === "rest"));

    const proj = await freshProject();
    const saved = await call("connectorSave", ctx, {
      projectId: proj.id,
      connector: { name: "My API", kind: "rest", endpoint: "https://example.com/api", method: "GET", authMode: "none" },
    });
    assert.equal(saved.ok, true);

    // network is disabled in tests — connectorTest must still resolve ok:true
    const tested = await call("connectorTest", ctx, { projectId: proj.id, connectorId: saved.result.connector.id });
    assert.equal(tested.ok, true);
    assert.ok("reachable" in tested.result);

    const del = await call("connectorDelete", ctx, { projectId: proj.id, connectorId: saved.result.connector.id });
    assert.equal(del.ok, true);
  });

  it("rejects an unknown connector kind", async () => {
    const proj = await freshProject();
    const r = await call("connectorSave", ctx, { projectId: proj.id, connector: { name: "X", kind: "smoke-signal" } });
    assert.equal(r.ok, false);
  });
});

describe("app-maker — version history", () => {
  it("snapshots, lists and restores versions", async () => {
    const proj = await freshProject();
    const snap = await call("versionSnapshot", ctx, { projectId: proj.id, label: "v1" });
    assert.equal(snap.ok, true);

    const list = await call("versionList", ctx, { projectId: proj.id });
    assert.equal(list.ok, true);
    assert.ok(list.result.count >= 1);

    const restore = await call("versionRestore", ctx, { projectId: proj.id, versionId: snap.result.version.id });
    assert.equal(restore.ok, true);
    assert.ok(restore.result.project);
  });
});

describe("app-maker — legacy analyzer macros still parity", () => {
  it("scaffoldApp / uiComplexity / wireframeValidate return ok", async () => {
    const scaffold = ACTIONS.get("app-maker.scaffoldApp")(ctx, { data: { spec: { pages: [{ name: "Home", components: [{ type: "Button" }] }] } } }, {});
    assert.equal(scaffold.ok, true);
    const complexity = ACTIONS.get("app-maker.uiComplexity")(ctx, { data: { screens: [{ name: "S", widgets: [{ type: "button" }] }] } }, {});
    assert.equal(complexity.ok, true);
    const wireframe = ACTIONS.get("app-maker.wireframeValidate")(ctx, { data: { wireframe: { screens: [{ name: "A", links: [] }] } } }, {});
    assert.equal(wireframe.ok, true);
  });
});
