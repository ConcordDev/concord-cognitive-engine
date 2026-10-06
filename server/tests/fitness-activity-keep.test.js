// tests/fitness-activity-keep.test.js — REAL end-to-end proof for the
// Fitness lens keep-and-draft workflow. Mirrors the established pattern
// (pets-health-record-keep, hvac-load-keep, …): create a real activity via
// `activity-create`, read it back via `activity-detail`, save it as a
// private DTU via `dtu.create`, read that DTU back via `dtu.get`, then draft
// it in Thread via `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("fitness activity keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("fitness-keep-proof"); });

  it("creates a real activity, details it, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real activity via the fitness domain macro.
    const created = await lensRun("fitness", "activity-create", {
      params: {
        type: "run",
        name: "Proof Run",
        distanceKm: 5.0,
        durationSec: 1500,
        elevationGainM: 30,
        avgHr: 150,
        maxHr: 165,
        calories: 320,
      },
    }, ctx);
    assert.equal(created.ok, true, "activity-create should succeed");
    const actId = created.result.activity.id;
    assert.ok(actId, "activity should have an id");

    // 2. Read the real activity detail.
    const detail = await lensRun("fitness", "activity-detail", { params: { id: actId } }, ctx);
    assert.equal(detail.ok, true, "activity-detail should succeed");
    const activity = detail.result.activity;
    assert.equal(activity.id, actId);
    assert.equal(activity.distanceKm, 5.0);
    assert.equal(activity.durationSec, 1500);
    assert.ok(activity.pace, "pace should be formatted");
    assert.ok(activity.duration, "duration should be formatted");

    // 3. Save the activity as a private DTU.
    const sentence = `Proof Run · ${activity.date}: 5 km, ${activity.duration}, ${activity.pace}/km, 320 kcal, 150 bpm avg, RE ${activity.relativeEffort}.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["fitness", "activity", "run"],
        source: "fitness-lens:activity-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "fitness_activity_report",
          activityId: actId,
          type: "run",
          name: "Proof Run",
          distanceKm: 5.0,
          durationSec: 1500,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "fitness" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 4. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 5. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Fitness activity — Proof Run",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 6. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to detail a non-existent activity", async () => {
    const r = await lensRun("fitness", "activity-detail", { params: { id: "act_does_not_exist" } }, ctx);
    // lens.run unwraps a handler's { ok:false, error } into r.result.{ok,error}.
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "activity not found");
  });
});