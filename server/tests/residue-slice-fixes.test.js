// Residue slice pins (B6, CB-0568):
//  - FIX-daily-005: the Daily computed-fields rule counts the entry's actual
//    text fields (notes/body/workedOn/learned/goals), not only `content` —
//    notes-carrying entries exported with wordCount 0.
//  - FIX-metacognition-001: reflections are editable and deletable by their
//    owner — reflectionSave with an id updates in place (createdAt and the
//    streak untouched), reflectionDelete removes only the caller's own.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import registerMetacognitionActions from "../domains/metacognition.js";

describe("FIX-daily-005 daily wordCount", () => {
  const rule = EXTENDED_DOMAIN_RULES.get("daily");
  it("counts a notes-carrying Today entry instead of leaving wordCount 0", () => {
    const out = rule.computedFields("journal", {
      title: "Today",
      notes: "shipped the export fix",
      workedOn: "residue slice",
      learned: "word counts matter",
      goals: "finish pins",
    });
    assert.equal(out.wordCount, 11);
  });
  it("counts a body-carrying journal entry", () => {
    const out = rule.computedFields("journal", { title: "J", body: "one two three" });
    assert.equal(out.wordCount, 3);
  });
  it("keeps counting content entries as before", () => {
    const out = rule.computedFields("journal", { title: "J", content: "alpha beta" });
    assert.equal(out.wordCount, 2);
  });
  it("an entry with no text fields counts 0", () => {
    const out = rule.computedFields("journal", { title: "J" });
    assert.equal(out.wordCount, 0);
  });
});

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`metacognition.${name}`);
  if (!fn) throw new Error(`metacognition.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("FIX-metacognition-001 reflection edit + delete", () => {
  before(() => { registerMetacognitionActions(register); });
  beforeEach(() => { globalThis._concordSTATE = {}; });

  it("reflectionSave with an id updates the caller's own reflection in place", () => {
    const saved = call("reflectionSave", ctxA, {
      title: "First take",
      answers: [{ question: "What happened?", answer: "It went well" }],
    });
    assert.equal(saved.ok, true);
    const id = saved.result.reflection.id;
    const createdAt = saved.result.reflection.createdAt;

    const updated = call("reflectionSave", ctxA, {
      id,
      title: "Second take",
      answers: [{ question: "What happened?", answer: "It went sideways" }],
      note: "revised",
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.updated, true);
    assert.equal(updated.result.reflection.id, id);
    assert.equal(updated.result.reflection.createdAt, createdAt);
    assert.equal(updated.result.reflection.title, "Second take");
    assert.equal(updated.result.reflection.answers[0].answer, "It went sideways");
    assert.ok(updated.result.reflection.editedAt);

    const list = call("reflectionList", ctxA, {});
    assert.equal(list.result.total, 1);
  });

  it("updating another user's reflection reads as not found", () => {
    const saved = call("reflectionSave", ctxA, { note: "mine" });
    const id = saved.result.reflection.id;
    const r = call("reflectionSave", ctxB, { id, note: "hijacked" });
    assert.equal(r.ok, false);
    const list = call("reflectionList", ctxA, {});
    assert.equal(list.result.reflections[0].note, "mine");
  });

  it("reflectionDelete removes only the caller's own reflection", () => {
    const saved = call("reflectionSave", ctxA, { note: "to delete" });
    const id = saved.result.reflection.id;
    const foreign = call("reflectionDelete", ctxB, { id });
    assert.equal(foreign.ok, false);
    const own = call("reflectionDelete", ctxA, { id });
    assert.equal(own.ok, true);
    assert.equal(own.result.removed, id);
    const list = call("reflectionList", ctxA, {});
    assert.equal(list.result.total, 0);
  });

  it("reflectionDelete of an unknown id refuses in words", () => {
    const r = call("reflectionDelete", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});
