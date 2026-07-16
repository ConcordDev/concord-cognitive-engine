// tests/depth/voice-speaker-vector-behavior.test.js — REAL behavioral tests
// closing docs/WAVE4_INVENTORY.md's voice row: `recording-auto-label-speakers`
// was genuinely unreachable because no frontend code anywhere attached a
// per-segment acoustic `.vector` — recording-create's segments came from
// typed text or live ASR words, neither of which carried one (see
// docs/lens-specs/voice-capability-map.md's "Investigated and honestly
// deferred" section, and CLAUDE.md's DATA-SOURCING/ENGINEERING/CURATION
// triage — this was classed ENGINEERING: unbuilt capture logic, not a
// missing external data source).
//
// This closes the gap on the backend side: recording-create and
// live-append now accept an OPTIONAL per-segment/per-append `vector` field
// (validated when present, never required), live-finalize folds per-word
// vectors into a running-mean per-speaker-group vector (the exact
// accumulation shape voiceprint-enroll already uses for re-enrollment
// refinement), and recording-auto-label-speakers is exercised end-to-end
// against real enrolled voice-prints with both a matching and a
// non-matching case.
//
// Isolated DB via a unique DB_PATH so this file never collides with a
// parallel test run (established pattern — see the sibling
// agents-task-definitions-behavior.test.js).
import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/voice-speaker-vector-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("voice — optional per-segment/per-append vector: accepted + persisted", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`voice-vec-accept-${randomUUID()}`); });

  it("recording-create persists a segment's vector when supplied", async () => {
    const created = await lensRun("voice", "recording-create", {
      params: {
        title: "Vector Test",
        segments: [
          { speaker: "A", text: "hello there", startSec: 0, vector: [0.1, 0.2, 0.3] },
          { speaker: "B", text: "no vector here", startSec: 8 },
        ],
      },
    }, ctx);
    assert.equal(created.result.recording.segments[0].vector.length, 3);
    assert.deepEqual(created.result.recording.segments[0].vector, [0.1, 0.2, 0.3]);
    // Backward-compat: a segment with no vector field simply has none — no
    // fabricated placeholder is ever inserted.
    assert.equal(created.result.recording.segments[1].vector, undefined);

    // Round-trips through recording-detail (not just the create response).
    const detail = await lensRun("voice", "recording-detail", { params: { id: created.result.recording.id } }, ctx);
    assert.deepEqual(detail.result.recording.segments[0].vector, [0.1, 0.2, 0.3]);
  });

  it("recording-create: a malformed segment vector is honestly rejected, not silently dropped", async () => {
    const notArray = await lensRun("voice", "recording-create", {
      params: { title: "Bad Vec 1", segments: [{ text: "x", startSec: 0, vector: "not-an-array" }] },
    }, ctx);
    assert.equal(notArray.result.ok, false);
    assert.match(notArray.result.error, /segment vector invalid/);
    assert.match(notArray.result.error, /must be an array/);

    const tooShort = await lensRun("voice", "recording-create", {
      params: { title: "Bad Vec 2", segments: [{ text: "x", startSec: 0, vector: [1] }] },
    }, ctx);
    assert.equal(tooShort.result.ok, false);
    assert.match(tooShort.result.error, /at least 2 dimensions/);

    const nonFinite = await lensRun("voice", "recording-create", {
      params: { title: "Bad Vec 3", segments: [{ text: "x", startSec: 0, vector: [1, NaN, 3] }] },
    }, ctx);
    assert.equal(nonFinite.result.ok, false);
    assert.match(nonFinite.result.error, /finite numbers/);

    // A malformed vector on one segment rejects the WHOLE create call —
    // it must not silently create a recording missing that segment's data.
    const list = await lensRun("voice", "recording-list", {}, ctx);
    assert.ok(!list.result.recordings.some((r) => r.title.startsWith("Bad Vec")));
  });

  it("recording-create: null/omitted vector is accepted (fully backward-compatible)", async () => {
    const created = await lensRun("voice", "recording-create", {
      params: { title: "No Vec", segments: [{ text: "plain text", startSec: 0, vector: null }] },
    }, ctx);
    assert.equal(created.result.ok, undefined); // no `ok:false` — real success
    assert.equal(created.result.recording.segments[0].vector, undefined);
  });

  it("live-append persists a vector on the accepted word; malformed vector rejected", async () => {
    const start = await lensRun("voice", "live-start", { params: { title: "Vec Live" } }, ctx);
    const sid = start.result.session.id;

    const ok = await lensRun("voice", "live-append", {
      params: { sessionId: sid, text: "alpha", isFinal: true, vector: [0.5, 0.6, 0.7] },
    }, ctx);
    assert.deepEqual(ok.result.accepted.vector, [0.5, 0.6, 0.7]);

    const noVec = await lensRun("voice", "live-append", {
      params: { sessionId: sid, text: "beta", isFinal: true },
    }, ctx);
    assert.equal(noVec.result.accepted.vector, undefined);

    const bad = await lensRun("voice", "live-append", {
      params: { sessionId: sid, text: "gamma", isFinal: true, vector: ["a", "b"] },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /vector invalid/);
    assert.match(bad.result.error, /finite numbers/);
  });
});

