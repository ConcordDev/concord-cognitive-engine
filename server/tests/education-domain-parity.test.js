// Contract tests for the education-lens parity macros in server/domains/education.js.
// Covers: flashcards SM-2 lifecycle, decks CRUD, quiz-from-text + mint-deck,
// tutor-ask + lesson-plan-generate (LLM-mocked), preserving the analytical
// macros above.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerEducationActions from "../domains/education.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`education.${name}`);
  assert.ok(fn, `education.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEducationActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), educationLens: { decks: new Map(), cards: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
});

const userA = "user_a";
const userB = "user_b";
const ctxA = { actor: { userId: userA }, userId: userA };
const ctxB = { actor: { userId: userB }, userId: userB };

describe("education.flashcards-* (decks + cards + SM-2 review)", () => {
  it("deck CRUD scoped per user", () => {
    const d1 = call("flashcards-deck-create", ctxA, { title: "French A1" });
    assert.equal(d1.ok, true);
    const list = call("flashcards-decks", ctxA, {});
    assert.equal(list.result.decks.length, 1);
    assert.equal(list.result.decks[0].title, "French A1");

    // Other user empty
    assert.equal(call("flashcards-decks", ctxB, {}).result.decks.length, 0);
  });

  it("rejects deck create with empty title", () => {
    assert.equal(call("flashcards-deck-create", ctxA, { title: "" }).ok, false);
  });

  it("card create + due queue (due immediately on creation)", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const deckId = d.result.deck.id;
    call("flashcards-card-create", ctxA, { deckId, front: "hello", back: "bonjour" });
    call("flashcards-card-create", ctxA, { deckId, front: "thanks", back: "merci" });

    const due = call("flashcards-due", ctxA, { deckId, limit: 10 });
    assert.equal(due.result.cards.length, 2);
    assert.equal(due.result.total, 2);
  });

  it("rejects card create with missing fields", () => {
    assert.equal(call("flashcards-card-create", ctxA, { deckId: "x" }).ok, false);
    assert.equal(call("flashcards-card-create", ctxA, { front: "x", back: "y" }).ok, false);
  });

  it("SM-2 review: good rating advances interval, ease drifts, due moves to future", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const c = call("flashcards-card-create", ctxA, { deckId: d.result.deck.id, front: "f", back: "b" });
    const id = c.result.card.id;

    // First good review
    const r1 = call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.card.repetitions, 1);
    assert.equal(r1.result.card.interval, 1);
    assert.ok(r1.result.card.ease >= 2.4);
    assert.ok(new Date(r1.result.card.dueAt).getTime() > Date.now() + 1000);

    // Second good review
    const r2 = call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    assert.equal(r2.result.card.repetitions, 2);
    assert.equal(r2.result.card.interval, 6);

    // Third good review → interval × ease
    const r3 = call("flashcards-review", ctxA, { cardId: id, quality: 5 });
    assert.equal(r3.result.card.repetitions, 3);
    assert.ok(r3.result.card.interval > 6);
  });

  it("SM-2 review: bad rating (q<3) resets repetitions + interval, schedules <1 day", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const c = call("flashcards-card-create", ctxA, { deckId: d.result.deck.id, front: "f", back: "b" });
    const id = c.result.card.id;
    call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    call("flashcards-review", ctxA, { cardId: id, quality: 4 });
    const fail = call("flashcards-review", ctxA, { cardId: id, quality: 1 });
    assert.equal(fail.result.card.repetitions, 0);
    assert.equal(fail.result.card.interval, 0);
    // Re-scheduled to <1 day later (minutes), not days
    const due = new Date(fail.result.card.dueAt).getTime();
    assert.ok(due - Date.now() < 86_400_000);
  });

  it("SM-2 review: ease floor at 1.3", () => {
    const d = call("flashcards-deck-create", ctxA, { title: "x" });
    const c = call("flashcards-card-create", ctxA, { deckId: d.result.deck.id, front: "f", back: "b" });
    const id = c.result.card.id;
    // Hammer with low quality to drive ease toward floor
    let lastReview;
    for (let i = 0; i < 20; i++) {
      lastReview = call("flashcards-review", ctxA, { cardId: id, quality: 0 });
    }
    assert.ok(lastReview.result.card.ease >= 1.3);
    assert.equal(lastReview.result.card.ease, 1.3);
  });

  it("review rejects unknown card id", () => {
    assert.equal(call("flashcards-review", ctxA, { cardId: "nope", quality: 3 }).ok, false);
  });
});

describe("education.tutor-ask (Socratic)", () => {
  it("returns graceful no-op text when llm unavailable", async () => {
    const r = await call("tutor-ask", ctxA, { subject: "algebra", history: [{ role: "student", content: "what's 2+2?" }] });
    assert.equal(r.ok, true);
    assert.match(r.result.text, /unavailable/);
  });

  it("constrains LLM via system prompt at hintLevel 1 (Socratic-only)", async () => {
    let capturedSys = "";
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async ({ messages }) => {
        capturedSys = messages?.[0]?.content || "";
        return { text: "What do you notice about both sides of the equation?" };
      }},
    };
    const r = await call("tutor-ask", ctx, {
      subject: "algebra", level: "8th grade", hintLevel: 1,
      history: [{ role: "student", content: "stuck on 2x+5=11" }],
    });
    assert.equal(r.ok, true);
    assert.match(r.result.text, /notice/i);
    assert.match(capturedSys, /Socratic|do not reveal/i);
    assert.equal(r.result.hintLevel, 1);
  });

  it("hintLevel 3 unlocks step-by-step walk-through", async () => {
    let capturedSys = "";
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async ({ messages }) => { capturedSys = messages?.[0]?.content || ""; return { text: "step" }; } },
    };
    await call("tutor-ask", ctx, { subject: "algebra", hintLevel: 3, history: [] });
    assert.match(capturedSys, /walk them through|next single step/i);
  });
});

describe("education.quiz-from-text + mint-deck", () => {
  it("rejects empty source + no DTU", async () => {
    const r = await call("quiz-from-text", { llm: { chat: async () => ({ text: "{}" }) } }, { source: "", count: 5 });
    assert.equal(r.ok, false);
  });

  it("generates N cards from text via utility brain (JSON output)", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({
        text: '```json\n{"cards":[{"front":"Q1?","back":"A1","difficulty":"easy"},{"front":"Q2?","back":"A2","difficulty":"medium"}]}\n```',
      }) },
    };
    const r = await call("quiz-from-text", ctx, { source: "Mitochondria are the powerhouse of the cell. ATP is the energy currency.", count: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.cards.length, 2);
    assert.equal(r.result.cards[0].front, "Q1?");
    assert.equal(r.result.cards[0].difficulty, "easy");
  });

  it("mint-deck creates deck + cards in one shot", () => {
    const r = call("quiz-mint-deck", ctxA, {
      title: "Bio basics",
      cards: [
        { front: "Q1", back: "A1" },
        { front: "Q2", back: "A2" },
        { front: "", back: "skipped" },  // dropped
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.added, 3);  // input count, not filtered
    const due = call("flashcards-due", ctxA, { deckId: r.result.deck.id });
    assert.equal(due.result.cards.length, 2);  // empty front dropped
  });

  it("mint-deck rejects empty cards array", () => {
    assert.equal(call("quiz-mint-deck", ctxA, { title: "x", cards: [] }).ok, false);
  });
});

describe("education.lesson-plan-generate", () => {
  it("rejects empty topic", async () => {
    const r = await call("lesson-plan-generate", { llm: { chat: async () => ({ text: "{}" }) } }, { topic: "" });
    assert.equal(r.ok, false);
  });

  it("parses LLM JSON output into structured plan", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({
        text: '{"plan":{"title":"Linear equations","subject":"Algebra I","grade":"8th","duration":"45 min","standards":["CCSS.8.EE.C.7"],"objectives":["solve 1-step","solve 2-step"],"materials":["whiteboard"],"warmUp":"3-min entry ticket","mainActivity":"think-pair-share on 2x+5=15","practice":"workbook 1.3","closure":"exit ticket","differentiation":{"struggling":"chips","grade_level":"as written","advanced":"systems"},"assessment":"quick quiz"}}',
      }) },
    };
    const r = await call("lesson-plan-generate", ctx, { subject: "Algebra I", grade: "8th", duration: "45 min", topic: "Linear equations" });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan.title, "Linear equations");
    assert.equal(r.result.plan.objectives.length, 2);
    assert.ok(r.result.plan.differentiation.struggling);
    assert.ok(r.result.plan.assessment);
  });

  it("returns parse error on garbage LLM output", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: "I cannot help with that." }) },
    };
    const r = await call("lesson-plan-generate", ctx, { topic: "x" });
    assert.equal(r.ok, false);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("(carry on with at least one existing macro)", () => {
    // The pre-existing education domain registers complexityAnalysis-ish
    // analytical macros — just confirm registration count is plausible.
    assert.ok(ACTIONS.size > 12);
  });
});
