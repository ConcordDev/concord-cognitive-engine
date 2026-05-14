// @env-config-ok: intentional external URL references
// server/lib/video-gen.js
//
// Sprint 14 — video generation backend. Mirrors the image-gen
// pattern (multimodal.image_generate) but for video: local first
// (ComfyUI / SVD if configured), then BYO-keyed cloud (OpenAI Sora,
// Google Veo, Runway) — never hardcodes keys.
//
// Returns a video URL (cloud-hosted) OR a base64 mp4 inline.
//
// All three providers operate on the "submit prompt → poll for
// completion" pattern as of 2026 — generation takes 30s-5min.
// This module exposes:
//   • startVideoGeneration({db, userId, provider, prompt, opts})
//     → returns { jobId, provider, status:'pending' }
//   • pollVideoStatus(jobId) → returns { status, url?, error? }
//
// The chat_agent's generate_video tool kicks off a job, returns the
// jobId artifact immediately, and the frontend polls until done.

import { decryptKey } from "./byo-crypto.js";

const PENDING_JOBS = new Map(); // jobId → { provider, status, url, error, startedAt }

function generateJobId() {
  return `vid_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

async function getUserApiKey(db, userId, provider) {
  if (!db || !userId) return "";
  try {
    const row = db.prepare(`
      SELECT encrypted_key FROM user_brain_overrides
      WHERE user_id = ? AND provider = ? AND active = 1 LIMIT 1
    `).get(userId, provider);
    if (!row?.encrypted_key) return "";
    return (await decryptKey(userId, row.encrypted_key)) || "";
  } catch { return ""; }
}

// ── OpenAI Sora ──────────────────────────────────────────────────

async function startSora({ apiKey, prompt, opts = {} }) {
  if (!apiKey) return { ok: false, error: "missing_openai_key" };
  const body = {
    model: opts.model || "sora-2",
    prompt: String(prompt),
    n_seconds: Math.min(60, opts.duration || 4),
    n_variants: 1,
    size: opts.size || "1024x576",
  };
  try {
    const res = await fetch("https://api.openai.com/v1/videos/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `sora_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    return { ok: true, providerJobId: j.id, status: j.status || "pending" };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function pollSora({ apiKey, providerJobId }) {
  try {
    const res = await fetch(`https://api.openai.com/v1/videos/generations/${encodeURIComponent(providerJobId)}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { status: "error", error: `sora_poll_${res.status}` };
    const j = await res.json();
    if (j.status === "succeeded" || j.status === "completed") {
      const url = j.assets?.[0]?.video_url || j.video_url || null;
      return { status: "completed", url };
    }
    if (j.status === "failed") return { status: "failed", error: j.error?.message || "sora_failed" };
    return { status: "pending" };
  } catch (err) {
    return { status: "error", error: err?.message };
  }
}

// ── Google Veo (via Vertex / GenerativeLanguage API) ─────────────

async function startVeo({ apiKey, prompt, opts = {} }) {
  if (!apiKey) return { ok: false, error: "missing_google_key" };
  const model = opts.model || "veo-3.0-generate-preview";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateVideo?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: { text: String(prompt) },
          config: {
            aspectRatio: opts.aspectRatio || "16:9",
            durationSeconds: Math.min(8, opts.duration || 5),
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `veo_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    return { ok: true, providerJobId: j.name || j.operationId, status: "pending" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

async function pollVeo({ apiKey, providerJobId }) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(providerJobId)}?key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return { status: "error", error: `veo_poll_${res.status}` };
    const j = await res.json();
    if (j.done) {
      const url = j.response?.generatedVideos?.[0]?.video?.uri
        || j.response?.video?.uri
        || null;
      return { status: url ? "completed" : "failed", url, error: j.error?.message };
    }
    return { status: "pending" };
  } catch (err) {
    return { status: "error", error: err?.message };
  }
}

// ── Runway (via Runway API) ──────────────────────────────────────

async function startRunway({ apiKey, prompt, opts = {} }) {
  if (!apiKey) return { ok: false, error: "missing_runway_key" };
  try {
    const res = await fetch("https://api.dev.runwayml.com/v1/text_to_video", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Runway-Version": "2024-11-06" },
      body: JSON.stringify({
        model: opts.model || "gen3a_turbo",
        promptText: String(prompt),
        duration: Math.min(10, opts.duration || 5),
        ratio: opts.ratio || "1280:720",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `runway_${res.status}: ${err.slice(0, 200)}` };
    }
    const j = await res.json();
    return { ok: true, providerJobId: j.id, status: "pending" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

async function pollRunway({ apiKey, providerJobId }) {
  try {
    const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(providerJobId)}`, {
      headers: { "Authorization": `Bearer ${apiKey}`, "X-Runway-Version": "2024-11-06" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { status: "error", error: `runway_poll_${res.status}` };
    const j = await res.json();
    if (j.status === "SUCCEEDED") {
      const url = j.output?.[0] || null;
      return { status: "completed", url };
    }
    if (j.status === "FAILED") return { status: "failed", error: j.failure?.reason };
    return { status: "pending" };
  } catch (err) {
    return { status: "error", error: err?.message };
  }
}

// ── Public dispatcher ────────────────────────────────────────────

export async function startVideoGeneration({ db, userId, provider, prompt, opts = {} }) {
  if (!prompt) return { ok: false, error: "missing_prompt" };
  const p = provider || "openai";
  const jobId = generateJobId();
  const apiKey = await getUserApiKey(db, userId, p)
    || process.env[p === "openai" ? "OPENAI_API_KEY" : p === "google" ? "GOOGLE_API_KEY" : "RUNWAY_API_KEY"]
    || "";

  let result;
  if (p === "openai" || p === "sora") result = await startSora({ apiKey, prompt, opts });
  else if (p === "google" || p === "veo") result = await startVeo({ apiKey, prompt, opts });
  else if (p === "runway") result = await startRunway({ apiKey, prompt, opts });
  else return { ok: false, error: `unknown_video_provider_${p}` };

  if (!result.ok) return { ok: false, error: result.error };

  PENDING_JOBS.set(jobId, {
    provider: p,
    apiKey,
    providerJobId: result.providerJobId,
    status: result.status,
    url: null,
    error: null,
    prompt,
    startedAt: Date.now(),
  });
  return { ok: true, jobId, provider: p, status: result.status };
}

export async function pollVideoStatus(jobId) {
  if (!jobId) return { ok: false, error: "missing_jobId" };
  const job = PENDING_JOBS.get(jobId);
  if (!job) return { ok: false, error: "job_not_found" };
  if (job.status === "completed" || job.status === "failed" || job.status === "error") {
    // Never spread `job` wholesale — it holds the plaintext apiKey.
    return {
      ok: true, jobId,
      provider: job.provider,
      status: job.status,
      url: job.url,
      error: job.error,
      elapsedMs: Date.now() - job.startedAt,
    };
  }
  let r;
  if (job.provider === "openai" || job.provider === "sora") {
    r = await pollSora({ apiKey: job.apiKey, providerJobId: job.providerJobId });
  } else if (job.provider === "google" || job.provider === "veo") {
    r = await pollVeo({ apiKey: job.apiKey, providerJobId: job.providerJobId });
  } else if (job.provider === "runway") {
    r = await pollRunway({ apiKey: job.apiKey, providerJobId: job.providerJobId });
  } else {
    r = { status: "error", error: "unknown_provider" };
  }
  if (r.status === "completed" || r.status === "failed" || r.status === "error") {
    job.status = r.status;
    job.url = r.url || null;
    job.error = r.error || null;
  }
  PENDING_JOBS.set(jobId, job);
  return {
    ok: true, jobId,
    provider: job.provider,
    status: job.status,
    url: job.url,
    error: job.error,
    elapsedMs: Date.now() - job.startedAt,
  };
}

export function listPendingJobs() {
  return Array.from(PENDING_JOBS.entries()).map(([jobId, j]) => ({
    jobId, provider: j.provider, status: j.status,
    elapsedMs: Date.now() - j.startedAt, hasUrl: !!j.url,
  }));
}

export const VIDEO_GEN_CONSTANTS = Object.freeze({
  PROVIDERS: ["openai", "google", "runway"],
});
