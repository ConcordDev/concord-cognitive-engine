// Contract tests for the poetry lens — poem workspace substrate in
// server/domains/poetry.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPoetryActions from "../domains/poetry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`poetry.${name}`);
  assert.ok(fn, `poetry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPoetryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

const HAIKU = "An old silent pond\nA frog jumps into the pond\nSplash silence again";

describe("poetry.poem CRUD", () => {
  it("creates a poem scoped per user", () => {
    call("poem-create", ctxA, { title: "Pond", body: HAIKU, form: "haiku" });
    assert.equal(call("poem-list", ctxA, {}).result.count, 1);
    assert.equal(call("poem-list", ctxB, {}).result.count, 0);
  });
  it("rejects a titleless poem", () => {
    assert.equal(call("poem-create", ctxA, { body: "x" }).ok, false);
  });
  it("updates body + status and deletes", () => {
    const p = call("poem-create", ctxA, { title: "Draft", body: "one line" }).result.poem;
    call("poem-update", ctxA, { id: p.id, status: "finished", body: HAIKU });
    assert.equal(call("poem-detail", ctxA, { id: p.id }).result.poem.status, "finished");
    call("poem-delete", ctxA, { id: p.id });
    assert.equal(call("poem-list", ctxA, {}).result.count, 0);
  });
  it("filters poem-list by form", () => {
    call("poem-create", ctxA, { title: "H", body: HAIKU, form: "haiku" });
    call("poem-create", ctxA, { title: "S", body: "sonnet text", form: "sonnet" });
    assert.equal(call("poem-list", ctxA, { form: "haiku" }).result.count, 1);
  });
});

describe("poetry.poem-analyze", () => {
  it("analyzes meter + rhyme on a saved poem", () => {
    const p = call("poem-create", ctxA, { title: "Pond", body: HAIKU }).result.poem;
    const a = call("poem-analyze", ctxA, { id: p.id });
    assert.equal(a.ok, true);
    assert.equal(a.result.analysis.lineCount, 3);
    assert.equal(a.result.analysis.syllablesPerLine.length, 3);
    assert.ok(typeof a.result.analysis.rhymeScheme === "string");
  });
  it("rejects analysis on an unknown poem", () => {
    assert.equal(call("poem-analyze", ctxA, { id: "nope" }).ok, false);
  });
});

describe("poetry.dashboard", () => {
  it("aggregates poems, status counts and forms", () => {
    const p = call("poem-create", ctxA, { title: "A", body: HAIKU, form: "haiku" }).result.poem;
    call("poem-update", ctxA, { id: p.id, status: "finished" });
    call("poem-create", ctxA, { title: "B", body: "free text", form: "free-verse" });
    const d = call("poetry-dashboard", ctxA, {});
    assert.equal(d.result.poems, 2);
    assert.equal(d.result.finished, 1);
    assert.equal(d.result.byForm.haiku, 1);
  });
});

describe("poetry — analysis macros still intact", () => {
  it("formGuide returns a form guide", () => {
    const r = call("formGuide", ctxA, {});
    assert.equal(r.ok, true);
  });
});
