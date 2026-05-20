// server/domains/all.js
// Aggregation domain providing cross-domain analytics and search.

export default function registerAllActions(registerLensAction) {
  /**
   * crossDomainSearch
   * Search across all lens artifacts for matching query. Uses the live
   * STATE.dtus map exposed via globalThis._concordSTATE.
   */
  registerLensAction("all", "crossDomainSearch", (ctx, artifact, params) => {
    const query = String(params.query || artifact.data?.query || '').toLowerCase().trim();
    if (!query) return { ok: true, result: { matches: [], message: 'Provide a search query' } };

    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { matches: [], message: 'No DTU store available' } };

    const matches = [];
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
    for (const dtu of STATE.dtus.values?.() ?? []) {
      const hay = `${dtu.title || ''}\n${dtu.human?.summary || dtu.body || ''}`.toLowerCase();
      if (hay.includes(query)) {
        matches.push({
          dtuId: dtu.id,
          title: dtu.title,
          domain: dtu.domain,
          summary: (dtu.human?.summary || '').slice(0, 200),
          createdAt: dtu.createdAt,
        });
        if (matches.length >= limit) break;
      }
    }

    return { ok: true, result: { query, matches, total: matches.length } };
  });

  /**
   * domainStats
   * Aggregate statistics across all domains.
   */
  registerLensAction("all", "domainStats", (_ctx, _artifact, _params) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { message: 'No DTU store available', stats: {} } };

    const counts = {};
    let total = 0;
    let oldest = Infinity;
    let newest = 0;

    for (const dtu of STATE.dtus.values?.() ?? []) {
      const dom = dtu.domain || 'unknown';
      counts[dom] = (counts[dom] || 0) + 1;
      total++;
      const ts = new Date(dtu.createdAt || 0).getTime();
      if (Number.isFinite(ts)) {
        if (ts < oldest) oldest = ts;
        if (ts > newest) newest = ts;
      }
    }

    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count }));

    return {
      ok: true,
      result: {
        totalDtus: total,
        domains: ranked.length,
        topDomains: ranked.slice(0, 10),
        oldestDtuAt: oldest === Infinity ? null : new Date(oldest).toISOString(),
        newestDtuAt: newest === 0 ? null : new Date(newest).toISOString(),
      },
    };
  });

  /**
   * recentActivity
   * Show recent cross-domain activity feed.
   */
  registerLensAction("all", "recentActivity", (_ctx, _artifact, params) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { feed: [] } };

    const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
    const items = [];
    for (const dtu of STATE.dtus.values?.() ?? []) {
      items.push({
        dtuId: dtu.id,
        title: dtu.title,
        domain: dtu.domain,
        createdAt: dtu.createdAt,
        creatorId: dtu.creatorId || dtu.ownerId,
      });
    }
    items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return { ok: true, result: { feed: items.slice(0, limit) } };
  });
}
