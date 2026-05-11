// server/lib/byo-providers.js
//
// Sprint 10 — provider adapters for BYO API keys.
//
// Each adapter is a thin wrapper around the provider's chat-completion
// endpoint that returns the same shape as `ollamaChat()`:
//   { ok, text, toolCalls, tokensIn, tokensOut, error? }
//
// Supported providers (May 2026 model defaults — caller can override):
//   - openai      → /v1/chat/completions
//   - anthropic   → /v1/messages
//   - xai         → /v1/chat/completions (OpenAI-compatible)
//   - google      → v1beta/models/{model}:generateContent
//
// Privacy: the key is passed in per-request; never stored in module
// scope, never logged, never returned. The HTTPS endpoint is the
// provider's official API — never proxied through concord-os.org.

const DEFAULT_MODELS = Object.freeze({
  openai:    { conscious: "gpt-4o",         subconscious: "gpt-4o-mini",  utility: "gpt-4o-mini", repair: "gpt-4o-mini", vision: "gpt-4o" },
  anthropic: { conscious: "claude-opus-4-7", subconscious: "claude-sonnet-4-6", utility: "claude-haiku-4-5-20251001", repair: "claude-haiku-4-5-20251001", vision: "claude-opus-4-7" },
  xai:       { conscious: "grok-3",         subconscious: "grok-3-fast",  utility: "grok-3-fast", repair: "grok-3-fast", vision: "grok-3" },
  google:    { conscious: "gemini-2.5-pro", subconscious: "gemini-2.5-flash", utility: "gemini-2.5-flash", repair: "gemini-2.5-flash", vision: "gemini-2.5-pro" },
});

const DEFAULT_TIMEOUT_MS = 60_000;

function pickModel(provider, slot, override) {
  if (override) return override;
  return DEFAULT_MODELS[provider]?.[slot] || DEFAULT_MODELS[provider]?.conscious;
}

// ── OpenAI ───────────────────────────────────────────────────────

async function openaiChat({ apiKey, modelId, messages, opts = {} }) {
  const body = {
    model: modelId,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  };
  if (opts.tools?.length) body.tools = opts.tools;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `openai_${res.status}: ${err.slice(0, 200)}` };
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

// ── Anthropic ────────────────────────────────────────────────────

async function anthropicChat({ apiKey, modelId, messages, opts = {} }) {
  // Anthropic separates system from messages. Pull any leading system role.
  let system = "";
  const msgs = [];
  for (const m of messages) {
    if (m.role === "system") system += (system ? "\n\n" : "") + (m.content || "");
    else msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content || "" });
  }
  const body = {
    model: modelId,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
    messages: msgs,
  };
  if (system) body.system = system;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `anthropic_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    const blocks = Array.isArray(j.content) ? j.content : [];
    const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
    return {
      ok: true,
      text,
      toolCalls: blocks.filter(b => b.type === "tool_use").map((b, i) => ({
        id: b.id || `tc_${Date.now()}_${i}`,
        name: b.name || "",
        args: b.input || {},
      })),
      tokensIn: j.usage?.input_tokens || 0,
      tokensOut: j.usage?.output_tokens || 0,
    };
  } catch (err) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: err?.message || String(err) };
  }
}

// ── xAI (OpenAI-compatible) ──────────────────────────────────────

async function xaiChat({ apiKey, modelId, messages, opts = {} }) {
  return openaiCompatibleChat("https://api.x.ai/v1/chat/completions", { apiKey, modelId, messages, opts, providerName: "xai" });
}

async function openaiCompatibleChat(url, { apiKey, modelId, messages, opts = {}, providerName }) {
  const body = {
    model: modelId,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `${providerName}_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    const msg = j.choices?.[0]?.message || {};
    return {
      ok: true,
      text: msg.content || "",
      toolCalls: [],
      tokensIn: j.usage?.prompt_tokens || 0,
      tokensOut: j.usage?.completion_tokens || 0,
    };
  } catch (err) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: err?.message || String(err) };
  }
}

// ── Google (Gemini) ──────────────────────────────────────────────

async function googleChat({ apiKey, modelId, messages, opts = {} }) {
  // Gemini API takes a single concatenated prompt for messages.
  const contents = [];
  let system = "";
  for (const m of messages) {
    if (m.role === "system") {
      system += (system ? "\n\n" : "") + (m.content || "");
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content || "" }],
      });
    }
  }
  const body = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 2048,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `google_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    return {
      ok: true,
      text,
      toolCalls: [],
      tokensIn: j.usageMetadata?.promptTokenCount || 0,
      tokensOut: j.usageMetadata?.candidatesTokenCount || 0,
    };
  } catch (err) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: err?.message || String(err) };
  }
}

function tryParse(s) {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return null; }
}

// ── Public dispatcher ────────────────────────────────────────────

const ADAPTERS = {
  openai:    openaiChat,
  anthropic: anthropicChat,
  xai:       xaiChat,
  google:    googleChat,
};

/**
 * Dispatch a chat call to the user's chosen provider.
 * @param {object} args
 * @param {string} args.provider     'openai' | 'anthropic' | 'xai' | 'google'
 * @param {string} args.apiKey       plaintext key (decrypted just before this call)
 * @param {string} args.slot         brain slot (conscious|subconscious|utility|repair|vision)
 * @param {string} [args.modelId]    override model id; falls back to provider default for slot
 * @param {Array<{role,content}>} args.messages
 * @param {object} [args.opts]
 * @returns {Promise<{ok, text, toolCalls, tokensIn, tokensOut, error?}>}
 */
export async function providerChat({ provider, apiKey, slot, modelId, messages, opts = {} }) {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `unknown_provider_${provider}` };
  }
  if (!apiKey) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: "missing_api_key" };
  }
  const resolvedModel = pickModel(provider, slot, modelId);
  if (!resolvedModel) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `no_default_model_for_${provider}_${slot}` };
  }
  return adapter({ apiKey, modelId: resolvedModel, messages, opts });
}

export const BYO_PROVIDERS = Object.freeze({
  list: ["openai", "anthropic", "xai", "google"],
  defaultModels: DEFAULT_MODELS,
});
