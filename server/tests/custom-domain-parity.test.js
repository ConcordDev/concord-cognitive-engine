// Contract tests for server/domains/custom.js — pure-compute schema/template
// macros plus the no-code lens-builder substrate (canvas, palette, bindings,
// preview, publish, import/export, wiring). Per-user state lives on
// globalThis._concordSTATE.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCustomActions from "../domains/custom.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`custom.${name}`);
  if (!fn) throw new Error(`custom.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerCustomActions(register); });

beforeEach(() => {
  // isolate per-test builder state
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("custom — pure-compute macros", () => {
  it("evaluateSchema reports field validity", () => {
    const r = call("evaluateSchema", ctxA, { data: { schema: [
      { name: "title", type: "string", required: true },
      { name: "score", type: "number" },
    ] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFields, 2);
    assert.equal(r.result.requiredCount, 1);
    assert.equal(r.result.schemaValid, true);
  });

  it("templateRender substitutes {{vars}} and flags missing", () => {
    const r = call("templateRender", ctxA, { data: {
      template: "Hi {{name}}, you have {{count}} items",
      variables: { name: "Ada" },
    } }, {});
    assert.equal(r.ok, true);
    assert.match(r.result.rendered, /Hi Ada/);
    assert.deepEqual(r.result.variablesMissing, ["count"]);
    assert.equal(r.result.complete, false);
  });

  it("validateData applies rules", () => {
    const r = call("validateData", ctxA, { data: {
      values: { name: "" },
      validationRules: [{ field: "name", required: true }],
    } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.failed, 1);
    assert.equal(r.result.valid, false);
  });

  it("transformData runs operations", () => {
    const r = call("transformData", ctxA, { data: {
      input: { name: " ada " },
      transforms: [{ field: "name", operation: "trim" }, { field: "name", operation: "uppercase" }],
    } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.output.name, "ADA");
    assert.equal(r.result.transformsApplied, 2);
  });
});

describe("custom — component palette", () => {
  it("palette returns prebuilt widget types", () => {
    const r = call("palette", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 5);
    const types = r.result.components.map((c) => c.type);
    for (const t of ["table", "chart", "form", "button"]) assert.ok(types.includes(t));
  });
});

describe("custom — visual widget canvas", () => {
  it("create / list / get / save / delete round-trip", () => {
    const created = call("canvasCreate", ctxA, { name: "Ops Board" });
    assert.equal(created.ok, true);
    const cid = created.result.canvas.id;

    const listed = call("canvasList", ctxA, {});
    assert.equal(listed.result.count, 1);

    const saved = call("canvasSave", ctxA, { canvasId: cid, widgets: [
      { type: "table", x: 0, y: 0, w: 6, h: 4 },
      { type: "chart", x: 6, y: 0, w: 6, h: 4, props: { chartKind: "line" } },
    ] });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.canvas.widgets.length, 2);
    assert.equal(saved.result.canvas.widgets[1].props.chartKind, "line");

    const got = call("canvasGet", ctxA, { canvasId: cid });
    assert.equal(got.result.canvas.widgets.length, 2);

    const del = call("canvasDelete", ctxA, { canvasId: cid });
    assert.equal(del.result.deleted, true);
    assert.equal(call("canvasList", ctxA, {}).result.count, 0);
  });

  it("canvasCreate rejects empty name", () => {
    const r = call("canvasCreate", ctxA, { name: "  " });
    assert.equal(r.ok, false);
  });

  it("canvasSave rejects unknown widget type", () => {
    const cid = call("canvasCreate", ctxA, { name: "X" }).result.canvas.id;
    const r = call("canvasSave", ctxA, { canvasId: cid, widgets: [{ type: "bogus" }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown widget type/);
  });

  it("canvases are per-user isolated", () => {
    call("canvasCreate", ctxA, { name: "A board" });
    assert.equal(call("canvasList", ctxA, {}).result.count, 1);
    assert.equal(call("canvasList", ctxB, {}).result.count, 0);
  });
});

describe("custom — data-source bindings", () => {
  it("creates a macro binding", () => {
    const r = call("bindingCreate", ctxA, { kind: "macro", name: "Weather feed", domain: "weather", macro: "forecast" });
    assert.equal(r.ok, true);
    assert.equal(r.result.binding.kind, "macro");
    assert.equal(call("bindingList", ctxA, {}).result.count, 1);
  });

  it("rejects rest binding with invalid url", () => {
    const r = call("bindingCreate", ctxA, { kind: "rest", name: "Bad", url: "not-a-url" });
    assert.equal(r.ok, false);
  });

  it("bindingTest for a macro binding reports run-time resolution", async () => {
    const b = call("bindingCreate", ctxA, { kind: "macro", name: "M", domain: "d", macro: "m" }).result.binding;
    const r = await call("bindingTest", ctxA, { bindingId: b.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tested, false);
  });

  it("bindingTest probes a rest binding and shapes the response", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([{ id: 1, name: "x" }, { id: 2, name: "y" }]) });
    const b = call("bindingCreate", ctxA, { kind: "rest", name: "R", url: "https://example.com/d.json" }).result.binding;
    const r = await call("bindingTest", ctxA, { bindingId: b.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tested, true);
    assert.equal(r.result.rowCount, 2);
    assert.deepEqual(r.result.fields, ["id", "name"]);
  });

  it("bindingDelete removes a binding", () => {
    const b = call("bindingCreate", ctxA, { kind: "macro", name: "M", domain: "d", macro: "m" }).result.binding;
    const r = call("bindingDelete", ctxA, { bindingId: b.id });
    assert.equal(r.result.deleted, true);
  });
});

describe("custom — live preview", () => {
  it("renders a draft and flags unbound binding-required widgets", () => {
    const r = call("previewRender", ctxA, { draft: { widgets: [
      { type: "table", id: "w1" },
      { type: "text", id: "w2" },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.widgetCount, 2);
    // table binds → unbound issue; text doesn't bind → renderable
    assert.ok(r.result.issues.some((i) => /no data source bound/.test(i)));
    assert.equal(r.result.renderableCount, 1);
  });

  it("renders a saved canvas with a bound widget cleanly", () => {
    const cid = call("canvasCreate", ctxA, { name: "C" }).result.canvas.id;
    const b = call("bindingCreate", ctxA, { kind: "macro", name: "B", domain: "d", macro: "m" }).result.binding;
    call("canvasSave", ctxA, { canvasId: cid, widgets: [{ type: "table", bindingId: b.id }] });
    const r = call("previewRender", ctxA, { canvasId: cid });
    assert.equal(r.ok, true);
    assert.equal(r.result.renderableCount, 1);
    assert.equal(r.result.issues.length, 0);
  });
});

describe("custom — publish to navigation", () => {
  it("publish / publishedList / unpublish round-trip", () => {
    const cid = call("canvasCreate", ctxA, { name: "Dash" }).result.canvas.id;
    call("canvasSave", ctxA, { canvasId: cid, widgets: [{ type: "metric" }] });
    const pub = call("publish", ctxA, { canvasId: cid, navLabel: "My Dash" });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.published.navLabel, "My Dash");

    const list = call("publishedList", ctxA, {});
    assert.equal(list.result.count, 1);

    const un = call("unpublish", ctxA, { canvasId: cid });
    assert.equal(un.result.unpublished, true);
    assert.equal(call("publishedList", ctxA, {}).result.count, 0);
  });

  it("refuses to publish an empty canvas", () => {
    const cid = call("canvasCreate", ctxA, { name: "Empty" }).result.canvas.id;
    const r = call("publish", ctxA, { canvasId: cid });
    assert.equal(r.ok, false);
    assert.match(r.error, /empty canvas/);
  });
});

describe("custom — import / export", () => {
  it("exportCanvas produces a v1 definition with referenced bindings", () => {
    const cid = call("canvasCreate", ctxA, { name: "Export Me" }).result.canvas.id;
    const b = call("bindingCreate", ctxA, { kind: "macro", name: "B", domain: "d", macro: "m" }).result.binding;
    call("canvasSave", ctxA, { canvasId: cid, widgets: [{ type: "chart", bindingId: b.id }] });
    const r = call("exportCanvas", ctxA, { canvasId: cid });
    assert.equal(r.ok, true);
    assert.equal(r.result.definition.spec, "concord-custom-lens/v1");
    assert.equal(r.result.definition.bindings.length, 1);
    assert.match(r.result.filename, /\.concord-lens\.json$/);
  });

  it("importCanvas re-keys bindings and creates a new canvas", () => {
    const cid = call("canvasCreate", ctxA, { name: "Src" }).result.canvas.id;
    const b = call("bindingCreate", ctxA, { kind: "macro", name: "B", domain: "d", macro: "m" }).result.binding;
    call("canvasSave", ctxA, { canvasId: cid, widgets: [{ type: "chart", bindingId: b.id }] });
    const def = call("exportCanvas", ctxA, { canvasId: cid }).result.definition;

    const imp = call("importCanvas", ctxB, { definition: def });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.importedWidgets, 1);
    assert.equal(imp.result.importedBindings, 1);
    assert.equal(call("canvasList", ctxB, {}).result.count, 1);
  });

  it("importCanvas rejects an unrecognized spec", () => {
    const r = call("importCanvas", ctxA, { definition: { spec: "other/v9", canvas: {} } });
    assert.equal(r.ok, false);
  });
});

describe("custom — event/action wiring", () => {
  it("create / list / delete a wiring", () => {
    const cid = call("canvasCreate", ctxA, { name: "Wired" }).result.canvas.id;
    const saved = call("canvasSave", ctxA, { canvasId: cid, widgets: [
      { type: "button", id: "btn1" }, { type: "table", id: "tbl1" },
    ] }).result.canvas;
    const btnId = saved.widgets.find((w) => w.type === "button").id;

    const wr = call("wiringCreate", ctxA, {
      canvasId: cid, sourceWidgetId: btnId, event: "click",
      action: { kind: "macro", domain: "weather", macro: "refresh" },
      refreshWidgetId: saved.widgets.find((w) => w.type === "table").id,
    });
    assert.equal(wr.ok, true);
    assert.equal(wr.result.wiring.action.macro, "refresh");

    const list = call("wiringList", ctxA, { canvasId: cid });
    assert.equal(list.result.count, 1);

    const del = call("wiringDelete", ctxA, { wiringId: wr.result.wiring.id });
    assert.equal(del.result.deleted, true);
  });

  it("wiringCreate rejects a macro action missing domain/macro", () => {
    const cid = call("canvasCreate", ctxA, { name: "W" }).result.canvas.id;
    const r = call("wiringCreate", ctxA, {
      canvasId: cid, sourceWidgetId: "btn", action: { kind: "macro" },
    });
    assert.equal(r.ok, false);
  });

  it("wiringCreate requires canvasId and sourceWidgetId", () => {
    assert.equal(call("wiringCreate", ctxA, { sourceWidgetId: "x" }).ok, false);
    assert.equal(call("wiringCreate", ctxA, { canvasId: "c" }).ok, false);
  });
});
