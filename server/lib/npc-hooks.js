// server/lib/npc-hooks.js
//
// D5 (depth/balance plan) — CK3-style HOOKS: spendable, expiring, inheritable
// leverage built on top of the existing secrets/opinions substrate.
//
//   weak hook   → single-use coercion. Spending it consumes it.
//   strong hook → unlimited use AND passively blocks the TARGET from taking
//                 hostile action (scheme/betrayal) against the HOLDER while live.
//
// Hooks are sourced from a discovered/held secret (or a favour/debt), may
// expire, and are inheritable (see inheritHooks). All functions are crash-safe
// and degrade to a no-op on minimal builds without the npc_hooks table.

import crypto from "node:crypto";

// Default time-to-live for a granted hook, in real seconds. 0 / unset = no
// expiry (the safe default for a persistent world — an operator can opt into
// CK3-style decay). When > 0, expireHooks() sweeps lapsed hooks.
function defaultTtlS() {
  const v = Number(process.env.CONCORD_HOOK_TTL_S);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Secrets at or above this discovery difficulty (1–10) yield a STRONG hook —
// a deep, hard-won secret is real leverage. Below it, a weak (single-use) hook.
export const STRONG_HOOK_DIFFICULTY = Number(process.env.CONCORD_HOOK_STRONG_DIFFICULTY) || 8;

function tableExists(db) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_hooks'").get();
  } catch { return false; }
}

/**
 * Grant a hook. Idempotent against the unique live (holder,target,secret) index
 * — re-granting the same secret-derived hook returns the existing one rather
 * than stacking. weak ⇒ uses_left defaults to 1; strong ⇒ uses_left NULL.
 */
export function grantHook(db, {
  holderKind, holderId, targetKind, targetId,
  strength = "weak", source = "secret", sourceSecretId = null,
  usesLeft = null, ttlS = null,
} = {}) {
  if (!db || !holderKind || !holderId || !targetKind || !targetId) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (!tableExists(db)) return { ok: false, reason: "no_table" };
  if (holderKind === targetKind && holderId === targetId) {
    return { ok: false, reason: "self_hook" };
  }
  const str = strength === "strong" ? "strong" : "weak";
  const uses = str === "strong" ? null : (Number.isFinite(usesLeft) ? usesLeft : 1);
  const ttl = Number.isFinite(ttlS) && ttlS > 0 ? Math.floor(ttlS) : defaultTtlS();
  try {
    // Return an existing live hook for the same source if present.
    const existing = db.prepare(`
      SELECT id FROM npc_hooks
      WHERE holder_kind = ? AND holder_id = ? AND target_kind = ? AND target_id = ?
        AND (source_secret_id IS ? OR source_secret_id = ?) AND spent_at IS NULL
    `).get(holderKind, holderId, targetKind, targetId, sourceSecretId, sourceSecretId);
    if (existing) return { ok: true, action: "exists", hookId: existing.id, strength: str };

    const id = `hook_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO npc_hooks
        (id, holder_kind, holder_id, target_kind, target_id, strength, source,
         source_secret_id, uses_left, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, holderKind, holderId, targetKind, targetId, str, source,
           sourceSecretId, uses, ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : null);
    return { ok: true, action: "granted", hookId: id, strength: str };
  } catch (err) {
    return { ok: false, reason: err?.message || "grant_failed" };
  }
}

/** Live hooks a holder holds (optionally filtered to a single target). */
export function getActiveHooks(db, { holderKind, holderId, targetKind = null, targetId = null } = {}) {
  if (!db || !holderKind || !holderId || !tableExists(db)) return [];
  try {
    const now = Math.floor(Date.now() / 1000);
    const base = `
      SELECT id, holder_kind, holder_id, target_kind, target_id, strength, source,
             source_secret_id, uses_left, created_at, expires_at
      FROM npc_hooks
      WHERE holder_kind = ? AND holder_id = ? AND spent_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)`;
    if (targetKind && targetId) {
      return db.prepare(base + ` AND target_kind = ? AND target_id = ?`)
        .all(holderKind, holderId, now, targetKind, targetId);
    }
    return db.prepare(base).all(holderKind, holderId, now);
  } catch { return []; }
}

/**
 * Does `holder` hold a live STRONG hook over `target`? A strong hook passively
 * blocks the target from hostile action against the holder (CK3 semantics).
 */
export function hasBlockingHook(db, { holderKind, holderId, targetKind, targetId } = {}) {
  if (!db || !holderKind || !holderId || !targetKind || !targetId || !tableExists(db)) return false;
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = db.prepare(`
      SELECT id FROM npc_hooks
      WHERE holder_kind = ? AND holder_id = ? AND target_kind = ? AND target_id = ?
        AND strength = 'strong' AND spent_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `).get(holderKind, holderId, targetKind, targetId, now);
    return !!row;
  } catch { return false; }
}

/**
 * Spend a hook. Weak hooks decrement uses_left and are marked spent at 0.
 * Strong hooks never deplete (unlimited use) — spend returns ok without
 * consuming. Returns { ok, consumed, remaining }.
 */
export function spendHook(db, hookId) {
  if (!db || !hookId || !tableExists(db)) return { ok: false, reason: "missing_inputs" };
  try {
    const h = db.prepare(`SELECT strength, uses_left, spent_at FROM npc_hooks WHERE id = ?`).get(hookId);
    if (!h) return { ok: false, reason: "not_found" };
    if (h.spent_at) return { ok: false, reason: "already_spent" };
    if (h.strength === "strong") {
      return { ok: true, consumed: false, remaining: null }; // unlimited
    }
    const remaining = Math.max(0, (Number(h.uses_left) || 1) - 1);
    if (remaining <= 0) {
      db.prepare(`UPDATE npc_hooks SET uses_left = 0, spent_at = unixepoch() WHERE id = ?`).run(hookId);
      return { ok: true, consumed: true, remaining: 0 };
    }
    db.prepare(`UPDATE npc_hooks SET uses_left = ? WHERE id = ?`).run(remaining, hookId);
    return { ok: true, consumed: true, remaining };
  } catch (err) {
    return { ok: false, reason: err?.message || "spend_failed" };
  }
}

/** GC: mark expired hooks spent. Returns the count swept. */
export function expireHooks(db, now = Math.floor(Date.now() / 1000)) {
  if (!db || !tableExists(db)) return { ok: false, swept: 0 };
  try {
    const r = db.prepare(`
      UPDATE npc_hooks SET spent_at = ?
      WHERE spent_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(now, now);
    return { ok: true, swept: r.changes || 0 };
  } catch { return { ok: false, swept: 0 }; }
}

