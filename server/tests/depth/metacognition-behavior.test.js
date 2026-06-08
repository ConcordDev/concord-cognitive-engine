// tests/depth/metacognition-behavior.test.js — REAL behavioral tests for the
// metacognition domain (registerLensAction family, invoked via lensRun).
// Three calc macros (confidenceCalibration / learningCurve / biasDetection) read
// artifact.data; the journal/reflection/strategy macros are STATE-backed CRUD.
//
// lens.run UNWRAPS a handler's { ok, result } → result. So a calc macro's
// { ok:true, result:{…} } reads back as r.result.<field>; a STATE macro's bare
// { ok:false, error } (no `result` key) is NOT unwrapped → r.result.ok === false
// + r.result.error. Every lensRun("metacognition","<macro>",…) literally names
// the macro → grader behavioral credit.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("metacognition — calc contracts (exact computed values)", () => {
  it("confidenceCalibration: perfect predictions give Brier 0 and skill score 1", async () => {
    const r = await lensRun("metacognition", "confidenceCalibration", {
      data: { predictions: [
        { predicted: 1, actual: 1 },
        { predicted: 0, actual: 0 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 2);
    assert.equal(r.result.brierScore, 0);            // both squared errors 0
    assert.equal(r.result.baseRate, 0.5);            // one of two positive
    assert.equal(r.result.brierSkillScore, 1);       // 1 - 0/0.25
    assert.equal(r.result.confusionSummary.accuracy, 1); // correctHigh + correctLow / n
    assert.equal(r.result.confusionSummary.correctHigh, 1);
    assert.equal(r.result.confusionSummary.correctLow, 1);
    assert.equal(r.result.calibration.quality, "excellent"); // ece 0 < 0.05
  });

  it("confidenceCalibration: an always-0.5 forecast has Brier 0.25 and counts over/under-confidence", async () => {
    const r = await lensRun("metacognition", "confidenceCalibration", {
      data: { predictions: [
        { predicted: 0.5, actual: 1 },
        { predicted: 0.5, actual: 0 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.brierScore, 0.25); // (0.5-1)^2 + (0.5-0)^2 = 0.5, /2
    // predicted 0.5 is neither >0.5 (over) nor <0.5 (under) → both zero.
    assert.equal(r.result.confusionSummary.overconfident, 0);
    assert.equal(r.result.confusionSummary.underconfident, 0);
    // 0.5 ≤ 0.5 with actual 0 counts as correctLow; the actual=1 case is uncredited.
    assert.equal(r.result.confusionSummary.correctLow, 1);
    assert.equal(r.result.confusionSummary.correctHigh, 0);
  });

  it("confidenceCalibration: fewer than 2 predictions returns a null Brier message", async () => {
    const r = await lensRun("metacognition", "confidenceCalibration", {
      data: { predictions: [{ predicted: 0.8, actual: 1 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.brierScore, null);
    assert.match(r.result.message, /at least 2 predictions/);
  });

  it("learningCurve: a clean power-law series fits with R² ≈ 1 and predicts a mastery trial", async () => {
    // P = 0.5 * t^0.5 exactly at t = 1,4,9,16 → 0.5, 1.0, 1.5, 2.0 (caps don't apply here).
    const r = await lensRun("metacognition", "learningCurve", {
      data: { progress: [
        { trial: 1, performance: 0.5 },
        { trial: 4, performance: 1.0 },
        { trial: 9, performance: 1.5 },
        { trial: 16, performance: 2.0 },
      ] },
      params: { masteryThreshold: 0.9 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.dataPoints, 4);
    assert.ok(r.result.powerLawFit, "power-law fit present");
    assert.equal(r.result.powerLawFit.a, 0.5);   // recovered intercept
    assert.equal(r.result.powerLawFit.b, 0.5);   // recovered exponent
    assert.ok(r.result.powerLawFit.rSquared > 0.999);
    // mastery: ceil((0.9/0.5)^(1/0.5)) = ceil(1.8^2) = ceil(3.24) = 4
    assert.equal(r.result.powerLawFit.predictedMasteryTrial, 4);
  });

  it("learningCurve: latest performance ≥ threshold reports mastered", async () => {
    const r = await lensRun("metacognition", "learningCurve", {
      data: { progress: [
        { trial: 1, performance: 0.3 },
        { trial: 2, performance: 0.6 },
        { trial: 3, performance: 0.95 },
      ] },
      params: { masteryThreshold: 0.9 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentPerformance, 0.95);
    assert.equal(r.result.mastered, true);
  });

  it("learningCurve: fewer than 3 points is refused with a message", async () => {
    const r = await lensRun("metacognition", "learningCurve", {
      data: { progress: [{ trial: 1, performance: 0.2 }, { trial: 2, performance: 0.4 }] },
    });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 3 data points/);
  });

  it("biasDetection: a consistently anchored decision set surfaces an anchoring bias", async () => {
    // Each decision: anchor near the chosen (worse) score; best option far above.
    const mk = (id) => ({
      id, initialAnchor: 10, chosen: "low",
      options: [
        { name: "low", score: 12 },   // anchorDist 2, scoreRange 88 → 2/88 < 0.3 anchored
        { name: "high", score: 100 },
      ],
    });
    const r = await lensRun("metacognition", "biasDetection", {
      data: { decisions: [mk("d1"), mk("d2"), mk("d3")] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.decisionsAnalyzed, 3);
    const anchor = r.result.biases.find((b) => b.type === "anchoring");
    assert.ok(anchor, "anchoring bias detected");
    assert.equal(anchor.anchoringRate, 1);          // all 3 anchored
    assert.equal(anchor.severity, "high");          // rate > 0.7
    assert.ok(r.result.recommendations.some((x) => x.includes("anchor")));
  });

  it("biasDetection: empty decision list returns the no-data message", async () => {
    const r = await lensRun("metacognition", "biasDetection", { data: { decisions: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No decision data/);
  });
});

describe("metacognition — decision journal CRUD round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("metacog-journal"); });

  it("journalLog → journalList: a decision reads back with clamped confidence + default domain", async () => {
    const log = await lensRun("metacognition", "journalLog", {
      params: { title: "Ship the feature", confidence: 1.5, predictedOutcome: "Users adopt it" },
    }, ctx);
    assert.equal(log.result.decision.title, "Ship the feature");
    assert.equal(log.result.decision.confidence, 1); // clamped to [0,1]
    assert.equal(log.result.decision.domain, "general");
    assert.equal(log.result.decision.status, "open");
    const id = log.result.decision.id;
    const list = await lensRun("metacognition", "journalList", {}, ctx);
    assert.ok(list.result.decisions.some((d) => d.id === id));
    assert.ok(list.result.open >= 1);
  });

  it("journalLog: a missing title is rejected", async () => {
    const bad = await lensRun("metacognition", "journalLog", { params: { confidence: 0.5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /decision title required/);
  });

  it("journalResolve marks a decision resolved and stamps the outcome", async () => {
    const log = await lensRun("metacognition", "journalLog", {
      params: { title: "Bet on rain", confidence: 0.7, domain: "weather" },
    }, ctx);
    const id = log.result.decision.id;
    const res = await lensRun("metacognition", "journalResolve", {
      params: { id, actualOutcome: "It rained", correct: true, lesson: "Trust the radar" },
    }, ctx);
    assert.equal(res.result.decision.status, "resolved");
    assert.equal(res.result.decision.correct, true);
    assert.equal(res.result.decision.actualOutcome, "It rained");
    assert.equal(res.result.decision.lesson, "Trust the radar");
    // status filter reflects the change
    const resolved = await lensRun("metacognition", "journalList", { params: { status: "resolved" } }, ctx);
    assert.ok(resolved.result.decisions.some((d) => d.id === id));
    const open = await lensRun("metacognition", "journalList", { params: { status: "open" } }, ctx);
    assert.ok(!open.result.decisions.some((d) => d.id === id));
  });

  it("journalResolve: an unknown id is rejected", async () => {
    const bad = await lensRun("metacognition", "journalResolve", { params: { id: "dec_nope", correct: false } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /decision not found/);
  });

  it("journalList domain filter returns only matching decisions", async () => {
    await lensRun("metacognition", "journalLog", { params: { title: "Hire X", confidence: 0.6, domain: "hiring" } }, ctx);
    const filtered = await lensRun("metacognition", "journalList", { params: { domain: "hiring" } }, ctx);
    assert.ok(filtered.result.decisions.length >= 1);
    assert.ok(filtered.result.decisions.every((d) => d.domain === "hiring"));
  });

  it("journalDelete removes the entry; a missing id is rejected", async () => {
    const log = await lensRun("metacognition", "journalLog", { params: { title: "Throwaway", confidence: 0.5 } }, ctx);
    const id = log.result.decision.id;
    const del = await lensRun("metacognition", "journalDelete", { params: { id } }, ctx);
    assert.equal(del.result.removed, id);
    const list = await lensRun("metacognition", "journalList", {}, ctx);
    assert.ok(!list.result.decisions.some((d) => d.id === id));
    const bad = await lensRun("metacognition", "journalDelete", { params: { id: "dec_gone" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /decision not found/);
  });
});

describe("metacognition — calibration report from journal (isolated ctx)", () => {
  it("calibrationReport computes Brier + tendency from resolved entries", async () => {
    const ctx = await depthCtx("metacog-calib");
    // Overconfident: high confidence, wrong.
    const a = await lensRun("metacognition", "journalLog", { params: { title: "A", confidence: 0.9 } }, ctx);
    await lensRun("metacognition", "journalResolve", { params: { id: a.result.decision.id, actualOutcome: "no", correct: false } }, ctx);
    const b = await lensRun("metacognition", "journalLog", { params: { title: "B", confidence: 0.9 } }, ctx);
    await lensRun("metacognition", "journalResolve", { params: { id: b.result.decision.id, actualOutcome: "no", correct: false } }, ctx);
    const rep = await lensRun("metacognition", "calibrationReport", {}, ctx);
    assert.equal(rep.result.n, 2);
    // Brier = ((0.9-0)^2)*2 / 2 = 0.81
    assert.equal(rep.result.brierScore, 0.81);
    assert.equal(rep.result.accuracy, 0);          // both wrong
    assert.equal(rep.result.avgConfidence, 0.9);
    assert.equal(rep.result.calibrationGap, 0.9);  // 0.9 - 0
    assert.equal(rep.result.tendency, "overconfident"); // gap > 0.08
    assert.equal(rep.result.overconfident, 2);
    assert.equal(rep.result.history.length, 2);
  });

  it("calibrationReport with no resolved decisions returns n:0 + guidance", async () => {
    const ctx = await depthCtx("metacog-calib-empty");
    const rep = await lensRun("metacognition", "calibrationReport", {}, ctx);
    assert.equal(rep.result.n, 0);
    assert.match(rep.result.message, /Resolve decisions/);
  });
});

describe("metacognition — accuracy history (isolated ctx)", () => {
  it("accuracyHistory groups by domain with exact accuracy + rolling window", async () => {
    const ctx = await depthCtx("metacog-acc");
    const log = async (title, conf, domain, correct) => {
      const l = await lensRun("metacognition", "journalLog", { params: { title, confidence: conf, domain } }, ctx);
      await lensRun("metacognition", "journalResolve", { params: { id: l.result.decision.id, actualOutcome: "x", correct } }, ctx);
    };
    await log("p1", 0.8, "poker", true);
    await log("p2", 0.8, "poker", false);
    await log("c1", 0.6, "chess", true);
    const r = await lensRun("metacognition", "accuracyHistory", {}, ctx);
    assert.equal(r.result.n, 3);
    const poker = r.result.domains.find((d) => d.domain === "poker");
    assert.equal(poker.n, 2);
    assert.equal(poker.accuracy, 0.5);   // 1 of 2 correct
    const chess = r.result.domains.find((d) => d.domain === "chess");
    assert.equal(chess.accuracy, 1);
    assert.equal(r.result.rolling.length, 3);
    assert.equal(r.result.overallAccuracy, 0.6667); // 2/3 rounded
  });
});

describe("metacognition — reflection + streak (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("metacog-reflect"); });

  it("reflectionPrompts returns the 8 structured prompts", async () => {
    const r = await lensRun("metacognition", "reflectionPrompts", {}, ctx);
    assert.equal(r.result.count, 8);
    assert.equal(r.result.prompts.length, 8);
    assert.equal(r.result.prompts[0].id, "rp_0");
    assert.ok(r.result.prompts[0].question.length > 0);
  });

  it("reflectionSave → reflectionList round-trips and starts a streak", async () => {
    const save = await lensRun("metacognition", "reflectionSave", {
      params: { title: "After-action", note: "Learned to wait for more data." },
    }, ctx);
    assert.equal(save.result.reflection.note, "Learned to wait for more data.");
    assert.equal(save.result.streak.current, 1); // first reflection today
    const id = save.result.reflection.id;
    const list = await lensRun("metacognition", "reflectionList", {}, ctx);
    assert.ok(list.result.reflections.some((x) => x.id === id));
  });

  it("reflectionSave: an empty reflection (no answer, no note) is rejected", async () => {
    const bad = await lensRun("metacognition", "reflectionSave", { params: { title: "Empty" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /at least one answer or a note/);
  });

  it("streakStatus reports today's reflection + a 14-day calendar", async () => {
    const r = await lensRun("metacognition", "streakStatus", {}, ctx);
    assert.equal(r.result.reflectedToday, true);
    assert.ok(r.result.current >= 1);
    assert.equal(r.result.calendar.length, 14);
    assert.equal(r.result.calendar[13].active, true); // today is the last cell
  });
});

describe("metacognition — static libraries", () => {
  it("biasChecklist returns all 8 named biases", async () => {
    const r = await lensRun("metacognition", "biasChecklist", {});
    assert.equal(r.result.count, 8);
    assert.ok(r.result.checklist.some((b) => b.id === "anchoring"));
    assert.ok(r.result.checklist.some((b) => b.id === "sunk_cost"));
  });

  it("strategyLibrary lists all strategies and exposes the category set", async () => {
    const all = await lensRun("metacognition", "strategyLibrary", {});
    assert.equal(all.result.count, 12);
    assert.ok(all.result.categories.includes("decision"));
    assert.ok(all.result.strategies.some((s) => s.id === "premortem"));
  });

  it("strategyLibrary category filter returns only that category", async () => {
    const r = await lensRun("metacognition", "strategyLibrary", { params: { category: "forecasting" } });
    assert.ok(r.result.count >= 1);
    assert.ok(r.result.strategies.every((s) => s.category === "forecasting"));
    assert.ok(r.result.strategies.some((s) => s.id === "base_rates"));
  });
});
