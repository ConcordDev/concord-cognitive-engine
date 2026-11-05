/**
 * Global feed selection.
 *
 * The global feed lists DTUs published to the shared pool. It must apply the
 * same read filters as every other DTU read (privateDtuHiddenFrom + the
 * hidden-system-row rule that userVisibleDTUs uses), for the viewer making
 * the request, and it must not treat a compressed tier (mega/hyper) as
 * published by itself: only an explicit global flag or scope publishes.
 *
 * Kept as a pure function so server.js routes and the tests share one
 * implementation.
 */

function timeOf(d, preferPublished) {
  const t = (preferPublished && d?.meta?.publishedAt) || d?.createdAt || 0;
  const n = new Date(t).getTime();
  return Number.isFinite(n) ? n : 0;
}

export function isPublishedGlobal(d) {
  return !!d && (d.isGlobal === true || d.scope === "global");
}

/**
 * @param {Iterable<object>} dtus
 * @param {object} opts
 * @param {string|null} opts.viewerId        requesting user id (null = anonymous)
 * @param {(d:object)=>boolean} opts.isHidden        hidden system/internal predicate
 * @param {(d:object, viewerId:string|null)=>boolean} opts.isPrivateFrom  private-read predicate
 * @param {(d:object)=>boolean} [opts.isShadow]
 * @param {string} [opts.tier]
 * @param {string} [opts.lensId]             lens feed: scope=global rows for this lens
 * @returns {object[]} newest first
 */
export function selectGlobalFeed(dtus, opts = {}) {
  const { viewerId = null, isHidden, isPrivateFrom, isShadow, tier, lensId } = opts;
  if (typeof isHidden !== "function" || typeof isPrivateFrom !== "function") {
    // Fail closed: without the read filters nothing is returned.
    return [];
  }
  const lens = lensId ? String(lensId).toLowerCase() : null;
  const out = [];
  for (const d of dtus || []) {
    if (!d) continue;
    if (!isPublishedGlobal(d)) continue;
    if (lens && d.scope !== "global") continue;
    if (isShadow && isShadow(d)) continue;
    if (isHidden(d)) continue;
    if (isPrivateFrom(d, viewerId || null)) continue;
    if (tier && d.tier !== tier) continue;
    if (lens) {
      const onLens =
        d.meta?.publishedFromLens === lens ||
        (d.tags || []).some((t) => String(t).toLowerCase() === lens) ||
        d.meta?.domain === lens;
      if (!onLens) continue;
    }
    out.push(d);
  }
  out.sort((a, b) => timeOf(b, !!lens) - timeOf(a, !!lens));
  return out;
}
