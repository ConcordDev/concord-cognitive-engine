// server/lib/chat/image-router.js
//
// Explicit image requests ("make an image of a red bicycle") are answered by
// Concord's pod GPU FLUX server before any model is asked. A small local
// model otherwise replies from training data that it cannot generate images
// and names an outside service, even while :7870 is healthy.
//
// GPU only. Pollinations, DALL-E, Midjourney, and Stable Diffusion are never
// a substitute. "GPU image generation is offline" is reserved for a gen
// server that is actually unreachable or missing weights.

import { generateViaLocalGpu } from "../pollinations-image.js";
import { storeArtifact, retrieveArtifact } from "../artifact-store.js";
import { createMediaDTU, canAccessMediaDTU, getMediaDTU } from "../media-dtu.js";

// Unit tests have no booted server. Production chat uses the same STATE
// object the /api/media router was mounted with.
let _fallbackMediaState = null;
function mediaHost(explicit) {
  if (explicit && typeof explicit === "object") return explicit;
  if (globalThis._concordSTATE) return globalThis._concordSTATE;
  if (!_fallbackMediaState) _fallbackMediaState = { dtus: new Map() };
  return _fallbackMediaState;
}

export const GPU_OFFLINE_REPLY = "GPU image generation is offline";

const OFFLINE_REASONS = new Set(["local_gpu_unreachable", "weights_missing"]);
const OUTSIDE_SERVICE = /\b(?:dall[- ]?e(?:\s*\d)?|midjourney|stable diffusion|pollinations(?:\.ai)?|comfyui|automatic1111)\b/gi;