describe("voice — live-finalize averages per-speaker-group vectors (running mean)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`voice-vec-finalize-${randomUUID()}`); });

  it("two consecutive same-speaker finals: vector is the exact running mean, hand-verified", async () => {
    const start = await lensRun("voice", "live-start", { params: { title: "Avg Test" } }, ctx);
    const sid = start.result.session.id;
    // P1 speaks two consecutive finals with vectors [1,1,1] then [3,3,3].
    // Running mean (same accumulation shape as voiceprint-enroll's
    // re-enrollment refinement): after word 1, vector=[1,1,1], n=1.
    // After word 2: vector[i] = (vector[i]*n + new[i]) / (n+1)
    //             = (1*1 + 3) / 2 = 2  for every dimension → [2,2,2].
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "one", isFinal: true, speaker: "P1", atSec: 0, vector: [1, 1, 1] } }, ctx);
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "two", isFinal: true, speaker: "P1", atSec: 2, vector: [3, 3, 3] } }, ctx);
    // A different speaker starts a new segment — must not pollute P1's average.
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "three", isFinal: true, speaker: "P2", atSec: 4, vector: [10, 10, 10] } }, ctx);

    const fin = await lensRun("voice", "live-finalize", { params: { sessionId: sid } }, ctx);
    assert.equal(fin.result.recording.segments.length, 2);
    const p1 = fin.result.recording.segments.find((s) => s.speaker === "P1");
    const p2 = fin.result.recording.segments.find((s) => s.speaker === "P2");
    assert.equal(p1.text, "one two");
    assert.deepEqual(p1.vector, [2, 2, 2]);
    // P2's single-word segment carries its own vector unaveraged.
    assert.deepEqual(p2.vector, [10, 10, 10]);
  });

  it("a three-word same-speaker run averages correctly: [0,0] , [3,0] , [3,3] -> [2,1]", async () => {
    // Hand-verified: running mean after each step —
    //   step1: [0,0]                         (n=1)
    //   step2: ((0*1+3)/2, (0*1+0)/2) = [1.5, 0]   (n=2)
    //   step3: ((1.5*2+3)/3, (0*2+3)/3) = (6/3, 3/3) = [2, 1]  (n=3)
    // which also equals the plain arithmetic mean of the three vectors:
    //   mean_x = (0+3+3)/3 = 2, mean_y = (0+0+3)/3 = 1 — running mean and
    // batch mean agree, as they must for equal-weight samples.
    const start = await lensRun("voice", "live-start", { params: { title: "Three Word Avg" } }, ctx);
    const sid = start.result.session.id;
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "a", isFinal: true, speaker: "S", atSec: 0, vector: [0, 0] } }, ctx);
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "b", isFinal: true, speaker: "S", atSec: 1, vector: [3, 0] } }, ctx);
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "c", isFinal: true, speaker: "S", atSec: 2, vector: [3, 3] } }, ctx);
    const fin = await lensRun("voice", "live-finalize", { params: { sessionId: sid } }, ctx);
    assert.equal(fin.result.recording.segments.length, 1);
    assert.deepEqual(fin.result.recording.segments[0].vector, [2, 1]);
  });

  it("a speaker segment with no vectored words at all carries no vector (no fabrication)", async () => {
    const start = await lensRun("voice", "live-start", { params: { title: "No Vec Live" } }, ctx);
    const sid = start.result.session.id;
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "plain", isFinal: true, speaker: "Q", atSec: 0 } }, ctx);
    const fin = await lensRun("voice", "live-finalize", { params: { sessionId: sid } }, ctx);
    assert.equal(fin.result.recording.segments[0].vector, undefined);
  });
});

