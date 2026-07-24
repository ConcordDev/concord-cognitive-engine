// server/lib/forge-marketplace.js
//
// Phase 6a — Forge → Marketplace.
//
// Forge generates polyglot single-file apps. Until now those apps lived
// only in the Forge lens. Phase 6a mints them as kind='forge_app' DTUs
// so they:
//   1. Get persistent IDs the user can reference.
//   2. Flow through the existing royalty cascade.
//   3. Can be cited by other apps (a generated CRUD app cites the
//      template that generated it; royalties cascade).
//   4. Can be listed on the marketplace at user-set prices.
//
// We don't reimplement the Forge engine — we wrap its output in a DTU.

import crypto from "node:crypto";
import logger from "../logger.js";

/**
 * Mint a Forge-generated app as a DTU.
 *
 * Inputs:
 *   userId        — creator (the wallet/owner that earns royalties).
 *                   For NPC-authored content, set userId to the mentor
 *                   player's id and pass actorKind: 'npc' + npcId so the
 *                   royalty trail attributes to the human who taught the
 *                   NPC, while the DTU still records its NPC origin.
 *   actorKind     — 'player' (default) or 'npc'. NPCs author DTUs through
 *                   the same path — the only difference is the
 *                   meta.author_kind tag and the optional npcId / mentorId
 *                   pair used for downstream attribution.
 *   npcId         — when actorKind='npc', the originating NPC's id.
 *   mentorId      — when actorKind='npc', the player who taught the NPC.
 *                   Defaults to userId since NPCs route their royalties
 *                   through their mentor by convention.
 *   templateId    — Forge template the app was generated from (parent
 *                   for royalty cascade citation)
 *   appName       — human title
 *   sourceCode    — the actual generated single-file source
 *   manifest      — Forge manifest used (sections, language, framework)
 *   summary       — optional short prose for marketplace listings
 *
 * Returns: { ok, dtuId, citationId? }
 */
