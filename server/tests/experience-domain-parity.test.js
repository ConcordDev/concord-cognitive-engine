// Contract tests for server/domains/experience.js stateful UX-research macros.
// Exercises the unmoderated test runner, click/heatmap, card-sort/tree-test,
// survey builder, participant panel, highlight reels, and prototype analytics.
// Pattern mirrors travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerExperienceActions from "../domains/experience.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`experience.${name}`);
  if (!fn) throw new Error(`experience.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerExperienceActions(register); });

beforeEach(() => {
  // Reset per-user state between tests.
  if (globalThis._concordSTATE) globalThis._concordSTATE.experienceLens = undefined;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("experience — unmoderated usability test runner", () => {
  it("createTest requires at least one task", () => {
    const r = call("createTest", ctxA, { name: "Empty", tasks: [] });
    assert.equal(r.ok, false);
  });

  it("createTest + listTests + recordRun + listRuns end-to-end", () => {
    const created = call("createTest", ctxA, {
      name: "Checkout flow",
      tasks: ["Find the cart", "Complete payment"],
    });
    assert.equal(created.ok, true);
    const testId = created.result.test.id;
    assert.equal(created.result.test.tasks.length, 2);

    const listed = call("listTests", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);

    const tasks = created.result.test.tasks;
    const run = call("recordRun", ctxA, {
      testId,
      participant: "P1",
      tasks: [
        { taskId: tasks[0].id, success: true, durationMs: 4200, events: [{ t: 100, kind: "click", x: 10, y: 20 }] },
        { taskId: tasks[1].id, success: false, durationMs: 9100, events: [] },
      ],
    });
    assert.equal(run.ok, true);
    assert.equal(run.result.run.successCount, 1);

    const runs = call("listRuns", ctxA, { testId });
    assert.equal(runs.ok, true);
    assert.equal(runs.result.count, 1);

    const withStats = call("listTests", ctxA, {});
    assert.equal(withStats.result.tests[0].runCount, 1);
    assert.equal(withStats.result.tests[0].successRate, 50);
  });
});

describe("experience — click / heatmap tester", () => {
  it("createHeatmapStudy + recordClick + heatmapResults with first-click target", () => {
    const study = call("createHeatmapStudy", ctxA, {
      name: "Nav first-click",
      target: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
    });
    assert.equal(study.ok, true);
    const studyId = study.result.study.id;

    call("recordClick", ctxA, { studyId, x: 0.5, y: 0.5, durationMs: 1200 }); // in target
    call("recordClick", ctxA, { studyId, x: 0.9, y: 0.1, durationMs: 800 });  // miss

    const res = call("heatmapResults", ctxA, { studyId });
    assert.equal(res.ok, true);
    assert.equal(res.result.totalClicks, 2);
    assert.equal(res.result.firstClickSuccessRate, 50);
    assert.equal(res.result.avgDecisionMs, 1000);
  });
});

describe("experience — card-sorting / tree-testing", () => {
  it("createCardSort + submitCardSort + cardSortResults agreement", () => {
    const study = call("createCardSort", ctxA, {
      name: "IA validation",
      cards: ["Settings", "Profile", "Billing"],
    });
    assert.equal(study.ok, true);
    const studyId = study.result.study.id;

    call("submitCardSort", ctxA, { studyId, participant: "P1", groups: [{ category: "Account", cards: ["Settings", "Profile"] }] });
    call("submitCardSort", ctxA, { studyId, participant: "P2", groups: [{ category: "Account", cards: ["Settings"] }] });

    const res = call("cardSortResults", ctxA, { studyId });
    assert.equal(res.ok, true);
    assert.equal(res.result.submissions, 2);
    assert.ok(res.result.overallAgreement >= 0);
    assert.equal(res.result.popularCategories[0].category, "Account");
  });
});

describe("experience — survey builder with branching + NPS/CSAT", () => {
  it("surveyTemplates returns nps/csat/ces", () => {
    const r = call("surveyTemplates", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.find(t => t.id === "nps"));
  });

  it("createSurvey from template + submit + surveyResults computes NPS", () => {
    const created = call("createSurvey", ctxA, { name: "Post-task", template: "nps" });
    assert.equal(created.ok, true);
    const survey = created.result.survey;
    const npsQ = survey.questions[0];

    call("submitSurveyResponse", ctxA, { surveyId: survey.id, answers: { [npsQ.id]: 10 } });
    call("submitSurveyResponse", ctxA, { surveyId: survey.id, answers: { [npsQ.id]: 3 } });

    const res = call("surveyResults", ctxA, { surveyId: survey.id });
    assert.equal(res.ok, true);
    assert.equal(res.result.responseCount, 2);
    const npsResult = res.result.perQuestion.find(q => q.kind === "nps");
    assert.equal(npsResult.nps, 0); // 1 promoter - 1 detractor over 2 = 0

    const listed = call("listSurveys", ctxA, {});
    assert.equal(listed.result.surveys[0].responseCount, 2);
  });

  it("surveyNext resolves branching", () => {
    const created = call("createSurvey", ctxA, {
      name: "Branch test",
      questions: [
        { id: "q1", kind: "single", prompt: "Pick", options: ["A", "B"], branch: { A: "q3" } },
        { id: "q2", kind: "text", prompt: "Skipped" },
        { id: "q3", kind: "text", prompt: "Branched" },
      ],
    });
    assert.equal(created.ok, true);
    const branched = call("surveyNext", ctxA, { surveyId: created.result.survey.id, questionId: "q1", answer: "A" });
    assert.equal(branched.result.next.id, "q3");
    const linear = call("surveyNext", ctxA, { surveyId: created.result.survey.id, questionId: "q1", answer: "B" });
    assert.equal(linear.result.next.id, "q2");
  });
});

describe("experience — participant recruitment / panel", () => {
  it("addParticipant + listPanel + screenPanel + inviteParticipants", () => {
    const p1 = call("addParticipant", ctxA, { name: "Alex", attributes: { age: 30, device: "mobile" } });
    const p2 = call("addParticipant", ctxA, { name: "Sam", attributes: { age: 55, device: "desktop" } });
    assert.equal(p1.ok, true);
    assert.equal(p2.ok, true);

    const panel = call("listPanel", ctxA, {});
    assert.equal(panel.result.count, 2);

    const screened = call("screenPanel", ctxA, { rules: [{ attribute: "device", op: "eq", value: "mobile" }] });
    assert.equal(screened.ok, true);
    assert.equal(screened.result.matchCount, 1);

    const invited = call("inviteParticipants", ctxA, { participantIds: [p1.result.participant.id], studyName: "Beta" });
    assert.equal(invited.ok, true);
    assert.equal(invited.result.invited, 1);
  });
});

describe("experience — highlight reels / clip sharing", () => {
  it("createClip + listClips + buildReel produce shareable tokens", () => {
    const clip1 = call("createClip", ctxA, { runId: "run1", label: "Confusion", startMs: 1000, endMs: 5000, sentiment: "negative" });
    const clip2 = call("createClip", ctxA, { runId: "run1", label: "Delight", startMs: 6000, endMs: 8000, sentiment: "positive" });
    assert.equal(clip1.ok, true);
    assert.ok(clip1.result.shareUrl.includes("/share/clip/"));

    const clips = call("listClips", ctxA, { runId: "run1" });
    assert.equal(clips.result.count, 2);
    assert.equal(clips.result.bySentiment.negative, 1);

    const reel = call("buildReel", ctxA, { name: "Top moments", clipIds: [clip1.result.clip.id, clip2.result.clip.id] });
    assert.equal(reel.ok, true);
    assert.equal(reel.result.reel.clipCount, 2);
    assert.ok(reel.result.shareUrl.includes("/share/reel/"));
  });
});

describe("experience — prototype embed interaction analytics", () => {
  it("createPrototype + recordInteraction + prototypeAnalytics funnel", () => {
    const proto = call("createPrototype", ctxA, {
      name: "Onboarding proto",
      embedUrl: "https://figma.com/proto/abc",
      frames: ["Welcome", "Signup"],
    });
    assert.equal(proto.ok, true);
    const protoId = proto.result.prototype.id;
    const frames = proto.result.prototype.frames;

    call("recordInteraction", ctxA, { prototypeId: protoId, frameId: frames[0].id, kind: "tap", x: 0.5, y: 0.5 });
    call("recordInteraction", ctxA, { prototypeId: protoId, frameId: frames[0].id, kind: "tap", x: 0.1, y: 0.1, misclick: true });

    const listed = call("listPrototypes", ctxA, {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.prototypes[0].interactionCount, 2);

    const analytics = call("prototypeAnalytics", ctxA, { prototypeId: protoId });
    assert.equal(analytics.ok, true);
    assert.equal(analytics.result.totalInteractions, 2);
    assert.equal(analytics.result.misclickRate, 50);
    assert.equal(analytics.result.funnel[0].interactions, 2);
  });
});

describe("experience — error paths never throw", () => {
  it("missing-id macros return ok:false", () => {
    for (const [name, params] of [
      ["recordRun", { testId: "nope", tasks: [] }],
      ["recordClick", { studyId: "nope", x: 0.5, y: 0.5 }],
      ["heatmapResults", { studyId: "nope" }],
      ["submitCardSort", { studyId: "nope", groups: [] }],
      ["cardSortResults", { studyId: "nope" }],
      ["surveyResults", { surveyId: "nope" }],
      ["prototypeAnalytics", { prototypeId: "nope" }],
    ]) {
      const r = call(name, ctxA, params);
      assert.equal(r.ok, false, `${name} should fail gracefully`);
    }
  });
});
