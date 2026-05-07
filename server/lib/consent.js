// lib/consent.js
// Consent Layer — Nothing Leaves Without Permission.
//
// Every action that moves user data beyond their personal universe
// requires explicit opt-in. Not a blanket TOS checkbox.
// SPECIFIC consent for SPECIFIC actions.
//
// x²-x=0 — data is either shared (1) or private (0).
// There is no ambiguous middle state.

import { randomUUID } from "crypto";

function uid(prefix = "con") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// ── Consent Action Definitions ──────────────────────────────────────────────

export const CONSENT_ACTIONS = {
  // Publishing — data leaves personal universe
  publish_to_marketplace: {
    prompt: "List this DTU on the marketplace. Other users will see it.",
    required: true,
    revocable: true,
    scope: "marketplace",
  },
  publish_to_regional: {
    prompt: "Share this DTU with your regional substrate. Users in your region can see it.",
    required: true,
    revocable: true,
    scope: "regional",
  },
  publish_to_feed: {
    prompt: "Post this to the social feed. Your followers will see it.",
    required: true,
    revocable: true,
    scope: "feed",
  },

  // Promotion — escalation through tiers (each level = new consent)
  promote_to_national: {
    prompt: "Submit this DTU for national consideration. If approved, users across your country can see it.",
    required: true,
    revocable: false, // once on national, can't unpublish — others may have cited it
    scope: "national",
  },
  promote_to_global: {
    prompt: "Submit this DTU for the Sacred Timeline. If approved, it becomes part of civilization's knowledge. This cannot be undone.",
    required: true,
    revocable: false,
    scope: "global",
  },

  // Profile visibility — opt-in per scope
  show_profile_regional: {
    prompt: "Show your profile on the regional leaderboard.",
    required: true,
    revocable: true,
    scope: "regional",
  },
  show_profile_national: {
    prompt: "Show your profile on the national leaderboard.",
    required: true,
    revocable: true,
    scope: "national",
  },
  show_profile_global: {
    prompt: "Show your profile on the global leaderboard.",
    required: true,
    revocable: true,
    scope: "global",
  },

  // Data usage — who can use your work
  allow_citation: {
    prompt: "Allow other users and emergents to cite your published DTUs. You earn royalties when cited.",
    required: true,
    revocable: true, // revoking stops future citations, existing ones stay
    scope: "citation",
  },
  allow_emergent_learning: {
    prompt: "Allow Concord's emergent entities to learn from your published DTUs. You earn royalties when they cite you.",
    required: true,
    revocable: true,
    scope: "emergent",
  },

  // Concord system usage
  allow_global_dtu_creation: {
    prompt: "Allow Concord to include your cited work in global knowledge DTUs. Your attribution and royalties are preserved.",
    required: true,
    revocable: true,
    scope: "system",
  },
};

// All valid action keys
const VALID_ACTIONS = new Set(Object.keys(CONSENT_ACTIONS));

// ── Core Consent Functions ──────────────────────────────────────────────────

/**
 * Check if a user has granted consent for a specific action.
 * Returns { consented: boolean, action, prompt? }
 *
 * This is the gate. Every data movement path calls this BEFORE acting.
 */
export function checkConsent(db, userId, action) {
  if (!userId || !action) return { consented: false, error: "missing_params" };
  if (!VALID_ACTIONS.has(action)) return { consented: false, error: "invalid_action" };

  const row = db.prepare(
    "SELECT granted, revoked_at FROM user_consent WHERE user_id = ? AND action = ?"
  ).get(userId, action);

  if (!row || row.granted !== 1 || row.revoked_at) {
    return {
      consented: false,
      action,
      prompt: CONSENT_ACTIONS[action].prompt,
      revocable: CONSENT_ACTIONS[action].revocable,
    };
  }

  return { consented: true, action };
}

/**
 * Grant consent for a specific action.
 * Called when user explicitly opts in — at the moment of action, not buried in settings.
 */
