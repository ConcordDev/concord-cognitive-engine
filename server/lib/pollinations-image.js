// server/lib/pollinations-image.js
//
// Shared text-to-image helper. Prefer Concord's local GPU gen server
// (CONCORD_GEN_URL, default http://127.0.0.1:7870 → FLUX.1-schnell) so
// product art has no third-party watermark. Pollinations is a last-resort
// fallback only when the gen server is unreachable / missing weights —
// never the primary path on a healthy GPU pod.
//
// @env-config-ok: image.pollinations.ai remains the documented free public
// fallback; the preferred provider is the self-hosted gen server.

import fs from "fs";
import path from "path";

const GEN_URL = () => (process.env.CONCORD_GEN_URL || process.env.GEN_SERVER_URL || "http://127.0.0.1:7870").replace(/\/$/, "");
const FALLBACK_REASONS = new Set(["local_gpu_unreachable", "weights_missing"]);
// FLUX-schnell renders in seconds; the long tail is a cold model load.
const GPU_CONCEPT_TIMEOUT_MS = Number(process.env.CONCORD_GEN_TIMEOUT_MS) || 5 * 60 * 1000;
// Chat turns must not sit on the 5-minute default. A phone cancels the
// stream at ~45s with no bytes; 120s is the chat concept budget.
export const CHAT_CONCEPT_TIMEOUT_MS = 120_000;
export const IMAGE_TIMEOUT_REPLY = "Image generation timed out before the GPU finished. Try again in a moment.";
export const GPU_BUSY_REPLY = "The GPU is busy with another job. Try again in a moment.";
export const GPU_WRONG_MODEL_REPLY = "The GPU has a different model loaded, so this generation cannot start. Try again in a moment.";
// Chat probes /health before POST. A busy or unloaded pod answers in this
// window instead of queueing behind the job that holds the gen-server lock.
// The cap is the longest a chat turn may sit on "a job is already running".
export const GEN_HEALTH_TIMEOUT_MS = 4_000;
export const GEN_BUSY_WAIT_CAP_MS = 20_000;
// Organic batch posts omit this and still queue. Chat sends it so a pod that
// has been redeployed refuses instead of accepting the request onto the lock.
export const GEN_FAIL_IF_BUSY_HEADER = "X-Concord-Fail-If-Busy";
const ABORT_TEXT_RE = /aborted due to timeout|operation was aborted|\bAbortError\b|\bTimeoutError\b/i;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GLB_MAGIC = Buffer.from("glTF");
const BUSY_TEXT_RE = /^(?:the gpu is busy\b|3d generation is busy\b)/i;

/** Plain sentence for a saved reply. Raw AbortError text stays out of the transcript. */
export function userFacingGenerationError(text, fallback = IMAGE_TIMEOUT_REPLY) {
  const s = String(text || "").trim();
  if (!s) return "";
  return ABORT_TEXT_RE.test(s) ? fallback : s;
}

export function isGenerationAbort(err) {
  const name = String(err?.name || "");
  return name === "TimeoutError" || name === "AbortError" || ABORT_TEXT_RE.test(String(err?.message || err || ""));
}

