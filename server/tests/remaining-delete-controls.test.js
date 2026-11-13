// Deletes the remaining desks were missing: education decks and exercises,
// legal matters/cases/events/templates, disputes withdraw, paper collections,
// and mental-health mood and gratitude entries.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEducation from "../domains/education.js";
import registerLegal from "../domains/legal.js";
import registerDisputes from "../domains/disputes.js";
import registerPaper from "../domains/paper.js";
import registerMental from "../domains/mentalhealth.js";
import registerClassroom from "../domains/classroom.js";
import registerQuest from "../domains/questmarket.js";
import registerMove from "../domains/move-builder.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
const ctx = { actor: { userId: "owner" }, userId: "owner" };

before(() => {
  registerEducation(register);
  registerLegal(register);
  registerDisputes(register);
  registerPaper(register);
  registerMental(register);
  registerClassroom(register);
  registerQuest(register);
  registerMove(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("remaining missing deletes", () => {
  it("deletes an education deck and its cards, and an exercise", () => {
    const deck = call("education", "flashcards-deck-create", ctx, { title: "Photosynthesis" }).result.deck;
    call("education", "flashcards-card-create", ctx, { deckId: deck.id, front: "Q", back: "A" });
    assert.equal(call("education", "flashcards-deck-delete", ctx, { deckId: deck.id }).result.deleted, deck.id);
    assert.equal(call("education", "flashcards-decks", ctx, {}).result.decks.length, 0);

    const exercise = call("education", "exercises-create", ctx, {
      title: "Check", steps: [{ prompt: "2+2", answer: "4" }],
    }).result.exercise;
    assert.equal(call("education", "exercises-delete", ctx, { exerciseId: exercise.id }).ok, true);
    assert.equal(call("education", "exercises-list", ctx, {}).result.exercises.length, 0);
  });

  it("deletes a legal matter, docket case, calendar event, and template", () => {
    const matter = call("legal", "matters-create", ctx, { name: "QA matter", clientName: "Ada" }).result.matter;
    assert.equal(call("legal", "matters-delete", ctx, { id: matter.id }).ok, true);
    assert.equal(call("legal", "matters-list", ctx, {}).result.matters.length, 0);

    const docket = call("legal", "case-add", ctx, { caption: "QA v QA", caseNumber: "1:26" }).result.case;
    assert.equal(call("legal", "case-delete", ctx, { id: docket.id }).ok, true);
    assert.equal(call("legal", "case-list", ctx, {}).result.cases.length, 0);

    const event = call("legal", "calendar-create", ctx, { title: "Hearing", date: "2026-12-01" }).result.event;
    assert.equal(call("legal", "calendar-delete", ctx, { id: event.id }).ok, true);
    assert.equal(call("legal", "calendar-list", ctx, {}).result.events.length, 0);

    const templates = call("legal", "doc-templates-list", ctx, {}).result.templates;
    const before = templates.length;
    assert.ok(before > 0);
    const ids = templates.map((t) => t.id);
    for (const id of ids) assert.equal(call("legal", "doc-templates-delete", ctx, { id }).ok, true);
    const left = call("legal", "doc-templates-list", ctx, {}).result.templates;
    assert.equal(left.length, 0);
    assert.equal(call("legal", "doc-templates-list", ctx, {}).result.templates.length, 0);
  });

  it("withdraws the filer's dispute and drops it from the active count", () => {
    const opened = call("disputes", "case-open", ctx, { title: "QA case", disputeType: "other" }).result.case;
    assert.equal(call("disputes", "case-list", ctx, {}).result.stats.active, 1);
    const other = { actor: { userId: "stranger" }, userId: "stranger" };
    assert.equal(call("disputes", "case-withdraw", other, { id: opened.id }).ok, false);
    assert.equal(call("disputes", "case-withdraw", ctx, { id: opened.id }).result.case.status, "withdrawn");
    assert.equal(call("disputes", "case-list", ctx, {}).result.stats.active, 0);
  });

  it("deletes a paper collection and a mood and gratitude entry", () => {
    const col = call("paper", "collection-create", ctx, { name: "QA col" }).result.collection;
    assert.equal(call("paper", "collection-delete", ctx, { id: col.id }).ok, true);
    assert.equal(call("paper", "collection-list", ctx, {}).result.count, 0);

    const mood = call("mental-health", "mood-log", ctx, { mood: 3, note: "qa" }).result.entry;
    assert.equal(call("mental-health", "mood-update", ctx, { id: mood.id, mood: 5, note: "edited" }).result.entry.note, "edited");
    assert.equal(call("mental-health", "mood-delete", ctx, { id: mood.id }).ok, true);
    assert.equal(call("mental-health", "mood-history", ctx, {}).result.count, 0);

    const thanks = call("mental-health", "gratitude-add", ctx, { entries: ["sun"] }).result.entry;
    assert.deepEqual(call("mental-health", "gratitude-update", ctx, { id: thanks.id, entries: ["rain"] }).result.entry.items, ["rain"]);
    assert.equal(call("mental-health", "gratitude-delete", ctx, { id: thanks.id }).ok, true);
    assert.equal(call("mental-health", "gratitude-list", ctx, {}).result.count, 0);
  });

  it("keeps assignments from another cohort visible as other when a cohort filter is on", () => {
    call("classroom", "assignment-create", ctx, { cohortId: 1, title: "In cohort" });
    call("classroom", "assignment-create", ctx, { cohortId: 2, title: "Archived cohort work" });
    const listed = call("classroom", "assignment-list", ctx, { cohortId: 1 }).result;
    assert.equal(listed.assignments.length, 1);
    assert.equal(listed.assignments[0].title, "In cohort");
    assert.equal(listed.other.length, 1);
    assert.equal(listed.other[0].title, "Archived cohort work");
    assert.equal(call("classroom", "assignment-delete", ctx, { assignmentId: listed.other[0].id }).ok, true);
    assert.equal(call("classroom", "assignment-list", ctx, { cohortId: 1 }).result.other.length, 0);
  });

  it("lets the poster edit a quest title without touching the escrowed reward", () => {
    const posted = call("questmarket", "postQuest", ctx, { title: "Old title", description: "Old", reward: 0 }).result.quest;
    const other = { actor: { userId: "stranger" }, userId: "stranger" };
    assert.equal(call("questmarket", "updateQuest", other, { questId: posted.id, title: "Stolen" }).ok, false);
    const edited = call("questmarket", "updateQuest", ctx, { questId: posted.id, title: "New title", description: "New" }).result;
    assert.equal(edited.title, "New title");
    assert.equal(edited.reward, 0);
    assert.equal(call("questmarket", "cancelQuest", ctx, { questId: posted.id }).ok, true);
  });

  it("renames the caller's minted move and refuses a missing row", async () => {
    const stored = { id: "move:owner:1", title: "Old", body: JSON.stringify({ name: "Old", kind: "move_recipe" }), owner: "owner" };
    const db = {
      prepare(sql) {
        return {
          all() { return [{ name: "body_json" }, { name: "owner_user_id" }, { name: "title" }]; },
          get(id) { return id === stored.id ? { id: stored.id, body: stored.body, owner: stored.owner } : null; },
          run(...args) {
            if (String(sql).startsWith("UPDATE") && args[2] === stored.id) {
              stored.title = args[0];
              stored.body = args[1];
              return { changes: 1 };
            }
            return { changes: 0 };
          },
        };
      },
    };
    const rename = actions.get("move-builder.rename");
    const renamed = await rename({ db, actor: { userId: "owner" } }, { moveId: stored.id, name: "New name" });
    assert.equal(renamed.name, "New name");
    assert.equal(stored.title, "New name");
    assert.equal(JSON.parse(stored.body).name, "New name");
    assert.equal((await rename({ db, actor: { userId: "owner" } }, { moveId: "missing", name: "Nope" })).ok, false);
  });
});
