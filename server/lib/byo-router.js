// server/lib/byo-router.js
//
// Sprint 10 — the BYO router. Sits between callers (chat, autogen,
// vision, repair, etc.) and the actual provider. Looks up the user's
// brain override; if active, decrypts the key and routes to the
// external provider. Otherwise falls through to the default Ollama
// instance (free, concord-os.org subsidised).
//
// Same return shape as `ollamaChat`, so every existing callsite that
// does `const r = await ollamaChat(...)` can be one-line swapped for
// `const r = await brainChat(userId, ...)` with zero shape changes.
//
// Provenance: every successful call returns `{ ok, provider, model, ... }`.
// DTU mint paths read these so the dtus row records who minted it.

import { ollamaChat } from "./inference/ollama-client.js";
import { providerChat, BYO_PROVIDERS } from "./byo-providers.js";
import { decryptKey } from "./byo-crypto.js";
import { consumeRateLimitToken } from "./byo-rate-limit.js";
import { platformProviderChat, platformProviderConfigured } from "./platform-providers.js";
import { freeCloudProviderChat } from "./free-cloud-router-extended.js";

/**
 * Look up an override row for a (user, slot).
 * @returns {{provider, model_id, encrypted_key} | null}
 */
export function getOverride(db, userId, slot) {
  if (!db || !userId || !slot) return null;
  try {
    return db.prepare(`
      SELECT provider, model_id, encrypted_key, active
      FROM user_brain_overrides
      WHERE user_id = ? AND brain_slot = ? AND active = 1
      LIMIT 1
    `).get(userId, slot) || null;
  } catch {
    // Migration 170 not applied — caller falls through to default.
    return null;
  }
}

/**
 * Read a user's account-level brain_mode ('private' | 'high_power').
 *
 * Deliberately FAILS CLOSED to 'private' on any error (missing db, missing
 * userId, migration 397 not yet applied, corrupt row) — this is the one
 * place in this file that inverts the rest of BYO's fail-open philosophy.
 * Everywhere else here, a failure falls through to Ollama so a user is
 * never blocked from chatting; here, a failure must never accidentally
 * OPEN a cloud path for an account that never explicitly chose one.
 *
 * @returns {'private'|'high_power'}
 */
export function getBrainMode(db, userId) {
  if (!db || !userId) return "private";
  try {
    const row = db.prepare(`SELECT brain_mode FROM users WHERE id = ?`).get(userId);
    return row?.brain_mode === "high_power" ? "high_power" : "private";
  } catch {
    // Migration 397 not applied, or any other read failure — fail closed.
    return "private";
  }
}

/**
 * Predict, WITHOUT actually dispatching, whether a call for this (user,
 * slot) will land locally (Ollama) or externally (BYO override or a
 * configured High Power Mode platform provider). Callers that build a
 * system prompt BEFORE the real dispatch decision (e.g.
 * prompt-registry.js#composeSystemPrompt's conscious-brain persona
 * portability logic) use this to pick the right persona text ahead of
 * time — brainChat() itself doesn't need this, it makes the real
 * decision inline as it goes.
 *
 * @returns {'local'|'external'}
 */
export function resolveDispatchTarget(db, userId, slot) {
  const mode = getBrainMode(db, userId);
  if (mode === "private") return "local";
  const override = userId ? getOverride(db, userId, slot) : null;
  if (override && override.provider && override.provider !== "concord_default" && override.provider !== "ollama") {
    return "external";
  }
  if (platformProviderConfigured(slot)) return "external";
  return "local";
}

/**
 * Bump the last_used_at timestamp so the settings UI can show
 * "last used 5m ago" without us logging the prompt itself.
 */
function touchOverride(db, userId, slot) {
  try {
    db.prepare(`
      UPDATE user_brain_overrides
      SET last_used_at = unixepoch()
      WHERE user_id = ? AND brain_slot = ?
    `).run(userId, slot);
  } catch { /* noop */ }
}

/**
 * The unified inference entry point. Decides override-vs-default per
 * (user, slot), routes accordingly, and returns provenance metadata
 * so callers can stamp DTU mints.
 *
 * @param {object} args
 * @param {object} args.db
 * @param {string} args.userId          required for override lookup
 * @param {string} args.slot            brain slot (conscious|subconscious|utility|repair|vision)
 * @param {Array<{role,content}>} args.messages
 * @param {object} [args.opts]
 * @returns {Promise<{ok, text, toolCalls, tokensIn, tokensOut, provider, model, error?}>}
 */
