// answerConfidence — labels a reply low confidence only when the small local
// backup model (BRAIN_LOCAL_UNIFIED_MODEL) produced it via the local Ollama path.
// The env var is read at call time, so each case sets and restores it.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { answerConfidence, LOW_CONFIDENCE_REASON, SMALL_MODEL_FACT_GUARD, smallModelPromptSuffix } = await import("../lib/answer-confidence.js");
const { getLocalUnifiedModel, isMacFallbackMode } = await import("../lib/brain-config.js");

const LOW = { answerConfidence: "low", answerConfidenceReason: LOW_CONFIDENCE_REASON };
const SMALL = "concord-utility-2b:latest";

// The label also needs the Mac fallback to be the active routing (pod mode names
// the pod's model in BRAIN_LOCAL_UNIFIED_MODEL), so the default case here is mac.
const ENV_KEYS = ["BRAIN_LOCAL_UNIFIED_MODEL", "BRAINS_MODE", "OLLAMA_PROXY_URL", "BRAIN_CONSCIOUS_URL", "BRAIN_CONSCIOUS_URLS", "BRAIN_UTILITY_URL", "BRAIN_UTILITY_URLS"];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.BRAIN_LOCAL_UNIFIED_MODEL = SMALL;
  process.env.BRAINS_MODE = "mac";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
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

describe("smallModelPromptSuffix — factual guard for backup-model calls", () => {
  it("the called model is the small local model -> guard suffix", () => {
    assert.equal(smallModelPromptSuffix(SMALL), `\n\n${SMALL_MODEL_FACT_GUARD}`);
  });

  it("tag-less and differently-cased names still match", () => {
    assert.equal(smallModelPromptSuffix("concord-utility-2b"), `\n\n${SMALL_MODEL_FACT_GUARD}`);
    assert.equal(smallModelPromptSuffix("Concord-Utility-2B:LATEST"), `\n\n${SMALL_MODEL_FACT_GUARD}`);
  });

  it("a pod-served model -> no suffix", () => {
    assert.equal(smallModelPromptSuffix("qwen3:30b"), "");
  });

  it("missing/unknown model -> no suffix (never guessed at)", () => {
    assert.equal(smallModelPromptSuffix(null), "");
    assert.equal(smallModelPromptSuffix(""), "");
    assert.equal(smallModelPromptSuffix("unknown"), "");
  });

  it("BRAIN_LOCAL_UNIFIED_MODEL unset -> no suffix", () => {
    delete process.env.BRAIN_LOCAL_UNIFIED_MODEL;
    assert.equal(smallModelPromptSuffix(SMALL), "");
  });

  it("the guard text demands explicit quantities and admits uncertainty", () => {
    assert.match(SMALL_MODEL_FACT_GUARD, /Only state numbers/);
    assert.match(SMALL_MODEL_FACT_GUARD, /explicitly/);
    assert.match(SMALL_MODEL_FACT_GUARD, /not sure/);
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

describe("pod mode vs Mac fallback (label is routing-based, not model-name-based)", () => {
  const POD = "concord-core-v6:latest";

  it("pod mode: the unified model is the POD model -> a pod utility/repair answer is never labelled", () => {
    process.env.BRAIN_LOCAL_UNIFIED_MODEL = POD;
    process.env.BRAINS_MODE = "pod";
    assert.equal(answerConfidence({ source: "ollama", model: POD }), null);
    assert.equal(answerConfidence({ provider: "concord_default", model: POD }), null);
    assert.equal(smallModelPromptSuffix(POD), "");
  });

  it("pod mode by routing: pod tunnel URLs and no BRAINS_MODE -> not labelled", () => {
    process.env.BRAIN_LOCAL_UNIFIED_MODEL = POD;
    delete process.env.BRAINS_MODE;
    process.env.BRAIN_UTILITY_URL = "http://127.0.0.1:11436";
    process.env.BRAIN_CONSCIOUS_URL = "http://127.0.0.1:11435";
    assert.equal(answerConfidence({ source: "ollama", model: POD }), null);
  });

  it("mac mode via BRAINS_MODE=mac -> labelled (Oct 27 ruling kept)", () => {
    assert.deepEqual(answerConfidence({ source: "ollama", model: SMALL }), LOW);
    assert.match(smallModelPromptSuffix(SMALL), /small local backup model/);
  });

  it("mac mode via the :11480 proxy (no BRAINS_MODE) -> labelled", () => {
    delete process.env.BRAINS_MODE;
    process.env.OLLAMA_PROXY_URL = "http://127.0.0.1:11480";
    assert.deepEqual(answerConfidence({ source: "ollama", model: SMALL }), LOW);
  });

  it("mac mode via per-brain :11480 URLs (no proxy var) -> labelled", () => {
    delete process.env.BRAINS_MODE;
    process.env.BRAIN_UTILITY_URLS = "http://127.0.0.1:11480";
    assert.deepEqual(answerConfidence({ source: "ollama", model: SMALL }), LOW);
  });

  it("BRAINS_MODE wins over the URLs both ways", () => {
    process.env.OLLAMA_PROXY_URL = "http://127.0.0.1:11480";
    process.env.BRAINS_MODE = "pod";
    assert.equal(answerConfidence({ source: "ollama", model: SMALL }), null);
  });

  it("an unset environment is not the Mac fallback", () => {
    delete process.env.BRAINS_MODE;
    assert.equal(answerConfidence({ source: "ollama", model: SMALL }), null);
  });

  it("isMacFallbackMode ignores non-loopback or other-port proxies", () => {
    assert.equal(isMacFallbackMode({ OLLAMA_PROXY_URL: "http://10.0.0.5:11480" }), false);
    assert.equal(isMacFallbackMode({ OLLAMA_PROXY_URL: "http://127.0.0.1:11435" }), false);
    assert.equal(isMacFallbackMode({ OLLAMA_PROXY_URL: "http://localhost:11480" }), true);
  });
});