export function grantConsent(db, userId, action, { ip, userAgent } = {}) {
  if (!userId || !action) return { ok: false, error: "missing_params" };
  if (!VALID_ACTIONS.has(action)) return { ok: false, error: "invalid_action" };

  const now = nowISO();
  const actionDef = CONSENT_ACTIONS[action];

  try {
    db.prepare(`
      INSERT INTO user_consent (id, user_id, action, granted, granted_at, revoked_at, revocable, prompt_text, updated_at)
      VALUES (?, ?, ?, 1, ?, NULL, ?, ?, ?)
      ON CONFLICT(user_id, action) DO UPDATE SET
        granted = 1,
        granted_at = ?,
        revoked_at = NULL,
        updated_at = ?
    `).run(
      uid("con"), userId, action, now, actionDef.revocable ? 1 : 0, actionDef.prompt, now,
      now, now
    );

    // Audit trail
    db.prepare(`
      INSERT INTO consent_audit_log (id, user_id, action, event, ip, user_agent, created_at)
      VALUES (?, ?, ?, 'granted', ?, ?, ?)
    `).run(uid("cal"), userId, action, ip || null, userAgent || null, now);

    return { ok: true, action, granted: true, revocable: actionDef.revocable };
  } catch (err) {
    console.error("[consent] grant_failed:", err.message);
    return { ok: false, error: "consent_grant_failed" };
  }
}

/**
 * Revoke consent for a specific action.
 * Respects irrevocability rules (national/global promotion can't be revoked).
 * Returns instructions for anonymization if content is already cited.
 */
export function revokeConsent(db, userId, action, { ip, userAgent } = {}) {
  if (!userId || !action) return { ok: false, error: "missing_params" };
  if (!VALID_ACTIONS.has(action)) return { ok: false, error: "invalid_action" };

  const actionDef = CONSENT_ACTIONS[action];
  if (!actionDef.revocable) {
    return { ok: false, error: "consent_not_revocable", action, reason: actionDef.prompt };
  }

  const now = nowISO();

  try {
    const existing = db.prepare(
      "SELECT granted FROM user_consent WHERE user_id = ? AND action = ?"
    ).get(userId, action);

    if (!existing || existing.granted !== 1) {
      return { ok: true, action, alreadyRevoked: true };
    }

    db.prepare(`
      UPDATE user_consent SET granted = 0, revoked_at = ?, updated_at = ?
      WHERE user_id = ? AND action = ?
    `).run(now, now, userId, action);

    // Audit trail
    db.prepare(`
      INSERT INTO consent_audit_log (id, user_id, action, event, ip, user_agent, created_at)
      VALUES (?, ?, ?, 'revoked', ?, ?, ?)
    `).run(uid("cal"), userId, action, ip || null, userAgent || null, now);

    // If revoking citation or emergent learning, check for DTUs that need anonymization
    let anonymizationNeeded = [];
    if (action === "allow_citation" || action === "allow_emergent_learning") {
      anonymizationNeeded = findDtusNeedingAnonymization(db, userId);
    }

    return {
      ok: true,
      action,
      revoked: true,
      anonymizationNeeded: anonymizationNeeded.length > 0 ? anonymizationNeeded : undefined,
    };
  } catch (err) {
    console.error("[consent] revoke_failed:", err.message);
    return { ok: false, error: "consent_revoke_failed" };
  }
}

/**
 * Get all consent states for a user.
 * Returns the full consent dashboard — every toggle with current state.
 */
export function getUserConsents(db, userId) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  const rows = db.prepare(
    "SELECT action, granted, granted_at, revoked_at, revocable FROM user_consent WHERE user_id = ?"
  ).all(userId);

  const consentMap = {};
  for (const row of rows) {
    consentMap[row.action] = {
      granted: row.granted === 1 && !row.revoked_at,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
      revocable: row.revocable === 1,
    };
  }

  // Build complete state — include actions with no record (default: not consented)
  const consents = {};
  for (const [action, def] of Object.entries(CONSENT_ACTIONS)) {
    const existing = consentMap[action];
    consents[action] = {
      granted: existing?.granted || false,
      grantedAt: existing?.grantedAt || null,
      revokedAt: existing?.revokedAt || null,
      revocable: def.revocable,
      prompt: def.prompt,
      scope: def.scope,
    };
  }

  // Get counts of shared items per scope
  const stats = getConsentStats(db, userId);

  return { ok: true, consents, stats };
}

