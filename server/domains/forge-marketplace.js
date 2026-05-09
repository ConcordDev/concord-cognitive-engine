// server/domains/forge-marketplace.js
//
// Phase 6a — macros: mint a Forge-generated app as a DTU + list it.

import {
  mintForgeAppAsDtu,
  listForgeAppOnMarketplace,
  listForgeAppsForUser,
} from "../lib/forge-marketplace.js";

export default function registerForgeMarketplaceMacros(register) {
  register("forge_marketplace", "mint", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return await mintForgeAppAsDtu(db, {
      userId,
      templateId: input.templateId,
      appName: input.appName,
      sourceCode: input.sourceCode,
      manifest: input.manifest,
      summary: input.summary,
    });
  }, { note: "mint Forge-generated app as a DTU + register citation" });

  register("forge_marketplace", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return listForgeAppOnMarketplace(db, {
      dtuId: input.dtuId,
      sellerId: userId,
      priceCents: input.priceCents,
      currency: input.currency,
      title: input.title,
      description: input.description,
    });
  }, { note: "list a forge_app DTU on the marketplace" });

  register("forge_marketplace", "list_for_user", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return { ok: true, apps: listForgeAppsForUser(db, userId) };
  }, { note: "list user's minted Forge apps" });
}
