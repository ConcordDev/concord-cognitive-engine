// Behaviour tests for Projects key uniqueness (Review 4, projects.md
// F13, slice S10): a second project could be created with the
// identical name AND the identical key "PR4", silently breaking the
// thing a key is for — issue refs like PR4-1 resolving to exactly one
// project. Now an explicitly requested key that is taken is rejected
// by name with the next free key suggested and nothing created; an
// auto-derived key uniquifies silently; a duplicate name is refused
// unless the caller explicitly confirms it (the create dialog's
// "Create anyway"), and keys are scoped per account.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerProjectsActions from "../domains/projects.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`projects.${name}`);
  assert.ok(fn, `projects.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerProjectsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const listKeys = (ctx) => call("project-list", ctx, { includeArchived: true }).result.projects.map((p) => p.key);

describe("projects keys — uniqueness (F13)", () => {
  it("rejects a second project with a taken key, naming the holder and a free suggestion; the original is untouched", () => {
    const first = call("project-create", ctxA, { name: "PR4 Projects Review", key: "PR4" });
    assert.equal(first.ok, true);
    const t = call("task-create", ctxA, { projectId: first.result.project.id, title: "Issue one" }).result.task;
    assert.equal(t.ref, "PR4-1");

    const dupe = call("project-create", ctxA, { name: "Something else", key: "pr4" });
    assert.equal(dupe.ok, false);
    assert.equal(dupe.code, "duplicate_key");
    assert.match(dupe.error, /PR4 is already used by "PR4 Projects Review"/);
    assert.equal(dupe.suggestion, "PR42");
    assert.deepEqual(listKeys(ctxA), ["PR4"], "nothing was created");
    assert.equal(call("task-detail", ctxA, { id: t.id }).result.task.ref, "PR4-1",
      "the original project and its issues are untouched");
  });

  it("an auto-derived key uniquifies silently instead of colliding", () => {
    call("project-create", ctxA, { name: "Alpha", key: "ALPH" });
    const auto = call("project-create", ctxA, { name: "Alphabet" });
    assert.equal(auto.ok, true);
    assert.notEqual(auto.result.project.key, "ALPH");
    assert.deepEqual(listKeys(ctxA).sort(), ["ALPH", auto.result.project.key].sort());
  });

  it("a duplicate name needs explicit confirmation, then succeeds", () => {
    call("project-create", ctxA, { name: "Roadmap", key: "RD1" });
    const warn = call("project-create", ctxA, { name: "roadmap", key: "RD2" });
    assert.equal(warn.ok, false);
    assert.equal(warn.code, "duplicate_name");
    assert.deepEqual(listKeys(ctxA), ["RD1"], "the unconfirmed create stored nothing");
    const ok = call("project-create", ctxA, { name: "roadmap", key: "RD2", confirmDuplicateName: true });
    assert.equal(ok.ok, true);
    assert.deepEqual(listKeys(ctxA).sort(), ["RD1", "RD2"]);
  });

  it("keys are scoped per account — another user may hold the same key", () => {
    call("project-create", ctxA, { name: "Mine", key: "PR4" });
    const other = call("project-create", ctxB, { name: "Theirs", key: "PR4" });
    assert.equal(other.ok, true);
    assert.equal(other.result.project.key, "PR4");
  });
});
