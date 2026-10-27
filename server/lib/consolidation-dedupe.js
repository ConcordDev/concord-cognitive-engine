// Consolidation dedupe + honest accounting helpers (pure, no STATE access).
//
// Ramaj, 2026-10-27: every cycle logged megaPromoted 8 / hyperPromoted 4,
// but _promoteClusterBatch counted a cluster before trying it, so skipped and
// rejected clusters were reported as promotions. The store also had
// "MEGA — MEGA …" and "HYPER — MEGA …" titles: a downgraded mega (stored as
// a regular that keeps its "MEGA — " title and clusterKey) was clustered
// again, and the title builder prefixed the tier onto a title that already
// carried one.

const TIER_PREFIX = /^\s*(?:mega|hyper)\s*[—–-]\s*/i;

/** "MEGA — HYPER — MEGA — Foo" → "Foo". */
export function stripTierPrefix(title) {
  let t = String(title ?? "");
  for (let i = 0; i < 8 && TIER_PREFIX.test(t); i++) t = t.replace(TIER_PREFIX, "");
  return t.trim();
}

/** Title for a new consolidated node: exactly one tier prefix. */
export function consolidatedTitle(targetTier, seed, maxLen = 80) {
  const base = stripTierPrefix(seed).slice(0, maxLen) || "Cluster";
  return `${String(targetTier).toUpperCase()} — ${base}`;
}

/**
 * A regular that is really a failed promotion: it carries a clusterKey
 * (the anti-gaming downgrade keeps it) or a tier prefix in its title.
 * Clustering it again is what minted "MEGA — MEGA" nodes.
 */
export function isPromotionArtifact(d, childTier = "regular") {
  if (!d) return false;
  if (childTier !== "regular") return false;
  if (d.meta?.clusterKey) return true;
  return TIER_PREFIX.test(String(d.title || ""));
}

/** Distinct members by normalised title + summary head. */
export function distinctContentCount(members) {
  const seen = new Set();
  for (const m of members || []) {
    const key = [
      stripTierPrefix(m?.title || "").toLowerCase(),
      String(m?.cretiHuman || m?.human?.summary || "").toLowerCase().replace(/\s+/g, " ").slice(0, 160),
    ].join("|");
    seen.add(key);
  }
  return seen.size;
}

/**
 * Screen a cluster's members before promotion.
 * @param {object[]} members  live members already filtered by tier/status
 * @param {object} o
 * @param {"regular"|"mega"} o.childTier
 * @param {(id: string) => boolean} o.isLiveConsolidated  true when id is a live mega/hyper
 * @param {number} o.minCluster
 * @returns {{ ok: boolean, members: object[], reason?: string }}
 */
export function screenClusterMembers(members, { childTier = "regular", isLiveConsolidated = () => false, minCluster = 3 } = {}) {
  const kept = [];
  let artifacts = 0;
  let claimed = 0;
  for (const m of members || []) {
    if (isPromotionArtifact(m, childTier)) { artifacts++; continue; }
    // Already absorbed into a live consolidated node.
    const parent = m?.meta?.megaParent;
    if (parent && parent !== m.id && isLiveConsolidated(parent)) { claimed++; continue; }
    kept.push(m);
  }
  if (kept.length < minCluster) {
    const reason = artifacts >= claimed && artifacts > 0 ? "members_are_promotion_artifacts"
      : claimed > 0 ? "members_already_consolidated" : "too_few_members";
    return { ok: false, members: kept, reason };
  }
  // A cluster of near-copies (one mega's text repeated) is not a synthesis.
  if (distinctContentCount(kept) < 2) return { ok: false, members: kept, reason: "single_distinct_member" };
  return { ok: true, members: kept };
}

/** Sorted member-set signature (order-independent dedupe). */
export function memberSetKey(ids) {
  return Array.from(new Set((ids || []).map(String))).sort().join("|");
}

/**
 * Bounded TTL set of cluster/member-set keys that were rejected, so the same
 * failing cluster is not rebuilt, scored and deleted every cycle.
 */
export function createRejectionCache({ ttlMs = 24 * 3600_000, max = 5000, now = Date.now } = {}) {
  const m = new Map();
  return {
    add(key, reason = "rejected") {
      if (!key) return;
      m.delete(key);
      m.set(key, { at: now(), reason });
      while (m.size > max) m.delete(m.keys().next().value);
    },
    has(key) {
      const e = key ? m.get(key) : null;
      if (!e) return false;
      if (now() - e.at > ttlMs) { m.delete(key); return false; }
      return true;
    },
    get size() { return m.size; },
    clear() { m.clear(); },
  };
}

/** Tally helper for skip reasons. */
export function bump(tally, reason) {
  const k = String(reason || "unknown");
  tally[k] = (tally[k] || 0) + 1;
  return tally;
}
