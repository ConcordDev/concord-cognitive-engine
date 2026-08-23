/**
 * Richer Dedup Key Derivation — Feed DTU Deduplication
 *
 * Generates dedup keys for feed DTUs from:
 *   - Source URL (primary)
 *   - Canonical title (secondary)
 *   - First 100 chars of body (tertiary)
 *
 * Allows feed-manager to maintain a set of seen dedup keys to prevent
 * duplicates across polls and across feed sources (same article from
 * multiple feeds should be deduplicated).
 */

import { createHash } from 'crypto';

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Extract body text from multiple possible fields */
function getBodyText(dtu) {
  return (
    dtu.creti ||
    dtu.body ||
    dtu.content ||
    dtu.core?.definitions?.[0] ||
    dtu.core?.evidence?.[0]?.value ||
    ''
  );
}

/** Get source URL from multiple possible locations */
function getSourceUrl(dtu) {
  return (
    dtu.meta?.externalUrl ||
    dtu.meta?.sourceUrl ||
    dtu.source?.url ||
    dtu.sourceUrl ||
    ''
  );
}

/** Canonical title: lowercase, trim, remove extra spaces */
function canonicalTitle(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

/** Normalize URL for comparison (remove query params, fragment, trailing slash) */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    // Remove common tracking params
    const params = new URLSearchParams(u.search);
    params.delete('utm_source');
    params.delete('utm_medium');
    params.delete('utm_campaign');
    params.delete('utm_content');
    params.delete('utm_term');
    u.search = params.toString();
    u.hash = '';
    const normalized = u.toString().replace(/\/$/, '').toLowerCase();
    return normalized;
  } catch {
    return url.toLowerCase().trim();
  }
}

/** Hash a string to a consistent short key */
function hashKey(str) {
  return createHash('sha256').update(str || '').digest('hex').slice(0, 16);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Derive a richer dedup key from URL + canonical title + first 100 body chars.
 * Returns a composite key that catches duplicates across sources.
 *
 * @param {object} dtu - DTU or feed item
 * @returns {string} - Composite dedup key (not hashed, human-readable for analysis)
 */
export function getDedupKey(dtu) {
  const sourceUrl = getSourceUrl(dtu);
  const title = canonicalTitle(dtu.title || '');
  const body = getBodyText(dtu);
  const bodySnippet = String(body || '').slice(0, 100);

  // Build components in priority order
  const components = [];
  if (sourceUrl) components.push(`url:${normalizeUrl(sourceUrl)}`);
  if (title) components.push(`title:${title}`);
  if (bodySnippet) components.push(`body:${bodySnippet}`);

  // Return composite key (not hashed for debugging)
  return components.join('|');
}

/**
 * Hash a dedup key to a short fingerprint suitable for Set storage.
 * Used internally by feed-manager to maintain a Set of seen keys.
 *
 * @param {string} dedupKey - The composite dedup key from getDedupKey()
 * @returns {string} - 16-char hex hash
 */
export function hashDedupKey(dedupKey) {
  return hashKey(dedupKey);
}

/**
 * Derive BOTH the readable key and its hash (common pattern).
 * @param {object} dtu
 * @returns {{ key: string, hash: string }}
 */
export function getDedupKeyAndHash(dtu) {
  const key = getDedupKey(dtu);
  const hash = hashDedupKey(key);
  return { key, hash };
}
