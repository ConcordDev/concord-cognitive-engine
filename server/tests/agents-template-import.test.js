// FIX-agents-013 (server leg): template import must be reversible.
// importTemplate bumps the caller's per-user install count; the new
// uninstallTemplate drops it back down (floor 0), scoped to the caller,
// so an import can be undone whole. Unknown templates error honestly.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const registerAgentsActions = (await import("../domains/agents.js")).default;

const actions = new Map();
registerAgentsActions((domain, name, fn) => actions.set(name, fn));
const call = (name, userId, params = {}) =>
  actions.get(name)({ actor: { userId } }, null, params);

describe("agents template import / uninstall (FIX-agents-013)", () => {
  before(() => {
    globalThis._concordSTATE = { agentsLens: {} };
  });

  it("import bumps only the caller's install count", async () => {
    const r = await call("importTemplate", "user-a", { templateId: "tpl_ops_monitor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.template.installs, 1);
    assert.equal(r.result.agentDefinition.importedFrom, "tpl_ops_monitor");
    const list = await call("listTemplates", "user-b");
    const tpl = list.result.templates.find((t) => t.id === "tpl_ops_monitor");
    assert.equal(tpl.installs, 0);
  });

  it("import honors a caller-chosen name for the created agent", async () => {
    const r = await call("importTemplate", "user-a", { templateId: "tpl_ops_monitor", name: "Night Watch" });
    assert.equal(r.ok, true);
    assert.equal(r.result.agentDefinition.name, "Night Watch");
    assert.equal(r.result.template.installs, 2);
  });

  it("uninstall reverses the count, floored at zero", async () => {
    let r = await call("uninstallTemplate", "user-a", { templateId: "tpl_ops_monitor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.template.installs, 1);
    r = await call("uninstallTemplate", "user-a", { templateId: "tpl_ops_monitor" });
    assert.equal(r.result.template.installs, 0);
    r = await call("uninstallTemplate", "user-a", { templateId: "tpl_ops_monitor" });
    assert.equal(r.ok, true);
    assert.equal(r.result.template.installs, 0);
  });

  it("uninstall does not touch another user's count and errors on unknown templates", async () => {
    await call("importTemplate", "user-b", { templateId: "tpl_ops_monitor" });
    const r = await call("uninstallTemplate", "user-a", { templateId: "tpl_ops_monitor" });
    assert.equal(r.result.template.installs, 0);
    const list = await call("listTemplates", "user-b");
    assert.equal(list.result.templates.find((t) => t.id === "tpl_ops_monitor").installs, 1);
    const bad = await call("uninstallTemplate", "user-a", { templateId: "tpl_nope" });
    assert.equal(bad.ok, false);
  });
});
