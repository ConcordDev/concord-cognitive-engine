// server/lib/byo-keys.js
//
// Sprint 10 — read/write API for user-brain-override rows.
//
// Privacy:
//   - The plaintext key is accepted only as an argument to `setKey()`.
//   - After encryption + persistence, the plaintext is dropped.
//   - `listOverrides` returns ONLY the masked preview, never any
//     ciphertext or plaintext. The frontend has no path to read the
//     full key back. To rotate, the user must paste a new one.

import { encryptKey, previewOf } from "./byo-crypto.js";
import { providerChat, BYO_PROVIDERS } from "./byo-providers.js";

const VALID_SLOTS = new Set(["conscious", "subconscious", "utility", "repair", "vision"]);

export async function setKey(db, userId, { slot, provider, modelId, apiKey }) {
  if (!db || !userId || !slot || !provider) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
  if (!BYO_PROVIDERS.list.includes(provider) && provider !== "concord_default" && provider !== "ollama") {
    return { ok: false, reason: "invalid_provider" };
  }

  // Default-path rows don't need a key — but BYO providers must.
  let encrypted = null;
  let preview = null;
  if (provider !== "concord_default" && provider !== "ollama") {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 8) {
      return { ok: false, reason: "missing_or_short_api_key" };
    }
    try {
      encrypted = await encryptKey(userId, apiKey.trim());
      preview = previewOf(apiKey.trim());
    } catch (err) {
      return { ok: false, reason: "encryption_failed", error: err?.message };
    }
  }

  db.prepare(`
    INSERT INTO user_brain_overrides
      (user_id, brain_slot, provider, model_id, encrypted_key, key_preview, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
    ON CONFLICT(user_id, brain_slot) DO UPDATE SET
      provider      = excluded.provider,
      model_id      = excluded.model_id,
      encrypted_key = COALESCE(excluded.encrypted_key, encrypted_key),
      key_preview   = COALESCE(excluded.key_preview, key_preview),
      active        = 1,
      updated_at    = unixepoch()
  `).run(userId, slot, provider, modelId || null, encrypted, preview);

  return { ok: true, slot, provider, modelId: modelId || null, preview };
}

export function removeKey(db, userId, slot) {
  if (!db || !userId || !slot) return { ok: false, reason: "missing_inputs" };
  const r = db.prepare(`DELETE FROM user_brain_overrides WHERE user_id = ? AND brain_slot = ?`).run(userId, slot);
  return { ok: true, deleted: r.changes };
}

export function setActive(db, userId, slot, active) {
  if (!db || !userId || !slot) return { ok: false, reason: "missing_inputs" };
  const r = db.prepare(`
    UPDATE user_brain_overrides SET active = ?, updated_at = unixepoch()
    WHERE user_id = ? AND brain_slot = ?
  `).run(active ? 1 : 0, userId, slot);
  return { ok: true, changed: r.changes };
}

export function listOverrides(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT brain_slot AS slot, provider, model_id, key_preview, active,
             created_at, updated_at, last_used_at
      FROM user_brain_overrides
      WHERE user_id = ?
      ORDER BY brain_slot ASC
    `).all(userId);
  } catch {
    return [];
  }
}

/** Verify the saved key works by sending a 1-token ping. */
export async function testConnection(db, userId, slot) {
  if (!db || !userId || !slot) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`
    SELECT provider, model_id, encrypted_key FROM user_brain_overrides
    WHERE user_id = ? AND brain_slot = ?
  `).get(userId, slot);
  if (!row) return { ok: false, reason: "no_override" };
  if (row.provider === "concord_default" || row.provider === "ollama") {
    return { ok: true, provider: row.provider, note: "default path; no external key" };
  }
  const { decryptKey } = await import("./byo-crypto.js");
  const apiKey = await decryptKey(userId, row.encrypted_key);
  if (!apiKey) return { ok: false, reason: "key_undecryptable" };
  const r = await providerChat({
    provider: row.provider,
    apiKey,
    slot,
    modelId: row.model_id || null,
    messages: [{ role: "user", content: "ping" }],
    opts: { maxTokens: 8, timeoutMs: 12_000 },
  });
  return {
    ok: r.ok,
    provider: row.provider,
    model: row.model_id || BYO_PROVIDERS.defaultModels[row.provider]?.[slot],
    error: r.error || null,
  };
}

export function listAvailableProviders() {
  return {
    providers: BYO_PROVIDERS.list.map(name => ({
      id: name,
      name: ({
        openai: "OpenAI",
        anthropic: "Anthropic Claude",
        xai: "xAI Grok",
        google: "Google Gemini",
      })[name],
      defaultModels: BYO_PROVIDERS.defaultModels[name],
      keyFormat: ({
        openai: "sk-…",
        anthropic: "sk-ant-…",
        xai: "xai-…",
        google: "AIza…",
      })[name],
    })),
    slots: ["conscious", "subconscious", "utility", "repair", "vision"],
    note: "Plaintext keys are encrypted AES-GCM with a per-user wrapping key derived from JWT_SECRET. They are never returned to the frontend after save; the masked preview is shown instead.",
  };
}
