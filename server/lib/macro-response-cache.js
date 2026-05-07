/**
 * Macro Response Cache
 *
 * LRU cache of successful macro responses. Used as Tier 4 fallback
 * when LLM is unavailable — returns cached responses for the same
 * domain+name combination.
 */
import { createHash } from "node:crypto";

const MAX_ENTRIES = 1000;
const READ_TTL_MS = 60 * 60 * 1000;   // 1 hour for read macros
const WRITE_TTL_MS = 5 * 60 * 1000;    // 5 minutes for write macro results

// Map<string, { response, cachedAt, ttlMs }>
const _cache = new Map();

// Read macro name patterns
const READ_PATTERNS = /^(get|list|status|info|count|search|query|check|find|stats|metrics|health|schema)$/i;

function _key(domain, name, inputHash) {
  return `${domain}:${name}:${inputHash || "_"}`;
}

function _hashInput(input) {
  if (!input || typeof input !== "object") return "_";
  try {
    return createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 12);
  } catch {
    return "_";
  }
}

/**
 * Store a successful macro response in cache.
 */
export function set(domain, name, input, response) {
  if (!response || response.ok === false) return;

  const isRead = READ_PATTERNS.test(name);
  const ttlMs = isRead ? READ_TTL_MS : WRITE_TTL_MS;
  const inputHash = _hashInput(input);
  const key = _key(domain, name, inputHash);

  _cache.set(key, { response, cachedAt: Date.now(), ttlMs });

  // LRU eviction
  if (_cache.size > MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
}

/**
 * Get a cached macro response.
 * @returns {object|null} The cached response, or null if not found/expired.
 */
export function get(domain, name, inputHash) {
  const key = _key(domain, name, inputHash);
  const entry = _cache.get(key);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.cachedAt > entry.ttlMs) {
    _cache.delete(key);
    return null;
  }

  // Move to end (LRU refresh)
  _cache.delete(key);
  _cache.set(key, entry);
  return entry.response;
}

/**
 * Get cache stats.
 */
export function getStats() {
  let expired = 0;
  const now = Date.now();
  for (const [, v] of _cache) {
    if (now - v.cachedAt > v.ttlMs) expired++;
  }
  return { size: _cache.size, maxEntries: MAX_ENTRIES, expired };
}

/**
 * Clear all cached responses.
 */
export function clear() {
  _cache.clear();
}
