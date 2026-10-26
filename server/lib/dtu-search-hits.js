/**
 * Visibility + existence gate for inverted-index DTU search hits.
 *
 * searchIndexed used to return scored rows as-is. A hit for a deleted id
 * spread `undefined` into `{_searchScore}` and stayed in the result, and a
 * hit for another account's private DTU was returned with no visibility
 * check. The token-scan fallback already used userVisibleDTUs plus the
 * shadow/internal kind filter. Indexed hits take the same path, and the
 * caller's limit is applied after that filter.
 */

export const SEARCH_INTERNAL_KINDS = new Set([
  "shadow",
  "pattern_shadow",
  "repair_record",
  "royalty_record",
  "session_context",
  "linguistic_map",
  "audit_trail",
  "system_metric",
  "repair_dtu",
  "client_error",
]);

export function searchCandidateLimit(limit) {
  const n = Number(limit);
  const base = Number.isFinite(n) && n > 0 ? n : 20;
  return Math.min(2000, Math.max(Math.ceil(base * 25), 200));
}

export function isSearchHiddenDtu(d) {
  if (!d || typeof d !== "object" || !d.id) return true;
  if (String(d.tier || "").toLowerCase() === "shadow") return true;
  if (Array.isArray(d.tags) && d.tags.includes("shadow")) return true;
  if (SEARCH_INTERNAL_KINDS.has(d.machine?.kind)) return true;
  if (d.visibility === "internal" || d.scope === "system") return true;
  return false;
}

/** Drop missing ids (caller evicts), hidden kinds, and ids outside the viewer set. Limit last. */
export function filterVisibleSearchHits(hits, { visibleIds, limit = 20 } = {}) {
  const cap = Math.max(1, Math.min(500, Number(limit) || 20));
  const out = [];
  for (const hit of hits || []) {
    if (!hit?.id) continue;
    if (isSearchHiddenDtu(hit)) continue;
    if (visibleIds && !visibleIds.has(hit.id)) continue;
    out.push(hit);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Turn scored index rows into live DTU objects. A missing id is evicted
 * from the index and omitted. Shadow docs are omitted. The id is read
 * from the score row, never from a spread of `undefined`.
 */
export function materializeIndexedHits(scored, { getLive, evict, isShadow } = {}) {
  const out = [];
  for (const row of scored || []) {
    const id = row?.id;
    if (!id) continue;
    const live = typeof getLive === "function" ? getLive(id) : null;
    if (!live) {
      try { evict?.(id); } catch { /* eviction is best-effort */ }
      continue;
    }
    if (typeof isShadow === "function" && isShadow(live)) continue;
    out.push({ ...live, _searchScore: row.score });
  }
  return out;
}
