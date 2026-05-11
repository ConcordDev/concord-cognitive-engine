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
export async function brainChat({ db, userId, slot, messages, opts = {} }) {
  if (!slot) {
    return {
      ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0,
      provider: "concord_default", model: "unknown",
      error: "missing_slot",
    };
  }

  // 1) Override path — user has plugged in a frontier-model API key.
  const override = userId ? getOverride(db, userId, slot) : null;
  if (override && override.provider && override.provider !== "concord_default" && override.provider !== "ollama") {
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

  // 2) Default path — concord-os.org-hosted Ollama brain.
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
