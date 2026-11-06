/**
 * build(translation) — the full-build pins (S2 code legs · S3 · F5).
 *
 *   - deterministic decoding: translate and batch call the engine at
 *     temperature 0 (the same input must return the same translation)
 *   - same-language short-circuit: when the source IS the target
 *     (explicit, or a decisive offline detection), the text returns
 *     unchanged and labelled, with NO engine call and no glossary check
 *   - glossary enforcement (S3): a violating first attempt earns ONE
 *     bounded corrective re-ask; the better attempt is returned and
 *     whatever still misses is still reported by the checker
 *   - detect honesty (F5): an LLM refinement may correct the verdict,
 *     but the confidence returned is always the offline detector's
 *     COMPUTED figure — never the model's self-reported number
 *
 * Harness mirrors the shipped translation.test.js (canonical register +
 * stubbed ctx.llm), extended with a reply SEQUENCE for the retry legs.
 *
 * Run: node --test server/tests/translation-full-build.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerTranslationMacros, { detectOffline } from "../domains/translation.js";

function makeHarness({ replies = [] } = {}) {
  const macros = new Map();
  registerTranslationMacros((domain, name, handler) => macros.set(name, handler));
  const calls = [];
  const ctx = {
    actor: { userId: "user-1" },
    llm: {
      async chat(opts) {
        calls.push(opts);
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
        return reply;
      },
    },
  };
  const call = (name, input = {}) => macros.get(name)(ctx, input);
  return { call, calls };
}

describe("build(translation) — deterministic decoding", () => {
  it("translate calls the engine at temperature 0", async () => {
    const h = makeHarness({ replies: [{ content: "Hola" }] });
    const r = await h.call("translate", { text: "Hello", targetLanguage: "es" });
    assert.equal(r.ok, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].temperature, 0);
  });

  it("batch calls the engine at temperature 0", async () => {
    const h = makeHarness({ replies: [{ content: '["Hola"]' }] });
    const r = await h.call("batch", { items: ["Hello"], targetLanguage: "es" });
    assert.equal(r.ok, true);
    assert.equal(h.calls[0].temperature, 0);
  });
});

describe("build(translation) — same-language short-circuit", () => {
  it("an explicit source equal to the target returns the text unchanged, no engine call", async () => {
    const h = makeHarness({ replies: [{ content: "SHOULD NOT BE CALLED" }] });
    const r = await h.call("translate", {
      text: "el zorro",
      sourceLanguage: "es",
      targetLanguage: "es",
      glossary: [{ source: "fox", target: "zorro" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.translated, "el zorro");
    assert.equal(r.result.sameLanguage, true);
    assert.deepEqual(r.result.glossaryMisses, [], "no glossary check on a same-language run");
    assert.equal(h.calls.length, 0, "the engine is never called");
  });

  it("auto-detect on a decisive script verdict short-circuits too", async () => {
    const h = makeHarness({ replies: [{ content: "SHOULD NOT BE CALLED" }] });
    const text = "привет мир это тест";
    const r = await h.call("translate", { text, targetLanguage: "ru" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sameLanguage, true);
    assert.equal(r.result.translated, text);
    assert.equal(h.calls.length, 0);
  });
});

describe("build(translation) — glossary enforcement (S3)", () => {
  const glossary = [{ source: "fox", target: "zorro" }];

  it("a violating first attempt is regenerated once and the compliant attempt returned", async () => {
    const h = makeHarness({
      replies: [{ content: "the quick brown fox" }, { content: "el zorro rápido y marrón" }],
    });
    const r = await h.call("translate", { text: "the quick brown fox", targetLanguage: "es", glossary });
    assert.equal(r.ok, true);
    assert.equal(r.result.translated, "el zorro rápido y marrón");
    assert.deepEqual(r.result.glossaryMisses, []);
    assert.equal(r.result.glossaryAttempts, 2);
    assert.equal(h.calls.length, 2, "exactly one bounded retry");
    assert.match(h.calls[1].system, /CORRECTION/, "the retry names the violation");
    assert.match(h.calls[1].system, /"fox" -> "zorro"/);
  });

  it("a persistent violation is returned with its misses still honestly reported", async () => {
    const h = makeHarness({
      replies: [{ content: "the quick brown fox" }, { content: "un renard rapide" }],
    });
    const r = await h.call("translate", { text: "the quick brown fox", targetLanguage: "es", glossary });
    assert.equal(r.ok, true);
    assert.equal(r.result.glossaryAttempts, 2);
    assert.equal(r.result.glossaryMisses.length, 1);
    assert.equal(r.result.glossaryMisses[0].target, "zorro");
    assert.equal(h.calls.length, 2, "never a third attempt");
  });

  it("a compliant first attempt is not retried", async () => {
    const h = makeHarness({ replies: [{ content: "el zorro" }] });
    const r = await h.call("translate", { text: "the fox", targetLanguage: "es", glossary });
    assert.equal(r.ok, true);
    assert.equal(r.result.glossaryAttempts, 1);
    assert.equal(h.calls.length, 1);
  });

  it("batch regenerates the same way", async () => {
    const h = makeHarness({
      replies: [{ content: '["the fox"]' }, { content: '["el zorro"]' }],
    });
    const r = await h.call("batch", { items: ["the fox"], targetLanguage: "es", glossary });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.translations, ["el zorro"]);
    assert.deepEqual(r.result.glossaryMisses, []);
    assert.equal(r.result.glossaryAttempts, 2);
  });
});

describe("build(translation) — detect confidence is computed (F5)", () => {
  it("an LLM refinement keeps its verdict but NOT its self-reported confidence", async () => {
    const text = "Guten Tag, wie geht es Ihnen";
    const h = makeHarness({
      replies: [{ content: '{"language":"German","code":"DE","confidence":0.99}' }],
    });
    const r = await h.call("detect", { text });
    assert.equal(r.ok, true);
    assert.equal(r.result.language, "German");
    assert.equal(r.result.code, "de");
    assert.equal(r.result.method, "llm");
    assert.equal(r.result.confidence, detectOffline(text).confidence, "the computed figure, verbatim");
    assert.notEqual(r.result.confidence, 0.99);
  });
});
