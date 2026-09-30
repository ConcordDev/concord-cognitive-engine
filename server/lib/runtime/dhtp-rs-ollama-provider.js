// server/lib/runtime/dhtp-rs-ollama-provider.js
// Ollama adapter for DHTP-RS benchmark (spec §13 local model portability)

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || "http://localhost:11434";

/**
 * Build a callProvider compatible with representation-sufficiency-bench.
 * Uses direct Ollama /api/chat — does not depend on Docker brain hostnames.
 */
export function makeOllamaCallProvider(modelId, baseUrl = DEFAULT_OLLAMA_URL) {
  const root = baseUrl.replace(/\/$/, "");
  return async function ollamaBenchChat({ messages, opts = {} }) {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const body = {
      model: modelId,
      stream: false,
      messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
      options: {
        temperature: opts.temperature ?? 0.3,
        num_predict: opts.maxTokens ?? 256,
        num_ctx: Math.min(Number(process.env.CONCORD_NUM_CTX_CAP || 8192), 8192),
      },
    };

    try {
      const res = await fetch(`${root}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return {
          ok: false,
          text: "",
          tokensIn: 0,
          tokensOut: 0,
          model: modelId,
          usage: { prompt_tokens: 0, completion_tokens: 0 },
          error: `HTTP ${res.status}`,
        };
      }
      const j = await res.json();
      const msg = j?.message || {};
      const text = (msg.content || "").trim()
        || (msg.thinking || "").trim()
        || (j?.response || "").trim();
      const tokensIn = j?.prompt_eval_count || 0;
      const tokensOut = j?.eval_count || 0;
      return {
        ok: true,
        text,
        tokensIn,
        tokensOut,
        model: modelId,
        usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut },
      };
    } catch (err) {
      return {
        ok: false,
        text: "",
        tokensIn: 0,
        tokensOut: 0,
        model: modelId,
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        error: err?.message || String(err),
      };
    }
  };
}

/** Probe Ollama /api/tags for installed models. */
export async function listOllamaModels(baseUrl = DEFAULT_OLLAMA_URL) {
  try {
    const root = baseUrl.replace(/\/$/, "");
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.models || []).map((m) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** Pick best available models for portability sweep (2B / 7-8B / 14B). */
export function pickPortabilityModels(available) {
  const picks = [];
  const lower = available.map((m) => m.toLowerCase());
  const find = (re) => available.find((m, i) => re.test(lower[i]));

  const twoB = find(/2b|1\.5b|3b/);
  const sevenB = find(/7b|8b/);
  const fourteenB = find(/14b|13b|12b/);

  if (twoB) picks.push({ tier: "2B", model: twoB });
  if (sevenB) picks.push({ tier: "7-8B", model: sevenB });
  if (fourteenB) picks.push({ tier: "14B", model: fourteenB });

  if (!picks.length && available.length) {
    picks.push({ tier: "local", model: available[0] });
  }
  return picks;
}
