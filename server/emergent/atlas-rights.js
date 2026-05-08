/**
 * Atlas Artifact Rights & Citation System
 *
 * Responsibilities:
 *   - Canonical content hashing (proof of originality)
 *   - License validation + enforcement
 *   - Derivative rights checking
 *   - Marketplace listing validation
 *   - canUse(user, artifact, action) — the rights engine
 *   - Proof-of-origin record creation
 *   - Citation snippet generation
 *
 * Integration points:
 *   - Write guard: validates license + derivative rights on create/update
 *   - Submission pipeline: validates marketplace listing rights
 *   - Retrieval: attaches license metadata to results
 *   - Chat escalation: applies lane-aware defaults
 *
 * What this does NOT do:
 *   - DRM, watermarking, content obfuscation
 *   - On-chain anything
 *   - Free-form license logic (v1 = predefined profiles only)
 */

import crypto from "crypto";
import {
  SCOPES,
  LICENSE_TYPES,
  LICENSE_TYPE_SET,
  LICENSE_PROFILES,
  DEFAULT_LICENSE_BY_LANE,
  RIGHTS_ACTIONS,
} from "./atlas-config.js";
import { getAtlasState } from "./atlas-epistemic.js";
// Imported from the shared scope-state module to avoid cycling back into
// atlas-scope-router (which imports atlas-write-guard which imports us).
import { getDtuScope } from "./atlas-scope-state.js";

// ── Rights State ────────────────────────────────────────────────────────────

