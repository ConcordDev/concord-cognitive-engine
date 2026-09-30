// @env-config-ok: intentional external URL references
// server/lib/cloudflare-ai-provider.js
//
// Cloudflare Workers AI adapter (NOT OpenAI-compatible — custom format).
//
// Endpoint: https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}
// Auth: Authorization: Bearer ${API_TOKEN}
// Text models: @cf/meta/llama-3.1-8b-instruct, @cf/mistral/mistral-7b-instruct-v0.1
// Vision: @cf/meta/llama-3.2-11b-vision-instruct (messages content[] with image_url)
//
// Returns same shape as ollamaChat: {ok, text, toolCalls, tokensIn, tokensOut, error?}

import { scanMessagesForLeaks } from "./outbound-content-guard.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function unwrapCfResponse(j) {
  if (j == null) return "";
  if (typeof j.response === "string") return j.response;
  if (typeof j.result?.response === "string") return j.result.response;
  if (typeof j.result === "string") return j.result;
  if (typeof j.result?.description === "string") return j.result.description;
  return "";
}

function normalizeMessagesForCf(messages, opts = {}) {
  const images = Array.isArray(opts.images) ? opts.images.filter(Boolean) : [];
  return (messages || []).map((m) => {
    const role = m.role || "user";
    if (Array.isArray(m.content)) {
      return { role, content: m.content };
    }
    const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
    const msgImages = Array.isArray(m.images) ? m.images : [];
    const allImages = [...msgImages, ...(role === "user" ? images : [])];
    if (!allImages.length) {
      return { role, content: text };
    }
    const content = [{ type: "text", text: text || "Describe this image." }];
    for (const img of allImages) {
      const raw = String(img);
      const url = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
      content.push({ type: "image_url", image_url: { url } });
    }
    return { role, content };
  });
}

async function cloudflareChat({ apiKey, modelId, messages, opts = {} }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: "cloudflare_account_id_missing" };
  }
  if (!apiKey) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: "cloudflare_api_token_missing" };
  }

  const leak = scanMessagesForLeaks(messages || []);
  if (leak.blocked) {
    return {
      ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
      error: `blocked_secret_detected:${leak.patternId}`,
    };
  }

  const hasImages = Boolean(opts.images?.length) || (messages || []).some(
    (m) => (Array.isArray(m.images) && m.images.length)
      || (Array.isArray(m.content) && m.content.some((c) => c?.type === "image_url" || c?.type === "image")),
  );
  const resolvedModel = modelId
    || (hasImages ? (process.env.BRAIN_VISION_MODEL || DEFAULT_VISION_MODEL) : DEFAULT_TEXT_MODEL);

  const body = {
    messages: normalizeMessagesForCf(messages, opts),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
  };

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${resolvedModel}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return {
        ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
        error: `cloudflare_${res.status}: ${err.slice(0, 200)}`,
      };
    }

    const j = await res.json();
    if (j.errors?.length) {
      return {
        ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
        error: `cloudflare_error: ${j.errors[0].message}`,
      };
    }
    if (j.success === false && Array.isArray(j.messages) && j.messages.length) {
      return {
        ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
        error: `cloudflare_error: ${j.messages[0].message || JSON.stringify(j.messages[0]).slice(0, 200)}`,
      };
    }

    return {
      ok: true,
      text: unwrapCfResponse(j),
      toolCalls: [],
      tokensIn: j.result?.usage?.prompt_tokens || j.tokens_in || 0,
      tokensOut: j.result?.usage?.completion_tokens || j.tokens_out || 0,
      model: resolvedModel,
      provider: "cloudflare",
    };
  } catch (err) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: err?.message || String(err) };
  }
}

export { DEFAULT_VISION_MODEL, DEFAULT_TEXT_MODEL, unwrapCfResponse, normalizeMessagesForCf };
export default cloudflareChat;