describe("voice — recording-auto-label-speakers is genuinely reachable end-to-end", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`voice-vec-autolabel-${randomUUID()}`); });

  it("a segment vector close to an enrolled print matches; a far one does not (real, not manually injected)", async () => {
    // Enroll two speakers with distinct acoustic prints.
    await lensRun("voice", "voiceprint-enroll", { params: { name: "Priya", vector: [0.1, 0.2, 0.3, 0.1, 0.2] } }, ctx);
    await lensRun("voice", "voiceprint-enroll", { params: { name: "Devon", vector: [0.9, 0.8, 0.7, 0.9, 0.8] } }, ctx);

    // Create a recording via the now-real capture path: recording-create
    // with per-segment vectors, exactly what the shared Web Audio
    // extraction produces client-side. One segment is acoustically close
    // to Priya's print; the other is far from both enrolled prints.
    const rec = await lensRun("voice", "recording-create", {
      params: {
        title: "Real Auto-Label",
        segments: [
          { speaker: "Speaker 1", text: "definitely priya talking", startSec: 0, vector: [0.11, 0.19, 0.31, 0.09, 0.21] },
          { speaker: "Speaker 1", text: "an unrecognized voice", startSec: 8, vector: [5, 5, 5, 5, 5] },
        ],
      },
    }, ctx);
    const recId = rec.result.recording.id;

    const label = await lensRun("voice", "recording-auto-label-speakers", { params: { id: recId } }, ctx);
    assert.equal(label.result.totalSegments, 2);
    assert.equal(label.result.relabeled, 1);
    assert.equal(label.result.unmatched, 1);
    assert.equal(Array.isArray(label.result.matches), true);
    assert.equal(label.result.matches.length, 2);

    const closeMatch = label.result.matches.find((m) => m.segmentId === rec.result.recording.segments[0].id);
    assert.equal(closeMatch.matched, true);
    assert.equal(closeMatch.speaker, "Priya");
    assert.ok(closeMatch.distance < 0.35);
    assert.ok(closeMatch.confidence > 0 && closeMatch.confidence <= 1);

    const farMatch = label.result.matches.find((m) => m.segmentId === rec.result.recording.segments[1].id);
    assert.equal(farMatch.matched, false);
    assert.equal(farMatch.reason, "no_print_within_threshold");

    // The applied label is real — recording-detail reflects it, not just
    // the auto-label response.
    const detail = await lensRun("voice", "recording-detail", { params: { id: recId } }, ctx);
    assert.equal(detail.result.recording.segments[0].speaker, "Priya");
    assert.equal(detail.result.recording.segments[0].speakerSource, "voiceprint");
    // The unmatched segment keeps its original (pre-existing) speaker label.
    assert.equal(detail.result.recording.segments[1].speaker, "Speaker 1");
  });

  it("a live/meeting-style recording reaches auto-label via live-finalize's averaged vector", async () => {
    const d = await depthCtx(`voice-vec-autolabel-live-${randomUUID()}`);
    await lensRun("voice", "voiceprint-enroll", { params: { name: "Amara", vector: [1, 1, 1] } }, d);

    const start = await lensRun("voice", "live-start", { params: { title: "Live Autolabel" } }, d);
    const sid = start.result.session.id;
    // Two words average to [1,1,1] exactly — a perfect match to Amara's print.
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "hi", isFinal: true, speaker: "Speaker 1", atSec: 0, vector: [0.5, 0.5, 0.5] } }, d);
    await lensRun("voice", "live-append", { params: { sessionId: sid, text: "there", isFinal: true, speaker: "Speaker 1", atSec: 1, vector: [1.5, 1.5, 1.5] } }, d);
    const fin = await lensRun("voice", "live-finalize", { params: { sessionId: sid } }, d);
    assert.deepEqual(fin.result.recording.segments[0].vector, [1, 1, 1]);

    const label = await lensRun("voice", "recording-auto-label-speakers", { params: { id: fin.result.recording.id } }, d);
    assert.equal(label.result.relabeled, 1);
    assert.equal(label.result.matches[0].speaker, "Amara");
    assert.equal(label.result.matches[0].distance, 0);
  });
});
