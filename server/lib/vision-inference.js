// server/lib/vision-inference.js
// Unified vision inference — Ollama multimodal OR Cloudflare Workers AI.
// Used by: personal locker pipeline, lens visual actions, chat pre-processing.
// Does NOT require session multimodalOptIn — this is a server-side pipeline helper.

import { BRAIN_CONFIG } from "./brain-config.js";
import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";
import cloudflareChat, { DEFAULT_VISION_MODEL } from "./cloudflare-ai-provider.js";

const DEFAULT_PROMPT = "Describe this image in detail. Extract key entities, topics, any visible text, and overall context.";

/**
 * Classify a base64 payload (or data URL) as image / audio / video / unknown.
 * Vision must not accept audio — a .wav dropped on "Analyze with Vision"
 * is audio even when the picker filter is bypassed.
 */
export function sniffEncodedMedia(input) {
  const raw = String(input || "").trim();
  if (!raw) return "empty";
  const dataUrl = /^data:([^;,]+)/i.exec(raw);
  if (dataUrl) {
    const mime = dataUrl[1].toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
  }
  const b64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  let buf;
  try { buf = Buffer.from(b64, "base64"); } catch { return "unknown"; }
  if (!buf || buf.length < 12) return "unknown";
  const ascii = (a, b) => buf.toString("ascii", a, b);
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return "video";
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG") return "image";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image";
  if (ascii(0, 2) === "BM") return "image";
  if (ascii(0, 4) === "OggS") return "audio";
  if (ascii(0, 4) === "fLaC") return "audio";
  if (ascii(0, 3) === "ID3") return "audio";
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return "audio";
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return "audio";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12).toLowerCase();
    if (brand === "avif" || brand === "avis") return "image";
    if (brand.startsWith("m4a") || brand === "mp4a") return "audio";
    return "video";
  }
  const head = buf.subarray(0, Math.min(buf.length, 256)).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image";
  return "unknown";
}

/**
 * Gate for POST /api/chat vision uploads. Audio (and anything that is not
 * an image) is rejected before an LLM reply can be produced.
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function visionImageGate(body) {
  const mode = String(body?.mode || "").trim().toLowerCase();
  const images = [];
  if (Array.isArray(body?.images)) {
    for (const img of body.images) {
      if (img != null && String(img).length) images.push(String(img));
    }
  }
  if (typeof body?.imageB64 === "string" && body.imageB64) images.push(body.imageB64);
  if (typeof body?.imageBase64 === "string" && body.imageBase64) images.push(body.imageBase64);
  if (mode !== "vision" && images.length === 0) return { ok: true };
  if (images.length === 0) return { ok: false, status: 400, error: "vision requires an image" };
  for (const img of images) {
    const kind = sniffEncodedMedia(img);
    if (kind !== "image") {
      return { ok: false, status: 415, error: `vision accepts images only (got ${kind})` };
    }
  }
  return { ok: true };
}

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
  const kind = sniffEncodedMedia(imageB64);
  if (kind === "audio" || kind === "video") {
    return { ok: false, error: `vision accepts images only (got ${kind})`, status: 415 };
  }
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
