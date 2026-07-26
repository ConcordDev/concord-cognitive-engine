// server/lib/pollinations-image.js
//
// Shared text-to-image helper — the free keyless Pollinations image
// endpoint. Extracted from domains/chat.js's "image-generate" macro so
// other domains (art, creative) needing real text-to-image generation
// don't duplicate the URL-construction + reachability-check logic.
//
// @env-config-ok: image.pollinations.ai is the single free, keyless, public
// base URL for this service (no auth, no per-tenant account, no alternate
// self-hosted mirror in use) — the same "stable public API contract, not
// deployment config" class as the coingecko.com / open-meteo.com entries
// already exempted in the env-config-drift detector's PUBLIC_API_HOST_RE
// list. An env var here would have no legitimate second value to hold.

/**
 * Build a deterministic (same prompt+seed → same image) Pollinations
 * text-to-image URL and best-effort check that it's reachable.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.seed] - explicit seed; derived from the prompt otherwise
 * @returns {Promise<{ ok: boolean, error?: string, url?: string, width?: number, height?: number, seed?: number, reachable?: boolean }>}
 */
export async function generatePollinationsImage({ prompt, width, height, seed } = {}) {
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
    // Network failure in a sandboxed test env — still return the URL, the
    // client <img> tag will surface a load error if it truly fails.
    reachable = false;
  }

  return { ok: true, url, width: w, height: h, seed: s, reachable };
}
