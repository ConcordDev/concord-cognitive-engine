// tests/depth/voice-behavior.test.js — REAL behavioral tests for the voice
// domain (registerLensAction family, invoked via lensRun). Curated, high-
// confidence subset: exact-value transcript calcs (analyze / diarize /
// sentiment / keyword) + Otter.ai-shape CRUD round-trips (recordings, live
// sessions, voice-prints, meetings, shares, comments) + validation rejections.
//
// Every lensRun("voice", "<macro>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
//
// DELIBERATELY SKIPPED (network / LLM — never exercised here):
//   • transcript-translate    → egresses to the MyMemory translation API.
//   • recording-summary-llm   → routes to the subconscious brain (LLM).
// Their deterministic siblings (recording-summary, transcript-translations-list)
// ARE covered.
//
// SHAPE NOTE: a voice lens-action handler returns { ok:true, result:{…} } on
// success and { ok:false, error } on refusal. `lens.run` unwraps the success
// case (result := handlerResult.result) but a refusal has no `result` key so it
// passes through verbatim. Hence success → r.result.<field>; refusal →
// r.result.ok === false + r.result.error (same convention as logistics).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("voice — transcript calc contracts (exact computed values)", () => {
  it("transcriptAnalyze: exact word/sentence counts, filler detection, speaking rate", async () => {
    const r = await lensRun("voice", "transcriptAnalyze", {
      data: {
        transcript: "Um, this is basically great. We will, you know, succeed.",
        durationMinutes: 2,
      },
    });
    assert.equal(r.result.wordCount, 10); // Um, this is basically great. We will, you know, succeed.
    assert.equal(r.result.sentenceCount, 2); // split on . → 2 non-empty
    // 10 words over 2 minutes → 5 words/min.
    assert.equal(r.result.speakingRate, "5 words/min");
    // Fillers present: "um" (1), "basically" (1), "you know" (1) → 3.
    assert.equal(r.result.totalFillers, 3);
    assert.equal(r.result.fillerWords.um, 1);
    assert.equal(r.result.fillerWords.basically, 1);
    assert.equal(r.result.fillerWords["you know"], 1);
    assert.equal(r.result.avgWordsPerSentence, 5); // round(10/2 *10)/10
  });

  it("transcriptAnalyze: empty transcript returns the guidance message (no crash)", async () => {
    const r = await lensRun("voice", "transcriptAnalyze", { data: { transcript: "   " } });
    assert.ok(r.result.message.includes("Provide a transcript"));
  });

  it("speakerDiarize: word-share + dominant speaker computed exactly from segments", async () => {
    const r = await lensRun("voice", "speakerDiarize", {
      data: {
        segments: [
          { speaker: "Alice", text: "one two three four", startTime: 0, endTime: 4 }, // 4 words, 4s
          { speaker: "Bob",   text: "five six",          startTime: 4, endTime: 6 }, // 2 words, 2s
          { speaker: "Alice", text: "seven eight",       startTime: 6, endTime: 8 }, // 2 words, 2s
        ],
      },
    });
    assert.equal(r.result.speakerCount, 2);
    assert.equal(r.result.totalSegments, 3);
    assert.equal(r.result.totalWords, 8);
    assert.equal(r.result.totalDurationSeconds, 8);
    // Alice: 6 words / 8 → 75%; sorted first → dominant.
    assert.equal(r.result.dominantSpeaker, "Alice");
    const alice = r.result.speakers.find((sp) => sp.speaker === "Alice");
    assert.equal(alice.wordCount, 6);
    assert.equal(alice.wordShare, 75);
    assert.equal(alice.talkTimeSeconds, 6);
    // balanceRatio = least(Bob 2) / most(Alice 6) * 100 → 33.
    assert.equal(r.result.balanceRatio, 33);
  });

  it("speakerDiarize: empty input returns the guidance message", async () => {
    const r = await lensRun("voice", "speakerDiarize", { data: {} });
    assert.ok(r.result.message.includes("Provide segments"));
  });

  it("sentimentScore: positive transcript scores positive; negation flips polarity", async () => {
    const r = await lensRun("voice", "sentimentScore", {
      data: { transcript: "This is great and wonderful. I am happy." },
    });
    // 3 positive signals (great, wonderful, happy), 0 negative → score 1.
    assert.equal(r.result.overallScore, 1);
    assert.equal(r.result.overallLabel, "positive");
    assert.equal(r.result.totalPositiveSignals, 3);
    assert.equal(r.result.totalNegativeSignals, 0);

    const neg = await lensRun("voice", "sentimentScore", {
      data: { transcript: "This is not good." },
    });
    // "not good" → negated positive counts as negative → score -1.
    assert.equal(neg.result.overallScore, -1);
    assert.equal(neg.result.overallLabel, "negative");
    assert.equal(neg.result.totalNegativeSignals, 1);
  });

  it("keywordSpot: exact occurrence counts + density, with not-found list", async () => {
    const r = await lensRun("voice", "keywordSpot", {
      data: {
        transcript: "deploy the build then deploy again before the release",
        keywords: ["deploy", "release", "rollback"],
      },
    });
    assert.equal(r.result.keywordsSearched, 3);
    assert.equal(r.result.totalOccurrences, 3); // deploy×2 + release×1
    assert.equal(r.result.wordCount, 9);
    const deploy = r.result.topKeywords.find((k) => k.keyword === "deploy");
    assert.equal(deploy.count, 2);
    assert.deepEqual(r.result.notFound, ["rollback"]);
  });

  it("keywordSpot: no keywords returns guidance message", async () => {
    const r = await lensRun("voice", "keywordSpot", { data: { transcript: "hello world", keywords: [] } });
    assert.ok(r.result.message.includes("keywords array"));
  });
});

