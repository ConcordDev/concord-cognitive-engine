/**
 * Source Attribution — Universal Attribution System for External Content
 *
 * Every piece of external content entering the platform (feeds, web search,
 * user uploads, webhooks, OpenStax ingestion) receives a standardized
 * attribution record.  This module provides:
 *
 *   - Structured attribution creation
 *   - License constants with commercial/derivative rules
 *   - Marketplace eligibility checks
 *   - Attribution validation and display formatting
 *   - Fork lineage preservation
 *   - Content deduplication against existing DTUs
 *   - DMCA takedown record creation
 *   - Admin dashboard stats
 *
 * All exported helpers are pure functions except where noted.
 */

import { createHash } from "crypto";
import logger from "../logger.js";

// ══════════════════════════════════════════════════════════════════════════════
// LICENSE TYPES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Frozen mapping of canonical license keys to their rule descriptors.
 * `display` may contain `{author}` and `{url}` placeholders.
 */
export const LICENSE_TYPES = Object.freeze({
  CC_BY_4: Object.freeze({
    id: "CC BY 4.0",
    commercial: true,
    derivative: true,
    shareAlike: false,
    attributionRequired: true,
    display: "Licensed under CC BY 4.0 by {author}",
  }),
  CC_BY_NC_SA: Object.freeze({
    id: "CC BY-NC-SA 4.0",
    commercial: false,
    derivative: true,
    shareAlike: true,
    attributionRequired: true,
    display:
      "Licensed under CC BY-NC-SA by {author}. Non-commercial use only.",
  }),
  CC_BY_NC: Object.freeze({
    id: "CC BY-NC 4.0",
    commercial: false,
    derivative: true,
    shareAlike: false,
    attributionRequired: true,
    display: "Licensed under CC BY-NC by {author}. Non-commercial use only.",
  }),
  CC0: Object.freeze({
    id: "CC0 / Public Domain",
    commercial: true,
    derivative: true,
    shareAlike: false,
    attributionRequired: false,
    display: "Public domain",
  }),
  PUBLIC_DOMAIN: Object.freeze({
    id: "Public Domain",
    commercial: true,
    derivative: true,
    shareAlike: false,
    attributionRequired: false,
    display: "Public domain",
  }),
  ALL_RIGHTS_RESERVED: Object.freeze({
    id: "All Rights Reserved",
    commercial: false,
    derivative: false,
    shareAlike: false,
    attributionRequired: true,
    display: "© {author}. Snippet shown under fair use. {url}",
  }),
  FAIR_USE: Object.freeze({
    id: "Fair Use",
    commercial: false,
    derivative: false,
    shareAlike: false,
    attributionRequired: true,
    display: "Excerpt via web search. {url}",
  }),
  GOVERNMENT: Object.freeze({
    id: "US Government Work",
    commercial: true,
    derivative: true,
    shareAlike: false,
    attributionRequired: false,
    display: "US Government work — not subject to copyright",
  }),
});

// ══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Resolve a license id string to its LICENSE_TYPES entry (or undefined). */
function _resolveLicense(licenseId) {
  if (!licenseId) return undefined;
  for (const key of Object.keys(LICENSE_TYPES)) {
    if (LICENSE_TYPES[key].id === licenseId) return LICENSE_TYPES[key];
  }
  return undefined;
}