/**
 * Bulk update consents — for the settings page "Save Changes" button.
 * Each action in the updates object is processed independently.
 */
export function updateConsents(db, userId, updates, { ip, userAgent } = {}) {
  if (!userId || !updates || typeof updates !== "object") {
    return { ok: false, error: "invalid_params" };
  }

  const results = {};
  const doUpdate = db.transaction(() => {
    for (const [action, granted] of Object.entries(updates)) {
      if (!VALID_ACTIONS.has(action)) {
        results[action] = { ok: false, error: "invalid_action" };
        continue;
      }

      if (granted) {
        results[action] = grantConsent(db, userId, action, { ip, userAgent });
      } else {
        results[action] = revokeConsent(db, userId, action, { ip, userAgent });
      }
    }
  });

  try {
    doUpdate();
    return { ok: true, results };
  } catch (err) {
    console.error("[consent] bulk_update_failed:", err.message);
    return { ok: false, error: "consent_update_failed" };
  }
}

// ── Anonymization ───────────────────────────────────────────────────────────

/**
 * Find DTUs that have been cited at national/global and can't be deleted
 * but need anonymization because the user is revoking consent.
 */
function findDtusNeedingAnonymization(db, userId) {
  // DTUs at national/global tier that have been cited by others
  try {
    return db.prepare(`
      SELECT DISTINCT tc.original_content_id as dtu_id, tc.federation_tier
      FROM tier_content tc
      JOIN royalty_lineage rl ON rl.parent_id = tc.original_content_id
      WHERE tc.federation_tier IN ('national', 'global')
        AND rl.parent_creator = ?
        AND tc.original_content_id NOT IN (
          SELECT dtu_id FROM anonymized_attributions WHERE original_user_id = ?
        )
    `).all(userId, userId);
  } catch {
    // Tables may not exist yet
    return [];
  }
}

/**
 * Anonymize attribution on a DTU.
 * Removes personal attribution but preserves the knowledge and royalty flow.
 * Royalties still flow to an anonymous wallet the user can reclaim.
 */
export function anonymizeAttribution(db, dtuId, userId) {
  if (!dtuId || !userId) return { ok: false, error: "missing_params" };

  const now = nowISO();
  const anonymousWalletId = `anon_wallet_${userId.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20)}`;

  const doAnonymize = db.transaction(() => {
    // Check if already anonymized
    const existing = db.prepare(
      "SELECT id FROM anonymized_attributions WHERE dtu_id = ?"
    ).get(dtuId);
    if (existing) return { alreadyAnonymized: true };

    // Record anonymization
    db.prepare(`
      INSERT INTO anonymized_attributions (id, dtu_id, original_user_id, anonymous_wallet_id, anonymized_at, reason)
      VALUES (?, ?, ?, ?, ?, 'consent_revoked')
    `).run(uid("anon"), dtuId, userId, anonymousWalletId, now);

    // Update the DTU's creator display (not the actual creator field — needed for wallet routing)
    try {
      db.prepare(`
        UPDATE dtus SET metadata_json = json_set(
          COALESCE(metadata_json, '{}'),
          '$.anonymized', 1,
          '$.anonymizedAt', ?,
          '$.originalCreatorDisplay', (SELECT username FROM users WHERE id = ?),
          '$.creatorDisplay', 'Anonymous Creator'
        ) WHERE id = ? AND owner_user_id = ?
      `).run(now, userId, dtuId, userId);
    } catch {
      // metadata_json update is best-effort (column may not support json_set)
    }

    // Update royalty lineage to route through anonymous wallet
    db.prepare(`
      UPDATE royalty_lineage SET parent_creator = ?
      WHERE parent_creator = ? AND parent_id = ?
    `).run(anonymousWalletId, userId, dtuId);

    // Audit trail
    db.prepare(`
      INSERT INTO consent_audit_log (id, user_id, action, event, ip, user_agent, metadata_json, created_at)
      VALUES (?, ?, 'anonymize_attribution', 'anonymized', NULL, NULL, ?, ?)
    `).run(uid("cal"), userId, JSON.stringify({ dtuId, anonymousWalletId }), now);

    return { anonymized: true, anonymousWalletId };
  });

  try {
    const result = doAnonymize();
    if (result.alreadyAnonymized) {
      return { ok: true, alreadyAnonymized: true };
    }
    return { ok: true, dtuId, anonymousWalletId: result.anonymousWalletId };
  } catch (err) {
    console.error("[consent] anonymize_failed:", err.message);
    return { ok: false, error: "anonymization_failed" };
  }
}

