// Contract tests for server/domains/metacognition.js
// Covers the pure-math analytical macros plus the STATE-backed
// decision-journal / reflection / strategy / streak macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMetacognitionActions from "../domains/metacognition.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`metacognition.${name}`);
  if (!fn) throw new Error(`metacognition.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerMetacognitionActions(register); });

// Fresh per-test STATE so the per-user Maps don't leak between tests.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("metacognition pure-math macros", () => {
  it("confidenceCalibration computes Brier score + reliability bins", () => {
    const predictions = [
      { predicted: 0.9, actual: 1 }, { predicted: 0.8, actual: 1 },
      { predicted: 0.3, actual: 0 }, { predicted: 0.6, actual: 0 },
      { predicted: 0.7, actual: 1 },
    ];
    const r = call("confidenceCalibration", ctxA, { data: { predictions } }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.brierScore, "number");
    assert.ok(Array.isArray(r.result.calibration.bins));
  });

  it("learningCurve fits a curve and reports best model", () => {
    const progress = [
      { trial: 1, performance: 0.3 }, { trial: 2, performance: 0.45 },
      { trial: 3, performance: 0.6 }, { trial: 4, performance: 0.72 },
      { trial: 5, performance: 0.81 },
    ];
    const r = call("learningCurve", ctxA, { data: { progress } }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.currentPerformance, "number");
  });

  it("biasDetection returns ok with no decisions", () => {
    const r = call("biasDetection", ctxA, { data: { decisions: [] } }, {});
    assert.equal(r.ok, true);
  });
});

describe("metacognition decision journal", () => {
  it("journalLog records a decision", () => {
    const r = call("journalLog", ctxA, { title: "Take the new job", confidence: 0.7, domain: "work" });
    assert.equal(r.ok, true);
    assert.equal(r.result.decision.title, "Take the new job");
    assert.equal(r.result.decision.status, "open");
  });

  it("journalLog rejects an empty title", () => {
    const r = call("journalLog", ctxA, { confidence: 0.5 });
    assert.equal(r.ok, false);
  });

  it("journalList returns logged decisions scoped per user", () => {
    call("journalLog", ctxA, { title: "A decision", confidence: 0.6 });
    call("journalLog", ctxB, { title: "Other user decision", confidence: 0.6 });
    const r = call("journalList", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.equal(r.result.decisions[0].title, "A decision");
  });

  it("journalResolve records the outcome and journalDelete removes it", () => {
    const created = call("journalLog", ctxA, { title: "Resolve me", confidence: 0.8 });
    const id = created.result.decision.id;
    const resolved = call("journalResolve", ctxA, { id, actualOutcome: "It worked", correct: true });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.result.decision.status, "resolved");
    assert.equal(resolved.result.decision.correct, true);
    const del = call("journalDelete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.remaining, 0);
  });
});

describe("metacognition calibration + accuracy", () => {
  it("calibrationReport builds a reliability diagram from resolved decisions", () => {
    for (let i = 0; i < 4; i++) {
      const c = call("journalLog", ctxA, { title: `Pred ${i}`, confidence: 0.7, domain: "forecasting" });
      call("journalResolve", ctxA, { id: c.result.decision.id, actualOutcome: "x", correct: i % 2 === 0 });
    }
    const r = call("calibrationReport", ctxA, { bins: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 4);
    assert.ok(Array.isArray(r.result.reliability));
    assert.equal(typeof r.result.brierScore, "number");
  });

  it("accuracyHistory groups by domain and rolls accuracy", () => {
    for (let i = 0; i < 3; i++) {
      const c = call("journalLog", ctxA, { title: `H ${i}`, confidence: 0.6, domain: "work" });
      call("journalResolve", ctxA, { id: c.result.decision.id, actualOutcome: "x", correct: true });
    }
    const r = call("accuracyHistory", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 3);
    assert.ok(Array.isArray(r.result.domains));
    assert.ok(Array.isArray(r.result.rolling));
  });
});

describe("metacognition reflection + streak", () => {
  it("reflectionPrompts returns a structured prompt set", () => {
    const r = call("reflectionPrompts", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.ok(Array.isArray(r.result.prompts));
  });

  it("reflectionSave persists a reflection and updates the streak", () => {
    const r = call("reflectionSave", ctxA, {
      answers: [{ question: "What happened?", answer: "It went well" }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.reflection.id);
    assert.ok(r.result.streak.current >= 1);
  });

  it("reflectionSave rejects an empty reflection", () => {
    const r = call("reflectionSave", ctxA, { answers: [] });
    assert.equal(r.ok, false);
  });

  it("reflectionList returns saved reflections", () => {
    call("reflectionSave", ctxA, { note: "A note" });
    const r = call("reflectionList", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
  });

  it("streakStatus returns a 14-day calendar", () => {
    call("reflectionSave", ctxA, { note: "today" });
    const r = call("streakStatus", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.calendar.length, 14);
    assert.equal(r.result.reflectedToday, true);
  });
});

describe("metacognition bias checklist + strategy library", () => {
  it("biasChecklist returns the pre-decision checklist", () => {
    const r = call("biasChecklist", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.ok(r.result.checklist.every((b) => b.id && b.name && b.prompt));
  });

  it("strategyLibrary returns strategies and categories", () => {
    const r = call("strategyLibrary", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
    assert.ok(Array.isArray(r.result.categories));
  });

  it("strategyLibrary filters by category", () => {
    const all = call("strategyLibrary", ctxA, {}).result;
    const cat = all.categories[0];
    const filtered = call("strategyLibrary", ctxA, { category: cat });
    assert.equal(filtered.ok, true);
    assert.ok(filtered.result.strategies.every((s) => s.category === cat));
  });
});

describe("metacognition build — bias evaluations (S-MC-4)", () => {
  const richDecision = (title) => ({
    title,
    confidence: 0.7,
    domain: "forecasting",
    options: [
      { name: "A", score: 90, evidence: [{ supports: true, strength: 8 }] },
      { name: "B", score: 40, evidence: [] },
    ],
    chosen: "A",
    initialAnchor: 10,
    investedCost: 500,
  });

  it("every claimed pattern reports flagged / cleared / insufficient — never silence", () => {
    call("journalLog", ctxA, richDecision("D1"));
    call("journalLog", ctxA, richDecision("D2"));
    const r = call("journalBiasDetection", ctxA, {});
    assert.equal(r.ok, true);
    const byType = Object.fromEntries(r.result.evaluations.map((e) => [e.type, e]));
    // Supporting-only evidence on the chosen option, both decisions.
    assert.equal(byType.confirmation_bias.status, "flagged");
    assert.equal(byType.confirmation_bias.decisionsAnalyzed, 2);
    // Chosen score (90) sits far from the anchor (10) on a 50-wide range.
    assert.equal(byType.anchoring.status, "cleared");
    assert.equal(byType.anchoring.decisionsAnalyzed, 2);
    // The chosen option IS the best-scoring one — no sunk-cost signal.
    assert.equal(byType.sunk_cost.status, "cleared");
    // The flagged list itself is unchanged in shape.
    assert.ok(r.result.biases.some((b) => b.type === "confirmation_bias"));
  });

  it("a thin journal reports insufficient_data with what each pattern needs", () => {
    call("journalLog", ctxA, { title: "plain", confidence: 0.5 });
    const r = call("journalBiasDetection", ctxA, {});
    assert.equal(r.result.evaluations.length, 3);
    assert.ok(r.result.evaluations.every((e) => e.status === "insufficient_data" && e.needed));
  });

  it("an empty journal still carries the three evaluations", () => {
    const r = call("journalBiasDetection", ctxB, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.evaluations.length, 3);
  });
});

describe("metacognition build — evidence carries content (S-MC-6)", () => {
  it("journalLog stores evidence text and journalList returns it", () => {
    call("journalLog", ctxA, {
      title: "with evidence",
      confidence: 0.6,
      options: [
        { name: "X", score: 10, evidence: [{ supports: true, strength: 5, text: "Q3 report, p.12" }, { supports: false, strength: 3 }] },
        { name: "Y", score: 5, evidence: [] },
      ],
      chosen: "X",
    });
    const list = call("journalList", ctxA, {});
    const d = list.result.decisions.find((x) => x.title === "with evidence");
    assert.equal(d.options[0].evidence[0].text, "Q3 report, p.12");
    assert.ok(!("text" in d.options[0].evidence[1]), "no text key is invented for items without content");
  });
});

describe("metacognition build — learning-curve forecast (S-MC-5 / F7)", () => {
  it("a rising curve yields a numeric forecast with no apology note", () => {
    const progress = [0.3, 0.45, 0.6, 0.72, 0.81].map((p, i) => ({ trial: i + 1, performance: p }));
    const r = call("learningCurve", ctxA, { data: { progress } }, {});
    assert.equal(typeof r.result.forecast.masteryTrial, "number");
    assert.equal(r.result.forecast.note, null);
  });

  it("a falling curve states why there is no forecast instead of staying silent", () => {
    const progress = [0.8, 0.7, 0.6, 0.5, 0.42].map((p, i) => ({ trial: i + 1, performance: p }));
    const r = call("learningCurve", ctxA, { data: { progress } }, {});
    assert.equal(r.result.forecast.masteryTrial, null);
    assert.match(r.result.forecast.note, /forecast/i);
  });
});

describe("metacognition build — export provider (S-MC-7 / F10)", () => {
  it("the caller's decisions + reflections are exportable rows; another caller's are not", async () => {
    const { collectLensExport } = await import("../lib/lens-export.js");
    call("journalLog", ctxA, { title: "exportable decision", confidence: 0.5 });
    call("reflectionSave", ctxA, { title: "exportable reflection", note: "noted" });
    const out = await collectLensExport({ runMacro: async () => ({ ok: true, artifacts: [] }), domain: "metacognition", ctx: ctxA, limit: 50 });
    const titles = (out.artifacts || []).map((a) => a.title);
    assert.ok(titles.includes("exportable decision"));
    assert.ok(titles.includes("exportable reflection"));
    const other = await collectLensExport({ runMacro: async () => ({ ok: true, artifacts: [] }), domain: "metacognition", ctx: ctxB, limit: 50 });
    assert.ok(!(other.artifacts || []).some((a) => a.title === "exportable decision"));
  });
});