function getRightsState(STATE) {
  if (!STATE._rights) {
    STATE._rights = {
      // Origin records: artifactId → ProofOfOrigin
      origins: new Map(),

      // Transfer records: artifactId → TransferRecord[]
      transfers: new Map(),

      // Daily Merkle roots (optional, for stronger proof)
      dailyRoots: [],

      metrics: {
        originsRecorded: 0,
        rightsChecks: 0,
        rightsBlocked: 0,
        derivativesTracked: 0,
        citationsGenerated: 0,
        duplicateListingsBlocked: 0,
      },
    };
  }
  return STATE._rights;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CANONICAL CONTENT HASHING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Canonicalize content for hashing. Strips volatile fields, normalizes
 * whitespace, ensures stable key order.
 *
 * @param {object} artifact  DTU or any artifact with title, claims, tags, content
 * @returns {string} Canonicalized string representation
 */
export function canonicalizeContent(artifact) {
  const parts = [];

  // Title (normalized)
  if (artifact.title) {
    parts.push(`T:${_normalizeText(artifact.title)}`);
  }

  // Content body (if present)
  if (artifact.content) {
    parts.push(`B:${_normalizeText(artifact.content)}`);
  }

  // Claims (sorted by text for stability)
  const claims = (artifact.claims || [])
    .map(c => `${c.claimType || "FACT"}:${_normalizeText(c.text || "")}`)
    .sort();
  if (claims.length > 0) {
    parts.push(`C:${claims.join("|")}`);
  }

  // Tags (sorted)
  const tags = (artifact.tags || []).map(t => t.toLowerCase().trim()).sort();
  if (tags.length > 0) {
    parts.push(`G:${tags.join(",")}`);
  }

  // Interpretations (sorted by text)
  const interps = (artifact.interpretations || [])
    .map(i => _normalizeText(i.text || ""))
    .sort();
  if (interps.length > 0) {
    parts.push(`I:${interps.join("|")}`);
  }

  return parts.join("\n");
}

/**
 * Compute SHA-256 hash of canonicalized content.
 *
 * @param {object} artifact
 * @returns {string} 64-char hex hash
 */
export function computeContentHash(artifact) {
  const canonical = canonicalizeContent(artifact);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Compute evidence hash (sources + provenance chain).
 */
export function computeEvidenceHash(artifact) {
  const parts = [];

  for (const claim of (artifact.claims || [])) {
    for (const src of (claim.sources || [])) {
      parts.push(`${src.sourceTier || "UNCITED"}:${_normalizeText(src.title || "")}:${src.url || ""}`);
    }
  }

  for (const prov of (artifact.provenance || [])) {
    parts.push(`P:${prov.type || "GENERAL"}:${_normalizeText(prov.text || "")}`);
  }

  parts.sort();
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
}

/**
 * Compute lineage hash (parent chain).
 */
export function computeLineageHash(artifact) {
  const parents = (artifact.lineage?.parents || artifact.parent_artifact_ids || [])
    .slice()
    .sort();
  if (parents.length === 0) return null;
  return crypto.createHash("sha256").update(parents.join("|")).digest("hex");
}

function _normalizeText(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. LICENSE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve the effective license for an artifact.
 * Falls back to lane-aware defaults.
 *
 * @param {object} artifact  DTU with optional license_type field
 * @param {string} scope     SCOPES enum value
 * @returns {{ license_type, profile, isDefault }}
 */
export function resolveLicense(artifact, scope) {
  // Explicit license on artifact (top-level field or stamped in _rights)
  const explicitType = artifact.license_type || artifact._rights?.license_type;
  if (explicitType && LICENSE_TYPE_SET.has(explicitType)) {
    const profile = explicitType === LICENSE_TYPES.CUSTOM
      ? (artifact.license_custom || artifact._rights?.license_profile || null)
      : LICENSE_PROFILES[explicitType];
    return {
      license_type: explicitType,
      profile,
      isDefault: false,
    };
  }

  // Lane-aware default
  const defaultType = DEFAULT_LICENSE_BY_LANE[scope] || LICENSE_TYPES.PERSONAL;
  return {
    license_type: defaultType,
    profile: LICENSE_PROFILES[defaultType],
    isDefault: true,
  };
}

/**
 * Validate that a license_type is valid and, for CUSTOM, that all required
 * fields are present.
 *
 * @param {string} licenseType
 * @param {object} customProfile  Only used when licenseType === CUSTOM
 * @returns {{ ok, errors? }}
 */
export function validateLicense(licenseType, customProfile = null) {
  const errors = [];

  if (!licenseType) {
    errors.push("license_type is required");
    return { ok: false, errors };
  }

  if (!LICENSE_TYPE_SET.has(licenseType)) {
    errors.push(`Unknown license_type: ${licenseType}`);
    return { ok: false, errors };
  }

  if (licenseType === LICENSE_TYPES.CUSTOM) {
    if (!customProfile) {
      errors.push("CUSTOM license requires license_custom profile object");
      return { ok: false, errors };
    }

    const requiredFields = [
      "attribution_required", "derivative_allowed", "commercial_use_allowed",
      "redistribution_allowed", "royalty_required",
    ];
    for (const field of requiredFields) {
      if (typeof customProfile[field] !== "boolean") {
        errors.push(`CUSTOM license missing required boolean field: ${field}`);
      }
    }

    if (errors.length > 0) return { ok: false, errors };
  }

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. RIGHTS ENGINE — canUse(user, artifact, action)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check whether a user can perform an action on an artifact.
 *
 * @param {object} STATE
 * @param {string} userId
 * @param {string} artifactId   DTU id
 * @param {string} action       RIGHTS_ACTIONS enum value
 * @returns {{ allowed, reason, license_type }}
 */
export function canUse(STATE, userId, artifactId, action) {
  const rights = getRightsState(STATE);
  rights.metrics.rightsChecks++;

  const atlas = getAtlasState(STATE);
  const dtu = atlas.dtus.get(artifactId);
  if (!dtu) {
    return { allowed: false, reason: "Artifact not found" };
  }

  const scope = getDtuScope(STATE, artifactId);
  const { license_type, profile } = resolveLicense(dtu, scope);

  // Owner always has full rights
  const isOwner = dtu.author?.userId === userId;
  if (isOwner) {
    return { allowed: true, reason: "Owner has full rights", license_type };
  }

  // Check transfer rights
  const transferRecords = rights.transfers.get(artifactId) || [];
  const hasTransfer = transferRecords.some(
    t => t.toUserId === userId && t.action === action && (!t.expiresAt || new Date(t.expiresAt) > new Date())
  );
  if (hasTransfer) {
    return { allowed: true, reason: "Transfer rights granted", license_type };
  }

  if (!profile) {
    rights.metrics.rightsBlocked++;
    return { allowed: false, reason: "No license profile — cannot determine rights", license_type };
  }

  // Personal scope = owner-only
  if (license_type === LICENSE_TYPES.PERSONAL) {
    rights.metrics.rightsBlocked++;
    return { allowed: false, reason: "Personal license — owner only", license_type };
  }

  // Action-specific checks
  switch (action) {
    case RIGHTS_ACTIONS.VIEW:
      // Anything non-PERSONAL is viewable if in Global/Marketplace
      return scope !== SCOPES.LOCAL
        ? { allowed: true, reason: "Public scope — viewable", license_type }
        : { allowed: false, reason: "Local scope — owner only", license_type };

    case RIGHTS_ACTIONS.CITE:
      // Global/Marketplace artifacts can always be cited
      if (scope === SCOPES.LOCAL) {
        rights.metrics.rightsBlocked++;
        return { allowed: false, reason: "Local scope — cannot cite", license_type };
      }
      return { allowed: true, reason: "Public artifact — citable", license_type };

    case RIGHTS_ACTIONS.DERIVE:
      if (!profile.derivative_allowed) {
        rights.metrics.rightsBlocked++;
        return { allowed: false, reason: "License does not allow derivatives", license_type };
      }
      return { allowed: true, reason: "Derivatives allowed by license", license_type };

    case RIGHTS_ACTIONS.REDISTRIBUTE:
      if (!profile.redistribution_allowed) {
        rights.metrics.rightsBlocked++;
        return { allowed: false, reason: "License does not allow redistribution", license_type };
      }
      return { allowed: true, reason: "Redistribution allowed by license", license_type };

    case RIGHTS_ACTIONS.COMMERCIAL_USE:
      if (!profile.commercial_use_allowed) {
        rights.metrics.rightsBlocked++;
        return { allowed: false, reason: "License does not allow commercial use", license_type };
      }
      return { allowed: true, reason: "Commercial use allowed by license", license_type };

    case RIGHTS_ACTIONS.LIST_ON_MARKET:
      // Must be owner or have transfer rights (already checked above)
      rights.metrics.rightsBlocked++;
      return { allowed: false, reason: "Only owner can list on marketplace", license_type };

    case RIGHTS_ACTIONS.TRANSFER:
      // Only owner can transfer
      rights.metrics.rightsBlocked++;
      return { allowed: false, reason: "Only owner can transfer rights", license_type };

    default:
      rights.metrics.rightsBlocked++;
      return { allowed: false, reason: `Unknown action: ${action}`, license_type };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DERIVATIVE RIGHTS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate that a derivative artifact respects its parent(s)' licenses.
 *
 * @param {object} STATE
 * @param {object} derivativePayload  The new artifact being created
 * @param {string} creatorUserId
 * @returns {{ ok, errors?, warnings?, parentLicenses? }}
 */
export function validateDerivativeRights(STATE, derivativePayload, creatorUserId) {
  const rights = getRightsState(STATE);
  const parentIds = derivativePayload.lineage?.parents
    || derivativePayload.parent_artifact_ids
    || [];

  if (parentIds.length === 0) {
    return { ok: true, parentLicenses: [] };
  }

  const atlas = getAtlasState(STATE);
  const errors = [];
  const warnings = [];
  const parentLicenses = [];

  for (const parentId of parentIds) {
    const parentDtu = atlas.dtus.get(parentId);
    if (!parentDtu) {
      warnings.push(`Parent artifact ${parentId} not found — cannot verify rights`);
      continue;
    }

    const scope = getDtuScope(STATE, parentId);
    const { license_type, profile } = resolveLicense(parentDtu, scope);

    parentLicenses.push({
      parentId,
      license_type,
      profile,
      creator: parentDtu.author?.userId,
    });

    // Check derivative permission
    if (profile && !profile.derivative_allowed) {
      const isOwner = parentDtu.author?.userId === creatorUserId;
      if (!isOwner) {
        errors.push(`Parent ${parentId} (${license_type}) does not allow derivatives`);
      }
    }

    // Check attribution requirement
    if (profile?.attribution_required) {
      const hasAttribution = (derivativePayload.provenance || []).some(
        p => p.text?.includes(parentId) || p.sources?.some(s => s.sourceId === parentId)
      );
      // Also check lineage parents as implicit attribution
      const hasLineageRef = parentIds.includes(parentId);
      if (!hasAttribution && !hasLineageRef) {
        warnings.push(`Parent ${parentId} requires attribution — ensure proper citation`);
      }
    }

    // Check royalty inheritance
    if (profile?.royalty_required) {
      warnings.push(`Parent ${parentId} requires royalty split — must honor in marketplace listings`);
    }
  }

  rights.metrics.derivativesTracked++;

  if (errors.length > 0) {
    rights.metrics.rightsBlocked++;
    return { ok: false, errors, warnings, parentLicenses };
  }

  return { ok: true, warnings: warnings.length > 0 ? warnings : undefined, parentLicenses };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. MARKETPLACE LISTING VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate that an artifact can be listed on the marketplace.
 *
 * Checks:
 *   - Creator matches artifact creator (or has transfer rights)
 *   - Content hash doesn't match an existing exclusive listing
 *   - License allows marketplace listing
 *   - No duplicate market_listing_hash
 *
 * @param {object} STATE
 * @param {object} artifact       The DTU being listed
 * @param {string} listerId       User attempting to list
 * @param {object} listingOpts    { license_type, price, royaltySplits }
 * @returns {{ ok, errors?, warnings?, market_listing_hash? }}
 */
export function validateMarketplaceListing(STATE, artifact, listerId, listingOpts = {}) {
  const rights = getRightsState(STATE);
  const errors = [];
  const warnings = [];

  // 1. Creator / transfer rights check
  const isCreator = artifact.author?.userId === listerId;
  if (!isCreator) {
    const transferRecords = rights.transfers.get(artifact.id) || [];
    const hasListingRights = transferRecords.some(
      t => t.toUserId === listerId && t.action === RIGHTS_ACTIONS.LIST_ON_MARKET
    );
    if (!hasListingRights) {
      errors.push("Only the creator (or holder of transfer rights) can list on marketplace");
    }
  }

  // 2. License check — listing must specify a valid license
  const listingLicense = listingOpts.license_type;
  if (!listingLicense) {
    errors.push("Marketplace listing requires explicit license_type");
  } else {
    const licenseValid = validateLicense(listingLicense, listingOpts.license_custom);
    if (!licenseValid.ok) {
      errors.push(...licenseValid.errors);
    }
  }

  // 3. Content hash duplicate check
  const contentHashVal = computeContentHash(artifact);
  const atlas = getAtlasState(STATE);

  for (const [dtuId, dtu] of atlas.dtus) {
    if (dtuId === artifact.id) continue;
    const dtuScope = getDtuScope(STATE, dtuId);
    if (dtuScope !== SCOPES.MARKETPLACE) continue;

    const existingHash = computeContentHash(dtu);
    if (existingHash === contentHashVal) {
      // Exact duplicate on marketplace
      rights.metrics.duplicateListingsBlocked++;
      errors.push(`Identical content already listed on marketplace (${dtuId})`);
      break;
    }
  }

  // 4. Market listing hash (for unique listing identity)
  const market_listing_hash = crypto.createHash("sha256")
    .update(`${contentHashVal}|${listingLicense || "NONE"}|${artifact.author?.userId || "unknown"}`)
    .digest("hex")
    .slice(0, 32);

  // 5. Check parent licenses for derivative royalty obligations
  const parentIds = artifact.lineage?.parents || [];
  for (const parentId of parentIds) {
    const parentDtu = atlas.dtus.get(parentId);
    if (!parentDtu) continue;
    const parentScope = getDtuScope(STATE, parentId);
    const { profile: parentProfile } = resolveLicense(parentDtu, parentScope);
    if (parentProfile?.royalty_required && !listingOpts.royaltySplits) {
      warnings.push(`Parent ${parentId} requires royalty split — include in listing`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    market_listing_hash,
    content_hash: contentHashVal,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. PROOF OF ORIGIN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an immutable proof-of-origin record for an artifact.
 * Stored at creation time, never modified.
 *
 * @param {object} STATE
 * @param {object} artifact   DTU or any artifact
 * @param {string} instanceId Concord instance identifier
 * @returns {{ ok, origin }}
 */
export function recordOrigin(STATE, artifact, instanceId = "concord-default") {
  const rights = getRightsState(STATE);

  const contentHashVal = computeContentHash(artifact);
  const evidenceHashVal = computeEvidenceHash(artifact);
  const lineageHashVal = computeLineageHash(artifact);

  const origin = {
    artifact_id: artifact.id,
    content_hash: contentHashVal,
    evidence_hash: evidenceHashVal,
    lineage_hash: lineageHashVal,
    creator_id: artifact.author?.userId || "unknown",
    created_at: artifact.createdAt || new Date().toISOString(),
    instance_id: instanceId,
    recorded_at: new Date().toISOString(),
    // Fingerprint: hash of all above for tamper detection
    origin_fingerprint: crypto.createHash("sha256")
      .update(`${artifact.id}|${contentHashVal}|${artifact.author?.userId || "unknown"}|${artifact.createdAt || ""}|${instanceId}`)
      .digest("hex"),
  };

  Object.freeze(origin);
  rights.origins.set(artifact.id, origin);
  rights.metrics.originsRecorded++;

  return { ok: true, origin };
}

/**
 * Retrieve proof-of-origin for an artifact.
 */
export function getOrigin(STATE, artifactId) {
  const rights = getRightsState(STATE);
  const origin = rights.origins.get(artifactId);
  return origin ? { ok: true, origin } : { ok: false, error: "No origin record found" };
}

/**
 * Verify that an artifact's content hasn't changed since origin was recorded.
 */
export function verifyOriginIntegrity(STATE, artifact) {
  const rights = getRightsState(STATE);
  const origin = rights.origins.get(artifact.id);
  if (!origin) return { ok: false, error: "No origin record to verify against" };

  const currentHash = computeContentHash(artifact);
  const match = currentHash === origin.content_hash;

  return {
    ok: true,
    intact: match,
    origin_hash: origin.content_hash,
    current_hash: currentHash,
    artifact_id: artifact.id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CITATION GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a citation snippet for an artifact.
 *
 * @param {object} STATE
 * @param {string} artifactId
 * @returns {{ ok, citation? }}
 */
export function generateCitation(STATE, artifactId) {
  const rights = getRightsState(STATE);
  const atlas = getAtlasState(STATE);
  const dtu = atlas.dtus.get(artifactId);
  if (!dtu) return { ok: false, error: "Artifact not found" };

  const origin = rights.origins.get(artifactId);
  const scope = getDtuScope(STATE, artifactId);
  const { license_type } = resolveLicense(dtu, scope);

  rights.metrics.citationsGenerated++;

  const citation = {
    artifact_id: artifactId,
    title: dtu.title,
    author: dtu.author?.display || dtu.author?.userId || "Unknown",
    created_at: dtu.createdAt,
    content_hash: origin?.content_hash || computeContentHash(dtu),
    scope,
    license_type,
    version: dtu.schemaVersion || "atlas-1.0",
    // Human-readable citation string
    text: `${dtu.author?.display || dtu.author?.userId || "Unknown"}. "${dtu.title}". Concord Atlas (${scope}), ${dtu.createdAt?.split("T")[0] || "n.d."}. ID: ${artifactId}. Hash: ${(origin?.content_hash || computeContentHash(dtu)).slice(0, 12)}. License: ${license_type}.`,
  };

  return { ok: true, citation };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. TRANSFER RIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Grant transfer rights from owner to another user.
 *
 * @param {object} STATE
 * @param {string} artifactId
 * @param {string} fromUserId   Must be the owner
 * @param {string} toUserId
 * @param {string} action       RIGHTS_ACTIONS value
 * @param {object} opts         { expiresAt }
 * @returns {{ ok, transfer? }}
 */
export function grantTransferRights(STATE, artifactId, fromUserId, toUserId, action, opts = {}) {
  const rights = getRightsState(STATE);
  const atlas = getAtlasState(STATE);
  const dtu = atlas.dtus.get(artifactId);

  if (!dtu) return { ok: false, error: "Artifact not found" };
  if (dtu.author?.userId !== fromUserId) {
    return { ok: false, error: "Only the owner can grant transfer rights" };
  }

  const transfer = {
    id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    artifactId,
    fromUserId,
    toUserId,
    action,
    grantedAt: new Date().toISOString(),
    expiresAt: opts.expiresAt || null,
  };

  if (!rights.transfers.has(artifactId)) {
    rights.transfers.set(artifactId, []);
  }
  rights.transfers.get(artifactId).push(transfer);

  return { ok: true, transfer };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. ARTIFACT RIGHTS METADATA (attached to DTUs at write time)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Stamp an artifact with full rights metadata. Called during write guard.
 *
 * @param {object} artifact  Mutable DTU being created/updated
 * @param {string} scope     SCOPES value
 * @returns {object} The artifact (mutated in place with _rights)
 */
export function stampArtifactRights(artifact, scope) {
  const { license_type, profile, isDefault } = resolveLicense(artifact, scope);

  artifact._rights = {
    content_hash: computeContentHash(artifact),
    evidence_hash: computeEvidenceHash(artifact),
    lineage_hash: computeLineageHash(artifact),
    license_type,
    license_profile: profile,
    license_is_default: isDefault,
    attribution_required: profile?.attribution_required || false,
    derivative_allowed: profile?.derivative_allowed !== false,
    commercial_use_allowed: profile?.commercial_use_allowed !== false,
    origin_lane: scope,
    creator_user_id: artifact.author?.userId || "unknown",
    parent_artifact_ids: artifact.lineage?.parents || [],
    stamped_at: new Date().toISOString(),
  };

  return artifact;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. METRICS
// ═══════════════════════════════════════════════════════════════════════════════

export function getRightsMetrics(STATE) {
  const rights = getRightsState(STATE);
  return {
    ok: true,
    ...rights.metrics,
    totalOrigins: rights.origins.size,
    totalTransfers: Array.from(rights.transfers.values()).reduce((sum, arr) => sum + arr.length, 0),
  };
}
