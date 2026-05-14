/**
 * Tier-2 contract tests for the persona/natural-language engine.
 *
 * Pinned:
 *   - blocklists: scoreText counts tells; isCleanVoice gates exemplars
 *   - humanizer: opener strip, phrase strip, tricolon break, neg-parallel
 *     strip, burstiness rebalance, deterministic, sentence-start
 *     recapitalisation, intensity respected
 *   - idiolect-store: splitSentences handles abbreviations, extractIdiolect
 *     filters by length + cleanliness + distinctness, persistIdiolect
 *     fire-and-forget, getIdiolectSamples filters by tag + recency mix
 *
 * Run: node --test server/tests/persona-voice-engine.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  scoreText,
  isCleanVoice,
  BANNED_OPENERS,
  BANNED_PHRASES,
  TELL_WORDS,
} from "../lib/persona/blocklists.js";

import {
  humanize,
  HUMANIZER_INTERNALS,
} from "../lib/persona/humanizer.js";

import {
  splitSentences,
  extractIdiolectCandidates,
  persistIdiolect,
  getIdiolectSamples,
  IDIOLECT_INTERNALS,
} from "../lib/persona/idiolect-store.js";

// ── 1. Blocklists ──────────────────────────────────────────────────────────

describe("blocklists", () => {
  it("scoreText finds tell words", () => {
    assert.equal(scoreText("Let me delve into the tapestry of possibilities."), 2);
    assert.equal(scoreText("We need to navigate the landscape."), 2);
    assert.equal(scoreText("Hello there."), 0);
  });

  it("scoreText counts banned phrases", () => {
    assert.ok(scoreText("It's important to note that things change.") >= 1);
    assert.ok(scoreText("Furthermore, things change.") >= 1);
  });

  it("scoreText flags banned openers at sentence start", () => {
    assert.ok(scoreText("Certainly! Here is the answer.") >= 1);
    assert.ok(scoreText("absolutely, that works.") >= 1);
  });

  it("isCleanVoice gates clean sentences only", () => {
    assert.equal(isCleanVoice("Honestly, I think you nailed it."), true);
    assert.equal(isCleanVoice("Let's delve into this tapestry of options."), false);
    assert.equal(isCleanVoice("Certainly! Plain reply."), false);
    assert.equal(isCleanVoice("In conclusion, this works."), false);
  });

  it("exports populated lists", () => {
    assert.ok(BANNED_OPENERS.length >= 10);
    assert.ok(BANNED_PHRASES.length >= 15);
    assert.ok(TELL_WORDS.length >= 30);
  });
});

// ── 2. Humanizer ───────────────────────────────────────────────────────────

describe("humanizer", () => {
  it("strips banned openers", () => {
    const r = humanize("Certainly! The cat is on the mat.", { intensity: "medium" });
    assert.equal(r.text.startsWith("Certainly"), false);
    assert.ok(/^The cat/.test(r.text));
    assert.ok(r.changes.some(c => c.kind === "opener_stripped"));
  });

  it("strips banned phrases mid-text", () => {
    const r = humanize("It is important to note that the system is fine. I hope this helps!", { intensity: "medium" });
    assert.equal(/important to note/i.test(r.text), false);
    assert.equal(/hope this helps/i.test(r.text), false);
    assert.ok(r.changes.some(c => c.kind === "phrase_stripped"));
  });

  it("breaks tricolons", () => {
    const r = humanize("The system is fast, reliable, and scalable.", { intensity: "medium" });
    // Either dropped the third item or split into a follow-up sentence.
    const droppedOrSplit = !/fast,\s*reliable,\s*and\s*scalable/i.test(r.text);
    assert.equal(droppedOrSplit, true);
    assert.ok(r.changes.some(c => c.kind === "tricolon_broken"));
  });

  it("preserves proper-noun lists (does not break Tom, Jane, and Alex)", () => {
    const r = humanize("We met Tom, Jane, and Alex yesterday.", { intensity: "medium" });
    assert.ok(/Tom,\s*Jane,\s*and\s*Alex/.test(r.text));
  });

  it("strips negative parallelism", () => {
    const r = humanize("It's not just about speed, it's about quality.", { intensity: "medium" });
    assert.equal(/not just about/i.test(r.text), false);
    assert.ok(r.changes.some(c => c.kind === "neg_parallel_stripped"));
  });

  it("rebalances burstiness for uniform-length text", () => {
    const flat = "The cat sat down. The dog ran fast. The bird flew high. The fish swam deep.";
    const r = humanize(flat, { intensity: "medium" });
    // Either a split or a merge happened.
    assert.ok(r.changes.some(c => c.kind.startsWith("burstiness_")));
  });

  it("light intensity skips structural transforms", () => {
    const r = humanize("Certainly! The system is fast, reliable, and scalable. It's not just X, it's Y.", { intensity: "light" });
    // Opener stripped (light does that).
    assert.equal(/^Certainly/i.test(r.text), false);
    // But tricolon still intact (medium-only).
    assert.ok(r.changes.every(c => c.kind !== "tricolon_broken"));
    assert.ok(r.changes.every(c => c.kind !== "neg_parallel_stripped"));
  });

  it("is deterministic — same input yields same output", () => {
    const input = "In conclusion, this is robust, reliable, and scalable.";
    const a = humanize(input, { intensity: "medium" });
    const b = humanize(input, { intensity: "medium" });
    assert.equal(a.text, b.text);
  });

  it("re-capitalises sentence starts after phrase stripping", () => {
    const r = humanize("Furthermore, the system works. Moreover, it scales.", { intensity: "medium" });
    // Each sentence should start with a capital letter, not lowercase
    // 'the' / 'it' left over from the stripped transitions.
    for (const s of splitSentences(r.text)) {
      assert.ok(/^[A-Z"']/.test(s), `sentence should start uppercase: ${s}`);
    }
  });

  it("returns stats with sentenceCount, meanLen, stddev, words", () => {
    const r = humanize("One. Two short. Three is a bit longer. Four has quite a few more words in it.", { intensity: "medium" });
    assert.equal(typeof r.stats.sentenceCount, "number");
    assert.equal(typeof r.stats.meanLen, "number");
    assert.equal(typeof r.stats.stddev, "number");
    assert.equal(typeof r.stats.words, "number");
  });

  it("handles empty / null input gracefully", () => {
    assert.equal(humanize("").text, "");
    assert.equal(humanize(null).text, "");
    assert.equal(humanize(undefined).text, "");
  });

  it("hash + rng are deterministic", () => {
    const { _hash32, _rng } = HUMANIZER_INTERNALS;
    assert.equal(_hash32("abc"), _hash32("abc"));
    const a = _rng(123);
    const b = _rng(123);
    assert.equal(a(), b());
    assert.equal(a(), b());
  });
});

// ── 3. Idiolect store ──────────────────────────────────────────────────────

describe("idiolect-store", () => {
  it("splitSentences handles abbreviations", () => {
    const result = splitSentences("Mr. Smith arrived. He said hello. Dr. Patel agreed.");
    assert.equal(result.length, 3);
    assert.equal(result[0], "Mr. Smith arrived.");
    assert.equal(result[2], "Dr. Patel agreed.");
  });

  it("extractIdiolectCandidates rejects sentences with banned words", () => {
    const text = "Let's delve into this. But I think you're right.";
    const out = extractIdiolectCandidates(text);
    assert.ok(out.every(c => !/delve/i.test(c.sentence)));
  });

  it("extractIdiolectCandidates rejects too-short / too-long sentences", () => {
    const tooShort = "Yes.";
    const tooLong = "Word ".repeat(45) + ".";
    assert.equal(extractIdiolectCandidates(tooShort).length, 0);
    assert.equal(extractIdiolectCandidates(tooLong).length, 0);
  });

  it("extractIdiolectCandidates requires a distinctness marker", () => {
    const flat = "The cat sat on the mat in the room.";
    // No sentence-initial conjunction, no opinion verb, no proper noun
    // pair, no em-dash, no question mark.
    const out = extractIdiolectCandidates(flat);
    assert.equal(out.length, 0);
  });

  it("extractIdiolectCandidates surfaces voicey sentences", () => {
    const text = "Honestly, I think the rhythm matters more than the words used.";
    const out = extractIdiolectCandidates(text);
    assert.equal(out.length, 1);
    assert.ok(out[0].score >= 1);
  });

  it("persistIdiolect calls runMacro for each candidate", async () => {
    const calls = [];
    const fakeRun = async (domain, name, input) => {
      calls.push({ domain, name, input });
      return { ok: true, id: `dtu-${calls.length}` };
    };
    const text = "Honestly, I notice the rhythm matters more than the words. But what do I know — I just live here.";
    const result = await persistIdiolect({
      runMacro: fakeRun,
      ctx: { actor: { userId: "concord" } },
      response: text,
      userId: "user-1",
      lens: "chat",
    });
    assert.ok(result.length >= 1);
    assert.equal(calls[0].domain, "dtu");
    assert.equal(calls[0].name, "create");
    assert.ok(calls[0].input.tags.includes("voice:idiolect"));
    assert.equal(calls[0].input.source, "persona.idiolect");
  });

  it("persistIdiolect is fire-and-forget on runMacro throw", async () => {
    const text = "Honestly, I think this is fine.";
    const result = await persistIdiolect({
      runMacro: async () => { throw new Error("simulated failure"); },
      ctx: {},
      response: text,
    });
    // Should not throw — returns the candidates with dtuId null.
    assert.ok(Array.isArray(result));
  });

  it("getIdiolectSamples filters by tag and excludes blocklist hits", () => {
    const state = {
      dtus: new Map([
        ["a", { tags: ["voice:idiolect"], creti: "Honestly, this is fine.", meta: { observedAt: Date.now() } }],
        ["b", { tags: ["voice:idiolect"], creti: "Let's delve into this.", meta: { observedAt: Date.now() } }],
        ["c", { tags: ["other"], creti: "Should be ignored.", meta: { observedAt: Date.now() } }],
      ]),
    };
    const samples = getIdiolectSamples({ STATE: state, n: 5 });
    assert.equal(samples.length, 1);
    assert.equal(samples[0], "Honestly, this is fine.");
  });

  it("getIdiolectSamples mixes recent and older entries", () => {
    const now = Date.now();
    const old = now - 90 * 24 * 60 * 60 * 1000;
    const state = {
      dtus: new Map([
        ["a", { tags: ["voice:idiolect"], creti: "Recent one A.", meta: { observedAt: now } }],
        ["b", { tags: ["voice:idiolect"], creti: "Recent one B.", meta: { observedAt: now - 1000 } }],
        ["c", { tags: ["voice:idiolect"], creti: "Older one C.", meta: { observedAt: old } }],
      ]),
    };
    const samples = getIdiolectSamples({ STATE: state, n: 3, now: () => now });
    assert.equal(samples.length, 3);
    assert.ok(samples.includes("Older one C."));
  });

  it("getIdiolectSamples returns empty array when no STATE.dtus", () => {
    assert.deepEqual(getIdiolectSamples({}), []);
    assert.deepEqual(getIdiolectSamples({ STATE: null }), []);
    assert.deepEqual(getIdiolectSamples(), []);
  });

  it("constants are sane", () => {
    assert.ok(IDIOLECT_INTERNALS.MIN_WORDS >= 1);
    assert.ok(IDIOLECT_INTERNALS.MAX_WORDS > IDIOLECT_INTERNALS.MIN_WORDS);
    assert.ok(IDIOLECT_INTERNALS.SAMPLE_DEFAULT >= 1);
    assert.equal(IDIOLECT_INTERNALS.IDIOLECT_TAG, "voice:idiolect");
  });
});

// ── 4. Integration sanity ──────────────────────────────────────────────────

describe("persona pipeline integration", () => {
  it("a tell-heavy response is meaningfully cleaned end-to-end", () => {
    const before = "Certainly! It is important to note that this solution is robust, reliable, and scalable. Moreover, it leverages cutting-edge technology. It's not just innovative, it's groundbreaking. I hope this helps!";
    const beforeScore = scoreText(before);
    const r = humanize(before, { intensity: "medium" });
    const afterScore = scoreText(r.text);
    // Score must drop meaningfully.
    assert.ok(afterScore < beforeScore, `score should drop: before=${beforeScore} after=${afterScore}`);
    // No banned openers survive at the start.
    assert.equal(/^(certainly|absolutely|great question)/i.test(r.text), false);
  });

  it("a clean human-style response is left mostly intact", () => {
    const before = "Honestly, I think the rhythm matters. But what do I know?";
    const r = humanize(before, { intensity: "medium" });
    // Should not strip anything since nothing matches the blocklist.
    assert.equal(r.changes.length, 0);
    assert.equal(r.text, before);
  });
});
