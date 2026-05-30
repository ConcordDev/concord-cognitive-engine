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
 * List a forge_app DTU on the marketplace at a user-set price. Wraps
 * the existing creative_artifact_listings (or marketplace_listings)
 * insert; uses the schema variant that's present.
 */
export function listForgeAppOnMarketplace(db, opts) {
  if (!db) return { ok: false, reason: "no_db" };
  const { dtuId, sellerId, priceCents, currency = "USD", title, description } = opts || {};
  if (!dtuId || !sellerId || !(priceCents > 0)) return { ok: false, reason: "missing_inputs" };

  // Try the v2 schema (creative_artifact_listings).
  try {
    const id = `cal_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO creative_artifact_listings
        (id, artifact_id, seller_id, price, currency, status, listed_at)
      VALUES (?, ?, ?, ?, ?, 'active', unixepoch())
    `).run(id, dtuId, sellerId, priceCents, currency);
    return { ok: true, listingId: id, schema: "creative_artifact_listings" };
  } catch { /* try v1 */ }

  // Fall back to marketplace_listings (auth schema).
  try {
    const id = `ml_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO marketplace_listings
        (id, owner_user_id, title, description, price_cents, currency, visibility)
      VALUES (?, ?, ?, ?, ?, ?, 'published')
    `).run(id, sellerId, title || "Forge app", description || "", priceCents, currency);
    return { ok: true, listingId: id, schema: "marketplace_listings" };
  } catch (err) {
    return { ok: false, reason: "no_marketplace_schema", error: err?.message };
  }
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
