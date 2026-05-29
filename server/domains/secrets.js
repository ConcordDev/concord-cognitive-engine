// server/domains/secrets.js
//
// Sprint C / Track A3 — macro surface for the secrets discovery loop.
//
// Read + write macros so the SecretsCodex HUD can list + weaponise
// discovered secrets. The PRIVACY INVARIANT is enforced upstream
// (narrative-bridge.js never sends secret.body to LLMs); these macros
// freely return body text because the user has earned discovery.

import {
  discoverSecret,
  weaponiseSecret,
  rollSurveillance,
  listDiscoveredForUser,
} from "../lib/secrets.js";

export default function registerSecretsMacros(register) {
  /**
   * secrets.list_discovered — list secrets discovered by the caller.
   * input: { userId?, includeBody?, limit? }
   */
  register("secrets", "list_discovered", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return {
      ok: true,
      secrets: listDiscoveredForUser(db, userId, {
        includeBody: input.includeBody !== false,
        limit,
      }),
    };
  }, { note: "list player's discovered secrets" });

  /**
   * secrets.discover — explicit discovery (used by quest scripting).
   * input: { secretId, via? }
   */
  register("secrets", "discover", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.secretId) return { ok: false, reason: "missing_inputs" };
    return discoverSecret(db, userId, input.secretId, input.via || "quest");
  });

  /**
   * secrets.weaponise — burn a discovered secret. Records opinion deltas
   * on holder + subject and emits a `secret:weaponised` realtime event.
   * input: { secretId, againstNpcId? }
   */
  register("secrets", "weaponise", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.secretId) return { ok: false, reason: "missing_inputs" };
    const r = weaponiseSecret(db, userId, input.secretId, input.againstNpcId);
    if (r?.ok) {
      try {
        const io = ctx?.app?.locals?.io || ctx?.io;
        io?.emit?.("secret:weaponised", {
          userId, secretId: input.secretId,
          holder: r.holder, subject_kind: r.subject_kind, subject_id: r.subject_id,
          kind: r.kind, ts: Math.floor(Date.now() / 1000),
        });
      } catch { /* socket optional */ }
    }
    return r;
  }, { note: "weaponise a discovered secret" });

  /**
   * secrets.surveillance_roll — long-press follow accumulates evidence.
   * input: { targetNpcId }
   */
  register("secrets", "surveillance_roll", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.targetNpcId) return { ok: false, reason: "missing_inputs" };
    return rollSurveillance(db, userId, input.targetNpcId);
  });

  /**
   * hooks.mine — D5: the leverage the player currently HOLDS (CK3 hooks).
   * Each entry is spendable (weak) or unlimited+blocking (strong). The
   * SecretsCodex / trait inspector surfaces these so the player can see what
   * they can coerce. input: { targetKind?, targetId? } to filter to one target.
   */
  register("hooks", "mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const { getActiveHooks } = await import("../lib/npc-hooks.js");
    const hooks = getActiveHooks(db, {
      holderKind: "player", holderId: userId,
      targetKind: input.targetKind || null, targetId: input.targetId || null,
    });
    return { ok: true, hooks };
  }, { note: "list the leverage (hooks) the player holds" });
}
