// server/lib/vision-inference.js
// Unified vision inference — Ollama multimodal OR Cloudflare Workers AI.
// Used by: personal locker pipeline, lens visual actions, chat pre-processing.
// Does NOT require session multimodalOptIn — this is a server-side pipeline helper.

import { BRAIN_CONFIG } from "./brain-config.js";
import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";
import cloudflareChat, { DEFAULT_VISION_MODEL } from "./cloudflare-ai-provider.js";

const DEFAULT_PROMPT = "Describe this image in detail. Extract key entities, topics, any visible text, and overall context.";

function visionProvider() {
  return String(process.env.BRAIN_VISION_PROVIDER || "").toLowerCase().trim();
}

function isCloudflareVision() {
  const p = visionProvider();
  if (p === "cloudflare" || p === "workers-ai" || p === "cf") return true;
  const url = String(process.env.BRAIN_VISION_URL || process.env.BRAIN_MULTIMODAL_URL || BRAIN_CONFIG?.multimodal?.url || "");
  return url.startsWith("cloudflare://") || url.includes("api.cloudflare.com");
}

/**
 * Analyze an image using the multimodal brain (CF Workers AI or Ollama).
 * @param {string} imageB64 - Base64-encoded image (no data URL prefix)
 * @param {string} [prompt]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ok: boolean, content?: string, source?: string, error?: string, model?: string}>}
 */
export async function callVision(imageB64, prompt = DEFAULT_PROMPT, opts = {}) {
  const brain = BRAIN_CONFIG.multimodal;
  const timeoutMs = opts.timeoutMs || brain.timeout || 120000;

  if (isCloudflareVision()) {
    const apiKey = process.env.CLOUDFLARE_API_TOKEN;
    const modelId = process.env.BRAIN_VISION_MODEL || brain.model || DEFAULT_VISION_MODEL;
    if (!apiKey) {
      return { ok: false, error: "cloudflare_api_token_missing", source: "cloudflare_workers_ai" };
    }
    const r = await cloudflareChat({
      apiKey,
      modelId,
      messages: [{ role: "user", content: prompt }],
      opts: { images: [imageB64], temperature: brain.temperature ?? 0.1, maxTokens: brain.maxTokens || 1500, timeoutMs },
    });
    if (!r.ok) {
      return { ok: false, error: r.error || "cloudflare_vision_failed", source: "cloudflare_workers_ai", model: modelId };
    }
    return { ok: true, content: r.text || "", source: "cloudflare_workers_ai", model: r.model || modelId };
  }

  const url = `${brain.url}/api/chat`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: brain.model,
        stream: false,
        messages: [{ role: "user", content: prompt, images: [imageB64] }],
        options: { temperature: brain.temperature, num_predict: brain.maxTokens },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return { ok: false, error: `LLaVA HTTP ${res.status}`, source: "ollama_llava" };
    }

    const j = await res.json();
    const content = j?.message?.content || j?.response || "";
    return { ok: true, content, source: "ollama_llava", model: brain.model };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), source: "ollama_llava" };
  }
}

/**
 * Fetch an image from a URL and analyze it.
 * @param {string} imageUrl
 * @param {string} [prompt]
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function callVisionUrl(imageUrl, prompt = DEFAULT_PROMPT, opts = {}) {
  try {
    const check = await validateSafeFetchUrl(imageUrl);
    if (!check.ok) return { ok: false, error: `Blocked URL: ${check.error}`, source: "ssrf_guard" };
    const res = await fetchWithPinnedIp(check, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, error: `Failed to fetch image: HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    const imageB64 = Buffer.from(buf).toString("base64");
    return callVision(imageB64, prompt, opts);
  } catch (err) {
    return { ok: false, error: err?.message || String(err), source: isCloudflareVision() ? "cloudflare_workers_ai" : "ollama_llava" };
  }
}

/**
 * Domain-specific prompt for a given lens domain.
 * @param {string} domain
 * @returns {string}
 */
export function visionPromptForDomain(domain) {
  const prompts = {
    art:          "Analyze this artwork. Describe the style, technique, color palette, composition, subject matter, and emotional tone.",
    photography:  "Analyze this photograph. Describe composition, lighting, subject, technique, and any notable photographic elements.",
    filmstudios:  "Analyze this film image or still. Describe scene composition, lighting, cinematographic technique, mood, and narrative elements.",
    whiteboard:   "Extract all text, diagrams, equations, and structural content from this whiteboard. Preserve the logical organization.",
    research:     "Analyze this research image, chart, or figure. Describe what data or findings it presents, axes, trends, and key takeaways.",
    science:      "Describe this scientific image, diagram, or figure. Explain what it depicts, including any labels, measurements, or processes shown.",
    healthcare:   "Describe this medical or health-related image. Identify anatomical structures, any visible conditions, or clinical context. Do not diagnose.",
    food:         "Describe this food or dish. Identify ingredients, preparation style, presentation, and overall appearance.",
    fashion:      "Analyze this fashion image. Describe garments, materials, style, color palette, silhouette, and overall aesthetic.",
  };
  return prompts[domain] || DEFAULT_PROMPT;
}

export const _testing = { isCloudflareVision, visionProvider };
