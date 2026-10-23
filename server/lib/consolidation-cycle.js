// One DTU consolidation cycle: cluster regulars → promote MEGAs, then (when
// the MEGA population allows) cluster MEGAs → promote HYPERs.
//
// The promotion budget bounds PROMOTION work only. It used to start before
// clustering, and clustering's wall time includes every yield it makes to
// the event loop — so with a busy loop (live 2026-10-22: 87 s wall for 57 ms
// of clustering CPU, waiting behind NPC-tick stalls) the budget was gone
// before the first promotion and every cycle promoted nothing
// (consolidation_defer_remaining done:0). Clustering is cheap in CPU and
// yields; it is timed and reported, never charged against promotion.

/**
 * @param {object} p
 * @param {() => Promise<{clusters?: any[]}|null>} p.clusterRegular
 * @param {() => Promise<{clusters?: any[]}|null>} p.clusterMega
 * @param {(clusters: any[], tier: "mega"|"hyper", startedAt: number) => Promise<number>} p.promoteBatch
 *        must stop once `now() - startedAt > budgetMs`; returns promotions done
 * @param {() => number} p.megaPopulation
 * @param {number} p.hyperMinPopulation
 * @param {number} [p.budgetMs]
 * @param {() => number} [p.now]
 * @param {(e: unknown) => void} [p.onError]
 */
export async function runConsolidationCycle({
  clusterRegular,
  clusterMega,
  promoteBatch,
  megaPopulation,
  hyperMinPopulation,
  budgetMs = 4000,
  now = Date.now,
  onError = () => {},
}) {
  let promoteMs = 0;
  let clusterMs = 0;
  let megaPromoted = 0;
  let hyperPromoted = 0;

  const promote = async (clusters, tier) => {
    const t0 = now();
    try {
      // Charge only promotion time already spent this cycle.
      return await promoteBatch(clusters, tier, t0 - promoteMs);
    } finally {
      promoteMs += now() - t0;
    }
  };

  try {
    const c0 = now();
    const r = await clusterRegular();
    clusterMs += now() - c0;
    if (r?.clusters?.length > 0) megaPromoted = await promote(r.clusters, "mega");
  } catch (e) { onError(e); }

  if (megaPopulation() >= hyperMinPopulation && promoteMs <= budgetMs) {
    try {
      const c0 = now();
      const r = await clusterMega();
      clusterMs += now() - c0;
      if (r?.clusters?.length > 0) hyperPromoted = await promote(r.clusters, "hyper");
    } catch (e) { onError(e); }
  }

  return { clusterMs, promoteMs, megaPromoted, hyperPromoted, budgetMs };
}
