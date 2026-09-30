// @env-config-ok: intentional external URL references
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
//   - groq        → /openai/v1/chat/completions (OpenAI-compatible) — PLATFORM-ONLY today
//   - mistral     → /v1/chat/completions (OpenAI-compatible) — PLATFORM-ONLY today
//   - openrouter  → /api/v1/chat/completions (OpenAI-compatible) — PLATFORM-ONLY today
//
// groq/mistral/openrouter exist here so server/lib/platform-providers.js (the
// operator-funded High Power Mode path) can dispatch to them through the
// same providerChat() used by BYO. They are deliberately NOT added to
// BYO_PROVIDERS.list below — a user's own BYO key setup (byo-keys.js#setKey)
// validates against that list, and the underlying user_brain_overrides
// table's `provider` CHECK constraint (migration 170) does not yet include
// 'groq'/'mistral' — adding them to the user-facing list without a matching
// CHECK-widening migration would let validation pass and the DB insert fail.
// Letting users BYO their own Groq/Mistral key is a reasonable future
// addition; it needs its own migration, not a side effect of this one.
//
// Privacy: the key is passed in per-request; never stored in module
// scope, never logged, never returned. The HTTPS endpoint is the
// provider's official API — never proxied through concord-os.org.

import { scanMessagesForLeaks } from "./outbound-content-guard.js";
import cloudflareChat from "./cloudflare-ai-provider.js";

const DEFAULT_MODELS = Object.freeze({
  openai:    { conscious: "gpt-4o",         subconscious: "gpt-4o-mini",  utility: "gpt-4o-mini", repair: "gpt-4o-mini", vision: "gpt-4o" },
  anthropic: { conscious: "claude-opus-4-7", subconscious: "claude-sonnet-4-6", utility: "claude-haiku-4-5-20251001", repair: "claude-haiku-4-5-20251001", vision: "claude-opus-4-7" },
  xai:       { conscious: "grok-3",         subconscious: "grok-3-fast",  utility: "grok-3-fast", repair: "grok-3-fast", vision: "grok-3" },
  google:    { conscious: "gemini-3.6-flash", subconscious: "gemini-3.5-flash-lite", utility: "gemini-3.5-flash-lite", repair: "gemini-3.5-flash-lite", vision: "gemini-3.6-flash" },
  // Groq — no training on inputs/outputs regardless of tier (verified against
  // Groq's own Services Agreement), so this is the one platform provider with
  // no privacy tradeoff. Free-tier catalog is text-only today, no vision
  // default; pickModel() falls back to .conscious for an unlisted slot.
  groq:      { conscious: "llama-3.3-70b-versatile", subconscious: "llama-3.3-70b-versatile", utility: "llama-3.1-8b-instant", repair: "llama-3.1-8b-instant" },
  // Mistral — free tier requires the OPERATOR to opt the platform account
  // into Mistral's data-training program to unlock it (not a per-user
  // choice). Model ids follow Mistral's own "-latest" alias convention;
  // override via modelId if the deployment pins specific versions.
  // repair -> codestral-latest deliberately (not mistral-small): Codestral
  // is Mistral's dedicated CODE model, and repair (error detection /
  // auto-fix) is exactly the code-adjacent task it's built for — the only
  // one of the three platform providers with a specialized code model in
  // its free catalog, matched to the slot that benefits from it.
  mistral:   { conscious: "mistral-large-latest", subconscious: "mistral-large-latest", utility: "mistral-small-latest", repair: "codestral-latest", vision: "pixtral-large-latest" },
  // OpenRouter — free-tier model aliases (":free" suffix), first-priority
  // provider in the Free Cloud Fleet order (server/lib/free-cloud-router.js).
  // Matched 1:1 against that file's DEFAULT_MODELS.openrouter table so the
  // two don't drift; that file only PICKS the provider, this file is what
  // actually calls it.
  openrouter: { conscious: "meta-llama/llama-3.3-70b-instruct:free", subconscious: "qwen/qwen-2.5-72b-instruct:free", utility: "meta-llama/llama-3.1-8b-instruct:free", repair: "qwen/qwen-2.5-coder-32b-instruct:free", vision: "llama-3.2-90b-vision-instruct:free" },
  // Cloudflare Workers AI — platform / free-cloud path (also BRAIN_VISION_PROVIDER=cloudflare).
  cloudflare: {
    conscious: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    subconscious: "@cf/meta/llama-3.1-8b-instruct",
    utility: "@cf/meta/llama-3.1-8b-instruct",
    repair: "@cf/meta/llama-3.1-8b-instruct",
    vision: "@cf/meta/llama-3.2-11b-vision-instruct",
    multimodal: "@cf/meta/llama-3.2-11b-vision-instruct",
  },
});

