// server/lib/hooks.js
//
// D5 — CK3 hooks: information-as-spendable-leverage.
//
// Builds directly on the already-deep secrets (mig 154) + opinions (mig 153)
// substrate. A hook is a held, spendable, expiring, inheritable piece of
// leverage one party holds OVER another. See migration 277 for the schema and
// the design rationale.
//
// Everything here is deterministic and synchronous — no RNG in resolution, so
// the contract test can pin exact outcomes. Every DB touch is guarded so a
// minimal build without the npc_hooks table degrades to a no-op rather than
// throwing (mirrors the secrets/schemes modules' defensive style).

import crypto from "node:crypto";
import { recordOpinionEvent } from "./npc-opinions.js";

// ── Dials (playtest fodder — see docs/BALANCE_DIALS.md) ──────────────────────
// Default TTL ≈ an in-world decade. The Concordia year is 42 days (seasons.js),
// so a decade ≈ 420 days. Env-overridable.
const HOOK_TTL_S = Math.max(
  3600,
  Number(process.env.CONCORD_HOOK_TTL_S) || 420 * 24 * 3600,
);
// A secret this hard to dig up yields a STRONG hook outright; below it, weak.
const STRONG_DIFFICULTY = Math.max(
  1,
  Math.min(10, Number(process.env.CONCORD_HOOK_STRONG_DIFFICULTY) || 7),
);
const WEAK_USES = Math.max(1, Number(process.env.CONCORD_HOOK_WEAK_USES) || 1);
const STRONG_USES = Math.max(1, Number(process.env.CONCORD_HOOK_STRONG_USES) || 3);
// Scheme-success bonus when the plotter holds a hook over the target.
const SUCCESS_BONUS_WEAK = 10;
const SUCCESS_BONUS_STRONG = 20;
// Opinion delta when a hook is spent to coerce: the target complies but resents
// the leverage (CK3 — using a hook breeds tyranny opinion).
const COERCE_OPINION_DELTA = -12;

function tableReady(db) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_hooks'").get();
  } catch {
    return false;
  }
}

function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Grant (or upgrade) a hook held by (holder) over (target). Idempotent per
 * (holder, target, source_secret_id): a repeat grant of the same strength is a
 * no-op; a strong grant over an existing weak hook upgrades it (and refreshes
 * uses_left + expiry); a weak grant never downgrades a strong hook.
 *
 * @returns { ok, action: 'granted'|'upgraded'|'refreshed'|'exists', hookId, strength }
 */
