// server/lib/inference/ollama-client.js
// OpenAI-compatible Ollama wrapper used exclusively by the inference module.
// Wraps BRAIN_CONFIG to produce typed BrainHandle objects.

import { BRAIN_CONFIG, pickBrainEndpoint, noteEndpointStart, noteEndpointFinish } from "../brain-config.js";

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
    model: config.model,
    stream: false,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    options: { temperature, num_predict: config.maxTokens },
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
 * Build a BrainHandle for use in the agent loop.
 * @param {string} brainName
 * @returns {import('./types.js').BrainHandle}
 */
export function makeBrainHandle(brainName) {
  const config = BRAIN_CONFIG[brainName];
  return {
    name: brainName,
    model: config?.model || "unknown",
    url: config?.url || "",
    priority: config?.priority ?? 2,
    chat: (messages, opts) => ollamaChat(brainName, messages, opts),
  };
}