const DEFAULT_TIMEOUT_MS = 60_000;

function pickModel(provider, slot, override) {
  if (override) return override;
  const table = DEFAULT_MODELS[provider] || {};
  // free-cloud-router uses slot "multimodal"; BYO tables historically used "vision"
  return table[slot] || (slot === "multimodal" ? table.vision : null) || (slot === "vision" ? table.multimodal : null) || table.conscious;
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

// ── Groq (OpenAI-compatible) ──────────────────────────────────────

async function groqChat({ apiKey, modelId, messages, opts = {} }) {
  return openaiCompatibleChat("https://api.groq.com/openai/v1/chat/completions", { apiKey, modelId, messages, opts, providerName: "groq" });
}

// ── Mistral (OpenAI-compatible) ───────────────────────────────────

async function mistralChat({ apiKey, modelId, messages, opts = {} }) {
  return openaiCompatibleChat("https://api.mistral.ai/v1/chat/completions", { apiKey, modelId, messages, opts, providerName: "mistral" });
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
    const cachedPromptTokens = j.usage?.prompt_tokens_details?.cached_tokens
      ?? j.usage?.cached_tokens
      ?? 0;
    const usage = j.usage ? {
      prompt_tokens: j.usage.prompt_tokens || 0,
      completion_tokens: j.usage.completion_tokens || 0,
      cached_prompt_tokens: cachedPromptTokens,
      reasoning_tokens: j.usage.completion_tokens_details?.reasoning_tokens || 0,
    } : null;
    return {
      ok: true,
      text: msg.content || "",
      toolCalls: [],
      tokensIn: usage?.prompt_tokens || 0,
      tokensOut: usage?.completion_tokens || 0,
      cachedPromptTokens,
      usage,
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

// ── OpenRouter (OpenAI-compatible, adds attribution headers) ──────

async function openrouterChat({ apiKey, modelId, messages, opts = {} }) {
  const body = {
    model: modelId,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  };
  if (opts.tools?.length) body.tools = opts.tools;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        // OpenRouter attribution headers — not auth, just identifies the
        // calling app for their leaderboards/rate-limit dashboards.
        "HTTP-Referer": "https://concord-os.org",
        "X-Title": "Concord Cognitive Engine",
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `openrouter_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    const msg = j.choices?.[0]?.message || {};
    const cachedPromptTokens = j.usage?.prompt_tokens_details?.cached_tokens
      ?? j.usage?.cached_tokens
      ?? 0;
    const usage = j.usage ? {
      prompt_tokens: j.usage.prompt_tokens || 0,
      completion_tokens: j.usage.completion_tokens || 0,
      cached_prompt_tokens: cachedPromptTokens,
    } : null;
    return {
      ok: true,
      text: msg.content || "",
      toolCalls: (msg.tool_calls || []).map((tc, i) => ({
        id: tc.id || `tc_${Date.now()}_${i}`,
        name: tc.function?.name || "",
        args: tryParse(tc.function?.arguments) || {},
      })),
      tokensIn: usage?.prompt_tokens || 0,
      tokensOut: usage?.completion_tokens || 0,
      cachedPromptTokens,
      usage,
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
  groq:      groqChat,
  mistral:   mistralChat,
  openrouter: openrouterChat,
  cloudflare: cloudflareChat,
};

/**
 * Dispatch a chat call to a provider. Used by both the per-user BYO path
 * (server/lib/byo-router.js) and the operator-funded platform-provider path
 * (server/lib/platform-providers.js) — the same adapters serve both; only
 * where the apiKey comes from differs.
 * @param {object} args
 * @param {string} args.provider     'openai' | 'anthropic' | 'xai' | 'google' | 'groq' | 'mistral'
 * @param {string} args.apiKey       plaintext key (decrypted just before this call, or an operator-configured platform key)
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
  // Outbound leak guard — this is the SINGLE enforcement point for both
  // BYO and platform-provider calls (both flow through providerChat()), so
  // wiring it here covers every one of the 4 LLM dispatch chokepoints for
  // free rather than needing 4 separate call sites. Not a privacy feature
  // — see server/lib/outbound-content-guard.js's header — just a backstop
  // against a live credential leaving the box toward a third party.
  const leak = scanMessagesForLeaks(messages);
  if (leak.blocked) {
    return {
      ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
      error: `blocked_secret_detected:${leak.patternId}`,
    };
  }
  return adapter({ apiKey, modelId: resolvedModel, messages, opts });
}

export const BYO_PROVIDERS = Object.freeze({
  list: ["openai", "anthropic", "xai", "google"],
  defaultModels: DEFAULT_MODELS,
});