export async function mintForgeAppAsDtu(db, opts) {
  if (!db) return { ok: false, reason: "no_db" };
  const {
    userId, templateId, appName, sourceCode, manifest, summary,
    actorKind, npcId, mentorId,
  } = opts || {};
  if (!userId || !appName || !sourceCode) return { ok: false, reason: "missing_inputs" };

  const author_kind = actorKind === "npc" ? "npc" : "player";
  const dtuId = `forge:${userId}:${crypto.randomUUID().slice(0, 8)}`;
  const meta = {
    author_kind,
    skill_kind: "forge_app",
    forge_template_id: templateId || null,
    forge_manifest: manifest || null,
    summary: summary || null,
    source_size: sourceCode.length,
    source_sha1: crypto.createHash("sha1").update(String(sourceCode)).digest("hex").slice(0, 16),
    // NPC-authored attribution. The NPC id is the in-world actor; the
    // mentor id (defaulted to the wallet owner when omitted) is the
    // player whose teaching produced the NPC's skill, and who therefore
    // earns royalty cascade payouts through this DTU's lineage.
    ...(author_kind === "npc" ? {
      npc_id: npcId || null,
      mentor_id: mentorId || userId,
    } : {}),
  };

  let inserted = false;
  try {
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
      VALUES (?, 'forge_app', ?, ?, ?, 1, 0, unixepoch())
    `).run(dtuId, appName, userId, JSON.stringify(meta));
    inserted = true;
  } catch (err) {
    try { logger.warn?.("forge-marketplace", "dtu_insert_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { ok: false, reason: "dtu_insert_failed", error: err?.message };
  }

  // Optional artifact write — if there's an artifact path table, we
  // record the source code there; otherwise skip (the SHA in meta is
  // enough for content-addressable lookup).
  // We deliberately don't write the source body to disk in this module
  // to keep it pure / tested without filesystem.

  // Royalty cascade: if a templateId was provided, register the citation
  // so future sales of THIS app pay back to the template author.
  let citationId = null;
  if (templateId) {
    try {
      const royalty = await import("../economy/royalty-cascade.js");
      // Best-effort: parent meta + creator must exist, but we don't gate
      // a missing parent (some Forge templates may be system-owned).
      const parent = db.prepare(`SELECT id, creator_id, data AS meta_json FROM dtus WHERE id = ?`).get(templateId);
      if (parent && royalty?.registerCitation) {
        const r = royalty.registerCitation(db, {
          childId: dtuId,
          parentId: templateId,
          creatorId: userId,
          parentCreatorId: parent.creator_id,
          parentDtu: { ...parent, visibility: "public" },
          generation: 1,
        });
        if (r?.ok) citationId = r.citationId || r.id || null;
      }
    } catch { /* royalty-cascade tables optional */ }
  }

  return { ok: inserted ? true : false, dtuId, citationId };
}

/**
 * List a forge_app DTU on the marketplace at a user-set price.
 *
 * Fixed (2026-07 grounding-audit continuation). This used to write into
 * `creative_artifact_listings` (a "v2 schema" that, it turns out, NO
 * migration anywhere in the repo ever creates — `scripts/audit/gates/
 * schema-drift.mjs` has a standing honest-suppression comment for exactly
 * this table) with a fallback to `marketplace_listings` (a real table with
 * real readers — `server/durable.js`, `server/guidance.js` — but no
 * purchase flow anywhere in the app). Either branch produced a "listing"
 * nobody could ever buy: Phase 6a's "forge apps can be listed on the
 * marketplace" claim was functionally hollow. This now lists through the
 * REAL, purchasable `marketplace.list` macro (server.js) — the same
 * `dtu.marketplace` + `purchaseWithRoyalties` system (95%-creator /
 * 5%-platform royalty cascade) the Creator lens's own Listings tab uses.
 * `mintForgeAppAsDtu`'s raw `INSERT INTO dtus` row is made resolvable to
 * that macro by `resolveMarketplaceDtu`'s SQL-shadow hydration
 * (`server/lib/dtu-shadow-hydrate.js`) — a sibling fix, already landed —
 * so no change was needed on the mint side, only here. Pattern mirrors
 * `server/lib/asset-gen/asset-marketplace.js#listGeneratedAssetOnMarketplace`.
 *
 * Signature change from the old `(db, opts)`: `marketplace.list` is a
 * macro, not a raw table, so this now takes a macro `ctx` (with a live
 * `ctx.macro.run`) instead of a bare `db` handle. The listing's SELLER is
 * whichever user `ctx.actor.userId` resolves to — `marketplace.list`'s own
 * ownership gate requires it to match the DTU's `ownerId`/`creator_id`, so
 * callers must pass the SAME ctx their own actor is authenticated under
 * (an explicit `opts.sellerId` can no longer override this — the old
 * signature accepted one, but `marketplace.list` never read it either).
 *
 * @param {object} ctx    a macro ctx with a live `ctx.macro.run` (e.g. the
 *   ctx any `register()`/`registerLensAction()` handler receives, or
 *   `makeInternalCtx(...)` for internal/system callers).
 * @param {object} opts
 * @param {string} opts.dtuId          id returned by `mintForgeAppAsDtu`
 * @param {number} [opts.price]        listing price in CC/USD units — the
 *   same units `marketplace.list` expects elsewhere (NOT cents).
 * @param {number} [opts.priceCents]   legacy cents-denominated price, kept
 *   for the existing frontend dialog (`PublishForgeAppDialog.tsx`) that
 *   still sends cents; converted to `price` (÷100) when `opts.price` is
 *   absent. Prefer `opts.price` in new callers.
 * @param {string} [opts.currency="USD"]
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {string[]} [opts.tags]
 * @returns {Promise<{ok:boolean, listingId?:string, dtuId?:string,
 *   listing?:object, reason?:string}>}
 */
export async function listForgeAppOnMarketplace(ctx, opts) {
  if (!ctx?.macro?.run) return { ok: false, reason: "no_macro_runtime" };
  const { dtuId, price, priceCents, currency = "USD", title, description, tags } = opts || {};
  if (!dtuId) return { ok: false, reason: "missing_inputs" };

  const numPrice = price != null ? Number(price) : Number(priceCents || 0) / 100;
  if (!Number.isFinite(numPrice) || numPrice < 0) return { ok: false, reason: "missing_inputs" };

  const listed = await ctx.macro.run("marketplace", "list", {
    dtuId,
    price: numPrice,
    currency,
    contentType: "forge_app",
    title,
    description,
    tags,
  });

  if (!listed?.ok) {
    return { ok: false, reason: listed?.error || listed?.reason || "listing_failed" };
  }
  return { ok: true, listingId: dtuId, dtuId, listing: listed.listing };
}

/**
 * Read a user's forge apps.
 */
export function listForgeAppsForUser(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, title, data AS meta_json, created_at FROM dtus
      WHERE type = 'forge_app' AND creator_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}
