import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMentorship from "../domains/mentorship.js";
import registerForge from "../domains/forge.js";
import registerLab from "../domains/lab.js";
import registerStudio from "../domains/studio.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function callAs(userId, domain, name, params) {
  const ctx = { actor: { userId }, userId };
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}
const call = (domain, name, params) => callAs("ada", domain, name, params);

before(() => {
  registerMentorship(register);
  registerForge(register);
  registerLab(register);
  registerStudio(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("list deletes", () => {
  it("deletes only the caller's mentorship goal", () => {
    const created = call("mentorship", "goal-create", { title: "Ship the brief" });
    assert.equal(created.ok, true);
    const id = created.result.goal.id;
    assert.equal(callAs("bea", "mentorship", "goal-delete", { id }).ok, false);
    assert.equal(call("mentorship", "goal-delete", { id }).ok, true);
    assert.equal(call("mentorship", "goal-list", {}).result.count, 0);
  });

  it("deletes only the caller's forge project", () => {
    const created = call("forge", "createProject", { appName: "Ada App" });
    assert.equal(created.ok, true);
    const id = created.result.projectId || created.result.project?.projectId;
    assert.ok(id);
    assert.equal(callAs("bea", "forge", "deleteProject", { projectId: id }).ok, false);
    assert.equal(call("forge", "deleteProject", { projectId: id }).ok, true);
    const left = call("forge", "listProjects", {});
    assert.equal(left.result.projects.some((p) => p.projectId === id), false);
  });

  it("deletes a draft notebook entry and keeps a signed one", () => {
    const draft = call("lab", "notebook-create", { title: "Throwaway" });
    assert.equal(draft.ok, true);
    const id = draft.result.entry.id;
    assert.equal(callAs("bea", "lab", "notebook-delete", { id }).ok, false);
    assert.equal(call("lab", "notebook-delete", { id }).ok, true);
    const signed = call("lab", "notebook-create", { title: "Signed page" });
    const sid = signed.result.entry.id;
    call("lab", "notebook-sign", { id: sid });
    const kept = call("lab", "notebook-delete", { id: sid });
    assert.equal(kept.ok, false);
    assert.match(kept.message, /stays on the record/);
  });

  it("deletes only the caller's studio project", () => {
    const created = call("studio", "project-create", { name: "Ada song" });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    assert.equal(callAs("bea", "studio", "project-delete", { id }).ok, false);
    assert.equal(call("studio", "project-delete", { id }).ok, true);
    assert.equal(call("studio", "project-list", {}).result.projects.some((p) => p.id === id), false);
  });
});
