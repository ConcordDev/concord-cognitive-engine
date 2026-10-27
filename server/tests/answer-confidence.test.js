// answerConfidence — labels a reply low confidence only when the small local
// backup model (BRAIN_LOCAL_UNIFIED_MODEL) produced it via the local Ollama path.
// The env var is read at call time, so each case sets and restores it.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { answerConfidence, LOW_CONFIDENCE_REASON } = await import("../lib/answer-confidence.js");
const { getLocalUnifiedModel } = await import("../lib/brain-config.js");

const LOW = { confidence: "low", confidenceReason: LOW_CONFIDENCE_REASON };
const SMALL = "concord-utility-2b:latest";

let saved;
beforeEach(() => {
  saved = process.env.BRAIN_LOCAL_UNIFIED_MODEL;
  process.env.BRAIN_LOCAL_UNIFIED_MODEL = SMALL;
});
afterEach(() => {
  if (saved === undefined) delete process.env.BRAIN_LOCAL_UNIFIED_MODEL;
  else process.env.BRAIN_LOCAL_UNIFIED_MODEL = saved;
});

describe("answerConfidence — backup-model labelling", () => {
  it("ollama source + the small local model -> low", () => {
    assert.deepEqual(answerConfidence({ source: "ollama", model: SMALL }), LOW);
  });

  it("ollama-stream source + the small local model -> low", () => {
    assert.deepEqual(answerConfidence({ source: "ollama-stream", model: SMALL }), LOW);
  });

  it("matches a tag-less model name against the :latest-tagged env value", () => {
    assert.deepEqual(answerConfidence({ source: "ollama", model: "concord-utility-2b" }), LOW);
  });

  it("matches case-insensitively", () => {
    assert.deepEqual(answerConfidence({ source: "ollama", model: "Concord-Utility-2B:LATEST" }), LOW);
  });

  it("a different (pod-served) model -> null", () => {
    assert.equal(answerConfidence({ source: "ollama", model: "qwen3:30b" }), null);
  });

  it("a BYO provider answering with the same model name -> null", () => {
    assert.equal(answerConfidence({ provider: "openai", model: SMALL }), null);
  });

  it("a free_cloud source -> null even when the model name matches", () => {
    assert.equal(answerConfidence({ source: "free_cloud", provider: "groq", model: SMALL }), null);
  });

  it("BRAIN_LOCAL_UNIFIED_MODEL unset -> null", () => {
    delete process.env.BRAIN_LOCAL_UNIFIED_MODEL;
    assert.equal(answerConfidence({ source: "ollama", model: SMALL }), null);
  });

  it("BRAIN_LOCAL_UNIFIED_MODEL blank -> null", () => {
    process.env.BRAIN_LOCAL_UNIFIED_MODEL = "   ";
    assert.equal(answerConfidence({ source: "ollama", model: SMALL }), null);
  });

  it("unknown / placeholder / empty model names -> null (never guessed)", () => {
    for (const model of ["ollama", "unknown", "", "   ", undefined, null]) {
      assert.equal(answerConfidence({ source: "ollama", model }), null, `model=${JSON.stringify(model)}`);
    }
  });

  it("concord_default provider + the small local model -> low", () => {
    assert.deepEqual(answerConfidence({ provider: "concord_default", model: SMALL }), LOW);
  });

  it("concord_default provider with the pod model -> null", () => {
    assert.equal(answerConfidence({ provider: "concord_default", model: "qwen3:30b" }), null);
  });

  it("no source and no provider -> null", () => {
    assert.equal(answerConfidence({ model: SMALL }), null);
    assert.equal(answerConfidence(), null);
  });
});

describe("brain-config.getLocalUnifiedModel", () => {
  it("reads the env at call time, trimmed", () => {
    process.env.BRAIN_LOCAL_UNIFIED_MODEL = "  some-model:latest  ";
    assert.equal(getLocalUnifiedModel(), "some-model:latest");
  });

  it("returns null when unset or blank", () => {
    delete process.env.BRAIN_LOCAL_UNIFIED_MODEL;
    assert.equal(getLocalUnifiedModel(), null);
    process.env.BRAIN_LOCAL_UNIFIED_MODEL = "  ";
    assert.equal(getLocalUnifiedModel(), null);
  });
});
