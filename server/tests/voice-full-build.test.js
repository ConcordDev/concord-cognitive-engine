// voice-full-build.test.js — B6 F-B build(voice) server pins.
//
// (S1/F1) sentimentScore reads the words as written: inflected forms
// match the lexicon (brilliantly→brilliant, loved→love, hated→hate) and
// proud/win count — the §2 constructed instrument (3 positive / 1
// negative sentences) scores its positives instead of net-negative.
// (S6/F6) live-end closes a session Save refuses: a no-final-words
// session leaves status "live" for "ended"; finalized sessions refuse
// in words; appends to an ended session refuse.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVoiceActions from "../domains/voice.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(`voice.${name}`);
  if (!fn) throw new Error(`voice.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

const ctx = { actor: { userId: "voice_user" }, userId: "voice_user" };

before(() => { registerVoiceActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

// The §2 instrument's sentences, as the pass describes them.
const INSTRUMENT = [
  "The launch went brilliantly and the budget held for launch day.",
  "Everyone loved the demo and it made the whole team proud.",
  "The budget review felt like a win for everyone.",
  "I hated the delay and it worried me badly.",
].join(" ");

describe("voice — S1 sentiment reads the words (F1/D1)", () => {
  it("the §2 instrument: three positive sentences counted, verdict not negative", () => {
    const r = call("sentimentScore", ctx, { data: { transcript: INSTRUMENT } });
    assert.equal(r.ok, true);
    assert.equal(r.result.segmentBreakdown.positive, 3);
    assert.equal(r.result.segmentBreakdown.negative, 1);
    assert.equal(r.result.segmentBreakdown.neutral, 0);
    assert.ok(r.result.overallScore > 0, `overall should lean positive, got ${r.result.overallScore}`);
    assert.notEqual(r.result.overallLabel, "negative");
    assert.deepEqual(r.result.segments.map((s) => s.label), ["positive", "positive", "positive", "negative"]);
  });

  it("inflection works on the negative side too, and negation still flips", () => {
    const neg = call("sentimentScore", ctx, { data: { transcript: "She hated it and the delays worried everyone." } });
    assert.equal(neg.result.segmentBreakdown.negative, 1);
    assert.equal(neg.result.overallLabel, "negative");
    const flipped = call("sentimentScore", ctx, { data: { transcript: "The update was not good at all." } });
    assert.equal(flipped.result.overallLabel, "negative");
    const plain = call("sentimentScore", ctx, { data: { transcript: "A terrible, awful failure." } });
    assert.equal(plain.result.overallLabel, "negative");
  });
});

describe("voice — S6 End is distinct from Save (F6/D5)", () => {
  it("an empty session: finalize refuses, live-end closes it, appends refuse", () => {
    const started = call("live-start", ctx, null, { title: "Empty session" });
    const sid = started.result.session.id;
    const fin = call("live-finalize", ctx, null, { sessionId: sid });
    assert.equal(fin.ok, false);
    assert.match(fin.error, /no final words/);
    const ended = call("live-end", ctx, null, { sessionId: sid });
    assert.equal(ended.ok, true);
    assert.equal(ended.result.status, "ended");
    assert.equal(ended.result.wordCount, 0);
    const list = call("live-list", ctx, null, {});
    const row = list.result.sessions.find((s) => s.id === sid);
    assert.equal(row.status, "ended");
    assert.ok(row.endedAt, "endedAt is stamped");
    const again = call("live-end", ctx, null, { sessionId: sid });
    assert.equal(again.ok, false);
    assert.match(again.error, /already ended/);
    const append = call("live-append", ctx, null, { sessionId: sid, text: "late words", isFinal: true });
    assert.equal(append.ok, false);
    assert.match(append.error, /not live/);
  });

  it("a saved session refuses live-end in words; the finalize path stands", () => {
    const started = call("live-start", ctx, null, { title: "Real session" });
    const sid = started.result.session.id;
    call("live-append", ctx, null, { sessionId: sid, text: "hello world", isFinal: true });
    const fin = call("live-finalize", ctx, null, { sessionId: sid });
    assert.equal(fin.ok, true);
    assert.ok(fin.result.recording.id, "finalize still mints the recording");
    const end = call("live-end", ctx, null, { sessionId: sid });
    assert.equal(end.ok, false);
    assert.match(end.error, /already saved as a recording/);
  });
});