describe("voice — recording CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("voice-rec-crud"); });

  it("recording-create from segments → detail/list round-trip; duration derived", async () => {
    const created = await lensRun("voice", "recording-create", {
      params: {
        title: "Standup 6/8",
        folder: "Team",
        segments: [
          { speaker: "Ana", text: "We will ship the fix today.", startSec: 0 },
          { speaker: "Bo",  text: "Sounds good.",                startSec: 8 },
        ],
      },
    }, ctx);
    assert.equal(created.result.recording.title, "Standup 6/8");
    assert.equal(created.result.recording.folder, "Team");
    assert.equal(created.result.recording.segments.length, 2);
    // durFromSegments: last.startSec(8) + 5 → 13.
    assert.equal(created.result.recording.durationSec, 13);
    const id = created.result.recording.id;

    const detail = await lensRun("voice", "recording-detail", { params: { id } }, ctx);
    assert.equal(detail.result.recording.id, id);

    const list = await lensRun("voice", "recording-list", {}, ctx);
    const row = list.result.recordings.find((x) => x.id === id);
    assert.ok(row);
    assert.equal(row.segmentCount, 2);
    assert.equal(row.speakerCount, 2);
  });

  it("recording-create: missing title is rejected", async () => {
    const bad = await lensRun("voice", "recording-create", { params: { title: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /recording title required/);
  });

  it("recording-rename changes title + folder; missing recording rejected", async () => {
    const created = await lensRun("voice", "recording-create", { params: { title: "Draft", segments: [{ text: "hello", startSec: 0 }] } }, ctx);
    const id = created.result.recording.id;
    const ren = await lensRun("voice", "recording-rename", { params: { id, title: "Final", folder: "Archive" } }, ctx);
    assert.equal(ren.result.recording.title, "Final");
    assert.equal(ren.result.recording.folder, "Archive");
    const bad = await lensRun("voice", "recording-rename", { params: { id: "rec_nope", title: "X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /recording not found/);
  });

  it("segment-edit updates text + invalidates summary; bad ids rejected", async () => {
    const created = await lensRun("voice", "recording-create", { params: { title: "Edit Me", segments: [{ speaker: "S1", text: "original", startSec: 0 }] } }, ctx);
    const recId = created.result.recording.id;
    const segId = created.result.recording.segments[0].id;
    const edit = await lensRun("voice", "segment-edit", { params: { recordingId: recId, segmentId: segId, text: "revised", speaker: "S2" } }, ctx);
    assert.equal(edit.result.segment.text, "revised");
    assert.equal(edit.result.segment.speaker, "S2");
    const badSeg = await lensRun("voice", "segment-edit", { params: { recordingId: recId, segmentId: "sg_nope", text: "x" } }, ctx);
    assert.equal(badSeg.result.ok, false);
    assert.match(badSeg.result.error, /segment not found/);
  });

  it("highlight-toggle flips highlighted then back; reflected in recording-list", async () => {
    const created = await lensRun("voice", "recording-create", { params: { title: "Hi", segments: [{ text: "key point here", startSec: 0 }] } }, ctx);
    const recId = created.result.recording.id;
    const segId = created.result.recording.segments[0].id;
    const on = await lensRun("voice", "highlight-toggle", { params: { recordingId: recId, segmentId: segId } }, ctx);
    assert.equal(on.result.highlighted, true);
    const list = await lensRun("voice", "recording-list", {}, ctx);
    assert.equal(list.result.recordings.find((x) => x.id === recId).highlightCount, 1);
    const off = await lensRun("voice", "highlight-toggle", { params: { recordingId: recId, segmentId: segId } }, ctx);
    assert.equal(off.result.highlighted, false);
  });

  it("recording-summary picks action-cue segments as action items; sets hasSummary", async () => {
    const created = await lensRun("voice", "recording-create", {
      params: {
        title: "Sync",
        segments: [
          { speaker: "Lead", text: "We will ship the release on Friday.", startSec: 0 },
          { speaker: "Dev",  text: "The weather is nice today.",          startSec: 8 },
          { speaker: "Lead", text: "Make sure to update the docs.",       startSec: 16 },
        ],
      },
    }, ctx);
    const id = created.result.recording.id;
    const sum = await lensRun("voice", "recording-summary", { params: { id } }, ctx);
    // "We will ship" + "Make sure to update" both match ACTION_CUES → 2 items.
    assert.equal(sum.result.summary.actionItems.length, 2);
    assert.ok(sum.result.summary.speakers.includes("Lead"));
    const list = await lensRun("voice", "recording-list", {}, ctx);
    assert.equal(list.result.recordings.find((x) => x.id === id).hasSummary, true);
  });

  it("recording-summary: a recording with no transcript is rejected", async () => {
    const created = await lensRun("voice", "recording-create", { params: { title: "Empty", durationSec: 30 } }, ctx);
    const bad = await lensRun("voice", "recording-summary", { params: { id: created.result.recording.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no transcript/);
  });

  it("transcript-search finds the segment by substring; voice-dashboard tallies", async () => {
    const d = await depthCtx("voice-search-iso");
    await lensRun("voice", "recording-create", { params: { title: "Search Me", segments: [{ text: "the quarterly budget review", startSec: 0 }] } }, d);
    const hit = await lensRun("voice", "transcript-search", { params: { query: "quarterly budget" } }, d);
    assert.equal(hit.result.count, 1);
    assert.ok(hit.result.hits[0].text.includes("quarterly budget"));
    const empty = await lensRun("voice", "transcript-search", { params: { query: "nonexistent term" } }, d);
    assert.equal(empty.result.count, 0);
    const dash = await lensRun("voice", "voice-dashboard", {}, d);
    assert.equal(dash.result.recordings, 1);
    assert.equal(dash.result.totalSegments, 1);
  });

  it("transcript-search: empty query is rejected", async () => {
    const bad = await lensRun("voice", "transcript-search", { params: { query: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /query required/);
  });

  it("recording-delete removes a created recording; missing id rejected", async () => {
    const created = await lensRun("voice", "recording-create", { params: { title: "Trash", segments: [{ text: "x", startSec: 0 }] } }, ctx);
    const id = created.result.recording.id;
    const del = await lensRun("voice", "recording-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("voice", "recording-list", {}, ctx);
    assert.ok(!list.result.recordings.some((x) => x.id === id));
    const bad = await lensRun("voice", "recording-delete", { params: { id: "rec_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /recording not found/);
  });
});

describe("voice — live transcription session lifecycle (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("voice-live"); });

  it("live-start → live-append (interim then final) → live-detail tracks words", async () => {
    const start = await lensRun("voice", "live-start", { params: { title: "Live A", language: "en-US" } }, ctx);
    const sid = start.result.session.id;
    assert.equal(start.result.session.status, "live");

    // Interim word, then a final word that replaces nothing (different finality).
    const a1 = await lensRun("voice", "live-append", { params: { sessionId: sid, text: "hello", isFinal: false } }, ctx);
    assert.equal(a1.result.wordCount, 1);
    // Another interim replaces the trailing interim → still 1.
    const a2 = await lensRun("voice", "live-append", { params: { sessionId: sid, text: "hello there", isFinal: false } }, ctx);
    assert.equal(a2.result.wordCount, 1);
    // A final word appends.
    const a3 = await lensRun("voice", "live-append", { params: { sessionId: sid, text: "world", isFinal: true } }, ctx);
    assert.equal(a3.result.wordCount, 2);

    const detail = await lensRun("voice", "live-detail", { params: { sessionId: sid } }, ctx);
    assert.equal(detail.result.session.words.length, 2);
    const list = await lensRun("voice", "live-list", {}, ctx);
    assert.ok(list.result.sessions.some((g) => g.id === sid));
  });

  it("live-append: empty text + unknown session both rejected", async () => {
    const start = await lensRun("voice", "live-start", { params: { title: "Live B" } }, ctx);
    const sid = start.result.session.id;
    const noText = await lensRun("voice", "live-append", { params: { sessionId: sid, text: "  " } }, ctx);
    assert.equal(noText.result.ok, false);
    assert.match(noText.result.error, /text required/);
    const noSession = await lensRun("voice", "live-append", { params: { sessionId: "live_nope", text: "x" } }, ctx);
    assert.equal(noSession.result.ok, false);
    assert.match(noSession.result.error, /live session not found/);
  });

  it("live-finalize groups finals by speaker into a recording; re-finalize rejected", async () => {
    const start = await lensRun("voice", "live-start", { params: { title: "Live C" } }, ctx);
    const sid = start.result.session.id;
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "alpha", isFinal: true, speaker: "P1", atSec: 0 } }, ctx);
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "beta",  isFinal: true, speaker: "P1", atSec: 2 } }, ctx);
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "gamma", isFinal: true, speaker: "P2", atSec: 4 } }, ctx);
    const fin = await lensRun("voice", "live-finalize", { params: { sessionId: sid } }, ctx);
    // P1's two consecutive finals merge into one segment; P2 starts a new one → 2 segments.
    assert.equal(fin.result.recording.segments.length, 2);
    assert.equal(fin.result.recording.segments[0].speaker, "P1");
    assert.equal(fin.result.recording.segments[0].text, "alpha beta");
    assert.equal(fin.result.recording.folder, "Live sessions");
    assert.equal(fin.result.sessionId, sid);
    // Session now finalized → re-finalize rejected.
    const again = await lensRun("voice", "live-finalize", { params: { sessionId: sid } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already finalized/);
  });

  it("live-finalize: a session with no final words is rejected", async () => {
    const start = await lensRun("voice", "live-start", { params: { title: "Live D" } }, ctx);
    const sid = start.result.session.id;
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "interim only", isFinal: false } }, ctx);
    const bad = await lensRun("voice", "live-finalize", { params: { sessionId: sid } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no final words/);
  });
});

describe("voice — voice-print enrollment + identification (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("voice-prints"); });

  it("voiceprint-enroll new → list → re-enroll refines via running mean", async () => {
    const e1 = await lensRun("voice", "voiceprint-enroll", { params: { name: "Ana", vector: [1, 1, 1] } }, ctx);
    assert.equal(e1.result.refined, false);
    assert.equal(e1.result.voicePrint.sampleCount, 1);
    // Re-enroll Ana with [3,3,3] → running mean (1+3)/2 = 2 across dims.
    const e2 = await lensRun("voice", "voiceprint-enroll", { params: { name: "ana", vector: [3, 3, 3] } }, ctx);
    assert.equal(e2.result.refined, true);
    assert.equal(e2.result.voicePrint.sampleCount, 2);
    assert.deepEqual(e2.result.voicePrint.vector, [2, 2, 2]);
    const list = await lensRun("voice", "voiceprint-list", {}, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.voicePrints[0].dimensions, 3);
  });

  it("voiceprint-enroll: missing name + bad vector rejected", async () => {
    const noName = await lensRun("voice", "voiceprint-enroll", { params: { name: "", vector: [1, 2] } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.match(noName.result.error, /speaker name required/);
    const badVec = await lensRun("voice", "voiceprint-enroll", { params: { name: "Bo", vector: [1] } }, ctx); // < 2 features
    assert.equal(badVec.result.ok, false);
    assert.match(badVec.result.error, /vector required/);
  });

  it("voiceprint-identify: nearest enrolled print within threshold matches", async () => {
    const d = await depthCtx("voice-id-iso");
    await lensRun("voice", "voiceprint-enroll", { params: { name: "Near", vector: [0, 0, 0] } }, d);
    await lensRun("voice", "voiceprint-enroll", { params: { name: "Far",  vector: [10, 10, 10] } }, d);
    // Query [0.1,0,0] → distance to Near 0.1 (< 0.35), to Far ~17.3.
    const r = await lensRun("voice", "voiceprint-identify", { params: { vector: [0.1, 0, 0] } }, d);
    assert.equal(r.result.matched, true);
    assert.equal(r.result.speaker, "Near");
    assert.equal(r.result.bestDistance, 0.1);
    assert.ok(r.result.confidence > 0 && r.result.confidence <= 1);
  });

  it("voiceprint-identify: no print within threshold → not matched", async () => {
    const d = await depthCtx("voice-id-far");
    await lensRun("voice", "voiceprint-enroll", { params: { name: "Only", vector: [10, 10, 10] } }, d);
    const r = await lensRun("voice", "voiceprint-identify", { params: { vector: [0, 0, 0], threshold: 0.35 } }, d);
    assert.equal(r.result.matched, false);
    assert.equal(r.result.speaker, null);
    assert.equal(r.result.confidence, 0);
  });

  it("voiceprint-identify: no enrolled prints reports the reason; bad vector rejected", async () => {
    const d = await depthCtx("voice-id-empty");
    const none = await lensRun("voice", "voiceprint-identify", { params: { vector: [1, 2, 3] } }, d);
    assert.equal(none.result.matched, false);
    assert.match(none.result.reason, /no enrolled/);
    const badVec = await lensRun("voice", "voiceprint-identify", { params: { vector: [1] } }, d);
    assert.equal(badVec.result.ok, false);
    assert.match(badVec.result.error, /vector required/);
  });

  it("recording-auto-label-speakers relabels segments by nearest print; voiceprint-delete removes", async () => {
    const d = await depthCtx("voice-autolabel");
    await lensRun("voice", "voiceprint-enroll", { params: { name: "Speaker Ana", vector: [0, 0] } }, d);
    const rec = await lensRun("voice", "recording-create", {
      params: { title: "Tag", segments: [{ speaker: "Speaker 1", text: "matched seg", startSec: 0 }, { speaker: "Speaker 1", text: "no vector", startSec: 8 }] },
    }, d);
    const recId = rec.result.recording.id;
    // Inject an acoustic vector onto the first segment so it matches the "Speaker Ana" print.
    const detail = await lensRun("voice", "recording-detail", { params: { id: recId } }, d);
    detail.result.recording.segments[0].vector = [0.05, 0];
    const label = await lensRun("voice", "recording-auto-label-speakers", { params: { id: recId } }, d);
    assert.equal(label.result.totalSegments, 2);
    assert.equal(label.result.relabeled, 1);   // first seg → "Speaker Ana"
    assert.equal(label.result.unmatched, 1);   // second seg has no vector

    const vpList = await lensRun("voice", "voiceprint-list", {}, d);
    const vpId = vpList.result.voicePrints[0].id;
    const del = await lensRun("voice", "voiceprint-delete", { params: { id: vpId } }, d);
    assert.equal(del.result.deleted, vpId);
  });

  it("recording-auto-label-speakers: no enrolled prints is rejected", async () => {
    const d = await depthCtx("voice-autolabel-empty");
    const rec = await lensRun("voice", "recording-create", { params: { title: "NoPrints", segments: [{ text: "x", startSec: 0 }] } }, d);
    const bad = await lensRun("voice", "recording-auto-label-speakers", { params: { id: rec.result.recording.id } }, d);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no enrolled voice prints/);
  });
});

describe("voice — meeting bot lifecycle (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("voice-meetings"); });

  it("meeting-schedule → list → bot-join → bot-finalize produces a recording", async () => {
    const sched = await lensRun("voice", "meeting-schedule", {
      params: { title: "Quarterly Review", startAt: "2026-09-01T15:00:00.000Z", durationMin: 45, attendees: ["a@x.com", "b@x.com"] },
    }, ctx);
    assert.equal(sched.result.meeting.botStatus, "scheduled");
    assert.equal(sched.result.meeting.durationMin, 45);
    const mtgId = sched.result.meeting.id;

    const list = await lensRun("voice", "meeting-list", {}, ctx);
    assert.ok(list.result.meetings.some((m) => m.id === mtgId));

    const join = await lensRun("voice", "meeting-bot-join", { params: { id: mtgId } }, ctx);
    assert.equal(join.result.meeting.botStatus, "joined");
    const sessionId = join.result.session.id;
    // Re-join now rejected.
    const rejoin = await lensRun("voice", "meeting-bot-join", { params: { id: mtgId } }, ctx);
    assert.equal(rejoin.result.ok, false);
    assert.match(rejoin.result.error, /already joined/);

    // Stream a couple of final words into the bot's live session.
    await lensRun("voice", "live-append", { params: { sessionId, text: "agenda item one", isFinal: true, speaker: "Host", atSec: 0 } }, ctx);
    await lensRun("voice", "live-append", { params: { sessionId, text: "all approved", isFinal: true, speaker: "Host", atSec: 5 } }, ctx);

    const fin = await lensRun("voice", "meeting-bot-finalize", { params: { id: mtgId } }, ctx);
    assert.equal(fin.result.meeting.botStatus, "recorded");
    assert.equal(fin.result.recording.folder, "Meetings");
    assert.ok(fin.result.recording.segments.length >= 1);
  });

  it("meeting-schedule: missing title + bad startAt rejected", async () => {
    const noTitle = await lensRun("voice", "meeting-schedule", { params: { title: "", startAt: "2026-09-01T15:00:00.000Z" } }, ctx);
    assert.equal(noTitle.result.ok, false);
    assert.match(noTitle.result.error, /meeting title required/);
    const badDate = await lensRun("voice", "meeting-schedule", { params: { title: "X", startAt: "not-a-date" } }, ctx);
    assert.equal(badDate.result.ok, false);
    assert.match(badDate.result.error, /valid startAt/);
  });

  it("meeting-bot-finalize: a meeting whose bot never joined is rejected", async () => {
    const sched = await lensRun("voice", "meeting-schedule", { params: { title: "No Bot", startAt: "2026-10-01T10:00:00.000Z" } }, ctx);
    const bad = await lensRun("voice", "meeting-bot-finalize", { params: { id: sched.result.meeting.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /bot has not joined/);
  });

  it("meeting-cancel removes a scheduled meeting; missing id rejected", async () => {
    const sched = await lensRun("voice", "meeting-schedule", { params: { title: "Cancel Me", startAt: "2026-11-01T10:00:00.000Z" } }, ctx);
    const id = sched.result.meeting.id;
    const cancel = await lensRun("voice", "meeting-cancel", { params: { id } }, ctx);
    assert.equal(cancel.result.deleted, id);
    const bad = await lensRun("voice", "meeting-cancel", { params: { id: "mtg_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /meeting not found/);
  });
});

describe("voice — sharing + segment comments (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("voice-shares"); });

  it("recording-share adds collaborators idempotently; share-detail reads back", async () => {
    const rec = await lensRun("voice", "recording-create", { params: { title: "Shared Doc", segments: [{ text: "discuss this", startSec: 0 }] } }, ctx);
    const recId = rec.result.recording.id;
    const share = await lensRun("voice", "recording-share", { params: { id: recId, collaborators: ["userA", "userB", "userA"] } }, ctx);
    // userA deduped → 2 collaborators.
    assert.equal(share.result.share.collaborators.length, 2);
    const detail = await lensRun("voice", "share-detail", { params: { recordingId: recId } }, ctx);
    assert.equal(detail.result.shared, true);
    assert.ok(detail.result.share.collaborators.includes("userA"));
  });

  it("share-detail on an unshared recording reports shared:false", async () => {
    const rec = await lensRun("voice", "recording-create", { params: { title: "Private", segments: [{ text: "secret", startSec: 0 }] } }, ctx);
    const detail = await lensRun("voice", "share-detail", { params: { recordingId: rec.result.recording.id } }, ctx);
    assert.equal(detail.result.shared, false);
    assert.equal(detail.result.share, null);
  });

  it("segment-comment-add → list → delete round-trips; author-gated delete", async () => {
    const rec = await lensRun("voice", "recording-create", { params: { title: "Commented", segments: [{ id: "sg_fixed", text: "review here", startSec: 0 }] } }, ctx);
    const recId = rec.result.recording.id;
    const segId = rec.result.recording.segments[0].id;
    const add = await lensRun("voice", "segment-comment-add", { params: { recordingId: recId, segmentId: segId, body: "looks good" } }, ctx);
    assert.equal(add.result.commentCount, 1);
    const cmtId = add.result.comment.id;

    const list = await lensRun("voice", "segment-comments-list", { params: { recordingId: recId, segmentId: segId } }, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.comments[0].body, "looks good");

    const del = await lensRun("voice", "segment-comment-delete", { params: { recordingId: recId, commentId: cmtId } }, ctx);
    assert.equal(del.result.deleted, cmtId);
    const after = await lensRun("voice", "segment-comments-list", { params: { recordingId: recId } }, ctx);
    assert.equal(after.result.count, 0);
  });

  it("segment-comment-add: missing body + comment on unknown recording rejected", async () => {
    const rec = await lensRun("voice", "recording-create", { params: { title: "Body Test", segments: [{ text: "x", startSec: 0 }] } }, ctx);
    const recId = rec.result.recording.id;
    const segId = rec.result.recording.segments[0].id;
    const noBody = await lensRun("voice", "segment-comment-add", { params: { recordingId: recId, segmentId: segId, body: "  " } }, ctx);
    assert.equal(noBody.result.ok, false);
    assert.match(noBody.result.error, /comment body required/);
    const noRec = await lensRun("voice", "segment-comment-add", { params: { recordingId: "rec_nope", segmentId: "s", body: "hi" } }, ctx);
    assert.equal(noRec.result.ok, false);
    assert.match(noRec.result.error, /not found or not shared/);
  });

  it("recording-unshare removes a single collaborator then the whole share", async () => {
    const rec = await lensRun("voice", "recording-create", { params: { title: "Unshare Me", segments: [{ text: "x", startSec: 0 }] } }, ctx);
    const recId = rec.result.recording.id;
    await lensRun("voice", "recording-share", { params: { id: recId, collaborators: ["c1", "c2"] } }, ctx);
    const one = await lensRun("voice", "recording-unshare", { params: { id: recId, collaborator: "c1" } }, ctx);
    assert.ok(!one.result.share.collaborators.includes("c1"));
    assert.ok(one.result.share.collaborators.includes("c2"));
    const all = await lensRun("voice", "recording-unshare", { params: { id: recId } }, ctx);
    assert.equal(all.result.unshared, recId);
    const detail = await lensRun("voice", "share-detail", { params: { recordingId: recId } }, ctx);
    assert.equal(detail.result.shared, false);
  });
});

describe("voice — translations list (deterministic; translate itself is network-skipped)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("voice-xlate"); });

  it("transcript-translations-list returns empty for a fresh recording; missing id rejected", async () => {
    const rec = await lensRun("voice", "recording-create", { params: { title: "ToTranslate", segments: [{ text: "hola mundo", startSec: 0 }] } }, ctx);
    const list = await lensRun("voice", "transcript-translations-list", { params: { id: rec.result.recording.id } }, ctx);
    assert.equal(list.result.count, 0);
    assert.deepEqual(list.result.translations, []);
    const bad = await lensRun("voice", "transcript-translations-list", { params: { id: "rec_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /recording not found/);
  });
});
