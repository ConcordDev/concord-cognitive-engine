// Behaviour tests for the F17 companion slice (Platform Chrome II,
// lens-side half): the saved-DTU link lives ON THE PROJECT RECORD.
// Before this slice, ProjectsKeepMenu held the saved DTU id in view-local
// state — navigate away and back and the lens said "Save the project
// first" over a DTU that demonstrably persisted (projects.md F17 / §2b
// #80). Now project-note-dtu-save records savedDtuId + savedDtuAt on the
// caller's own project, and project-get reads it back, so the saved state
// survives any navigation. A non-owner can neither write nor read the
// link (pjProject resolves only the caller's own projects).

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

describe("projects F17 — saved-DTU link on the record", () => {
  it("note-save persists and project-get reads the link back", () => {
    const p = call("project-create", ctxA, { name: "Kept", key: "KPT" }).result.project;
    const before = call("project-get", ctxA, { id: p.id });
    assert.equal(before.result.project.savedDtuId, undefined, "no link before any save");

    const noted = call("project-note-dtu-save", ctxA, { id: p.id, dtuId: "dtu_51175dcef0702fdfc900" });
    assert.equal(noted.ok, true);
    assert.equal(noted.result.savedDtuId, "dtu_51175dcef0702fdfc900");
    assert.ok(noted.result.savedDtuAt, "the save is timestamped");

    const after = call("project-get", ctxA, { id: p.id });
    assert.equal(after.result.project.savedDtuId, "dtu_51175dcef0702fdfc900");
    assert.equal(after.result.project.savedDtuAt, noted.result.savedDtuAt);
  });

  it("a later save replaces the link (the record names the latest DTU)", () => {
    const p = call("project-create", ctxA, { name: "Kept twice", key: "KP2" }).result.project;
    call("project-note-dtu-save", ctxA, { id: p.id, dtuId: "dtu_first" });
    call("project-note-dtu-save", ctxA, { id: p.id, dtuId: "dtu_second" });
    assert.equal(call("project-get", ctxA, { id: p.id }).result.project.savedDtuId, "dtu_second");
  });

  it("a non-owner can neither note-save nor read another's link", () => {
    const p = call("project-create", ctxA, { name: "Mine", key: "MIN" }).result.project;
    call("project-note-dtu-save", ctxA, { id: p.id, dtuId: "dtu_mine" });
    const foreignWrite = call("project-note-dtu-save", ctxB, { id: p.id, dtuId: "dtu_forged" });
    assert.equal(foreignWrite.ok, false, "non-owner write refused");
    const foreignRead = call("project-get", ctxB, { id: p.id });
    assert.equal(foreignRead.ok, false, "non-owner read refused — the link never leaks");
    assert.equal(call("project-get", ctxA, { id: p.id }).result.project.savedDtuId, "dtu_mine", "the owner's link is untouched");
  });

  it("an empty dtuId is refused and leaves the record unlinked", () => {
    const p = call("project-create", ctxA, { name: "Unkept", key: "UNK" }).result.project;
    assert.equal(call("project-note-dtu-save", ctxA, { id: p.id, dtuId: "" }).ok, false);
    assert.equal(call("project-note-dtu-save", ctxA, { id: p.id }).ok, false);
    assert.equal(call("project-get", ctxA, { id: p.id }).result.project.savedDtuId, undefined);
  });
});