/**
 * Convenience: derive + grant a hook from a secret. Strength scales with the
 * secret's discovery difficulty (deep secrets = strong leverage).
 */
export function grantHookFromSecret(db, { holderKind, holderId, secret, source = "secret", ttlS = null } = {}) {
  if (!secret?.id || !secret?.subject_kind || !secret?.subject_id) {
    return { ok: false, reason: "bad_secret" };
  }
  // A secret about a faction/kingdom/world isn't a per-person hook — skip.
  if (secret.subject_kind !== "npc" && secret.subject_kind !== "player") {
    return { ok: false, reason: "non_personal_subject" };
  }
  const strength = (Number(secret.discovery_difficulty) || 5) >= STRONG_HOOK_DIFFICULTY ? "strong" : "weak";
  return grantHook(db, {
    holderKind, holderId,
    targetKind: secret.subject_kind, targetId: secret.subject_id,
    strength, source, sourceSecretId: secret.id, ttlS,
  });
}

/**
 * Inherit hooks on a death (CK3: "a hook over a dead man's son still bites").
 * Two transfers, both to the deceased's heir:
 *   1. hooks the deceased HELD  → holder reassigned to the heir.
 *   2. hooks held OVER the deceased → target reassigned to the heir.
 * Self-hooks that would result are dropped. Returns counts.
 */
export function inheritHooks(db, deceasedKind, deceasedId, heirNpcId) {
  if (!db || !deceasedKind || !deceasedId || !heirNpcId || !tableExists(db)) {
    return { ok: false, held: 0, over: 0 };
  }
  try {
    let held = 0, over = 0;
    // 1. deceased's held hooks → heir (skip any whose target IS the heir).
    held = db.prepare(`
      UPDATE npc_hooks SET holder_kind = 'npc', holder_id = ?, source = 'inherited'
      WHERE holder_kind = ? AND holder_id = ? AND spent_at IS NULL
        AND NOT (target_kind = 'npc' AND target_id = ?)
    `).run(heirNpcId, deceasedKind, deceasedId, heirNpcId).changes || 0;
    // 2. hooks over the deceased → over the heir (skip any held by the heir).
    over = db.prepare(`
      UPDATE npc_hooks SET target_kind = 'npc', target_id = ?
      WHERE target_kind = ? AND target_id = ? AND spent_at IS NULL
        AND NOT (holder_kind = 'npc' AND holder_id = ?)
    `).run(heirNpcId, deceasedKind, deceasedId, heirNpcId).changes || 0;
    // Drop any self-hooks the reassignment may have produced.
    db.prepare(`
      UPDATE npc_hooks SET spent_at = unixepoch()
      WHERE spent_at IS NULL AND holder_kind = target_kind AND holder_id = target_id
    `).run();
    return { ok: true, held, over };
  } catch (err) {
    return { ok: false, held: 0, over: 0, reason: err?.message };
  }
}

export const HOOK_CONSTANTS = Object.freeze({ STRONG_HOOK_DIFFICULTY });
