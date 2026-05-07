/**
 * LLM Fallback Chain
 *
 * Provides tiered fallback when primary Ollama brains are unavailable.
 * All tiers are local — no cloud APIs, no data leaving the box.
 */
import logger from "../logger.js";

const TIERS = ["ollama", "llama_cpp", "semantic_cache", "heuristic", "graceful_error"];

let _localLLM = null;      // Tier 2: llm-local.js
let _semanticCache = null;  // Tier 3: semanticCache.js
let _macroCache = null;     // Tier 4: macro-response-cache.js

// Track which tier is currently active per brain
const _activeTiers = { conscious: "ollama", subconscious: "ollama", utility: "ollama", repair: "ollama" };

export function setLocalLLM(mod) { _localLLM = mod; }
export function setSemanticCache(mod) { _semanticCache = mod; }
export function setMacroCache(mod) { _macroCache = mod; }
export function getActiveTiers() { return { ..._activeTiers }; }

/**
 * Call with fallback through the tier chain.
 * @param {string} brainName - which brain (conscious, subconscious, utility, repair)
 * @param {object} opts - { system, messages, temperature, maxTokens, timeoutMs }
 * @param {Function} ollamaCall - the original Ollama call function (Tier 1)
 * @returns {Promise<{ ok: boolean, text?: string, tier: string, confidence: string }>}
 */
export async function callWithFallback(brainName, opts, ollamaCall) {
  // Tier 1: Ollama (primary)
  try {
    const result = await ollamaCall(opts);
    if (result && result.ok !== false) {
      _activeTiers[brainName] = "ollama";
      return { ...result, tier: "ollama", confidence: "full" };
    }
  } catch (e) {
    logger.log("debug", "lib", "fallback_tier1_failed", { brain: brainName, error: e?.message });
  }

  // Tier 2: llama.cpp local
  if (_localLLM) {
    try {
      const result = await _localLLM.generate(opts.messages, { temperature: opts.temperature, maxTokens: opts.maxTokens });
      if (result && result.ok) {
        _activeTiers[brainName] = "llama_cpp";
        return { ...result, tier: "llama_cpp", confidence: "reduced" };
      }
    } catch (e) {
      logger.log("debug", "lib", "fallback_tier2_failed", { brain: brainName, error: e?.message });
    }
  }

  // Tier 3: Semantic cache
  if (_semanticCache) {
    try {
      const lastUserMsg = opts.messages?.filter(m => m.role === "user").pop()?.content || "";
      if (lastUserMsg) {
        const cached = await _semanticCache.check(lastUserMsg, { lens: opts._lens });
        if (cached && cached.hit) {
          _activeTiers[brainName] = "semantic_cache";
          return { ok: true, text: cached.answer, tier: "semantic_cache", confidence: "cached", similarity: cached.similarity };
        }
      }
    } catch (e) {
      logger.log("debug", "lib", "fallback_tier3_failed", { brain: brainName, error: e?.message });
    }
  }

  // Tier 4: Heuristic/cached macro responses
  if (_macroCache && opts._domain && opts._name) {
    try {
      const cached = _macroCache.get(opts._domain, opts._name, opts._inputHash);
      if (cached) {
        _activeTiers[brainName] = "heuristic";
        return { ok: true, text: JSON.stringify(cached), tier: "heuristic", confidence: "cached" };
      }
    } catch (e) {
      logger.log("debug", "lib", "fallback_tier4_failed", { brain: brainName, error: e?.message });
    }
  }

  // Tier 5: Graceful error
  _activeTiers[brainName] = "graceful_error";
  return {
    ok: false,
    text: "I'm currently operating in limited mode — my language models are temporarily unavailable. I can still access your knowledge base and run cached operations. Please try again shortly.",
    tier: "graceful_error",
    confidence: "none",
    reason: "all_tiers_exhausted"
  };
}

/**
 * Get fallback chain health status.
 */
export function getFallbackHealth() {
  return {
    activeTiers: { ..._activeTiers },
    available: {
      ollama: true, // always "available" — circuit breaker handles actual status
      llama_cpp: !!_localLLM,
      semantic_cache: !!_semanticCache,
      heuristic: !!_macroCache,
      graceful_error: true,
    },
    tiers: TIERS,
  };
}
