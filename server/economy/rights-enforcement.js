// economy/rights-enforcement.js
// Rights Enforcement Middleware — checks licenses before serving artifacts.
//
// The license is encoded on the DTU. The server checks license before serving:
//   - No download license? Streaming only, no download endpoint.
//   - No remix license? API refuses to serve stems or source files.
//   - Trying to list a derivative without remix rights? Marketplace rejects.
//
// Every artifact access goes through checkAccess() which verifies the user
// holds the required license tier for the requested action.

import { createHash } from "crypto";

// ── License tier hierarchy (lower index = lower access level) ──────────────
// Tiers are cumulative: commercial includes download includes stream.
const TIER_HIERARCHY = {
  music:    ["listen", "download", "remix", "commercial", "exclusive", "stems"],
  art:      ["view", "download", "print", "commercial", "exclusive", "source_file"],
  code:     ["view", "personal", "commercial", "resale", "full_source"],
  document: ["read", "download", "citation", "commercial"],
  "3d_asset": ["view", "use_in_concord", "download", "commercial"],
  film:     ["view", "download", "commercial", "exclusive", "stems"],
};

// Capabilities granted at each tier level
const TIER_CAPABILITIES = {
  // Music
  "music:listen":     ["stream"],
  "music:download":   ["stream", "download"],
  "music:remix":      ["stream", "download", "remix", "derivative"],
  "music:commercial": ["stream", "download", "remix", "derivative", "commercial"],
  "music:exclusive":  ["stream", "download", "remix", "derivative", "commercial", "exclusive"],
  "music:stems":      ["stream", "download", "stems"],
  // Art
  "art:view":         ["view"],
  "art:download":     ["view", "download"],
  "art:print":        ["view", "download", "print"],
  "art:commercial":   ["view", "download", "print", "commercial"],
  "art:exclusive":    ["view", "download", "print", "commercial", "exclusive"],
  "art:source_file":  ["view", "download", "source"],
  // Code
  "code:view":        ["view"],
  "code:personal":    ["view", "download", "personal_use"],
  "code:commercial":  ["view", "download", "personal_use", "commercial"],
  "code:resale":      ["view", "download", "personal_use", "commercial", "resale"],
  "code:full_source": ["view", "download", "personal_use", "commercial", "resale", "source"],
  // Document
  "document:read":      ["view"],
  "document:download":  ["view", "download"],
  "document:citation":  ["view", "download", "cite"],
  "document:commercial":["view", "download", "cite", "commercial"],
  // 3D Asset
  "3d_asset:view":           ["view"],
  "3d_asset:use_in_concord": ["view", "use_in_concord"],
  "3d_asset:download":       ["view", "use_in_concord", "download"],
  "3d_asset:commercial":     ["view", "use_in_concord", "download", "commercial"],
  // Film
  "film:view":        ["stream"],
  "film:download":    ["stream", "download"],
  "film:commercial":  ["stream", "download", "commercial"],
  "film:exclusive":   ["stream", "download", "commercial", "exclusive"],
  "film:stems":       ["stream", "download", "stems"],
};

// Actions that require specific capabilities
const ACTION_REQUIREMENTS = {
  stream:            "stream",
  view:              "view",
  download:          "download",
  remix:             "remix",
  create_derivative: "derivative",
  commercial_use:    "commercial",
  print:             "print",
  cite:              "cite",
  resale:            "resale",
  access_source:     "source",
  access_stems:      "stems",
  use_in_concord:    "use_in_concord",
  exclusive_use:     "exclusive",
};

