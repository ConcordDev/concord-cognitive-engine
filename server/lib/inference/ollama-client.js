// server/lib/inference/ollama-client.js
// OpenAI-compatible Ollama wrapper used exclusively by the inference module.
// Wraps BRAIN_CONFIG to produce typed BrainHandle objects.

import { BRAIN_CONFIG, pickBrainEndpoint, noteEndpointStart, noteEndpointFinish } from "../brain-config.js";
import { coalesceNpcPrompt, isBackgroundCaller } from "../npc-prompt-coalescer.js";

/**
 * Parse tool calls from an Ollama message (best-effort JSON extraction).
 * Ollama returns tool_calls as a structured array when tools are provided.
 */
function parseToolCalls(message) {
  if (Array.isArray(message?.tool_calls)) {
    return message.tool_calls.map((tc, i) => ({
      id: tc.id || `tc_${Date.now()}_${i}`,
      name: tc.function?.name || tc.name || "",
      args: tc.function?.arguments || tc.arguments || {},
    }));
  }
  return [];
}

/**
 * Make a single chat completion call to an Ollama brain.
 *
 * @param {string} brainName - Key in BRAIN_CONFIG
 * @param {import('./types.js').Message[]} messages
 * @param {{ tools?: object[], temperature?: number, stream?: boolean, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ok: boolean, text: string, toolCalls: import('./types.js').ToolCall[], tokensIn: number, tokensOut: number, error?: string}>}
 */
export async function ollamaChat(brainName, messages, opts = {}) {
  const config = BRAIN_CONFIG[brainName];
  if (!config) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `Unknown brain: ${brainName}` };
  }

  const endpoint = pickBrainEndpoint(brainName) || config.url;
  const url = `${endpoint}/api/chat`;
  const timeoutMs = opts.timeoutMs ?? config.timeout ?? 30000;
  const temperature = opts.temperature ?? config.temperature ?? 0.7;

  const body = {
    model: opts.model || config.model,
    stream: false,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    options: {
      temperature,
      // Callers (e.g. chat-agent.js's runAgentLoop) pass a per-call
      // opts.maxTokens expecting it to actually apply — this used to always
      // read the brain's static BRAIN_CONFIG default instead, silently
      // discarding any caller override.
      num_predict: opts.maxTokens ?? config.maxTokens,
      // Without num_ctx Ollama uses its small default context and silently
      // truncates long prompts — send the brain's configured window, capped
      // by CONCORD_NUM_CTX_CAP for KV-cache VRAM control.
      num_ctx: Math.min(Number(process.env.CONCORD_NUM_CTX_CAP || 32768), config.contextWindow || 8192),
    },
  };

  if (opts.tools?.length) {
    body.tools = opts.tools;
  }

  // Structured output (Ollama JSON-schema constrained decoding). Pass a JSON
  // schema object (or the string "json") to force the model to emit a JSON
  // document matching the schema — the load-bearing primitive for the
  // sandwich parse-gate (NL → strict {domain,name,input}).
  if (opts.format) {
    body.format = opts.format;
  }

  const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);
  noteEndpointStart(endpoint);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      noteEndpointFinish(endpoint, { ok: false });
      return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `HTTP ${res.status}` };
    }

    const j = await res.json();
    const message = j?.message || {};
    const text = message.content || j?.response || "";
    const toolCalls = parseToolCalls(message);
    const tokensIn = j?.prompt_eval_count || 0;
    const tokensOut = j?.eval_count || 0;

    noteEndpointFinish(endpoint, { ok: true });
    return { ok: true, text, toolCalls, tokensIn, tokensOut };
  } catch (err) {
    noteEndpointFinish(endpoint, { ok: false });
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: err?.message || String(err) };
  }
}

/**
 * Check if an Ollama brain endpoint is reachable.
 * @param {string} brainName
 * @returns {Promise<boolean>}
 */
export async function isBrainAvailable(brainName) {
  const config = BRAIN_CONFIG[brainName];
  if (!config) return false;
  try {
    const res = await fetch(`${config.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Normalize a generate() prompt arg (string | string[] | object) to text.
 */
function promptToText(prompt) {
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    return prompt.map((p) => (typeof p === "string" ? p : (p?.content ?? String(p)))).join("\n");
  }
  if (prompt && typeof prompt === "object" && typeof prompt.content === "string") {
    return prompt.content;
  }
  return String(prompt ?? "");
}

/**
 * Build a BrainHandle for use in the agent loop + NPC/emergent generate path.
 * `generate()` routes non-player / NPC / ambient / emergent callers through
 * the npc-prompt-coalescer (sliding-window de-dupe + adaptive backoff + LOW
 * priority on the shared `_llmQueue`). Interactive callers bypass backoff.
 *
 * @param {string} brainName
 * @param {{ callerId?: string, envFingerprint?: string }} [handleOpts]
 * @returns {import('./types.js').BrainHandle}
 */
export function makeBrainHandle(brainName, handleOpts = {}) {
  const config = BRAIN_CONFIG[brainName];
  const stampedCallerId = handleOpts.callerId || "";
  const stampedEnv = handleOpts.envFingerprint || "";
  const handle = {
    name: brainName,
    model: config?.model || "unknown",
    url: config?.url || "",
    priority: config?.priority ?? 2,
    callerId: stampedCallerId,
    chat: (messages, opts) => ollamaChat(brainName, messages, opts),
    /**
     * Convenience single-prompt generate used by NPC / emergent / ambient
     * call sites. Returns model text, or null when adaptive backoff skips.
     * @param {string|string[]|object} prompt
     * @param {object} [genOpts]
     */
    generate: async (prompt, genOpts = {}) => {
      const text = promptToText(prompt);
      const callerId = genOpts.callerId || stampedCallerId || "";
      const envFingerprint = genOpts.envFingerprint || stampedEnv || brainName;
      const interactive = !!(genOpts.interactive || genOpts.critical || genOpts._priority === 0);

      return coalesceNpcPrompt({
        prompt: text,
        callerId,
        envFingerprint,
        intentKey: genOpts.intentKey,
        interactive,
        critical: !!genOpts.critical,
        generateFn: async () => {
          const r = await ollamaChat(brainName, [{ role: "user", content: text }], {
            temperature: genOpts.temperature,
            maxTokens: genOpts.maxTokens,
            timeoutMs: genOpts.timeoutMs,
            signal: genOpts.signal,
            model: genOpts.model,
          });
          if (!r.ok) {
            const err = new Error(r.error || "ollama_generate_failed");
            err.code = "ollama_generate_failed";
            throw err;
          }
          return r.text;
        },
      });
    },
  };
  // Mark background handles for metrics / debugging (non-enumerable-ish OK).
  handle._backgroundDefault = isBackgroundCaller(stampedCallerId) || !stampedCallerId;
  return handle;
}
