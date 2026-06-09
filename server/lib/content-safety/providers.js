// server/lib/content-safety/providers.js
//
// External content-classifier adapters, following the established Concord pattern
// for outbound API calls (native fetch + Bearer + AbortSignal.timeout, à la
// lib/byo-providers.js#openaiChat). Each returns a normalized
// { ok, flagged, categories[], scores } or { ok:false, reason } and NEVER throws.
//
// v1 baseline: OpenAI omni-moderation (free, text+image, 40+ langs). The CSAM
// hash-match path (Thorn Safer Match / Cloudflare CSAM / PhotoDNA) is an interface
// stub — it requires an account + NCMEC ESP registration (operational, not code).

function buildOpenAIInputs(input) {
  if (typeof input === "string") return [{ type: "text", text: input }];
  const out = [];
  if (input?.text) out.push({ type: "text", text: String(input.text) });
  if (input?.imageUrl) out.push({ type: "image_url", image_url: { url: String(input.imageUrl) } });
  return out.length ? out : [{ type: "text", text: "" }];
}

/** OpenAI omni-moderation (free). input: string | { text?, imageUrl? }. */
export async function openaiModeration(input, { apiKey, timeoutMs = 8000 } = {}) {
  const key = apiKey || process.env.CONCORD_MODERATION_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_key" };
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: buildOpenAIInputs(input) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `openai_${res.status}` };
    const j = await res.json();
    const r = (j.results && j.results[0]) || {};
    const categories = Object.entries(r.categories || {}).filter(([, v]) => v).map(([k]) => k);
    return { ok: true, flagged: !!r.flagged, categories, scores: r.category_scores || {} };
  } catch (e) {
    return { ok: false, reason: "fetch_error", detail: String(e?.message || e) };
  }
}

/**
 * CSAM hash-match interface (Thorn Safer Match / Cloudflare CSAM / PhotoDNA).
 * Returns { ok, match } when configured. Until CONCORD_CSAM_PROVIDER + a key are
 * set this returns { ok:false, reason:"not_configured" } — callers must treat
 * "not configured" as "cannot clear high-reach media", NOT as "safe".
 */
export async function csamHashMatch(_mediaBuffer, _opts = {}) {
  if (!process.env.CONCORD_CSAM_PROVIDER) return { ok: false, reason: "not_configured" };
  // Wire Thorn Safer Match / Cloudflare CSAM Scanning Tool / PhotoDNA here once an
  // account + NCMEC ESP registration exist. The provider returns a hash-match
  // verdict; a match → hard block + NCMEC CyberTipline report + artifact retention.
  return { ok: false, reason: "provider_unimplemented" };
}

export default { openaiModeration, csamHashMatch };