/**
 * Reclaim anonymized attributions — when user re-consents,
 * restore their name on previously anonymized DTUs.
 */
export function reclaimAttributions(db, userId) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  const now = nowISO();

  try {
    const anonymized = db.prepare(
      "SELECT dtu_id, anonymous_wallet_id FROM anonymized_attributions WHERE original_user_id = ?"
    ).all(userId);

    if (anonymized.length === 0) return { ok: true, reclaimed: 0 };

    const doReclaim = db.transaction(() => {
      for (const row of anonymized) {
        // Restore royalty lineage
        db.prepare(`
          UPDATE royalty_lineage SET parent_creator = ?
          WHERE parent_creator = ? AND parent_id = ?
        `).run(userId, row.anonymous_wallet_id, row.dtu_id);

        // Remove anonymization flag from DTU
        try {
          db.prepare(`
            UPDATE dtus SET metadata_json = json_set(
              COALESCE(metadata_json, '{}'),
              '$.anonymized', 0,
              '$.reclaimedAt', ?
            ) WHERE id = ?
          `).run(now, row.dtu_id);
        } catch {
          // best-effort
        }
      }

      // Remove anonymization records
      db.prepare(
        "DELETE FROM anonymized_attributions WHERE original_user_id = ?"
      ).run(userId);

      // Audit
      db.prepare(`
        INSERT INTO consent_audit_log (id, user_id, action, event, metadata_json, created_at)
        VALUES (?, ?, 'reclaim_attribution', 'granted', ?, ?)
      `).run(uid("cal"), userId, JSON.stringify({ count: anonymized.length }), now);

      return anonymized.length;
    });

    const count = doReclaim();
    return { ok: true, reclaimed: count };
  } catch (err) {
    console.error("[consent] reclaim_failed:", err.message);
    return { ok: false, error: "reclaim_failed" };
  }
}

// ── Consent Stats (for dashboard) ───────────────────────────────────────────

function getConsentStats(db, userId) {
  const stats = {};

  try {
    // DTUs listed on marketplace
    stats.marketplaceListings = db.prepare(`
      SELECT COUNT(*) as c FROM creative_artifacts
      WHERE creator_id = ? AND marketplace_status = 'active'
    `).get(userId)?.c || 0;
  } catch { stats.marketplaceListings = 0; }

  try {
    // DTUs shared regionally
    stats.regionalDtus = db.prepare(`
      SELECT COUNT(*) as c FROM tier_content tc
      JOIN dtus d ON d.id = tc.original_content_id
      WHERE d.owner_user_id = ? AND tc.federation_tier = 'regional'
    `).get(userId)?.c || 0;
  } catch { stats.regionalDtus = 0; }

  try {
    // DTUs at national level
    stats.nationalDtus = db.prepare(`
      SELECT COUNT(*) as c FROM tier_content tc
      JOIN dtus d ON d.id = tc.original_content_id
      WHERE d.owner_user_id = ? AND tc.federation_tier = 'national'
    `).get(userId)?.c || 0;
  } catch { stats.nationalDtus = 0; }

  try {
    // DTUs at global level
    stats.globalDtus = db.prepare(`
      SELECT COUNT(*) as c FROM tier_content tc
      JOIN dtus d ON d.id = tc.original_content_id
      WHERE d.owner_user_id = ? AND tc.federation_tier = 'global'
    `).get(userId)?.c || 0;
  } catch { stats.globalDtus = 0; }

  try {
    // Anonymized DTUs
    stats.anonymizedDtus = db.prepare(
      "SELECT COUNT(*) as c FROM anonymized_attributions WHERE original_user_id = ?"
    ).get(userId)?.c || 0;
  } catch { stats.anonymizedDtus = 0; }

  return stats;
}

