// server/lib/platform-providers.js
//
// Private Mode / High Power Mode — the operator-funded cloud path.
//
// One provider per brain slot, configured by the operator (not the user).
// Reuses byo-providers.js#providerChat/ADAPTERS UNCHANGED — the only new
// things here are (a) which provider serves which slot, (b) where the
// operator's key comes from, and (c) the global budget gate
// (platform-providers-budget.js).
//
// Provider mix and WHY, per-slot rationale chosen deliberately (operator
// decision, 2026-07-27) rather than one provider blanket-applied to every
// slot — each provider's actual strength routed to the slot that benefits:
//   - conscious: Gemini. The user-facing slot (chat, deep reasoning,
//     council debates) gets the strongest all-around reasoning model of
//     the three, and the only one with real vision support (relevant if
//     a conscious-slot call ever carries an image).
//   - subconscious: Mistral. Background autogen/dream/synthesis runs
//     unattended with no live user watching — Mistral's higher-volume
//     free tier (~1B tokens/month) fits that always-on workload better
//     than Gemini's tighter free-tier RPM.
//   - repair: Mistral, specifically routed to Codestral (see
//     byo-providers.js#DEFAULT_MODELS.mistral.repair) — Mistral is the
//     only one of the three with a dedicated CODE model in its free
//     catalog, and repair (error detection/auto-fix) is exactly the
//     code-adjacent task that model is built for.
//   - utility: Groq. Fast lens actions/formatting want low latency, not
//     depth — Groq's LPU hardware is built for exactly that, and it
//     trains on nothing regardless of tier (verified against its own
//     Services Agreement) — the one provider here with zero tradeoff.
//   - vision: Gemini. Same reasoning as conscious — the only one of the
//     three with real multimodal support in its free tier.
// Gemini and Mistral free tiers DO train on submitted data — used
// knowingly for the slots where capability/volume matters most, and
// always disclosed to the user before they can opt into High Power Mode
// (see the onboarding/settings copy in server/routes/auth.js and
// server/domains/byo-keys.js). This module makes no judgment about that
// tradeoff — it only routes; the disclosure is enforced at the UI/consent
// layer, not here.
import { providerChat, BYO_PROVIDERS } from "./byo-providers.js";
import { consumePlatformToken, recordPlatformSpendEstimate } from "./platform-providers-budget.js";

const VALID_SLOTS = ["conscious", "subconscious", "utility", "repair", "vision"];

// Default provider per slot. Operator-overridable per slot via
// CONCORD_PLATFORM_PROVIDER_<SLOT>=groq|google|mistral — a deployment-time
// config choice, not something a user ever sets. See the rationale block
// above for why each slot is assigned the provider it is.
const DEFAULT_SLOT_PROVIDER = Object.freeze({
  conscious: "google",
  subconscious: "mistral",
  utility: "groq",
  repair: "mistral",
  vision: "google",
});

const PROVIDER_ENV_KEY = Object.freeze({
  groq: "CONCORD_PLATFORM_GROQ_API_KEY",
  google: "CONCORD_PLATFORM_GOOGLE_API_KEY",
  mistral: "CONCORD_PLATFORM_MISTRAL_API_KEY",
});

function providerForSlot(slot) {
  const override = process.env[`CONCORD_PLATFORM_PROVIDER_${slot.toUpperCase()}`];
  if (override && PROVIDER_ENV_KEY[override]) return override;
  return DEFAULT_SLOT_PROVIDER[slot] || null;
}

function apiKeyFor(provider) {
  const envKey = PROVIDER_ENV_KEY[provider];
  return envKey ? (process.env[envKey] || null) : null;
}

/** True if the given slot (or any slot, if omitted) has a usable platform key configured. */
export function platformProviderConfigured(slot = null) {
  if (slot) {
    const provider = providerForSlot(slot);
    return !!(provider && apiKeyFor(provider));
  }
  return VALID_SLOTS.some((s) => platformProviderConfigured(s));
}

/**
 * The provider id (e.g. "google", "groq") that WOULD serve this slot if
 * it's actually configured (has a usable operator key) — null otherwise.
 * Used by brain-config.js#pickBrainEndpoint's opt-in `includeCloud`
 * candidate pool so it can label a cloud candidate with the real provider
 * id instead of guessing at the slot's default.
 */
export function platformProviderIdForSlot(slot) {
  if (!slot) return null;
  const provider = providerForSlot(slot);
  return provider && apiKeyFor(provider) ? provider : null;
}

/**
 * Dispatch a High-Power-Mode call to this slot's configured platform
 * provider. Caller (byo-router.js#brainChat, ctx.llm.chat, the streaming
 * chat path) is responsible for having already gated on brain_mode !==
 * 'private' — this function has no mode awareness of its own, it is only
 * ever reached from an already-gated call site.
 *
 * @param {object} args
 * @param {string} args.slot
 * @param {Array<{role,content}>} args.messages
 * @param {object} [args.opts]
 * @returns {Promise<{ok, text, toolCalls, tokensIn, tokensOut, provider, model, error?}>}
 */
export async function platformProviderChat({ slot, messages, opts = {} }) {
  const provider = providerForSlot(slot);
  if (!provider) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: "no_platform_provider_for_slot", provider: "none", model: "none" };
  }
  const apiKey = apiKeyFor(provider);
  if (!apiKey) {
    return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: "platform_provider_not_configured", provider: `${provider}_platform`, model: "none" };
  }

  const gate = consumePlatformToken(provider, slot);
  if (!gate.allowed) {
    return {
      ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
      error: gate.reason, retryAfterMs: gate.retryAfterMs,
      provider: `${provider}_platform`, model: "none",
    };
  }

  const r = await providerChat({ provider, apiKey, slot, modelId: null, messages, opts });

  // Visibility-only spend estimate — never gates, admin diagnostic only.
  // No verified per-token $ figures for these three providers were
  // established this session, so this stays a token-count signal rather
  // than a fabricated dollar estimate until real pricing is wired in.
  if (r.ok) recordPlatformSpendEstimate(0);

  // provider tag is *_platform (e.g. "google_platform") — distinct from a
  // user's own BYO key ("google") for DTU-provenance/royalty-cascade
  // clarity (see server/lib/byo-router.js#provenanceFrom, unchanged).
  // Adapters don't return which model they used, so re-derive it the same
  // way byo-router.js#brainChat does for BYO calls.
  const resolvedModel = BYO_PROVIDERS.defaultModels[provider]?.[slot] || provider;
  return { ...r, provider: `${provider}_platform`, model: resolvedModel };
}