/** PNG signature (8 bytes is enough) or JPEG SOI. Error text is neither. */
export function isPngOrJpeg(buf) {
  if (!Buffer.isBuffer(buf)) return false;
  if (buf.length >= PNG_SIG.length && buf.subarray(0, PNG_SIG.length).equals(PNG_SIG)) return true;
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** GLB magic ("glTF") plus the 12-byte header. A sentence is not a mesh. */
export function isGlb(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 12 && buf.subarray(0, 4).equals(GLB_MAGIC);
}

/**
 * Null when the buffer is a real image. A busy/error sentence comes back as
 * gpu_busy so chat can say the pod is busy without storing a .png of that text.
 * @returns {null | { reason: "gpu_busy" | "not_image", error: string }}
 */
export function imageByteFailure(buf) {
  if (isPngOrJpeg(buf)) return null;
  if (Buffer.isBuffer(buf) && buf.length > 0 && buf.length <= 512) {
    const text = buf.toString("utf8").trim();
    if (text && !text.includes("\uFFFD") && (text === GPU_BUSY_REPLY || BUSY_TEXT_RE.test(text))) {
      return { reason: "gpu_busy", error: GPU_BUSY_REPLY };
    }
  }
  return { reason: "not_image", error: "Image generation did not return an image." };
}

/**
 * Health the gen pod actually reported. `{ok:true}` with no model field still
 * proceeds (that is the healthy shape the pod and the tests use). Busy and a
 * named non-FLUX model fail before the long /concept POST.
 */
export function assessGpuHealth(health) {
  if (!health || typeof health !== "object") return { ok: false, reason: "local_gpu_unreachable" };
  const status = String(health.status || health.state || "").toLowerCase();
  // The gen pod reports `busy` (lock held) and `on_gpu` (trellis1 / flux).
  // A busy pod will not start /concept until the current job finishes, which
  // is longer than a chat turn can wait.
  const busyFlag = health.busy === true || health.busy === 1 || String(health.busy).toLowerCase() === "true";
  // `on_gpu: null` is the idle healthy shape. Only an explicit loading flag
  // means the weights are not ready yet — treat that like a busy pod.
  const loadingFlag = health.loading === true || health.loading === 1 || String(health.loading).toLowerCase() === "true";
  const loadingStatus = /^(?:loading|starting|warming|initializing)$/.test(status);
  if (loadingFlag || loadingStatus || busyFlag || status === "busy" || status === "occupied") {
    return { ok: false, reason: "gpu_busy", error: GPU_BUSY_REPLY, onGpu: health.on_gpu || null };
  }
  // `on_gpu: null` is idle and healthy. A loaded non-FLUX model (trellis1
  // while a mesh job owns the card) will not run /concept until it unloads.
  const onGpu = typeof health.on_gpu === "string" ? health.on_gpu.trim() : "";
  if (onGpu && !/flux/i.test(onGpu)) {
    return { ok: false, reason: "gpu_busy", error: GPU_BUSY_REPLY, onGpu };
  }
  const loaded = [health.model, health.loaded_model, health.loadedModel, health.weights?.loaded]
    .find((v) => typeof v === "string" && v.trim());
  if (loaded && !/flux/i.test(String(loaded))) {
    return { ok: false, reason: "gpu_wrong_model", error: GPU_WRONG_MODEL_REPLY };
  }
  if (!(health.ok === true || health.weights?.flux_schnell)) {
    return { ok: false, reason: "local_gpu_unreachable" };
  }
  if (health.weights && health.weights.flux_schnell === false) {
    return { ok: false, reason: "weights_missing" };
  }
  return { ok: true };
}

function conceptTimeoutMs(timeoutMs) {
  const n = Number(timeoutMs);
  if (Number.isFinite(n) && n > 0) return n;
  return GPU_CONCEPT_TIMEOUT_MS;
}
// Saved copies are a convenience cache, not storage — keep the newest N.
const gpuArtKeep = () => Number(process.env.CONCORD_GPU_ART_KEEP) || 200;

async function saveGpuArt(pngB64, seed) {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const outDir = path.join(dataDir, "gpu-art");
  await fs.promises.mkdir(outDir, { recursive: true });
  const savedPath = path.join(outDir, `flux-${Date.now()}-${seed}.png`);
  await fs.promises.writeFile(savedPath, Buffer.from(pngB64, "base64"));
  const names = (await fs.promises.readdir(outDir)).filter((n) => n.startsWith("flux-")).sort();
  for (const n of names.slice(0, Math.max(0, names.length - gpuArtKeep()))) {
    await fs.promises.unlink(path.join(outDir, n)).catch(() => {});
  }
  return savedPath;
}

async function localHealth() {
  try {
    const r = await fetch(`${GEN_URL()}/health`, { signal: AbortSignal.timeout(GEN_HEALTH_TIMEOUT_MS) });
    return r.ok ? await r.json() : null;
  } catch (err) {
    // The tunnel only carries the in-flight job, so a health abort is the
    // pod being busy — not "the server is down" (that is ECONNREFUSED).
    if (isGenerationAbort(err)) return { ok: true, busy: true };
    return null;
  }
}

/**
 * Generate via pod GPU (/concept → FLUX). Returns data URL + optional file path.
 * Never throws; returns { ok:false, reason } on failure.
 */
async function generateViaLocalGpu({ prompt, width, height, seed, timeoutMs } = {}) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) return { ok: false, reason: "prompt_required" };
  const health = await localHealth();
  const gate = assessGpuHealth(health);
  if (!gate.ok) return { ok: false, reason: gate.reason, ...(gate.error ? { error: gate.error } : {}) };
  const w = Math.max(256, Math.min(1024, Number(width) || 768));
  const h = Math.max(256, Math.min(1024, Number(height) || 768));
  let s = Number(seed);
  if (!Number.isInteger(s) || s < 0) {
    s = 0;
    for (let i = 0; i < cleanPrompt.length; i++) {
      s = (s * 31 + cleanPrompt.charCodeAt(i)) % 2147483647;
    }
  }
  try {
    const r = await fetch(`${GEN_URL()}/concept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [GEN_FAIL_IF_BUSY_HEADER]: "1" },
      body: JSON.stringify({ prompt: cleanPrompt, seed: s, width: w, height: h }),
      signal: AbortSignal.timeout(conceptTimeoutMs(timeoutMs)),
    });
    const body = await r.json();
    if (!body?.ok || !body?.png_b64) {
      const reason = body?.reason || "gpu_concept_failed";
      if (FALLBACK_REASONS.has(reason)) return { ok: false, reason };
      return { ok: false, reason, error: body?.error || body?.reason || "gpu_concept_failed" };
    }
    const pngBuf = Buffer.from(String(body.png_b64), "base64");
    const badPng = imageByteFailure(pngBuf);
    if (badPng) return { ok: false, reason: badPng.reason, error: badPng.error };
    const dataUrl = `data:image/png;base64,${body.png_b64}`;
    // Persist under DATA_DIR for artifact reuse (async, bounded).
    let savedPath = null;
    try { savedPath = await saveGpuArt(body.png_b64, s); } catch { /* non-fatal */ }
    return {
      ok: true,
      provider: body.provider || "local_gpu_flux",
      url: dataUrl,
      imageB64: body.png_b64,
      width: w,
      height: h,
      seed: s,
      reachable: true,
      seconds: body.seconds,
      path: savedPath,
      watermark: false,
    };
  } catch (err) {
    if (isGenerationAbort(err)) {
      return { ok: false, reason: "timeout", error: IMAGE_TIMEOUT_REPLY, detail: String(err?.message || err) };
    }
    return { ok: false, reason: "local_gpu_unreachable", error: String(err?.message || err) };
  }
}

/**
 * Pollinations URL fallback (may carry third-party branding despite nologo=true).
 */
async function generatePollinationsFallback({ prompt, width, height, seed } = {}) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) return { ok: false, error: "prompt required" };
  if (cleanPrompt.length > 800) return { ok: false, error: "prompt too long (max 800)" };

  const w = Math.max(256, Math.min(1024, Number(width) || 768));
  const h = Math.max(256, Math.min(1024, Number(height) || 768));

  let s = Number(seed);
  if (!Number.isInteger(s) || s < 0) {
    s = 0;
    for (let i = 0; i < cleanPrompt.length; i++) {
      s = (s * 31 + cleanPrompt.charCodeAt(i)) % 2147483647;
    }
  }

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}` +
    `?width=${w}&height=${h}&seed=${s}&nologo=true`;

  let reachable = true;
  try {
    const head = await fetch(url, { method: "HEAD" });
    reachable = head.ok;
  } catch {
    reachable = false;
  }

  return {
    ok: true,
    provider: "pollinations",
    url,
    width: w,
    height: h,
    seed: s,
    reachable,
    watermark: true,
    fallback: true,
  };
}

/**
 * Build / generate an image. GPU-first; Pollinations only if gen server is down.
 *
 * @returns {Promise<object>}
 */
export async function generatePollinationsImage(opts = {}) {
  // Force-pollinations only for unit tests that assert the URL shape.
  if (process.env.CONCORD_FORCE_POLLINATIONS === "1") {
    return generatePollinationsFallback(opts);
  }
  const gpu = await generateViaLocalGpu(opts);
  if (gpu.ok) return gpu;
  // Only "the GPU server isn't there" falls back. A real generation error or
  // timeout is reported, never silently swapped for a watermarked third party.
  if (!FALLBACK_REASONS.has(gpu.reason) && gpu.reason !== "prompt_required") {
    return { ok: false, error: gpu.error || gpu.reason || "gpu_generate_failed", reason: gpu.reason, provider_attempted: "local_gpu_flux" };
  }
  const fb = await generatePollinationsFallback(opts);
  if (fb.ok) {
    fb.gpu_miss_reason = gpu.reason || "local_gpu_unreachable";
  }
  return fb;
}

export { generateViaLocalGpu, generatePollinationsFallback, localHealth };
