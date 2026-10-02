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
import os from "os";
import path from "path";

const GEN_URL = () => (process.env.CONCORD_GEN_URL || process.env.GEN_SERVER_URL || "http://127.0.0.1:7870").replace(/\/$/, "");
const FALLBACK_REASONS = new Set(["local_gpu_unreachable", "weights_missing"]);

async function localHealth() {
  try {
    const r = await fetch(`${GEN_URL()}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/**
 * Generate via pod GPU (/concept → FLUX). Returns data URL + optional file path.
 * Never throws; returns { ok:false, reason } on failure.
 */
async function generateViaLocalGpu({ prompt, width, height, seed } = {}) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) return { ok: false, reason: "prompt_required" };
  const health = await localHealth();
  if (!health?.ok && health?.ok !== true && !health?.gpu && !health?.weights) {
    // Some health payloads are {ok:true,...}; also accept weights.flux_schnell
    if (!(health && (health.ok === true || health.weights?.flux_schnell))) {
      return { ok: false, reason: "local_gpu_unreachable" };
    }
  }
  if (health?.weights && health.weights.flux_schnell === false) {
    return { ok: false, reason: "weights_missing" };
  }
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: cleanPrompt, seed: s, width: w, height: h }),
      signal: AbortSignal.timeout(25 * 60 * 1000),
    });
    const body = await r.json();
    if (!body?.ok || !body?.png_b64) {
      const reason = body?.reason || "gpu_concept_failed";
      if (FALLBACK_REASONS.has(reason)) return { ok: false, reason };
      return { ok: false, reason, error: body?.error || body?.reason || "gpu_concept_failed" };
    }
    const dataUrl = `data:image/png;base64,${body.png_b64}`;
    // Persist under DATA_DIR for attachable proof / artifact reuse
    let savedPath = null;
    try {
      const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
      const outDir = path.join(dataDir, "gpu-art");
      fs.mkdirSync(outDir, { recursive: true });
      const fname = `flux-${Date.now()}-${s}.png`;
      savedPath = path.join(outDir, fname);
      fs.writeFileSync(savedPath, Buffer.from(body.png_b64, "base64"));
    } catch { /* non-fatal */ }
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
    const reason = err?.name === "TimeoutError" ? "timeout" : "local_gpu_unreachable";
    return { ok: false, reason, error: String(err?.message || err) };
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
  if (gpu.reason === "timeout" || (gpu.reason && !FALLBACK_REASONS.has(gpu.reason) && gpu.reason !== "prompt_required")) {
    // Real generation error (not "unreachable") — do not silently swap to a watermarked third party.
    if (gpu.reason !== "local_gpu_unreachable" && gpu.reason !== "weights_missing") {
      return { ok: false, error: gpu.error || gpu.reason || "gpu_generate_failed", reason: gpu.reason, provider_attempted: "local_gpu_flux" };
    }
  }
  const fb = await generatePollinationsFallback(opts);
  if (fb.ok) {
    fb.gpu_miss_reason = gpu.reason || "local_gpu_unreachable";
  }
  return fb;
}

export { generateViaLocalGpu, generatePollinationsFallback, localHealth };
