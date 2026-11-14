// FIX-app-maker-001 S1 — previewRender surfaces element data bindings.
// Pins: a bound element's caption resolves LIVE from the project (table name
// + field names; connector name + kind/method); a binding whose source was
// removed names itself removed; unbound elements render exactly as before;
// user strings in the caption are escaped. Harness mirrors
// appmaker-lens-macros.test.js (3-arg dispatch, per-test STATE isolation).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAppmakerActions from "../domains/appmaker.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "app-maker");
  ACTIONS.set(name, fn);
}
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`app-maker.${name} not registered`);
  const virtualArtifact = { id: null, domain: "app-maker", type: "domain_action", data: input || {}, meta: {} };
  return await fn(ctx, virtualArtifact, input || {});
}
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

before(() => { registerAppmakerActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

async function projectWithElement(el) {
  const p = await call("projectCreate", ctxA, { name: "Caption App" });
  assert.equal(p.ok, true);
  const proj = p.result.project;
  const page = proj.pages[0];
  const s = await call("editorSavePage", ctxA, { projectId: proj.id, pageId: page.id, elements: [el] });
  assert.equal(s.ok, true);
  return { proj, page };
}
const listEl = { id: "el1", type: "list", x: 10, y: 10, w: 220, h: 80, props: { label: "People" } };

describe("app-maker previewRender binding captions (FIX-app-maker-001 S1)", () => {
  it("a table-bound element renders a caption with the table name and field names", async () => {
    const { proj, page } = await projectWithElement(listEl);
    const t = await call("dataAddTable", ctxA, { projectId: proj.id, name: "Customers" });
    assert.equal(t.ok, true);
    const tableId = t.result.table.id;
    const sv = await call("dataSaveTable", ctxA, {
      projectId: proj.id, tableId,
      fields: [{ name: "id", type: "text" }, { name: "email", type: "text" }, { name: "plan", type: "text" }],
    });
    assert.equal(sv.ok, true);
    const b = await call("dataBindElement", ctxA, { projectId: proj.id, pageId: page.id, elementId: "el1", source: { kind: "table", refId: tableId } });
    assert.equal(b.ok, true);
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.html.includes('data-binding-caption="1"'), "caption marker present");
    assert.ok(r.result.html.includes("Data: Customers — id, email, plan"), "caption carries name + fields");
  });

  it("a connector-bound element renders a caption with the connector name, kind and method", async () => {
    const { proj, page } = await projectWithElement({ id: "el2", type: "text", x: 0, y: 0, w: 200, h: 30, props: { text: "Feed" } });
    // Public IP literal: assessPublicUrl validates it without DNS, so the
    // pin does not depend on the runner's resolver.
    const c = await call("connectorSave", ctxA, {
      projectId: proj.id,
      connector: { name: "API", kind: "rest", endpoint: "https://93.184.216.34/api", method: "GET" },
    });
    assert.equal(c.ok, true);
    const b = await call("dataBindElement", ctxA, { projectId: proj.id, pageId: page.id, elementId: "el2", source: { kind: "connector", refId: c.result.connector.id } });
    assert.equal(b.ok, true);
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    assert.ok(r.result.html.includes("Data: API — rest · GET"), "caption carries connector identity");
  });

  it("a binding whose source was removed names itself removed", async () => {
    const { proj, page } = await projectWithElement(listEl);
    const t = await call("dataAddTable", ctxA, { projectId: proj.id, name: "Gone" });
    const tableId = t.result.table.id;
    await call("dataBindElement", ctxA, { projectId: proj.id, pageId: page.id, elementId: "el1", source: { kind: "table", refId: tableId } });
    const d = await call("dataDeleteTable", ctxA, { projectId: proj.id, tableId });
    assert.equal(d.ok, true);
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    assert.ok(r.result.html.includes("Data: Gone — source removed"), "stale binding speaks");
  });

  it("an unbound element renders with no caption and unchanged markup", async () => {
    const { proj } = await projectWithElement({ id: "el3", type: "button", x: 5, y: 5, w: 120, h: 40, props: { label: "Go" } });
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    assert.equal(r.ok, true);
    assert.ok(!r.result.html.includes("data-binding-caption"), "no caption for unbound elements");
    assert.ok(r.result.html.includes(">Go</button>"), "button markup unchanged");
  });

  it("a hostile table name is escaped in the caption", async () => {
    const { proj, page } = await projectWithElement(listEl);
    const t = await call("dataAddTable", ctxA, { projectId: proj.id, name: "Evil<script>alert(1)</script>" });
    assert.equal(t.ok, true);
    await call("dataBindElement", ctxA, { projectId: proj.id, pageId: page.id, elementId: "el1", source: { kind: "table", refId: t.result.table.id } });
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    assert.ok(r.result.html.includes('data-binding-caption="1"'), "caption present");
    assert.ok(!r.result.html.includes("<script>alert(1)</script>"), "no raw script in the document");
    assert.ok(r.result.html.includes("&lt;script&gt;"), "name rendered escaped");
  });
});
