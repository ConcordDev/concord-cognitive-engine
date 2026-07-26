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
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    // Fixed (2026-07 grounding-audit continuation): listForgeAppOnMarketplace
    // now lists through the real `marketplace.list` macro via `ctx.macro.run`
    // (was a dead-end write into a never-created `creative_artifact_listings`
    // table / an unpurchasable `marketplace_listings` fallback). The seller
    // is derived by `marketplace.list` itself from `ctx.actor.userId` — pass
    // the SAME ctx this handler was invoked with so ownership resolves to
    // the authenticated caller, matching how `mint` above already scopes to
    // `ctx.actor.userId`.
    return listForgeAppOnMarketplace(ctx, {
      dtuId: input.dtuId,
      priceCents: input.priceCents,
      currency: input.currency,
      title: input.title,
      description: input.description,
    });
  }, { note: "list a forge_app DTU on the marketplace (real marketplace.list macro)" });

  register("forge_marketplace", "list_for_user", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return { ok: true, apps: listForgeAppsForUser(db, userId) };
  }, { note: "list user's minted Forge apps" });
}
