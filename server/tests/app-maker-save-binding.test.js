// FIX-app-maker-001 — saving a canvas page must persist the WHOLE saved
// layout: editorSavePage's element mapping rebuilt each element from
// geometry+props only, silently stripping its data binding, so a saved
// canvas returned with every binding gone. Pin the round trip, plus the
// layout fields themselves.
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
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctx = { actor: { userId: "u1" }, userId: "u1" };

describe("FIX-app-maker-001 editorSavePage round trip", () => {
  it("saved layout + element bindings come back on projectGet", async () => {
    const proj = (await call("projectCreate", ctx, { name: "App" })).result.project;
    const pageId = proj.pages[0].id;
    const elements = [
      { id: "el_btn", type: "button", x: 24, y: 40, w: 160, h: 44, props: { label: "Test Button" } },
      { id: "el_tbl", type: "table", x: 24, y: 100, w: 320, h: 180, props: { label: "Leads" },
        binding: { kind: "table", refId: "tbl_leads", label: "Leads table", query: "status = open", boundAt: "2026-11-10T00:00:00.000Z" } },
    ];
    const saved = await call("editorSavePage", ctx, { projectId: proj.id, pageId, elements });
    assert.equal(saved.ok, true);
    const back = (await call("projectGet", ctx, { projectId: proj.id })).result.project;
    const els = back.pages[0].elements;
    assert.equal(els.length, 2);
    assert.equal(els[0].props.label, "Test Button");
    assert.deepEqual([els[0].x, els[0].y, els[0].w, els[0].h], [24, 40, 160, 44]);
    assert.ok(els[1].binding, "the saved binding must survive the save");
    assert.equal(els[1].binding.kind, "table");
    assert.equal(els[1].binding.refId, "tbl_leads");
    assert.equal(els[1].binding.query, "status = open");
  });
});
