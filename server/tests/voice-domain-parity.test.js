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

// ─── Backlog item 1 — live in-browser transcription ───────────────────
describe("voice.live transcription", () => {
  it("starts a live session, appends words, and finalizes into a recording", () => {
    const start = call("live-start", ctxA, { title: "Live note", language: "en-US" });
    assert.equal(start.ok, true);
    const sid = start.result.session.id;
    assert.equal(start.result.session.status, "live");

    assert.equal(call("live-append", ctxA, { sessionId: sid, text: "hello there", isFinal: true, atSec: 0, speaker: "Ana" }).ok, true);
    // Interim chunk replaces trailing interim.
    call("live-append", ctxA, { sessionId: sid, text: "interim", isFinal: false, atSec: 1, speaker: "Ana" });
    const replaced = call("live-append", ctxA, { sessionId: sid, text: "final now", isFinal: false, atSec: 1, speaker: "Ana" });
    assert.equal(replaced.result.wordCount, 2);

    const detail = call("live-detail", ctxA, { sessionId: sid });
    assert.ok(detail.result.session.words.length >= 1);

    const fin = call("live-finalize", ctxA, { sessionId: sid });
    assert.equal(fin.ok, true);
    assert.ok(fin.result.recording.id);
    assert.equal(call("live-finalize", ctxA, { sessionId: sid }).ok, false);
  });
  it("live-list reports sessions scoped per user", () => {
    call("live-start", ctxA, { title: "A session" });
    assert.equal(call("live-list", ctxA, {}).result.count, 1);
    assert.equal(call("live-list", ctxB, {}).result.count, 0);
  });
});

// ─── Backlog item 2 — LLM-written meeting summary ─────────────────────
describe("voice.recording-summary-llm", () => {
  it("falls back gracefully when no llm is available", async () => {
    const r = newRecording();
    const res = await call("recording-summary-llm", ctxA, { id: r.id });
    assert.equal(res.ok, false);
    assert.match(res.error, /llm unavailable/);
  });
  it("composes a structured summary from an llm response", async () => {
    const r = newRecording();
    const llmCtx = {
      ...ctxA,
      llm: { chat: async () => ({ text: JSON.stringify({
        tldr: "Standup overview.",
        keyPoints: ["Release scheduled"],
        decisions: ["Ship today"],
        actionItems: [{ task: "Review metrics", owner: "Ana" }],
        openQuestions: ["When is the demo?"],
        topics: ["release"],
      }) }) },
    };
    const res = await call("recording-summary-llm", llmCtx, { id: r.id });
    assert.equal(res.ok, true);
    assert.equal(res.result.summary.composer, "llm");
    assert.equal(res.result.summary.tldr, "Standup overview.");
    assert.equal(res.result.summary.actionItems[0].owner, "Ana");
  });
});

// ─── Backlog item 3 — automatic speaker identification ────────────────
describe("voice.voiceprint identification", () => {
  it("enrolls, refines, identifies, and deletes a voice-print", () => {
    const e1 = call("voiceprint-enroll", ctxA, { name: "Ana", vector: [0.2, 0.5, 0.3, 0.1, 0.4] });
    assert.equal(e1.ok, true);
    assert.equal(e1.result.refined, false);
    const e2 = call("voiceprint-enroll", ctxA, { name: "Ana", vector: [0.22, 0.52, 0.31, 0.12, 0.41] });
    assert.equal(e2.result.refined, true);
    assert.equal(e2.result.voicePrint.sampleCount, 2);

    assert.equal(call("voiceprint-list", ctxA, {}).result.count, 1);

    const id = call("voiceprint-identify", ctxA, { vector: [0.21, 0.51, 0.3, 0.11, 0.4] });
    assert.equal(id.result.matched, true);
    assert.equal(id.result.speaker, "Ana");

    const miss = call("voiceprint-identify", ctxA, { vector: [9, 9, 9, 9, 9] });
    assert.equal(miss.result.matched, false);

    call("voiceprint-delete", ctxA, { id: e1.result.voicePrint.id });
    assert.equal(call("voiceprint-list", ctxA, {}).result.count, 0);
  });
  it("rejects an enroll with no acoustic vector", () => {
    assert.equal(call("voiceprint-enroll", ctxA, { name: "X" }).ok, false);
  });
});

