// Sidecar list decisions and the paginated response shape.
// The Rust DTU sidecar caches SQLite on a ~2.5s refresh and has no write
// API, so a DTU created a second ago is missing from a q= search
// (_source: "dtu-sidecar", total: 0). Fall back to the in-process store
// for that miss. Do not treat an unknown index time as always stale —
// that would disable the sidecar for an unqueried anonymous list after
// every write. Owner vaults (mine), tag filters, and signed-in searches
// are different: an empty mine or a tag the sidecar cannot apply is not
// proof the vault is empty.

export const SIDECAR_REFRESH_MS = 3000;

/** Page size when GET /api/dtus omits limit. Explicit limits still clamp to MAX_LIST_LIMIT. */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 5000;

export function resolveListLimit(raw) {
  if (raw == null || raw === "") return DEFAULT_LIST_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(n)));
}

/** Same owner chain as privateDtuHiddenFrom, plus authorId from the paginated route. */
export function dtuListedOwner(d) {
  if (!d || typeof d !== "object") return null;
  return d.author || d.ownerId || d.userId || d.createdBy || d.authorId || null;
}

/** Comma-separated or array tag filter. Empty means no tag constraint. */
export function tagFilterTerms(raw) {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }
  const s = String(raw || "").trim();
  if (!s) return [];
  return s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/** OR match, case-insensitive, against d.tags. */
export function dtuMatchesTagFilter(d, terms) {
  if (!terms || terms.length === 0) return true;
  const have = new Set((Array.isArray(d?.tags) ? d.tags : []).map((t) => String(t).trim().toLowerCase()));
  return terms.some((t) => have.has(t));
}

export function noteDtuWrite(now = Date.now()) {
  globalThis._dtuLastWriteAt = now;
  return now;
}

export function sidecarListTotal(body) {
  const items = Array.isArray(body?.dtus) ? body.dtus : [];
  const reported = Number(body?.total);
  if (Number.isFinite(reported) && reported > 0) return reported;
  if (items.length > 0) return items.length;
  return Number.isFinite(reported) ? reported : items.length;
}

/**
 * True when the sidecar body must be ignored and STATE.dtus used instead.
 * Empty hits with a query are a stale cache, not an empty vault.
 * An unqueried anonymous list does not fall back — that would disable the
 * sidecar after every write. mine/tag/signed-in search do fall back,
 * because the sidecar drops a brand-new private row and has no tag param.
 */
export function shouldFallbackFromSidecarList(body, {
  q = "",
  tag = "",
  mine = false,
  viewer = "",
  lastWriteAt = 0,
  now = Date.now(),
} = {}) {
  const query = String(q || "").trim();
  const tagSet = String(tag || "").trim();
  const mineOnly = mine === true || mine === "true";
  const viewerId = viewer && viewer !== "anon" ? String(viewer) : "";
  const items = Array.isArray(body?.dtus) ? body.dtus : [];
  const wrote = Number(lastWriteAt) || 0;
  const indexedThrough = Number(body?.indexedThrough);
  const indexStale = () => {
    if (!wrote) return false;
    if (Number.isFinite(indexedThrough) && indexedThrough < wrote) return true;
    if (!Number.isFinite(indexedThrough) && (now - wrote) < SIDECAR_REFRESH_MS) return true;
    return false;
  };

  if (tagSet) return true;
  if (mineOnly && items.length === 0) return true;
  // Sidecar q= searches title/tags/creti and hides a private row when the
  // viewer was dropped. A signed-in search has to see the owner's content.
  if (query && viewerId) return true;
  if (query) {
    if (items.length === 0) return true;
    if (indexStale()) return true;
    return false;
  }
  if (!mineOnly && !viewerId) return false;
  if (indexStale()) return true;
  // Owner already has cached rows, but a create from the last few seconds
  // is newer than every indexed createdAt.
  if (mineOnly && wrote && (now - wrote) < SIDECAR_REFRESH_MS) {
    let newest = 0;
    for (const d of items) {
      const t = Date.parse(d?.createdAt || d?.updatedAt || "");
      if (Number.isFinite(t) && t > newest) newest = t;
    }
    if (newest < wrote) return true;
  }
  return false;
}

export function dtuSearchHaystack(d) {
  const creti = typeof d?.creti === "string" ? d.creti : "";
  const parts = [
    d?.title,
    d?.content,
    creti,
    d?.cretiHuman,
    d?.human?.summary,
    d?.summary,
    ...(Array.isArray(d?.tags) ? d.tags : []),
  ];
  return parts.filter((x) => typeof x === "string" && x).join(" ").toLowerCase();
}

export function dtuMatchesQuery(d, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return dtuSearchHaystack(d).includes(q);
}

export function shapePaginatedBody(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const pagination = result?.pagination && typeof result.pagination === "object" ? result.pagination : {};
  const reported = Number(pagination.total);
  const total = Number.isFinite(reported) && reported > 0 ? reported : (items.length > 0 && (!Number.isFinite(reported) || reported === 0) ? items.length : (Number.isFinite(reported) ? reported : items.length));
  return {
    ok: true,
    ...result,
    items,
    dtus: items,
    total,
    hasMore: Boolean(pagination.hasNext),
    pagination: { ...pagination, total },
  };
}