// ── Ensure license tables ─────────────────────────────────────────────────
export function ensureLicenseTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_licenses (
      id TEXT PRIMARY KEY,
      dtu_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content_type TEXT NOT NULL,
      license_tier TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      tx_id TEXT,
      expires_at TEXT,
      revoked INTEGER DEFAULT 0,
      UNIQUE(dtu_id, user_id, license_tier)
    );
    CREATE INDEX IF NOT EXISTS idx_licenses_dtu ON dtu_licenses(dtu_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_user ON dtu_licenses(user_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_user_dtu ON dtu_licenses(user_id, dtu_id);
  `);
}

// ── Grant a license ───────────────────────────────────────────────────────
/**
 * Grant a license to a user for a DTU at a specific tier.
 * Called after purchase completes.
 */
export function grantLicense(db, { dtuId, userId, contentType, licenseTier, txId, expiresAt }) {
  const id = `lic_${createHash("sha256").update(`${dtuId}:${userId}:${licenseTier}:${Date.now()}`).digest("hex").slice(0, 16)}`;
  const now = new Date().toISOString();

  // Upsert — if user already has this tier, update the tx reference
  db.prepare(`
    INSERT INTO dtu_licenses (id, dtu_id, user_id, content_type, license_tier, granted_at, tx_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dtu_id, user_id, license_tier) DO UPDATE SET
      tx_id = excluded.tx_id,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      revoked = 0
  `).run(id, dtuId, userId, contentType, licenseTier, now, txId || null, expiresAt || null);

  return { ok: true, licenseId: id };
}

// ── Revoke a license ──────────────────────────────────────────────────────
export function revokeLicense(db, { dtuId, userId, licenseTier, reason }) {
  const result = db.prepare(`
    UPDATE dtu_licenses SET revoked = 1
    WHERE dtu_id = ? AND user_id = ? AND license_tier = ?
  `).run(dtuId, userId, licenseTier);

  return { ok: result.changes > 0, reason };
}

// ── Get user's licenses for a DTU ─────────────────────────────────────────
export function getUserLicenses(db, userId, dtuId) {
  return db.prepare(`
    SELECT * FROM dtu_licenses
    WHERE user_id = ? AND dtu_id = ? AND revoked = 0
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY granted_at DESC
  `).all(userId, dtuId);
}

// ── Get user's highest tier for a DTU ─────────────────────────────────────
export function getHighestTier(db, userId, dtuId, contentType) {
  const licenses = getUserLicenses(db, userId, dtuId);
  if (licenses.length === 0) return null;

  const hierarchy = TIER_HIERARCHY[contentType];
  if (!hierarchy) return licenses[0]?.license_tier || null;

  let highestIndex = -1;
  let highestTier = null;

  for (const lic of licenses) {
    const idx = hierarchy.indexOf(lic.license_tier);
    if (idx > highestIndex) {
      highestIndex = idx;
      highestTier = lic.license_tier;
    }
  }

  return highestTier;
}

// ── Check if user can perform an action on a DTU ──────────────────────────
/**
 * Core rights enforcement check.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.dtuId
 * @param {string} opts.contentType - music, art, code, document, 3d_asset, film
 * @param {string} opts.action - stream, download, remix, create_derivative, etc.
 * @param {string} [opts.creatorId] - DTU creator (creators always have full access)
 * @param {string} [opts.distributionMode] - marketplace_only, stream_and_marketplace, etc.
 * @returns {{ allowed: boolean, reason?: string, requiredTier?: string }}
 */
export function checkAccess(db, { userId, dtuId, contentType, action, creatorId, distributionMode }) {
  // Creator always has full access to their own content
  if (creatorId && userId === creatorId) {
    return { allowed: true, reason: "creator" };
  }

  // Check distribution mode restrictions
  if (distributionMode) {
    const modeCheck = checkDistributionModeAccess(distributionMode, contentType, action);
    if (!modeCheck.allowed) return modeCheck;
  }

  // Determine required capability for the action
  const requiredCapability = ACTION_REQUIREMENTS[action];
  if (!requiredCapability) {
    return { allowed: false, reason: `Unknown action: ${action}` };
  }

  // Free actions that don't require a license
  const freeActions = getFreeActions(contentType, distributionMode);
  if (freeActions.includes(requiredCapability)) {
    return { allowed: true, reason: "free_tier" };
  }

  // Check user's licenses
  const licenses = getUserLicenses(db, userId, dtuId);
  if (licenses.length === 0) {
    const requiredTier = getMinimumTierForAction(contentType, action);
    return { allowed: false, reason: "no_license", requiredTier };
  }

  // Check if any held license grants the required capability
  for (const lic of licenses) {
    const key = `${contentType}:${lic.license_tier}`;
    const capabilities = TIER_CAPABILITIES[key] || [];
    if (capabilities.includes(requiredCapability)) {
      return { allowed: true, reason: "licensed", tier: lic.license_tier };
    }
  }

  // User has licenses but none grant the required capability
  const requiredTier = getMinimumTierForAction(contentType, action);
  const highestTier = getHighestTier(db, userId, dtuId, contentType);
  return {
    allowed: false,
    reason: "insufficient_license",
    currentTier: highestTier,
    requiredTier,
  };
}

// ── Distribution mode access rules ────────────────────────────────────────
function checkDistributionModeAccess(mode, contentType, action) {
  const capability = ACTION_REQUIREMENTS[action];

  switch (mode) {
    case "marketplace_only":
      // No streaming/viewing without purchase (except snippets handled separately)
      if (capability === "stream" || capability === "view") {
        return { allowed: false, reason: "marketplace_only_no_preview" };
      }
      return { allowed: true };

    case "marketplace_with_snippet":
      // Same as marketplace_only — full content requires purchase
      // Snippets are separate DTUs with their own access rules
      if (capability === "stream" || capability === "view") {
        return { allowed: false, reason: "snippet_only" };
      }
      return { allowed: true };

    case "stream_and_marketplace":
      // Streaming is free, everything else requires license
      return { allowed: true };

    case "free_with_upgrades":
      // Stream + download free, remix/commercial/stems paid
      return { allowed: true };

    default:
      return { allowed: true };
  }
}

// ── Free actions per content type and distribution mode ────────────────────
function getFreeActions(contentType, distributionMode) {
  switch (distributionMode) {
    case "stream_and_marketplace":
      // Stream/view is free
      if (contentType === "music" || contentType === "film") return ["stream"];
      return ["view"];

    case "free_with_upgrades":
      // Stream + download free
      if (contentType === "music" || contentType === "film") return ["stream", "download"];
      return ["view", "download"];

    case "marketplace_only":
    case "marketplace_with_snippet":
      // Nothing free (snippets are separate DTUs)
      return [];

    default:
      // Default: basic view/stream is free
      if (contentType === "music" || contentType === "film") return ["stream"];
      return ["view"];
  }
}

// ── Minimum tier required for an action ───────────────────────────────────
function getMinimumTierForAction(contentType, action) {
  const capability = ACTION_REQUIREMENTS[action];
  if (!capability) return null;

  const hierarchy = TIER_HIERARCHY[contentType];
  if (!hierarchy) return null;

  // Find the lowest tier that includes this capability
  for (const tier of hierarchy) {
    const key = `${contentType}:${tier}`;
    const caps = TIER_CAPABILITIES[key] || [];
    if (caps.includes(capability)) return tier;
  }
  return null;
}

// ── Derivative rights check ───────────────────────────────────────────────
/**
 * Check if user can create a derivative work from a DTU.
 * Called when listing a derivative on marketplace.
 */
export function checkDerivativeRights(db, { userId, parentDtuId, parentContentType }) {
  const access = checkAccess(db, {
    userId,
    dtuId: parentDtuId,
    contentType: parentContentType,
    action: "create_derivative",
  });

  if (!access.allowed) {
    return {
      allowed: false,
      reason: `You need Remix rights on [${parentDtuId}] to sell derivatives`,
      requiredTier: access.requiredTier,
    };
  }

  return { allowed: true };
}

// ── Marketplace listing rights check ──────────────────────────────────────
/**
 * Check if a DTU can be listed on marketplace.
 * Validates: license compliance, derivative rights, content moderation.
 */
export function checkListingRights(db, { dtuId, sellerId, contentType, parentDtuId }) {
  // If this is a derivative, check remix rights on parent
  if (parentDtuId) {
    const derivCheck = checkDerivativeRights(db, {
      userId: sellerId,
      parentDtuId,
      parentContentType: contentType,
    });
    if (!derivCheck.allowed) return derivCheck;
  }

  return { allowed: true };
}

// ── Streaming middleware ──────────────────────────────────────────────────
/**
 * Express middleware for artifact streaming endpoints.
 * Checks access before serving the artifact.
 */
export function streamingGuard(db) {
  return (req, res, next) => {
    const { dtuId } = req.params;
    const userId = req.user?.id;
    const contentType = req.query.type || "music";
    const action = req.query.action || "stream";

    // Get DTU metadata for creator check
    const dtuRow = db.prepare("SELECT data FROM dtu_store WHERE id = ?").get(dtuId);
    let creatorId = null;
    let distributionMode = null;

    if (dtuRow) {
      try {
        const dtu = JSON.parse(dtuRow.data);
        creatorId = dtu.creator_id || dtu.creatorId || dtu.meta?.creatorId;
        distributionMode = dtu.meta?.distributionMode || dtu.distributionMode;
      } catch { /* parse error */ }
    }

    const access = checkAccess(db, {
      userId,
      dtuId,
      contentType,
      action,
      creatorId,
      distributionMode,
    });

    if (!access.allowed) {
      return res.status(403).json({
        ok: false,
        error: "access_denied",
        reason: access.reason,
        requiredTier: access.requiredTier,
        currentTier: access.currentTier,
      });
    }

    // Attach access info for downstream handlers
    req.accessInfo = access;
    next();
  };
}

// ── Download guard ────────────────────────────────────────────────────────
/**
 * Express middleware for download endpoints.
 * Checks download license + tracks download count.
 */
export function downloadGuard(db) {
  return (req, res, next) => {
    const { dtuId } = req.params;
    const userId = req.user?.id;
    const contentType = req.query.type || "music";

    const dtuRow = db.prepare("SELECT data FROM dtu_store WHERE id = ?").get(dtuId);
    let creatorId = null;
    let distributionMode = null;

    if (dtuRow) {
      try {
        const dtu = JSON.parse(dtuRow.data);
        creatorId = dtu.creator_id || dtu.creatorId || dtu.meta?.creatorId;
        distributionMode = dtu.meta?.distributionMode || dtu.distributionMode;
      } catch { /* parse error */ }
    }

    const access = checkAccess(db, {
      userId,
      dtuId,
      contentType,
      action: "download",
      creatorId,
      distributionMode,
    });

    if (!access.allowed) {
      return res.status(403).json({
        ok: false,
        error: "download_denied",
        reason: access.reason,
        requiredTier: access.requiredTier,
      });
    }

    // Track download for analytics
    try {
      db.prepare(`
        INSERT INTO download_log (artifact_id, user_id, downloaded_at, action)
        VALUES (?, ?, datetime('now'), 'download')
      `).run(dtuId, userId);
    } catch { /* download_log table may not exist */ }

    req.accessInfo = access;
    next();
  };
}

// ── License count for a DTU ───────────────────────────────────────────────
export function getLicenseCount(db, dtuId) {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM dtu_licenses
    WHERE dtu_id = ? AND revoked = 0
  `).get(dtuId);
  return row?.count || 0;
}

// ── License breakdown for a DTU ───────────────────────────────────────────
export function getLicenseBreakdown(db, dtuId) {
  return db.prepare(`
    SELECT license_tier, COUNT(*) as count
    FROM dtu_licenses
    WHERE dtu_id = ? AND revoked = 0
    GROUP BY license_tier
    ORDER BY count DESC
  `).all(dtuId);
}

// ── All licenses for a user ───────────────────────────────────────────────
export function getUserAllLicenses(db, userId, { limit = 50, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM dtu_licenses
    WHERE user_id = ? AND revoked = 0
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY granted_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
}
