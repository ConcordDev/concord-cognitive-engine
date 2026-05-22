// Contract tests for server/domains/metalearning.js — pure-math meta-learning
// macros plus the STATE-backed learning-science practice substrate (spaced
// repetition, learning plans, technique library, progress analytics, goals,
// strategy A/B experiments, study journal).

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import registerMetalearningActions from "../domains/metalearning.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`metalearning.${name}`);
  if (!fn) throw new Error(`metalearning.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerMetalearningActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

after(() => { globalThis._concordSTATE = undefined; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("metalearning pure-compute macros", () => {
  it("strategySelection falls back to heuristic with no landmarks", () => {
    const r = call("strategySelection", ctxA, { data: { taskFeatures: { complexity: 0.8 } } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "heuristic");
    assert.ok(r.result.recommended);
  });

  it("transferAnalysis computes overlap between domains", () => {
    const r = call("transferAnalysis", ctxA, {
      data: {
        sourceDomain: { name: "piano", concepts: ["rhythm", "harmony"], skills: ["sight-read"] },
        targetDomain: { name: "guitar", concepts: ["rhythm"], skills: ["sight-read"] },
      },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.similarity.overall >= 0);
  });

  it("performanceProfile builds a profile from assessments", () => {
    const r = call("performanceProfile", ctxA, {
      data: { assessments: [{ skill: "algebra", difficulty: 0.5, score: 0.8 }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.uniqueSkills, 1);
  });
});

describe("metalearning spaced repetition (SRS)", () => {
  it("adds, reviews, and schedules a card", () => {
    const add = call("srsAddCard", ctxA, {}, { front: "What is the spacing effect?", back: "Distributed practice", topic: "memory" });
    assert.equal(add.ok, true);
    const cardId = add.result.card.id;

    const due = call("srsDue", ctxA, {}, {});
    assert.equal(due.ok, true);
    assert.equal(due.result.dueCount, 1);

    const rev = call("srsReview", ctxA, {}, { cardId, grade: 5 });
    assert.equal(rev.ok, true);
    assert.ok(rev.result.nextDueInDays >= 1);

    const after = call("srsDue", ctxA, {}, {});
    assert.equal(after.result.dueCount, 0);
    assert.equal(after.result.upcoming.length, 1);
  });

  it("rejects a card with no front", () => {
    const r = call("srsAddCard", ctxA, {}, { back: "x" });
    assert.equal(r.ok, false);
  });

  it("a lapse (grade < 3) resets repetitions", () => {
    const add = call("srsAddCard", ctxA, {}, { front: "q", topic: "t" });
    const cardId = add.result.card.id;
    call("srsReview", ctxA, {}, { cardId, grade: 5 });
    const lapse = call("srsReview", ctxA, {}, { cardId, grade: 1 });
    assert.equal(lapse.ok, true);
    assert.equal(lapse.result.card.repetitions, 0);
    assert.equal(lapse.result.card.lapses, 1);
  });

  it("deletes a card", () => {
    const add = call("srsAddCard", ctxA, {}, { front: "q" });
    const r = call("srsDeleteCard", ctxA, {}, { cardId: add.result.card.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.remaining, 0);
  });
});

describe("metalearning learning plans", () => {
  it("creates, lists, and toggles plan steps", () => {
    const created = call("planCreate", ctxA, {}, {
      title: "Master ML",
      goal: "Ship a model",
      topics: ["Linear algebra", { name: "Calculus", estimatedHours: 10, milestone: "Gradients" }],
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.plan.topics.length, 2);

    const list = call("planList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.plans[0].progress, 0);

    const stepId = created.result.plan.topics[0].id;
    const toggled = call("planToggleStep", ctxA, {}, { planId: created.result.plan.id, stepId });
    assert.equal(toggled.ok, true);
    assert.ok(toggled.result.progress > 0);
  });

  it("rejects a plan with no title", () => {
    const r = call("planCreate", ctxA, {}, {});
    assert.equal(r.ok, false);
  });
});

describe("metalearning technique library", () => {
  it("returns the full library", () => {
    const r = call("techniqueLibrary", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.techniques.length >= 5);
  });

  it("filters by query", () => {
    const r = call("techniqueLibrary", ctxA, {}, { query: "retrieval" });
    assert.equal(r.ok, true);
    assert.ok(r.result.techniques.every((t) => /retrieval/i.test(t.name + t.summary + t.whenToUse)));
  });

  it("fetches a single technique by id", () => {
    const r = call("techniqueLibrary", ctxA, {}, { id: "interleaving" });
    assert.equal(r.ok, true);
    assert.equal(r.result.technique.id, "interleaving");
  });
});

describe("metalearning progress analytics", () => {
  it("returns analytics over reviewed cards", () => {
    const add = call("srsAddCard", ctxA, {}, { front: "q", topic: "stats" });
    call("srsReview", ctxA, {}, { cardId: add.result.card.id, grade: 5 });
    const r = call("progressAnalytics", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalReviews, 1);
    assert.ok(r.result.overallRetention >= 0);
  });
});

describe("metalearning goals", () => {
  it("creates, checks in, and lists goals", () => {
    const created = call("goalCreate", ctxA, {}, { title: "Read 12 papers", targetValue: 12 });
    assert.equal(created.ok, true);
    const goalId = created.result.goal.id;

    const checkIn = call("goalCheckIn", ctxA, {}, { goalId, value: 12, note: "done" });
    assert.equal(checkIn.ok, true);
    assert.equal(checkIn.result.goal.status, "achieved");

    const list = call("goalList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.achieved, 1);
  });

  it("rejects a goal with no title", () => {
    const r = call("goalCreate", ctxA, {}, {});
    assert.equal(r.ok, false);
  });
});

describe("metalearning strategy A/B experiments", () => {
  it("creates an experiment, records trials, and computes a winner", () => {
    const created = call("experimentCreate", ctxA, {}, {
      title: "Massed vs spaced", hypothesis: "Spaced wins", strategyA: "massed", strategyB: "spaced",
    });
    assert.equal(created.ok, true);
    const id = created.result.experiment.id;

    for (const s of [0.4, 0.45]) call("experimentRecordTrial", ctxA, {}, { experimentId: id, arm: "A", score: s });
    for (const s of [0.8, 0.85]) call("experimentRecordTrial", ctxA, {}, { experimentId: id, arm: "B", score: s });

    const list = call("experimentList", ctxA, {}, {});
    assert.equal(list.ok, true);
    const exp = list.result.experiments[0];
    assert.equal(exp.summary.winner, "B");
    assert.ok(exp.summary.armB.mean > exp.summary.armA.mean);
  });

  it("rejects a trial with no numeric score", () => {
    const created = call("experimentCreate", ctxA, {}, { title: "t", strategyA: "a", strategyB: "b" });
    const r = call("experimentRecordTrial", ctxA, {}, { experimentId: created.result.experiment.id, arm: "A" });
    assert.equal(r.ok, false);
  });
});

describe("metalearning study journal", () => {
  it("adds an entry and aggregates technique effectiveness", () => {
    const add = call("journalAdd", ctxA, {}, {
      topic: "calculus", technique: "Feynman Technique", minutesStudied: 45, effectiveness: 4,
      reflection: "Plain-language teaching exposed a gap in chain rule.",
    });
    assert.equal(add.ok, true);

    const list = call("journalList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalMinutes, 45);
    assert.ok(list.result.techniqueEffectiveness.length >= 1);
  });

  it("rejects an entry with no reflection text", () => {
    const r = call("journalAdd", ctxA, {}, { topic: "x" });
    assert.equal(r.ok, false);
  });
});