/** Extract the source object from a DTU, checking common locations. */
function _extractSource(dtu) {
  if (!dtu) return undefined;
  return dtu.source ?? dtu.meta?.source ?? undefined;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. createAttribution
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a standardized source attribution object.
 *
 * @param {object} opts
 * @param {string} opts.name        — Source name ("OpenStax", "Reuters", etc.)
 * @param {string} opts.url         — URL of the original content
 * @param {string} opts.license     — License identifier string
 * @param {string} opts.attribution — Human-readable attribution line
 * @param {string} opts.via         — Ingestion vector (feed-manager | web-search | openstax-ingest | user-ingest | webhook)
 * @param {string} [opts.fetchedAt] — ISO date override (defaults to now)
 * @returns {object} Standardized attribution record
 */
export function createAttribution(opts = {}) {
  const {
    name = "Unknown",
    url = "",
    license = "Unknown",
    attribution = "",
    via = "unknown",
    fetchedAt,
  } = opts;

  const record = {
    name,
    url,
    license,
    attribution,
    fetchedAt: fetchedAt || new Date().toISOString(),
    via,
  };

  logger.log("debug", "source-attribution", "Attribution created", {
    name,
    license,
    via,
  });

  return record;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. canListOnMarketplace
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Determine whether a DTU may be listed for sale on the marketplace.
 *
 * Rules:
 *   - CC BY-NC / CC BY-NC-SA / All Rights Reserved  → blocked
 *   - CC BY, CC0, Public Domain, Government          → allowed
 *   - No source (pure user-created)                  → allowed
 *
 * @param {object} dtu
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canListOnMarketplace(dtu) {
  const source = _extractSource(dtu);

  // Pure user-created DTUs have no external source — no restrictions.
  if (!source || !source.license) {
    return { allowed: true };
  }

  const licenseEntry = _resolveLicense(source.license);

  if (!licenseEntry) {
    // Unknown license — allow but warn.
    logger.log("warn", "source-attribution", "Unknown license on DTU", {
      license: source.license,
    });
    return { allowed: true, reason: "Unknown license — verify manually" };
  }

  if (!licenseEntry.commercial) {
    return {
      allowed: false,
      reason: `License "${licenseEntry.id}" does not permit commercial use`,
    };
  }

  if (licenseEntry.attributionRequired) {
    return {
      allowed: true,
      reason: "Attribution must persist in listing",
    };
  }

  return { allowed: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. validateAttribution
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validate that a DTU carries proper attribution when externally sourced.
 *
 * @param {object} dtu
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateAttribution(dtu) {
  const issues = [];
  const source = _extractSource(dtu);

  // If no source at all, check whether the DTU came from a feed or search.
  if (!source) {
    const via = dtu.meta?.via || dtu.via;
    if (
      via === "feed-manager" ||
      via === "web-search" ||
      via === "openstax-ingest" ||
      via === "webhook"
    ) {
      issues.push(`DTU arrived via "${via}" but has no source attribution`);
    }
    return { valid: issues.length === 0, issues };
  }

  // Required fields for any external source.
  if (!source.name) issues.push("Missing source name");
  if (!source.url) issues.push("Missing source URL");
  if (!source.via) issues.push("Missing source via (ingestion vector)");

  // License-specific checks.
  if (!source.license) {
    const via = source.via || dtu.meta?.via;
    if (via === "feed-manager" || via === "web-search") {
      issues.push(
        `License info missing on ${via} DTU — attribution may be incomplete`
      );
    }
  } else {
    const licenseEntry = _resolveLicense(source.license);
    if (licenseEntry && licenseEntry.attributionRequired && !source.attribution) {
      issues.push(
        `License "${licenseEntry.id}" requires attribution text but none provided`
      );
    }
  }

  if (!source.fetchedAt) issues.push("Missing fetchedAt timestamp");

  return { valid: issues.length === 0, issues };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. formatAttributionDisplay
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a human-readable attribution string for UI display.
 *
 * @param {object} source — Source attribution object (as returned by createAttribution)
 * @returns {string} Formatted attribution line
 */
function formatAttributionDisplay(source) {
  if (!source) return "";

  const licenseEntry = _resolveLicense(source.license);

  if (!licenseEntry) {
    // Fallback: best-effort display.
    return source.attribution || `Source: ${source.name || "Unknown"}`;
  }

  let display = licenseEntry.display;
  display = display.replace(/\{author\}/g, source.name || "Unknown");
  display = display.replace(/\{url\}/g, source.url || "");

  return display;
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. preserveAttributionOnFork
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Copy source attribution from an original DTU into a fork's lineage metadata.
 * Mutates `forkDtu` and returns it for convenience.
 *
 * @param {object} originalDtu
 * @param {object} forkDtu
 * @returns {object} The updated fork DTU
 */
function preserveAttributionOnFork(originalDtu, forkDtu) {
  if (!originalDtu || !forkDtu) return forkDtu;

  const originalSource = _extractSource(originalDtu);

  // Ensure meta and lineage exist on the fork.
  forkDtu.meta = forkDtu.meta || {};
  forkDtu.meta.lineage = forkDtu.meta.lineage || {};

  // Copy source attribution into lineage.
  if (originalSource) {
    forkDtu.meta.lineage.originalSource = { ...originalSource };
  }

  // Record the fork parent id.
  forkDtu.meta.lineage.forkedFrom = originalDtu.id || originalDtu._id || null;
  forkDtu.meta.lineage.forkedAt = new Date().toISOString();

  // If the original had a shareAlike license, propagate it to the fork's own source.
  if (originalSource?.license) {
    const licenseEntry = _resolveLicense(originalSource.license);
    if (licenseEntry?.shareAlike) {
      forkDtu.meta.source = forkDtu.meta.source || {};
      forkDtu.meta.source.license = originalSource.license;
      forkDtu.meta.source.attribution =
        forkDtu.meta.source.attribution || originalSource.attribution;
    }
  }

  logger.log("debug", "source-attribution", "Attribution preserved on fork", {
    forkedFrom: forkDtu.meta.lineage.forkedFrom,
  });

  return forkDtu;
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. checkContentDuplicate
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check whether a content hash already exists among a set of externally-sourced DTUs.
 *
 * @param {string} contentHash — SHA-256 hex digest of the content
 * @param {object[]} existingDtus — Array of DTU objects to search
 * @returns {{ duplicate: boolean, matchedDtuId?: string, source?: string }}
 */
function checkContentDuplicate(contentHash, existingDtus = []) {
  if (!contentHash || !existingDtus.length) {
    return { duplicate: false };
  }

  for (const dtu of existingDtus) {
    const hash =
      dtu.contentHash ||
      dtu.meta?.contentHash ||
      dtu.hash;

    if (hash && hash === contentHash) {
      const source = _extractSource(dtu);
      return {
        duplicate: true,
        matchedDtuId: dtu.id || dtu._id,
        source: source?.name,
      };
    }
  }

  return { duplicate: false };
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. createDMCARecord
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a DMCA takedown audit record.
 *
 * @param {object} opts
 * @param {string} opts.dtuId        — ID of the DTU in question
 * @param {string} opts.noticeUrl    — URL of the DMCA notice
 * @param {string} opts.complainant  — Name / entity filing the complaint
 * @param {string} opts.reason       — Free-text reason
 * @param {"remove"|"restrict"} opts.action — Action taken
 * @returns {object} Audit DTU object
 */
export function createDMCARecord(opts = {}) {
  const { dtuId, noticeUrl, complainant, reason, action = "restrict" } = opts;

  if (!dtuId) throw new Error("createDMCARecord requires opts.dtuId");
  if (!complainant) throw new Error("createDMCARecord requires opts.complainant");

  const record = {
    id: `dmca_${createHash("sha256").update(`${dtuId}:${complainant}:${Date.now()}`).digest("hex").slice(0, 16)}`,
    type: "dmca-takedown",
    dtuId,
    noticeUrl: noticeUrl || null,
    complainant,
    reason: reason || "",
    action,
    status: "pending",
    createdAt: new Date().toISOString(),
    hash: createHash("sha256")
      .update(`dmca:${dtuId}:${complainant}:${Date.now()}`)
      .digest("hex"),
  };

  logger.log("warn", "source-attribution", "DMCA record created", {
    dtuId,
    complainant,
    action,
  });

  return record;
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. getAttributionStats
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute attribution statistics across a collection of DTUs.
 *
 * @param {object[]} dtus
 * @returns {{ totalWithSource: number, totalWithout: number, bySource: Record<string,number>, byLicense: Record<string,number>, flaggedIssues: number }}
 */
export function getAttributionStats(dtus = []) {
  const stats = {
    totalWithSource: 0,
    totalWithout: 0,
    bySource: {},
    byLicense: {},
    flaggedIssues: 0,
  };

  for (const dtu of dtus) {
    const source = _extractSource(dtu);

    if (!source) {
      stats.totalWithout++;
      continue;
    }

    stats.totalWithSource++;

    // Count by source name.
    const name = source.name || "Unknown";
    stats.bySource[name] = (stats.bySource[name] || 0) + 1;

    // Count by license.
    const license = source.license || "Unspecified";
    stats.byLicense[license] = (stats.byLicense[license] || 0) + 1;

    // Run lightweight validation for flagged issues.
    const { valid } = validateAttribution(dtu);
    if (!valid) stats.flaggedIssues++;
  }

  return stats;
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. Feed-Specific Helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create an attribution record from a feed source config and a parsed feed item.
 *
 * @param {object} feedSource — Feed source config (must have `.name`, `.url`, optionally `.license`)
 * @param {object} item       — Parsed feed item (may have `.link`, `.title`, `.author`)
 * @returns {object} Attribution record
 */
export function feedAttribution(feedSource, item = {}) {
  const name = feedSource?.name || "Unknown Feed";
  const url = item.link || item.url || feedSource?.url || "";
  const license = feedSource?.license || LICENSE_TYPES.FAIR_USE.id;
  const author = item.author || feedSource?.name || "Unknown";

  const licenseEntry = _resolveLicense(license);
  let attributionText = "";
  if (licenseEntry) {
    attributionText = licenseEntry.display
      .replace(/\{author\}/g, author)
      .replace(/\{url\}/g, url);
  } else {
    attributionText = `Via ${name}`;
  }

  return createAttribution({
    name,
    url,
    license,
    attribution: attributionText,
    via: "feed-manager",
  });
}

/**
 * Create an attribution record for a web search result.
 *
 * @param {string} query     — The search query that produced this result
 * @param {string} resultUrl — URL of the search result
 * @param {string} domain    — Domain name (e.g. "reuters.com")
 * @returns {object} Attribution record
 */
function webSearchAttribution(query, resultUrl, domain) {
  return createAttribution({
    name: domain || "Web",
    url: resultUrl || "",
    license: LICENSE_TYPES.FAIR_USE.id,
    attribution: `Excerpt via web search. ${resultUrl || ""}`,
    via: "web-search",
  });
}

/**
 * Create an attribution record for user-uploaded content.
 *
 * @param {string} userId   — Uploading user's ID
 * @param {string} userName — Uploading user's display name
 * @returns {object} Attribution record
 */
function userUploadAttribution(userId, userName) {
  return createAttribution({
    name: userName || "User",
    url: "",
    license: LICENSE_TYPES.CC_BY_4.id,
    attribution: `Uploaded by ${userName || "User"}`,
    via: "user-ingest",
  });
}