export function grantHook(db, opts = {}) {
  if (!db || !tableReady(db)) return { ok: false, reason: "schema_unavailable" };
  const {
    holderKind, holderId, targetKind, targetId,
    strength = "weak", sourceSecretId = null, worldId = null,
    origin = "secret", at = now(),
  } = opts;
  if (!holderKind || !holderId || !targetKind || !targetId) return { ok: false, reason: "missing_inputs" };
  if (holderKind === targetKind && holderId === targetId) return { ok: false, reason: "self_hook" };
  if (strength !== "weak" && strength !== "strong") return { ok: false, reason: "bad_strength" };

  const existing = db.prepare(`
    SELECT id, strength, spent_at FROM npc_hooks
    WHERE holder_kind = ? AND holder_id = ? AND target_kind = ? AND target_id = ?
      AND ((source_secret_id IS NULL AND ? IS NULL) OR source_secret_id = ?)
  `).get(holderKind, holderId, targetKind, targetId, sourceSecretId, sourceSecretId);

  const uses = strength === "strong" ? STRONG_USES : WEAK_USES;
  const expiresAt = at + HOOK_TTL_S;

  if (existing) {
    // Re-grant: upgrade weak→strong, or refresh a spent/expired hook back to life.
    const upgrading = strength === "strong" && existing.strength === "weak";
    const reviving = !!existing.spent_at;
    if (upgrading || reviving) {
      const newStrength = strength === "strong" || existing.strength === "strong" ? "strong" : "weak";
      const newUses = newStrength === "strong" ? STRONG_USES : WEAK_USES;
      db.prepare(`
        UPDATE npc_hooks SET strength = ?, uses_left = ?, expires_at = ?, spent_at = NULL WHERE id = ?
      `).run(newStrength, newUses, expiresAt, existing.id);
      return { ok: true, action: upgrading ? "upgraded" : "refreshed", hookId: existing.id, strength: newStrength };
    }
    return { ok: true, action: "exists", hookId: existing.id, strength: existing.strength };
  }

  const id = `hook_${crypto.randomUUID().slice(0, 16)}`;
  db.prepare(`
    INSERT INTO npc_hooks
      (id, holder_kind, holder_id, target_kind, target_id, strength, source_secret_id, world_id, origin, uses_left, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, holderKind, holderId, targetKind, targetId, strength, sourceSecretId, worldId, origin, uses, at, expiresAt);
  return { ok: true, action: "granted", hookId: id, strength };
}

/**
 * Derive a hook from a freshly-discovered secret. The discoverer gains leverage
 * over the secret's SUBJECT (the person it incriminates). Strength is STRONG
 * when the secret was hard to dig up (discovery_difficulty ≥ STRONG_DIFFICULTY)
 * or the holder already holds another live hook over the same subject
 * (corroboration), else WEAK.
 *
 * @returns { ok, action, hookId, strength } | { ok:false, reason }
 */
export function generateHookFromSecretDiscovery(db, { holderKind = "player", holderId, secretId, worldId = null, at = now() } = {}) {
  if (!db || !tableReady(db)) return { ok: false, reason: "schema_unavailable" };
  if (!holderId || !secretId) return { ok: false, reason: "missing_inputs" };
  let sec;
  try {
    sec = db.prepare(`SELECT id, subject_kind, subject_id, discovery_difficulty FROM secrets WHERE id = ?`).get(secretId);
  } catch {
    return { ok: false, reason: "secrets_unavailable" };
  }
  if (!sec) return { ok: false, reason: "secret_not_found" };
  // Only person-subjects produce leverage — a "world" or "faction" secret has
  // no single coercible target.
  if (sec.subject_kind !== "npc" && sec.subject_kind !== "player") {
    return { ok: false, reason: "subject_not_coercible" };
  }
  // Don't hand a player a hook over themselves via a self-referencing secret.
  if (sec.subject_kind === holderKind && String(sec.subject_id) === String(holderId)) {
    return { ok: false, reason: "self_hook" };
  }

  let strong = (sec.discovery_difficulty || 5) >= STRONG_DIFFICULTY;
  if (!strong) {
    // Corroboration: a second live hook over the same subject promotes to strong.
    const corroborated = db.prepare(`
      SELECT 1 FROM npc_hooks
      WHERE holder_kind = ? AND holder_id = ? AND target_kind = ? AND target_id = ?
        AND spent_at IS NULL AND (source_secret_id IS NULL OR source_secret_id <> ?)
      LIMIT 1
    `).get(holderKind, holderId, sec.subject_kind, sec.subject_id, secretId);
    if (corroborated) strong = true;
  }

  return grantHook(db, {
    holderKind, holderId,
    targetKind: sec.subject_kind, targetId: sec.subject_id,
    strength: strong ? "strong" : "weak",
    sourceSecretId: secretId, worldId, origin: "secret", at,
  });
}

/** Active (unspent, unexpired) hooks held by a party. */
export function getHooksHeldBy(db, holderKind, holderId, { activeOnly = true, at = now() } = {}) {
  if (!db || !tableReady(db) || !holderKind || !holderId) return [];
  const where = activeOnly ? "AND spent_at IS NULL AND (expires_at IS NULL OR expires_at > ?)" : "";
  const args = activeOnly ? [holderKind, holderId, at] : [holderKind, holderId];
  return db.prepare(`
    SELECT id, target_kind, target_id, strength, source_secret_id, uses_left, expires_at, spent_at, origin
    FROM npc_hooks WHERE holder_kind = ? AND holder_id = ? ${where}
    ORDER BY (strength = 'strong') DESC, created_at DESC LIMIT 100
  `).all(...args);
}

/** Active hooks held AGAINST a party (leverage others have over them). */
export function getHooksAgainst(db, targetKind, targetId, { activeOnly = true, at = now() } = {}) {
  if (!db || !tableReady(db) || !targetKind || !targetId) return [];
  const where = activeOnly ? "AND spent_at IS NULL AND (expires_at IS NULL OR expires_at > ?)" : "";
  const args = activeOnly ? [targetKind, targetId, at] : [targetKind, targetId];
  return db.prepare(`
    SELECT id, holder_kind, holder_id, strength, source_secret_id, uses_left, expires_at, origin
    FROM npc_hooks WHERE target_kind = ? AND target_id = ? ${where}
    ORDER BY (strength = 'strong') DESC, created_at DESC LIMIT 100
  `).all(...args);
}

/** Does (holder) hold a STRONG active hook over (target)? */
export function hasStrongHookOver(db, holderKind, holderId, targetKind, targetId, at = now()) {
  if (!db || !tableReady(db)) return false;
  const row = db.prepare(`
    SELECT 1 FROM npc_hooks
    WHERE holder_kind = ? AND holder_id = ? AND target_kind = ? AND target_id = ?
      AND strength = 'strong' AND spent_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1
  `).get(holderKind, holderId, targetKind, targetId, at);
  return !!row;
}

/**
 * Does the intended TARGET of a hostile action hold a strong hook over the
 * PLOTTER? If so the plotter cannot move — the target's leverage stays their
 * hand. This is the CK3 "strong hook blocks hostile schemes" rule.
 */
export function blocksHostileAction(db, { plotterKind, plotterId, targetKind, targetId }, at = now()) {
  if (!plotterKind || !plotterId || !targetKind || !targetId) return false;
  return hasStrongHookOver(db, targetKind, targetId, plotterKind, plotterId, at);
}

/**
 * Scheme-success bonus the plotter earns from holding a hook over the target.
 * Strong > weak; 0 when no hook. Pure read.
 */
export function successBonusFor(db, { plotterKind, plotterId, targetKind, targetId }, at = now()) {
  if (!db || !tableReady(db)) return 0;
  const row = db.prepare(`
    SELECT strength FROM npc_hooks
    WHERE holder_kind = ? AND holder_id = ? AND target_kind = ? AND target_id = ?
      AND spent_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY (strength = 'strong') DESC LIMIT 1
  `).get(plotterKind, plotterId, targetKind, targetId, at);
  if (!row) return 0;
  return row.strength === "strong" ? SUCCESS_BONUS_STRONG : SUCCESS_BONUS_WEAK;
}

/**
 * Spend one use of a hook by id. Decrements uses_left; when it hits 0 the hook
 * is marked spent. A strong hook's passive block survives until uses_left
 * reaches 0 OR it expires.
 * @returns { ok, action:'spent'|'consumed', usesLeft } | { ok:false, reason }
 */
export function spendHook(db, hookId, { at = now() } = {}) {
  if (!db || !tableReady(db) || !hookId) return { ok: false, reason: "missing_inputs" };
  const h = db.prepare(`SELECT id, uses_left, spent_at, expires_at FROM npc_hooks WHERE id = ?`).get(hookId);
  if (!h) return { ok: false, reason: "not_found" };
  if (h.spent_at) return { ok: false, reason: "spent" };
  if (h.expires_at && h.expires_at <= at) return { ok: false, reason: "expired" };
  const usesLeft = Math.max(0, (h.uses_left || 1) - 1);
  if (usesLeft <= 0) {
    db.prepare(`UPDATE npc_hooks SET uses_left = 0, spent_at = ?, last_used_at = ? WHERE id = ?`).run(at, at, hookId);
    return { ok: true, action: "consumed", usesLeft: 0 };
  }
  db.prepare(`UPDATE npc_hooks SET uses_left = ?, last_used_at = ? WHERE id = ?`).run(usesLeft, at, hookId);
  return { ok: true, action: "spent", usesLeft };
}

/**
 * Coerce a target by spending the holder's best active hook over them. The
 * target complies but resents the leverage (opinion drops). Picks a strong hook
 * first (cheaper to the holder's standing? no — strong hooks have more uses);
 * spends one use. For an NPC target, records the resentment opinion delta.
 *
 * @returns { ok, action:'coerced', hookId, strength, usesLeft, opinionDelta } | { ok:false, reason }
 */
export function coerce(db, { holderKind, holderId, targetKind, targetId, reason = null }, { at = now() } = {}) {
  if (!db || !tableReady(db)) return { ok: false, reason: "schema_unavailable" };
  if (!holderKind || !holderId || !targetKind || !targetId) return { ok: false, reason: "missing_inputs" };
  const hook = db.prepare(`
    SELECT id, strength, uses_left FROM npc_hooks
    WHERE holder_kind = ? AND holder_id = ? AND target_kind = ? AND target_id = ?
      AND spent_at IS NULL AND uses_left > 0 AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY (strength = 'strong') DESC, uses_left DESC LIMIT 1
  `).get(holderKind, holderId, targetKind, targetId, at);
  if (!hook) return { ok: false, reason: "no_hook" };

  const spent = spendHook(db, hook.id, { at });
  if (!spent.ok) return spent;

  let opinionDelta = 0;
  if (targetKind === "npc") {
    opinionDelta = COERCE_OPINION_DELTA;
    try {
      recordOpinionEvent(db,
        { npcId: targetId, targetKind: holderKind === "player" ? "player" : "npc", targetId: holderId },
        opinionDelta, reason || "coerced by leverage held over me");
    } catch { /* opinions optional */ }
  }
  return { ok: true, action: "coerced", hookId: hook.id, strength: hook.strength, usesLeft: spent.usesLeft, opinionDelta };
}

/**
 * Inheritance — the load-bearing consequence lever. When an NPC dies:
 *   - hooks held OVER the deceased transfer to its heir (target_id → heirId):
 *     a hook over a dead lord's heir still bites.
 *   - hooks the deceased HELD pass to the heir as the new holder (holder_id →
 *     heirId): leverage outlives its discoverer.
 * Idempotent: re-pointed rows collide on the unique index and are skipped.
 *
 * @returns { ok, transferredOver, transferredHeld }
 */
export function inheritHooks(db, deceasedNpcId, heirNpcId, { at = now() } = {}) {
  if (!db || !tableReady(db) || !deceasedNpcId || !heirNpcId) return { ok: false, reason: "missing_inputs" };
  let over = 0, held = 0;

  const retireHook = db.prepare(`UPDATE npc_hooks SET spent_at = ? WHERE id = ?`);

  // Hooks held over the deceased → re-point target to the heir, decayed one
  // strength step (a hook on the heir is softer than on the original sinner).
  const overRows = db.prepare(`
    SELECT id, holder_kind, holder_id, strength, source_secret_id, world_id, origin
    FROM npc_hooks WHERE target_kind = 'npc' AND target_id = ? AND spent_at IS NULL
  `).all(deceasedNpcId);
  for (const r of overRows) {
    const decayed = r.strength === "strong" ? "weak" : "weak";
    const res = grantHook(db, {
      holderKind: r.holder_kind, holderId: r.holder_id,
      targetKind: "npc", targetId: heirNpcId,
      strength: decayed, sourceSecretId: r.source_secret_id, worldId: r.world_id,
      origin: "inherited", at,
    });
    if (res.ok && (res.action === "granted" || res.action === "upgraded" || res.action === "refreshed")) over++;
    // Retire the hook over the now-dead original.
    retireHook.run(at, r.id);
  }

  // Hooks the deceased HELD → heir becomes the new holder.
  const heldRows = db.prepare(`
    SELECT id, target_kind, target_id, strength, source_secret_id, world_id, origin
    FROM npc_hooks WHERE holder_kind = 'npc' AND holder_id = ? AND spent_at IS NULL
  `).all(deceasedNpcId);
  for (const r of heldRows) {
    if (r.target_kind === "npc" && r.target_id === heirNpcId) {
      // Don't hand the heir a hook over themselves — retire it.
      retireHook.run(at, r.id);
      continue;
    }
    const res = grantHook(db, {
      holderKind: "npc", holderId: heirNpcId,
      targetKind: r.target_kind, targetId: r.target_id,
      strength: r.strength, sourceSecretId: r.source_secret_id, worldId: r.world_id,
      origin: "inherited", at,
    });
    if (res.ok && (res.action === "granted" || res.action === "upgraded" || res.action === "refreshed")) held++;
    retireHook.run(at, r.id);
  }

  return { ok: true, transferredOver: over, transferredHeld: held };
}

/** Mark expired hooks spent so they drop out of active queries. */
export function decaySweep(db, at = now()) {
  if (!db || !tableReady(db)) return { ok: false, reason: "schema_unavailable" };
  const r = db.prepare(`
    UPDATE npc_hooks SET spent_at = expires_at
    WHERE spent_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
  `).run(at);
  return { ok: true, expired: r.changes };
}

/**
 * Trait-inspector summary for (npc, player): does the player hold a hook over
 * this NPC, and does this NPC hold one over the player? Pure read, no bodies.
 */
export function getHookSummaryForTrait(db, npcId, userId, at = now()) {
  const empty = { playerHolds: null, npcHolds: null };
  if (!db || !tableReady(db) || !npcId || !userId) return empty;
  const playerHolds = db.prepare(`
    SELECT strength, uses_left, expires_at FROM npc_hooks
    WHERE holder_kind = 'player' AND holder_id = ? AND target_kind = 'npc' AND target_id = ?
      AND spent_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY (strength = 'strong') DESC LIMIT 1
  `).get(userId, npcId, at);
  const npcHolds = db.prepare(`
    SELECT strength FROM npc_hooks
    WHERE holder_kind = 'npc' AND holder_id = ? AND target_kind = 'player' AND target_id = ?
      AND spent_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY (strength = 'strong') DESC LIMIT 1
  `).get(npcId, userId, at);
  return {
    playerHolds: playerHolds ? { strength: playerHolds.strength, usesLeft: playerHolds.uses_left } : null,
    npcHolds: npcHolds ? { strength: npcHolds.strength } : null,
  };
}

export const HOOK_CONSTANTS = Object.freeze({
  HOOK_TTL_S, STRONG_DIFFICULTY, WEAK_USES, STRONG_USES,
  SUCCESS_BONUS_WEAK, SUCCESS_BONUS_STRONG, COERCE_OPINION_DELTA,
});