export async function brainChat({ db, userId, slot, messages, opts = {}, brainMode = null }) {
  const startedAt = Date.now();
  const result = await _brainChatDispatch({ db, userId, slot, messages, opts, brainMode });
  try {
    const { meterBrainChatResult } = await import("./runtime/inference-billing-bridge.js");
    meterBrainChatResult(db, result, { slot, userId, latencyMs: Date.now() - startedAt, opts });
  } catch { /* metering never blocks */ }
  return result;
}

async function _brainChatDispatch({ db, userId, slot, messages, opts = {}, brainMode = null }) {
  if (!slot) {
    return {
      ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
      provider: "concord_default", model: "unknown",
      error: "missing_slot",
    };
  }

  // Private Mode: this account's whole-account "no exceptions" guarantee.
  // Skip BOTH the BYO override lookup and the platform-provider path
  // entirely — never even ask whether one is configured — and go straight
  // to local Ollama. This deliberately overrides a user's OWN BYO key too:
  // Private is an account-wide privacy guarantee, not merely "no platform
  // key." `brainMode` may be passed in by a caller that already resolved it
  // (e.g. ctx.llm.chat, which has it on ctx.actor for free); otherwise it's
  // looked up here.
  const mode = brainMode || getBrainMode(db, userId);
  if (mode === "private") {
    const r = await ollamaChat(slot, messages, opts);
    return { ...r, provider: "concord_default", model: "ollama" };
  }

  // 1) Override path — user has plugged in a frontier-model API key.
  const override = userId ? getOverride(db, userId, slot) : null;
  if (override && override.provider && override.provider !== "concord_default" && override.provider !== "ollama") {
    // Requests-per-minute throttle (Wave 4 gap-closure, item #9 of
    // docs/lens-specs/byo-keys-capability-map.md). This is a SEPARATE
    // control from the monthly $/token budget cap (byo_keys.budget_check)
    // — it caps burst rate, not spend. Gate BEFORE decrypting the key or
    // contacting the provider: a blocked call must never touch the
    // network, both to actually protect the user's provider account from
    // a runaway loop and to avoid burning an unnecessary decrypt cycle.
    // Fail-open when no limit is configured for this (user, slot).
    const rl = consumeRateLimitToken(userId, slot);
    if (!rl.allowed) {
      return {
        ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
        provider: override.provider,
        model: override.model_id || BYO_PROVIDERS.defaultModels[override.provider]?.[slot] || override.provider,
        error: "rate_limited",
        retryAfterMs: rl.retryAfterMs,
      };
    }
    const apiKey = await decryptKey(userId, override.encrypted_key);
    if (apiKey) {
      const r = await providerChat({
        provider: override.provider,
        apiKey,
        slot,
        modelId: override.model_id || null,
        messages,
        opts,
      });
      touchOverride(db, userId, slot);
      return {
        ...r,
        provider: override.provider,
        model: override.model_id || BYO_PROVIDERS.defaultModels[override.provider]?.[slot] || override.provider,
      };
    }
    // Key undecryptable (rotated JWT_SECRET, tampered row, etc.).
    // Fall through to default — never block the user from chatting.
  }

  // 2) Platform-provider path — High Power Mode, no BYO override for this
  // slot (or it just failed). Operator-funded Groq/Gemini/Mistral key, per
  // server/lib/platform-providers.js's slot registry. Only ever reached
  // when mode === 'high_power' (Private returned above), so a Private-Mode
  // account can never land here even if a platform key is configured.
  if (platformProviderConfigured(slot)) {
    const pg = await platformProviderChat({ slot, messages, opts });
    if (pg.ok) return pg;
    // Platform provider failed/exhausted budget — try free cloud routers next
    // (openrouter/cerebras/groq/gemini/mistral/cloudflare with FCFS daily quota)
    const fc = await freeCloudProviderChat({ db, userId, slot, messages, opts });
    if (fc.ok) return fc;
    // Free cloud also exhausted — fall through to Ollama
  } else {
    // No platform provider configured for this slot — try free cloud as primary fallback
    const fc = await freeCloudProviderChat({ db, userId, slot, messages, opts });
    if (fc.ok) return fc;
  }

  // 3) Default path — concord-os.org-hosted Ollama brain.
  const r = await ollamaChat(slot, messages, opts);
  return {
    ...r,
    provider: "concord_default",
    model: r.ok ? "ollama" : "ollama",
  };
}

/** Provenance helper for DTU mint paths. */
export function provenanceFrom(brainResult) {
  return {
    minted_by_provider: brainResult?.provider || "concord_default",
    minted_by_model:    brainResult?.model || "ollama",
  };
}
