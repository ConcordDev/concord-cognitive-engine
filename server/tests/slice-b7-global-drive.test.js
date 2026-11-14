// Slice B7 drive — FIX-global-007 renameView (server/domains/global.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGlobalActions from "../domains/global.js";

const actions = new Map();
registerGlobalActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`global:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "global", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("FIX-global-007: renameView renames the caller's view only; empty/unknown refused", () => {
  const saved = call("saveView", { view: { mode: "profile", label: "Country Profile: ESP · NY.GDP.PCAP.CD", config: { country: "ESP" } } });
  assert.equal(saved.ok, true);
  const id = saved.result.saved.id;

  const renamed = call("renameView", { id, label: "Spain deep dive" });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.result.saved.label, "Spain deep dive");

  const list = call("listViews", {});
  assert.equal(list.result.views.find((v) => v.id === id).label, "Spain deep dive");

  // Another user cannot rename it.
  assert.equal(call("renameView", { id, label: "hijack" }, "u2").ok, false);
  // Empty name refused; unknown id refused.
  assert.equal(call("renameView", { id, label: "  " }).ok, false);
  assert.equal(call("renameView", { id: "gv_nope", label: "x" }).ok, false);
});
