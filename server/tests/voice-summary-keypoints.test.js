// voice-summary-keypoints.test.js
//
// FIX-voice-010: the deterministic recording-summary's key points
// were the five LONGEST segments repeated verbatim — whole
// multi-sentence blocks, not a summary. The fallback is now
// sentence-level extractive scoring: the transcript's most central
// sentences (by content-word frequency), deduped, in order.
// Highlights remain the user's own picks, unchanged.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let registerVoiceActions;
let actions;

before(async () => {
  ({ default: registerVoiceActions } = await import("../domains/voice.js"));
  actions = new Map();
  registerVoiceActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  globalThis._concordSTATE = {};
});

function call(name, userId, params = {}) {
  const fn = actions.get(`voice.${name}`);
  assert.ok(fn, `voice.${name} registered`);
  return fn({ userId }, { id: null, data: params, meta: {} }, params);
}

describe("voice recording-summary key points (FIX-voice-010)", () => {
  it("picks the central sentences, not the longest segment verbatim", () => {
    // Segments ride recording-create's `segments` param. A long,
    // off-topic block (the old algorithm's first pick) vs shorter
    // sentences circling the meeting's actual topic.
    const r = call("recording-create", "u1", { title: "Launch sync", segments: [
      { speaker: "Ana", text: "The weather in the valley was bright all morning and the drive over took a while because traffic near the river was slow and everyone talked about weekend plans and the food truck schedule for the whole first part before we got started on anything real.", startSec: 0 },
      { speaker: "Ben", text: "The launch date moves to Friday.", startSec: 30 },
      { speaker: "Ana", text: "Launch readiness depends on the launch checklist.", startSec: 60 },
      { speaker: "Ben", text: "We freeze launch features on Wednesday before the launch.", startSec: 90 },
      { speaker: "Ana", text: "Marketing confirms the launch announcement for launch week.", startSec: 120 },
      { speaker: "Ben", text: "Support prepares the launch FAQ before launch day.", startSec: 150 },
      { speaker: "Ana", text: "Someone mentioned parking near the office.", startSec: 180 },
    ] }).result.recording;

    const sum = call("recording-summary", "u1", { id: r.id });
    assert.equal(sum.ok, true);
    const kp = sum.result.summary.keyPoints;
    assert.ok(kp.length >= 2 && kp.length <= 5, `expected a short extract, got ${kp.length}`);
    // The launch sentences dominate the extract...
    assert.ok(kp.some((p) => p.includes("launch")), `key points should centre on the topic: ${JSON.stringify(kp)}`);
    // ...and no key point is the whole rambling segment verbatim.
    assert.ok(!kp.some((p) => p.includes("food truck")), `the off-topic block must not be a key point: ${JSON.stringify(kp)}`);
    // Every point is a single sentence (no multi-sentence blocks).
    for (const p of kp) {
      const ends = (p.match(/[.!?](\s|$)/g) || []).length;
      assert.ok(ends <= 1, `key point should be one sentence: ${p}`);
    }
  });

  it("dedupes a repeated sentence and keeps highlights verbatim", () => {
    const r = call("recording-create", "u1", { title: "Standup", segments: [
      { speaker: "Ana", text: "We ship the beta on Monday.", startSec: 0 },
      { speaker: "Ben", text: "We ship the beta on Monday.", startSec: 10 },
    ] }).result.recording;
    const sum = call("recording-summary", "u1", { id: r.id });
    const matches = sum.result.summary.keyPoints.filter((p) => p.includes("ship the beta"));
    assert.equal(matches.length, 1, "the repeated sentence appears once");

    call("highlight-toggle", "u1", { recordingId: r.id, segmentId: r.segments[0].id });
    const sum2 = call("recording-summary", "u1", { id: r.id });
    assert.deepEqual(sum2.result.summary.keyPoints, ["We ship the beta on Monday."]);
  });
});