// ─── Backlog item 4 — meeting-bot integration ─────────────────────────
describe("voice.meeting bot", () => {
  it("schedules a meeting, joins with the bot, and finalizes a recording", () => {
    const startAt = new Date(Date.now() + 3600000).toISOString();
    const m = call("meeting-schedule", ctxA, { title: "Sync", startAt, durationMin: 45, attendees: ["a@x.io"] });
    assert.equal(m.ok, true);
    const mid = m.result.meeting.id;
    assert.equal(m.result.meeting.botStatus, "scheduled");

    assert.equal(call("meeting-list", ctxA, {}).result.count, 1);

    const join = call("meeting-bot-join", ctxA, { id: mid });
    assert.equal(join.ok, true);
    assert.equal(join.result.meeting.botStatus, "joined");
    const sid = join.result.session.id;

    call("live-append", ctxA, { sessionId: sid, text: "Welcome to the sync.", isFinal: true, atSec: 0, speaker: "Ana" });
    const done = call("meeting-bot-finalize", ctxA, { id: mid });
    assert.equal(done.ok, true);
    assert.equal(done.result.meeting.botStatus, "recorded");
    assert.ok(done.result.recording.id);
  });
  it("rejects an undated meeting and cancels a scheduled one", () => {
    assert.equal(call("meeting-schedule", ctxA, { title: "No date" }).ok, false);
    const m = call("meeting-schedule", ctxA, { title: "Cancelme", startAt: new Date(Date.now() + 7200000).toISOString() });
    call("meeting-cancel", ctxA, { id: m.result.meeting.id });
    assert.equal(call("meeting-list", ctxA, {}).result.count, 0);
  });
});

// ─── Backlog item 6 — share + segment comments ────────────────────────
describe("voice.recording share + comments", () => {
  it("shares a recording, adds + lists + deletes a segment comment", () => {
    const r = newRecording();
    const shared = call("recording-share", ctxA, { id: r.id, collaborators: ["user_b"] });
    assert.equal(shared.ok, true);
    assert.deepEqual(shared.result.share.collaborators, ["user_b"]);

    assert.equal(call("share-detail", ctxA, { recordingId: r.id }).result.shared, true);

    const c = call("segment-comment-add", ctxA, { recordingId: r.id, segmentId: r.segments[0].id, body: "Good point" });
    assert.equal(c.ok, true);
    // The collaborator can comment too.
    const c2 = call("segment-comment-add", ctxB, { recordingId: r.id, segmentId: r.segments[0].id, body: "Agreed" });
    assert.equal(c2.ok, true);

    const list = call("segment-comments-list", ctxA, { recordingId: r.id, segmentId: r.segments[0].id });
    assert.equal(list.result.count, 2);

    call("segment-comment-delete", ctxA, { recordingId: r.id, commentId: c.result.comment.id });
    assert.equal(call("segment-comments-list", ctxA, { recordingId: r.id }).result.count, 1);

    call("recording-unshare", ctxA, { id: r.id });
    assert.equal(call("share-detail", ctxA, { recordingId: r.id }).result.shared, false);
  });
  it("rejects a comment on a recording not shared with the caller", () => {
    const r = newRecording();
    assert.equal(call("segment-comment-add", ctxB, { recordingId: r.id, segmentId: r.segments[0].id, body: "hi" }).ok, false);
  });
});

// ─── Backlog item 7 — multi-language translation ──────────────────────
describe("voice.transcript-translate", () => {
  it("rejects an invalid or same-language target", async () => {
    const r = newRecording();
    assert.equal((await call("transcript-translate", ctxA, { id: r.id, targetLang: "??" })).ok, false);
    assert.equal((await call("transcript-translate", ctxA, { id: r.id, targetLang: "en", sourceLang: "en" })).ok, false);
  });
  it("translations-list returns an empty array before any translation", () => {
    const r = newRecording();
    const res = call("transcript-translations-list", ctxA, { id: r.id });
    assert.equal(res.ok, true);
    assert.equal(res.result.count, 0);
  });
});