const LEAD_IN = /^(?:(?:please|hey|hi|ok|okay|now|just)\s+|(?:can|could|would)\s+you\s+|i\s+(?:want|need)\s+(?:you\s+)?to\s+|i(?:'d| would)\s+like\s+(?:you\s+)?to\s+)*/i;
const MAKE = /^(?:make|generate|create|paint|render)\s+(?:me\s+|us\s+)?(?:an?\s+|some\s+)?(?:image|picture|photo|photograph|illustration|drawing)s?\s+(?:of\s+|showing\s+)?(.+)$/i;
const DRAW = /^draw\s+(?:me\s+|us\s+)?(?:an?\s+|some\s+)?(?:(?:image|picture|photo|photograph|illustration|drawing)s?\s+(?:of\s+|showing\s+)?)?(.+)$/i;
// "draw a conclusion", "draw attention", "draw on experience" are not pictures.
const DRAW_IDIOM = /^(?:a\s+)?(?:conclusion|distinction|comparison|parallel|blank|attention|inference|analogy|line\b|from\b|on\b|upon\b)/i;

function scrubOutside(text) {
  const cleaned = String(text || "")
    .replace(OUTSIDE_SERVICE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
  return cleaned;
}

/**
 * An explicit picture request, or null when the message should stay with the model.
 * @returns {{ prompt: string, width?: number, height?: number } | null}
 */
export function explicitImagePrompt(message) {
  let text = String(message || "").trim();
  if (!text || text.length > 800) return null;
  if (/^(?:what|who|why|how|when|where|is|are|does|do|explain|describe|tell me about|define)\b/i.test(text)) return null;
  if (/\b(?:do not|don't|dont)\s+(?:make|generate|create|draw|paint|render)\b/i.test(text)) return null;
  text = text.replace(/[.!?]+$/, "").replace(/\s+(?:please|thanks|thank you)$/i, "").trim();
  text = text.replace(LEAD_IN, "").trim();
  const made = text.match(MAKE);
  const drawn = made ? null : text.match(DRAW);
  let subject = (made || drawn)?.[1] || "";
  subject = subject.replace(/^(?:of\s+)/i, "").trim();
  if (!subject || subject.length < 3) return null;
  if (drawn && DRAW_IDIOM.test(subject)) return null;
  let width;
  let height;
  const size = subject.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (size) {
    width = Number(size[1]);
    height = Number(size[2]);
    subject = subject.replace(size[0], "").replace(/\s{2,}/g, " ").trim();
  }
  if (subject.length < 3) return null;
  return {
    prompt: subject,
    ...(width ? { width, height } : {}),
  };
}

export function markdownImageReply(prompt, url) {
  const alt = String(prompt || "image").replace(/[[\]()]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "image";
  return `![${alt}](${url})`;
}

/**
 * Bytes go to the content-addressed artifact store. The media row is
 * private, so only the owner can stream it. The chat reply keeps the
 * short URL, never the PNG.
 */
export async function publishPrivateImage({ imageB64, prompt, width, height, ownerId, state } = {}) {
  const buf = Buffer.from(String(imageB64 || ""), "base64");
  if (!buf.length) return { ok: false, error: "image generation returned no image", reason: "no_image" };
  const host = mediaHost(state);
  const authorId = String(ownerId || "anonymous");
  let artifactRef;
  try {
    artifactRef = await storeArtifact(
      `chat-image-${authorId}-${Date.now()}`,
      buf,
      "image/png",
      "image.png",
    );
  } catch (err) {
    return { ok: false, error: "could not store image artifact", reason: "store_failed", detail: String(err?.message || err) };
  }
  const created = createMediaDTU(host, {
    authorId,
    title: String(prompt || "generated image").slice(0, 180),
    mediaType: "image",
    mimeType: "image/png",
    fileSize: buf.length,
    originalFilename: "image.png",
    privacy: "private",
    resolution: width && height ? { width, height } : undefined,
    tags: ["chat", "generated"],
    artifactRef,
  });
  if (!created.ok) return { ok: false, error: created.error || "could not store image artifact", reason: "store_failed" };
  const mediaId = created.mediaDTU.id;
  return {
    ok: true,
    url: `/api/media/${mediaId}/stream`,
    mediaId,
    privacy: created.mediaDTU.privacy,
  };
}

export { retrieveArtifact, canAccessMediaDTU, getMediaDTU };

/**
 * Pod GPU only. Never calls Pollinations. Never throws.
 * offline is true only for local_gpu_unreachable and weights_missing.
 */
export async function produceGpuImage({ prompt, width, height, seed, ownerId, state } = {}) {
  const clean = String(prompt || "").trim();
  let gen;
  try {
    gen = await generateViaLocalGpu({ prompt: clean, width, height, seed });
  } catch (err) {
    return { ok: false, offline: true, error: GPU_OFFLINE_REPLY, reason: "local_gpu_unreachable", detail: String(err?.message || err) };
  }
  const external = gen?.provider === "pollinations" || /pollinations\.ai/i.test(String(gen?.url || ""));
  const dataUrl = typeof gen?.url === "string" && gen.url.startsWith("data:") ? gen.url : "";
  const image_b64 = gen?.imageB64 || (dataUrl ? dataUrl.slice(dataUrl.indexOf(",") + 1) : "");
  if (gen?.ok && !external && image_b64) {
    const stored = await publishPrivateImage({
      imageB64: image_b64, prompt: clean, width: gen.width, height: gen.height, ownerId, state,
    });
    if (!stored.ok) {
      return { ok: false, offline: false, error: stored.error, reason: stored.reason, prompt: clean };
    }
    const source = gen.provider || "local_gpu_flux";
    return {
      ok: true,
      offline: false,
      prompt: clean,
      source,
      artifact: {
        kind: "image",
        source,
        prompt: clean,
        mimeType: "image/png",
        url: stored.url,
        mediaId: stored.mediaId,
        ...(gen.width ? { width: gen.width } : {}),
        ...(gen.height ? { height: gen.height } : {}),
      },
    };
  }
  if (external || OFFLINE_REASONS.has(gen?.reason) || !gen) {
    return { ok: false, offline: true, error: GPU_OFFLINE_REPLY, reason: gen?.reason || "local_gpu_unreachable", prompt: clean };
  }
  const raw = scrubOutside(gen.error || gen.reason || "generate_image failed");
  return {
    ok: false,
    offline: false,
    error: raw || "generate_image failed",
    reason: gen.reason,
    prompt: clean,
  };
}

/**
 * @returns {Promise<null | { ok: boolean, offline: boolean, prompt: string, reply: string, artifact?: object, reason?: string }>}
 */
export async function fulfillImageRequest(message, opts = {}) {
  const parsed = explicitImagePrompt(message);
  if (!parsed) return null;
  const gen = await produceGpuImage({ ...parsed, ownerId: opts.ownerId, state: opts.state });
  if (gen.ok && gen.artifact) {
    return {
      ok: true,
      offline: false,
      prompt: parsed.prompt,
      reply: markdownImageReply(parsed.prompt, gen.artifact.url),
      artifact: gen.artifact,
      source: gen.source,
    };
  }
  if (gen.offline) {
    return { ok: false, offline: true, prompt: parsed.prompt, reply: GPU_OFFLINE_REPLY, reason: gen.reason };
  }
  return { ok: false, offline: false, prompt: parsed.prompt, reply: gen.error, reason: gen.reason };
}
