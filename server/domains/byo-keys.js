// server/domains/byo-keys.js
//
// Sprint 10 — macro surface for BYO API key management.
//
// All routes are authenticated — there's no publicReadDomains entry
// (we don't want unauthenticated readers learning ANY user's setup).
// The settings page UI calls these via the standard /api/lens/run
// authenticated path.

import {
  setKey, removeKey, setActive, listOverrides,
  testConnection, listAvailableProviders,
} from "../lib/byo-keys.js";

export default function registerByoKeysMacros(register) {
  register("byo_keys", "list", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return { ok: true, overrides: listOverrides(db, userId) };
  }, { note: "List the user's brain overrides. Returns previews only, never plaintext keys." });

  register("byo_keys", "set", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    const { slot, provider, modelId, apiKey } = input || {};
    return setKey(db, userId, { slot, provider, modelId, apiKey });
  }, { note: "Create or update a brain override. apiKey is encrypted at rest immediately." });

  register("byo_keys", "remove", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return removeKey(db, userId, input?.slot);
  }, { note: "Delete a brain override (key + provider config)." });

  register("byo_keys", "set_active", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return setActive(db, userId, input?.slot, !!input?.active);
  }, { note: "Toggle an override on/off without deleting the key." });

  register("byo_keys", "test", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return testConnection(db, userId, input?.slot);
  }, { note: "Send a 1-token ping to verify the saved key works." });

  register("byo_keys", "available_providers", async () => {
    return { ok: true, ...listAvailableProviders() };
  }, { note: "List supported providers + their default model maps. Static; safe for any caller." });
}
