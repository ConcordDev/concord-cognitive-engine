// server/domains/creator.js
// Creator dashboard lens. Surfaces the caller's DTU production, royalty
// income, citation graph entry-points, and audience metrics. Pulls from
// the existing economy + DTU substrate; no parallel state.

export default function registerCreatorActions(registerLensAction) {
  /**
   * dashboard — single rollup the lens page renders into a header.
   */
  registerLensAction("creator", "dashboard", (ctx) => {
    const STATE = globalThis._concordSTATE;
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    if (!userId) return { ok: false, error: "auth_required" };

    const items = [];
    let dtuCount = 0;
    let publishedCount = 0;
    if (STATE?.dtus) {
      for (const dtu of STATE.dtus.values?.() ?? []) {
        if (dtu.ownerUserId !== userId) continue;
        dtuCount++;
        if (dtu.visibility === "marketplace" || dtu.visibility === "public") {
          publishedCount++;
        }
        if (items.length < 10) {
          items.push({
            dtuId: dtu.id,
            title: dtu.title,
            visibility: dtu.visibility ?? "private",
            createdAt: dtu.createdAt,
          });
        }
      }
    }

    return {
      ok: true,
      result: {
        userId,
        dtuCount,
        publishedCount,
        recentDTUs: items,
      },
    };
  });

  /**
   * royalty-summary — placeholder for the royalty cascade ledger view.
   * The actual ledger is queried via /api/economy/* routes; this macro
   * exposes a small summary for the lens header chip.
   */
  registerLensAction("creator", "royalty-summary", (ctx) => {
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    if (!userId) return { ok: false, error: "auth_required" };
    // Real numbers come from /api/economy/royalty/cascade-earnings/:userId.
    return { ok: true, result: { userId, summaryEndpoint: `/api/economy/royalty/cascade-earnings/${userId}` } };
  });
}
