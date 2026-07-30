// server/lib/platform-providers-budget.js
//
// Private Mode / High Power Mode — operator-funded platform-provider spend
// protection. A real, continuous-refill token bucket per (provider, slot),
// mirroring server/lib/byo-rate-limit.js's exact refill algorithm — but
// GLOBAL (one bucket per provider+slot shared across every High-Power-Mode
// user), not per-user, since these are the operator's own keys.
//
// Lives in server/lib/, not server/domains/, for the same reason
// byo-rate-limit.js does: it must be import-safe from
// server/lib/platform-providers.js (the outbound dispatch chokepoint for
// every platform-provider inference call), and no server/lib/*.js file may
// import from server/domains/*.js anywhere in this codebase.
//
// Deliberately FAIL-CLOSED, the opposite of byo-rate-limit.js's fail-open
// stance. BYO protects a USER from their own runaway usage against a key
// they own and pay for — failing open there is correct (never silently
// break someone's own correctly-configured key on an infra hiccup). This
// module protects the OPERATOR's own paid/free-tier accounts from
// unbounded exposure — an unconfigured limit must default to a
// conservative cap, not "unlimited," because nobody owns the runaway cost
// but Concord itself. On exhaustion, the caller (platform-providers.js)
// falls through to local Ollama automatically — the same "never block the
// user" contract brainChat() already has for BYO failures; only the
// provider changes, the user is never blocked.
//
// Default RPM figures below are seeded from each provider's own published
// free-tier limits where this session's research actually confirmed a
// number (Groq: verified 30 RPM for llama-3.3-70b-versatile). Gemini and
// Mistral's exact current free-tier RPM were NOT independently verified
// this session — those two defaults are deliberately conservative
// placeholders, not scraped facts, and should be confirmed against each
// provider's current published limits before a real deployment relies on
// them. Override any of them via CONCORD_PLATFORM_RPM_<PROVIDER>_<SLOT>.

const VALID_SLOTS = new Set(["conscious", "subconscious", "utility", "repair", "vision"]);
const VALID_PROVIDERS = new Set(["groq", "google", "mistral"]);

/** Rolling window width — matches byo-rate-limit.js's cadence. */
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// Conservative hardcoded defaults, keyed "provider:slot". A slot not listed
// falls back to the provider's own DEFAULT_FALLBACK_RPM.
const DEFAULT_FALLBACK_RPM = 10;
const DEFAULT_RPM = Object.freeze({
  // Verified this session: Groq's published free-tier table for
  // llama-3.3-70b-versatile is 30 RPM / 1,000 RPD / 12K TPM / 100K TPD.
  // Applied uniformly across Groq slots as the conservative floor (the
  // smaller llama-3.1-8b-instant used for utility/repair likely allows
  // more, but was not independently verified, so the safer number is used
  // everywhere).
  "groq:conscious": 30,
  "groq:subconscious": 30,
  "groq:utility": 30,
  "groq:repair": 30,
  // NOT independently verified this session — conservative placeholder.
  "google:conscious": 15,
  "google:vision": 15,
  // NOT independently verified this session — conservative placeholder.
  "mistral:conscious": 10,
  "mistral:subconscious": 10,
  "mistral:utility": 10,
  "mistral:repair": 10,
  "mistral:vision": 10,
});

function envOverrideKey(provider, slot) {
  return `CONCORD_PLATFORM_RPM_${provider.toUpperCase()}_${slot.toUpperCase()}`;
}

function defaultMaxPerMinute(provider, slot) {
  const envVal = Number(process.env[envOverrideKey(provider, slot)]);
  if (Number.isFinite(envVal) && envVal > 0) return Math.max(1, Math.floor(envVal));
  return DEFAULT_RPM[`${provider}:${slot}`] || DEFAULT_FALLBACK_RPM;
}

function stateRoot() {
  const s = globalThis._concordSTATE;
  if (!s) return null;
  if (!s.platformProviders) {
    s.platformProviders = {
      buckets: new Map(), // "provider:slot" -> { maxPerMinute, tokens, lastRefillMs }
      dailySpendUsd: 0,
      dailySpendResetAt: 0,
    };
  }
  return s.platformProviders;
}

function bucketFor(provider, slot) {
  const root = stateRoot();
  if (!root) return null;
  const key = `${provider}:${slot}`;
  if (!root.buckets.has(key)) {
    const max = defaultMaxPerMinute(provider, slot);
    root.buckets.set(key, { maxPerMinute: max, tokens: max, lastRefillMs: Date.now() });
  }
  return root.buckets.get(key);
}

function refill(bucket, nowMs) {
  const elapsedMs = Math.max(0, nowMs - bucket.lastRefillMs);
  const refillPerMs = bucket.maxPerMinute / RATE_LIMIT_WINDOW_MS;
  bucket.tokens = Math.min(bucket.maxPerMinute, bucket.tokens + elapsedMs * refillPerMs);
  bucket.lastRefillMs = nowMs;
  return bucket;
}

/**
 * The enforcement gate. Call once per outbound platform-provider inference
 * attempt, BEFORE contacting the provider. Fail-CLOSED: a missing state
 * root (extremely unlikely — STATE always exists in a booted server)
 * denies rather than allows, since this is operator-spend protection, not
 * user protection.
 *
 * @param {string} provider  'groq' | 'google' | 'mistral'
 * @param {string} slot      brain slot
 * @param {number} [nowMs]
 * @returns {{allowed: boolean, reason: string, retryAfterMs?: number, maxPerMinute?: number}}
 */
export function consumePlatformToken(provider, slot, nowMs = Date.now()) {
  if (!VALID_PROVIDERS.has(provider) || !VALID_SLOTS.has(slot)) {
    return { allowed: false, reason: "invalid_provider_or_slot" };
  }
  const bucket = bucketFor(provider, slot);
  if (!bucket) return { allowed: false, reason: "state_unavailable" };

  refill(bucket, nowMs);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, reason: "within_limit", maxPerMinute: bucket.maxPerMinute };
  }
  const refillPerMs = bucket.maxPerMinute / RATE_LIMIT_WINDOW_MS;
  const retryAfterMs = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs));
  return { allowed: false, reason: "platform_budget_exhausted", retryAfterMs, maxPerMinute: bucket.maxPerMinute };
}

/** Read-only status for every (provider, slot) bucket that has been touched. Does not consume a token. */
export function getPlatformBudgetStatus(nowMs = Date.now()) {
  const root = stateRoot();
  if (!root) return { ok: false, reason: "state_unavailable" };
  const buckets = [];
  for (const [key, bucket] of root.buckets) {
    refill(bucket, nowMs);
    const [provider, slot] = key.split(":");
    buckets.push({ provider, slot, maxPerMinute: bucket.maxPerMinute, remaining: Math.floor(bucket.tokens) });
  }
  return { ok: true, buckets, dailySpendUsd: root.dailySpendUsd };
}

/** Track a rough spend estimate for the admin diagnostic endpoint — visibility only, never gates. */
export function recordPlatformSpendEstimate(usd) {
  const root = stateRoot();
  if (!root || !Number.isFinite(usd)) return;
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (now >= root.dailySpendResetAt) {
    root.dailySpendUsd = 0;
    root.dailySpendResetAt = now + oneDayMs;
  }
  root.dailySpendUsd += usd;
}
