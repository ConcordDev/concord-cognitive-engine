// @env-config-ok: intentional external URL references
// server/lib/cerebras-provider.js
//
// Cerebras adapter — OpenAI-compatible.
//
// Endpoint: https://api.cerebras.ai/v1/chat/completions
// Auth: Authorization: Bearer ${CEREBRAS_API_KEY}
// Model: llama-3.3-70b
//
// Returns same shape as ollamaChat: {ok, text, toolCalls, tokensIn, tokensOut, error?}

import { scanMessagesForLeaks } from "./outbound-content-guard.js";

const DEFAULT_TIMEOUT_MS = 60_000;

function tryParse(s) {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return null; }
}

async function cerebrasChat({ apiKey, modelId, messages, opts = {} }) {
  const body = {
    model: modelId || "llama-3.3-70b",
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  };
  if (opts.tools?.length) body.tools = opts.tools;
  try {
    const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `cerebras_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    const msg = j.choices?.[0]?.message || {};
    return {
      ok: true,
      text: msg.content || "",
      toolCalls: (msg.tool_calls || []).map((tc, i) => ({
        id: tc.id || `tc_${Date.now()}_${i}`,
        name: tc.function?.name || "",
        args: tryParse(tc.function?.arguments) || {},
      })),
      tokensIn: j.usage?.prompt_tokens || 0,
      tokensOut: j.usage?.completion_tokens || 0,
    };
  } catch (err) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: err?.message || String(err) };
  }
}

export default cerebrasChat;
