// @env-config-ok: intentional external URL references
// server/lib/voice-synthesis.js
//
// Sprint D / CC1+CC2 — ElevenLabs TTS wrapper.
//
// `synthesizeLine(text, voiceId, opts)` calls the ElevenLabs API,
// caches the resulting audio by sha1(text + voiceId + opts) under
// server/data/voice-cache/, and returns a {url, hit} where url is the
// served path to the cached file. Caller passes the URL through to
// the frontend dialogue panel.
//
// Env-gated by ELEVENLABS_API_KEY. When missing OR the API errors,
// returns { ok: false, reason } and caller falls back to text-only.
//
// Concurrency cap: 4 in-flight per process. LRU disk cache.

import { createHash } from "node:crypto";
import { mkdir, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = resolve(__dir, "../data/voice-cache");
const DEFAULT_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;   // 2 GB
const DEFAULT_MAX_INFLIGHT = 4;
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

let inflight = 0;
const queue = [];

/**
 * Returns { ok, url?, hit?, reason? }. Never throws.
 */
export async function synthesizeLine(text, voiceId, opts = {}) {
  if (!text || !voiceId) return { ok: false, reason: "missing_inputs" };
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, reason: "no_api_key" };

  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const stability = opts.stability ?? 0.55;
  const similarity = opts.similarityBoost ?? 0.7;
  const style = opts.style ?? 0;

  const fingerprint = createHash("sha1")
    .update(`${text}|${voiceId}|${stability}|${similarity}|${style}`)
    .digest("hex").slice(0, 16);
  const filename = `${fingerprint}.mp3`;
  const filepath = join(cacheDir, filename);
  const publicUrl = `/voice-cache/${filename}`;

  // Cache hit.
  if (existsSync(filepath)) {
    return { ok: true, url: publicUrl, hit: true };
  }

  // Cache miss → enqueue for ElevenLabs request.
  const job = () => doSynthesize({
    text, voiceId, apiKey, stability, similarity, style,
    cacheDir, filepath, publicUrl,
  });
  if (inflight >= DEFAULT_MAX_INFLIGHT) {
    return new Promise((resolve) => { queue.push(() => job().then(resolve)); });
  }
  return job();
}

async function doSynthesize({ text, voiceId, apiKey, stability, similarity, style, cacheDir, filepath, publicUrl }) {
  inflight++;
  try {
    await mkdir(cacheDir, { recursive: true });
    const url = `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        "accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability, similarity_boost: similarity, style },
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      try { logger.warn?.({ voiceId, status: r.status, body: txt.slice(0, 200) }, "voice_synthesis_api_error"); } catch { /* noop */ }
      return { ok: false, reason: `api_error_${r.status}` };
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    await writeFile(filepath, buf);
    // Best-effort cache prune.
    void pruneCacheIfNeeded(cacheDir);
    return { ok: true, url: publicUrl, hit: false };
  } catch (err) {
    try { logger.warn?.({ err: err?.message }, "voice_synthesis_failed"); } catch { /* noop */ }
    return { ok: false, reason: "exception" };
  } finally {
    inflight--;
    const next = queue.shift();
    if (next) next();
  }
}

/**
 * LRU-ish cache prune. Sorts files by mtime, deletes oldest until under
 * limit. Cheap and robust enough for a 2 GB cache budget.
 */
async function pruneCacheIfNeeded(cacheDir) {
  const limit = DEFAULT_CACHE_LIMIT_BYTES;
  try {
    const files = await readdir(cacheDir);
    const stats = [];
    let total = 0;
    for (const f of files) {
      try {
        const s = await stat(join(cacheDir, f));
        if (s.isFile()) { stats.push({ name: f, size: s.size, mtime: s.mtimeMs }); total += s.size; }
      } catch { /* ignore */ }
    }
    if (total <= limit) return;
    stats.sort((a, b) => a.mtime - b.mtime);
    while (total > limit && stats.length > 0) {
      const victim = stats.shift();
      try { await unlink(join(cacheDir, victim.name)); total -= victim.size; }
      catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * For testing or admin: warm the cache with a list of (text, voiceId) pairs.
 */
export async function warmCache(pairs, opts = {}) {
  let hits = 0, misses = 0, errors = 0;
  for (const { text, voiceId } of pairs) {
    const r = await synthesizeLine(text, voiceId, opts);
    if (!r.ok) errors++;
    else if (r.hit) hits++;
    else misses++;
  }
  return { ok: true, hits, misses, errors };
}

export const VOICE_SYNTHESIS_CONSTANTS = Object.freeze({
  DEFAULT_CACHE_LIMIT_BYTES,
  DEFAULT_MAX_INFLIGHT,
  ELEVENLABS_BASE,
});
