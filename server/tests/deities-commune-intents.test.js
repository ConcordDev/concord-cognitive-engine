// Audit fix sweep (PR #2356) — FIX-deities-003: commune replies were
// identical canned text for every commune type — the intent never
// reached the reply, so greet/petition/offering/question all returned
// the greet template. The reply now reflects the intent: an
// author-written intent template speaks when present, otherwise a
// deterministic intent line (intent + reception + tone) is added, and
// an offering is acknowledged whenever the deity does not refuse it.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDeitiesActions from "../domains/deities.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`deity.${name}`);
  if (!fn) throw new Error(`deity.${name} not registered`);
  return fn(ctx, { id: null, domain: "deity", type: "domain_action", data: params, meta: {} }, params);
}

before(() => { registerDeitiesActions(register); });
beforeEach(() => {
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.deitiesLens;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function compose(over = {}) {
  return call("compose", ctxA, {
    name: over.name || "Veyra",
    toneVector: over.toneVector || { warmth: 0.7, refusal: 0.2, mystery: 0.6 },
    alignmentThresholds: over.alignmentThresholds || { commune: 0.5, refuse: -0.3 },
    dialogueTemplates: over.dialogueTemplates,
  }).result.deityId;
}

describe("deity.commune — the reply reflects the intent", () => {
  it("the four intents produce four different utterances for one deity", () => {
    const id = compose();
    const texts = ["greet", "petition", "question", "offering"].map(
      (intent) => call("commune", ctxB, { deityId: id, intent }).result.utterance,
    );
    assert.equal(new Set(texts).size, 4, `intents collapsed: ${JSON.stringify(texts)}`);
    assert.match(texts[1], /petition is heard/i);
    assert.match(texts[2], /answer|silence itself/i);
    assert.match(texts[3], /empty-handed/i);
  });

  it("an offering is acknowledged in the neutral band too, not only when received", () => {
    const id = compose();
    const r = call("commune", ctxB, { deityId: id, intent: "offering", offering: "a carved stone" });
    assert.equal(r.result.reception, "neutral");
    assert.match(r.result.utterance, /"a carved stone" — is acknowledged/);
  });

  it("an author-written intent template speaks for that intent", () => {
    const id = compose({
      dialogueTemplates: [
        { trigger: "greet", text: "Veyra regards you in silence." },
        { trigger: "petition", text: "Veyra weighs your petition in open palms." },
        { trigger: "commune_low_alignment", text: "Veyra turns away." },
        { trigger: "commune_high_alignment", text: "Veyra extends a hand." },
      ],
    });
    const r = call("commune", ctxB, { deityId: id, intent: "petition" });
    assert.match(r.result.utterance, /weighs your petition in open palms/);
  });

  it("a refused petition is answered as refused, not greeted", () => {
    const id = compose({ alignmentThresholds: { commune: 0.5, refuse: 0.9 } });
    const r = call("commune", ctxB, { deityId: id, intent: "petition" });
    assert.equal(r.result.reception, "refused");
    assert.match(r.result.utterance, /petition goes unheard/i);
  });
});
