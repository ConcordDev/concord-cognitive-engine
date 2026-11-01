// server/lib/content-safety/providers.js
//
// External content-classifier adapters, following the established Concord pattern
// for outbound API calls (native fetch + Bearer + AbortSignal.timeout, à la
// lib/byo-providers.js#openaiChat). Each returns a normalized
// { ok, flagged, categories[], scores } or { ok:false, reason } and NEVER throws.
//
// v1 baseline: OpenAI omni-moderation (free, text+image, 40+ langs).
//
// Provider decision (founder, 2026-10-28): the CSAM path is WebPurify.
// csamHashMatch dispatches to WebPurify's AIM image check
// (webpurify.aim.imgcheck — real-time per-category probabilities, `csam`
// category included) when CONCORD_CSAM_PROVIDER=webpurify and
// WEBPURIFY_API_KEY are set. Isolation rule from the same decision: the
// cloud payload is strictly limited to public user-generated attachments
// at the publish boundary — callers pass only an already-public image URL
// and only at published-or-higher scopes; media bytes, private-tier
// content, and local text are NEVER sent. The local/offline paths
// (screenLocalSync, the local checks in screenForPublish) never touch
// this adapter, so local work is never blocked on the network.

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

const WEBPURIFY_AIM_ENDPOINT = "https://im-api1.webpurify.com/v2/services/rest/";

/**
 * WebPurify AIM image check (webpurify.aim.imgcheck). URL-based by design:
 * WebPurify fetches the image itself, so callers must pass an ALREADY-PUBLIC
 * image URL — never upload bytes here. Returns the normalized provider shape
 * { ok, flagged, categories, scores } with per-category probabilities (0-100);
 * `flagged`/`categories` use the threshold (default 50, env
 * WEBPURIFY_FLAG_THRESHOLD). Never throws.
 */
export async function webpurifyImageCheck(imageUrl, { apiKey, timeoutMs = 8000, cats = "csam,porn", threshold } = {}) {
  const key = apiKey || process.env.WEBPURIFY_API_KEY;
  if (!key) return { ok: false, reason: "no_key" };
  if (!imageUrl) return { ok: false, reason: "url_required" };
  const th = Number(threshold ?? process.env.WEBPURIFY_FLAG_THRESHOLD ?? 50);
  try {
    const qs = new URLSearchParams({
      method: "webpurify.aim.imgcheck",
      imgurl: String(imageUrl),
      format: "json",
      cats,
    });
    qs.set("api_key", key);
    const res = await fetch(`${WEBPURIFY_AIM_ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, reason: `webpurify_${res.status}` };
    const j = await res.json();
    const rsp = j?.rsp || {};
    if (rsp?.["@attributes"]?.stat === "fail" || rsp?.err) {
      const code = rsp?.err?.["@attributes"]?.code || "error";
      return { ok: false, reason: `webpurify_${code}` };
    }
    const scores = {};
    for (const c of String(cats).split(",").map((s) => s.trim()).filter(Boolean)) {
      const v = Number(rsp[c]);
      if (Number.isFinite(v)) scores[c] = v;
    }
    const categories = Object.entries(scores).filter(([, v]) => v >= th).map(([k]) => k);
    return { ok: true, flagged: categories.length > 0, categories, scores };
  } catch (e) {
    return { ok: false, reason: "fetch_error", detail: String(e?.message || e) };
  }
}

/**
 * CSAM check on media. Returns { ok, match } when configured. Until
 * CONCORD_CSAM_PROVIDER + credentials are set this returns
 * { ok:false, reason:"not_configured" } — callers must treat "not
 * configured" as "cannot clear high-reach media", NOT as "safe".
 *
 * Provider: webpurify (founder decision 2026-10-28). WebPurify is
 * URL-based, so opts.imageUrl is required; without it the result is
 * { ok:false, reason:"url_required" } and the caller's cannot-clear
 * semantics apply unchanged. A match at/above the CSAM threshold
 * (env WEBPURIFY_CSAM_THRESHOLD, default 50) → hard block + NCMEC
 * CyberTipline report + artifact retention, handled by the caller.
 */
export async function csamHashMatch(_mediaBuffer, opts = {}) {
  const provider = String(process.env.CONCORD_CSAM_PROVIDER || "").toLowerCase();
  if (!provider) return { ok: false, reason: "not_configured" };
  if (provider === "webpurify") {
    if (!process.env.WEBPURIFY_API_KEY) return { ok: false, reason: "no_key" };
    if (!opts.imageUrl) return { ok: false, reason: "url_required" };
    const r = await webpurifyImageCheck(opts.imageUrl, {});
    if (!r.ok) return r;
    const th = Number(process.env.WEBPURIFY_CSAM_THRESHOLD || 50);
    return { ok: true, match: (r.scores?.csam ?? 0) >= th, provider: "webpurify", scores: r.scores };
  }
  return { ok: false, reason: "provider_unimplemented" };
}

export default { openaiModeration, webpurifyImageCheck, csamHashMatch };
