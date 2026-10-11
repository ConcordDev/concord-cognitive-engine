// Sidecar list decisions and the paginated response shape.
// The Rust DTU sidecar caches SQLite on a ~2.5s refresh and has no write
// API, so a DTU created a second ago is missing from a q= search
// (_source: "dtu-sidecar", total: 0). Fall back to the in-process store
// for that miss. Do not treat an unknown index time as always stale —
// that would disable the sidecar after every write.

export const SIDECAR_REFRESH_MS = 3000;

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
 * True when a q= search must ignore the sidecar body and use STATE.dtus.
 * Empty hits with a query are a stale cache, not an empty vault.
 */
export function shouldFallbackFromSidecarList(body, { q = "", lastWriteAt = 0, now = Date.now() } = {}) {
  const query = String(q || "").trim();
  if (!query) return false;
  const items = Array.isArray(body?.dtus) ? body.dtus : [];
  if (items.length === 0) return true;
  const indexedThrough = Number(body?.indexedThrough);
  const wrote = Number(lastWriteAt) || 0;
  if (wrote && Number.isFinite(indexedThrough) && indexedThrough < wrote) return true;
  if (wrote && !Number.isFinite(indexedThrough) && (now - wrote) < SIDECAR_REFRESH_MS) return true;
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
