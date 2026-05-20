// server/domains/black-market.js
// Black-market lens. Surfaces marketplace listings flagged for the
// "underground bazaar" filter — typically rare-quality items, unique
// player creations, restricted-tier goods. Pulls from the same
// creative_artifacts table the marketplace uses, with an extra filter.

export default function registerBlackMarketActions(registerLensAction) {
  /**
   * listings — return rare/legendary-quality artifacts, optionally
   * filtered by type.
   */
  registerLensAction("black-market", "listings", (ctx, _artifact, params = {}) => {
    if (!ctx?.db) return { ok: true, result: { items: [] } };
    try {
      const limit = Math.min(50, Math.max(1, Number(params.limit) || 30));
      const type = typeof params.type === "string" ? params.type : null;
      let sql = `
        SELECT id, type, title, description, price, creator_id, created_at
        FROM creative_artifacts
        WHERE marketplace_status = 'active'
          AND (rating >= 4.5 OR price >= 50)
      `;
      const args = [];
      if (type) { sql += " AND type = ?"; args.push(type); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      args.push(limit);
      const rows = ctx.db.prepare(sql).all(...args);
      return { ok: true, result: { items: rows } };
    } catch { return { ok: true, result: { items: [] } }; }
  });

  /**
   * tiers — describe the restricted-tier categories that show up here.
   */
  registerLensAction("black-market", "tiers", () => ({
    ok: true,
    result: {
      tiers: [
        { id: "rare", label: "Rare goods", filter: "rating >= 4.5" },
        { id: "premium", label: "Premium", filter: "price >= 50" },
        { id: "exclusive", label: "Exclusive license", filter: "license_type = 'exclusive'" },
      ],
    },
  }));
}