// ── Consent Audit Log ───────────────────────────────────────────────────────

/**
 * Get consent audit history for a user.
 */
export function getConsentAuditLog(db, userId, { limit = 50, offset = 0 } = {}) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  const items = db.prepare(`
    SELECT * FROM consent_audit_log
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  const total = db.prepare(
    "SELECT COUNT(*) as c FROM consent_audit_log WHERE user_id = ?"
  ).get(userId)?.c || 0;

  return { ok: true, items, total, limit, offset };
}

// ── Enforcement Helpers (called by other modules) ───────────────────────────

/**
 * Require consent before proceeding with an action.
 * Returns { allowed: true } or { allowed: false, consentRequired: {...} }.
 *
 * Usage in route handlers:
 *   const check = requireConsent(db, userId, "publish_to_marketplace");
 *   if (!check.allowed) return res.status(403).json(check);
 */
export function requireConsent(db, userId, action) {
  const result = checkConsent(db, userId, action);
  if (result.consented) return { allowed: true };

  return {
    allowed: false,
    consentRequired: {
      action,
      prompt: CONSENT_ACTIONS[action]?.prompt,
      revocable: CONSENT_ACTIONS[action]?.revocable,
    },
    error: "consent_required",
  };
}

/**
 * Check if an emergent entity can cite a specific user's DTUs.
 * Returns false if user hasn't opted into emergent learning.
 */
export function canEmergentCiteUser(db, userId) {
  if (!userId) return false;
  // System/emergent accounts always allow citation between themselves
  if (userId === "__CONCORD__" || userId === "system") return true;
  if (userId.startsWith("ent_") || userId.startsWith("__")) return true;

  const result = checkConsent(db, userId, "allow_emergent_learning");
  return result.consented;
}

/**
 * Check if a DTU can be cited by other users.
 * Returns false if owner hasn't opted into citations.
 */
export function canCiteDtu(db, dtuOwnerId) {
  if (!dtuOwnerId) return false;
  // System content is always citable
  if (dtuOwnerId === "__CONCORD__" || dtuOwnerId === "system") return true;
  if (dtuOwnerId.startsWith("ent_") || dtuOwnerId.startsWith("__")) return true;

  const result = checkConsent(db, dtuOwnerId, "allow_citation");
  return result.consented;
}

/**
 * Filter a list of DTUs to only those whose owners have consented to emergent learning.
 * Used in brain context pipeline to gate which DTUs emergents can consume.
 */
export function filterByEmergentConsent(db, dtus) {
  if (!dtus || dtus.length === 0) return [];

  return dtus.filter(dtu => {
    const ownerId = dtu.owner_user_id || dtu.creator;
    return canEmergentCiteUser(db, ownerId);
  });
}

/**
 * Filter DTUs to only those whose owners consent to citation.
 * Used in citation registration to prevent unconsented citations.
 */
export function filterByCitationConsent(db, dtus) {
  if (!dtus || dtus.length === 0) return [];

  return dtus.filter(dtu => {
    const ownerId = dtu.owner_user_id || dtu.creator;
    return canCiteDtu(db, ownerId);
  });
}
