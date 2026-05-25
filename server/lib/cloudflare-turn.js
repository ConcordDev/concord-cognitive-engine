// server/lib/cloudflare-turn.js
//
// Cloudflare TURN credential minter.
//
// Cloudflare Calls offers a TURN service with a generous free tier
// (1 TB/month at time of writing). Credentials are short-lived and
// minted on demand via their REST API — we don't ship long-lived
// TURN passwords to the browser. Each `mintIceServers` call hits
// Cloudflare with bearer auth, gets back an iceServers config with
// time-boxed username/credential, and hands that back to the browser.
//
// Required env:
//   CF_TURN_KEY_ID            — UUID of the TURN key (from Cloudflare dash)
//   CF_TURN_KEY_API_TOKEN     — API token scoped to "Calls: Edit"
//
// Both are optional. When unset, this module returns null and the
// frontend falls back to STUN-only (which works for ~80% of network
// configurations — STUN is enough for any pair of users who aren't
// behind strict NAT).
//
// Endpoint reference:
//   POST https://rtc.live.cloudflare.com/v1/turn/keys/{KEY_ID}/credentials/generate
//   Body: { "ttl": <seconds> }   (3600–86400 are sane bounds)
//   Returns: { iceServers: { urls: [...], username, credential } }

const CF_TURN_BASE = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_TTL_SECONDS = 3600;  // 1 hour — long enough for any single visit
const FETCH_TIMEOUT_MS = 4000;

let _lastError = null;

/**
 * Returns true when both required env vars are present. Lets the caller
 * decide whether to advertise TURN to clients or fall back silently.
 */
export function isConfigured() {
  return !!(process.env.CF_TURN_KEY_ID && process.env.CF_TURN_KEY_API_TOKEN);
}

/**
 * Mint a set of iceServers from Cloudflare. Returns null when unconfigured
 * or on any error (caller falls back to STUN). Never throws — errors are
 * captured in `_lastError` for diagnostics.
 *
 * `ttl` is clamped to [60, 86400] (1min–24h). Cloudflare returns 400 outside
 * that range.
 */
export async function mintIceServers({ ttl = DEFAULT_TTL_SECONDS } = {}) {
  if (!isConfigured()) return null;
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_KEY_API_TOKEN;
  const clampedTtl = Math.max(60, Math.min(86400, Number(ttl) || DEFAULT_TTL_SECONDS));

  const url = `${CF_TURN_BASE}/${encodeURIComponent(keyId)}/credentials/generate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: clampedTtl }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      _lastError = { status: res.status, text: (await res.text().catch(() => "")).slice(0, 200) };
      return null;
    }
    const data = await res.json();
    // Cloudflare returns either `{ iceServers: { urls, username, credential } }`
    // or `{ iceServers: [ { urls, username, credential } ] }` depending on
    // SDK version. Normalise to an array for the browser.
    const raw = data?.iceServers;
    if (!raw) {
      _lastError = { status: 200, text: "missing iceServers in response" };
      return null;
    }
    const servers = Array.isArray(raw) ? raw : [raw];
    return { iceServers: servers, ttl: clampedTtl, expiresAt: Date.now() + clampedTtl * 1000 };
  } catch (e) {
    clearTimeout(timer);
    _lastError = { status: 0, text: String(e?.message || e).slice(0, 200) };
    return null;
  }
}

/** Diagnostics — exposes the last error so /api/webrtc/ice-servers can log it. */
export function lastError() {
  return _lastError;
}
