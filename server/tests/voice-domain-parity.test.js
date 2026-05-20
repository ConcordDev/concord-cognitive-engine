// Contract tests for the voice lens — Otter.ai-shape recording /
// transcript substrate in server/domains/voice.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVoiceActions from "../domains/voice.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`voice.${name}`);
  assert.ok(fn, `voice.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerVoiceActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newRecording(ctx = ctxA, over = {}) {
  return call("recording-create", ctx, {
    title: "Standup",
    segments: [
      { speaker: "Ana", text: "Good morning everyone.", startSec: 0 },
      { speaker: "Ben", text: "I will ship the release today.", startSec: 8 },
      { speaker: "Ana", text: "We should review the metrics after lunch.", startSec: 16 },
    ],
    ...over,
  }).result.recording;
}

describe("voice.recording CRUD", () => {
  it("creates a recording with segments scoped per user", () => {
    const r = newRecording();
    assert.equal(r.segments.length, 3);
    assert.equal(call("recording-list", ctxA, {}).result.count, 1);
    assert.equal(call("recording-list", ctxB, {}).result.count, 0);
  });
  it("splits a raw transcript into segments", () => {
    const r = call("recording-create", ctxA, { title: "Memo", transcript: "First sentence. Second one. Third here." });
    assert.equal(r.result.recording.segments.length, 3);
  });
  it("rejects an untitled recording", () => {
    assert.equal(call("recording-create", ctxA, {}).ok, false);
  });
  it("rename + delete", () => {
    const r = newRecording();
    call("recording-rename", ctxA, { id: r.id, title: "Daily sync" });
    assert.equal(call("recording-detail", ctxA, { id: r.id }).result.recording.title, "Daily sync");
    call("recording-delete", ctxA, { id: r.id });
    assert.equal(call("recording-list", ctxA, {}).result.count, 0);
  });
});

describe("voice.segments + highlights", () => {
  it("edits a segment and invalidates the summary", () => {
    const r = newRecording();
    call("recording-summary", ctxA, { id: r.id });
    assert.ok(call("recording-detail", ctxA, { id: r.id }).result.recording.summary);
    call("segment-edit", ctxA, { recordingId: r.id, segmentId: r.segments[0].id, speaker: "Anabel" });
    const rec = call("recording-detail", ctxA, { id: r.id }).result.recording;
    assert.equal(rec.segments[0].speaker, "Anabel");
    assert.equal(rec.summary, null);
  });
  it("toggles a highlight on a segment", () => {
    const r = newRecording();
    const t = call("highlight-toggle", ctxA, { recordingId: r.id, segmentId: r.segments[1].id });
    assert.equal(t.result.highlighted, true);
    assert.equal(call("highlight-toggle", ctxA, { recordingId: r.id, segmentId: r.segments[1].id }).result.highlighted, false);
  });
});

describe("voice.summary", () => {
  it("extracts action items from action-cue segments", () => {
    const r = newRecording();
    const sum = call("recording-summary", ctxA, { id: r.id });
    assert.equal(sum.ok, true);
    assert.ok(sum.result.summary.actionItems.length >= 2); // "I will ship" + "We should review"
    assert.equal(sum.result.summary.speakers.length, 2);
  });
  it("uses highlights as key points when present", () => {
    const r = newRecording();
    call("highlight-toggle", ctxA, { recordingId: r.id, segmentId: r.segments[0].id });
    const sum = call("recording-summary", ctxA, { id: r.id });
    assert.equal(sum.result.summary.keyPoints.length, 1);
    assert.equal(sum.result.summary.keyPoints[0], "Good morning everyone.");
  });
});

describe("voice.search + dashboard", () => {
  it("transcript-search finds matching segments across recordings", () => {
    newRecording();
    const hits = call("transcript-search", ctxA, { query: "metrics" });
    assert.equal(hits.result.count, 1);
    assert.match(hits.result.hits[0].text, /metrics/);
  });
  it("voice-dashboard aggregates recordings + segments", () => {
    newRecording();
    const d = call("voice-dashboard", ctxA, {});
    assert.equal(d.result.recordings, 1);
    assert.equal(d.result.totalSegments, 3);
  });
});

describe("voice — analysis macros still intact", () => {
  it("transcriptAnalyze handles empty input", () => {
    const r = call("transcriptAnalyze", ctxA, {});
    assert.equal(r.ok, true);
  });
});
