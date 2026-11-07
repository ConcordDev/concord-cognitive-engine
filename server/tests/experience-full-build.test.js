// experience-full-build.test.js — pins for the Experience full lens build
// (F-C row 23, the family closer): S4 clip run-validation and the S3
// lifecycle exits over the suite's per-user collections.
//
// Pattern mirrors experience-domain-parity.test.js: the domain module is
// registered into a local action map and driven directly, no server boot.
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
  if (globalThis._concordSTATE) globalThis._concordSTATE.experienceLens = undefined;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function seedRun(ctx) {
  const t = call("createTest", ctx, { name: "Checkout flow", tasks: ["Find the cart"] });
  const testId = t.result.test.id;
  const taskId = t.result.test.tasks[0].id;
  const run = call("recordRun", ctx, {
    testId, participant: "P1",
    tasks: [{ taskId, success: true, durationMs: 3000, events: [] }],
  });
  return { testId, runId: run.result.run.id };
}

describe("experience full build — S4 clip run-validation", () => {
  it("a clip against a nonexistent run is refused with the run named", () => {
    seedRun(ctxA);
    const r = call("createClip", ctxA, { runId: "uxr_probe_nonexistent_1031", label: "Probe" });
    assert.equal(r.ok, false);
    assert.match(r.error, /run not found: uxr_probe_nonexistent_1031/);
    assert.equal(call("listClips", ctxA, {}).result.count, 0);
  });

  it("a clip against the caller's own recorded run stands", () => {
    const { runId } = seedRun(ctxA);
    const r = call("createClip", ctxA, { runId, label: "Real cut" });
    assert.equal(r.ok, true);
    assert.equal(call("listClips", ctxA, {}).result.count, 1);
  });

  it("another account's run does not validate a clip", () => {
    const { runId } = seedRun(ctxA);
    const r = call("createClip", ctxB, { runId, label: "Not mine" });
    assert.equal(r.ok, false);
    assert.match(r.error, /run not found/);
  });
});

describe("experience full build — S3 lifecycle exits", () => {
  it("the delete verbs are registered for every suite collection", () => {
    for (const name of ["deleteTest", "deleteRun", "deleteHeatmapStudy", "deleteCardSort",
      "deleteSurvey", "deleteResponse", "deleteParticipant", "deleteClip", "deleteReel", "deletePrototype"]) {
      assert.ok(ACTIONS.has(`experience.${name}`), `experience.${name} registered`);
    }
    assert.ok(ACTIONS.has("experience.listReels"), "experience.listReels registered");
  });

  it("deleteTest cascades to its runs and their clips; unknown ids refuse in words", () => {
    const { testId, runId } = seedRun(ctxA);
    call("createClip", ctxA, { runId, label: "Cut" });
    const r = call("deleteTest", ctxA, { testId });
    assert.equal(r.ok, true);
    assert.equal(r.result.removedRuns, 1);
    assert.equal(r.result.removedClips, 1);
    assert.equal(call("listTests", ctxA, {}).result.count, 0);
    assert.equal(call("listRuns", ctxA, {}).result.count, 0);
    assert.equal(call("listClips", ctxA, {}).result.count, 0);
    const again = call("deleteTest", ctxA, { testId });
    assert.equal(again.ok, false);
    assert.equal(again.error, "test not found");
  });

  it("deleteRun removes the run and its clips only", () => {
    const { runId } = seedRun(ctxA);
    call("createClip", ctxA, { runId, label: "Cut" });
    const r = call("deleteRun", ctxA, { runId });
    assert.equal(r.ok, true);
    assert.equal(r.result.removedClips, 1);
    assert.equal(call("listTests", ctxA, {}).result.count, 1);
    assert.equal(call("listRuns", ctxA, {}).result.count, 0);
  });

  it("survey, participant, prototype, study, sort, reel and response deletes round-trip", () => {
    const s = call("createSurvey", ctxA, { name: "NPS", template: "nps" });
    const surveyId = s.result.survey.id;
    const resp = call("submitSurveyResponse", ctxA, { surveyId, respondent: "R1", answers: {} });
    const rd = call("deleteResponse", ctxA, { responseId: resp.result.response.id });
    assert.equal(rd.ok, true);
    const sd = call("deleteSurvey", ctxA, { surveyId });
    assert.equal(sd.ok, true);
    assert.equal(call("listSurveys", ctxA, {}).result.count, 0);

    const p = call("addParticipant", ctxA, { name: "Alex" });
    assert.equal(call("deleteParticipant", ctxA, { participantId: p.result.participant.id }).ok, true);
    assert.equal(call("listPanel", ctxA, {}).result.count, 0);

    const proto = call("createPrototype", ctxA, { name: "Onboarding", embedUrl: "https://figma.com/proto/x", frames: ["Welcome"] });
    call("recordInteraction", ctxA, { prototypeId: proto.result.prototype.id, frameId: proto.result.prototype.frames[0].id, x: 0.5, y: 0.5 });
    const pd = call("deletePrototype", ctxA, { prototypeId: proto.result.prototype.id });
    assert.equal(pd.ok, true);
    assert.equal(pd.result.removedInteractions, 1);
    assert.equal(call("listPrototypes", ctxA, {}).result.count, 0);

    const hm = call("createHeatmapStudy", ctxA, { name: "Nav" });
    assert.equal(call("deleteHeatmapStudy", ctxA, { studyId: hm.result.study.id }).ok, true);
    assert.equal(call("deleteHeatmapStudy", ctxA, { studyId: hm.result.study.id }).error, "study not found");

    const cs = call("createCardSort", ctxA, { name: "IA", cards: ["Settings"] });
    assert.equal(call("deleteCardSort", ctxA, { studyId: cs.result.study.id }).ok, true);

    const { runId } = seedRun(ctxA);
    const clip = call("createClip", ctxA, { runId, label: "Cut" });
    const reel = call("buildReel", ctxA, { name: "Reel", clipIds: [clip.result.clip.id] });
    assert.equal(call("listReels", ctxA, {}).result.count, 1);
    assert.equal(call("deleteReel", ctxA, { reelId: reel.result.reel.id }).ok, true);
    // The reel goes; its clips stay.
    assert.equal(call("listClips", ctxA, {}).result.count, 1);
    assert.equal(call("deleteClip", ctxA, { clipId: clip.result.clip.id }).ok, true);
    assert.equal(call("listClips", ctxA, {}).result.count, 0);
  });

  it("deletes are scoped to the caller's own collections", () => {
    const { testId } = seedRun(ctxA);
    const r = call("deleteTest", ctxB, { testId });
    assert.equal(r.ok, false);
    assert.equal(call("listTests", ctxA, {}).result.count, 1);
  });
});
