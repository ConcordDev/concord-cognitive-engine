// @sql-loop-ok: per-buyer transactional purchase loop is order-dependent
// (each purchase mutates buyer wealth that subsequent iterations read).
// Bounded at MAX_PURCHASES_PER_PASS=15 per heartbeat tick.
// server/lib/npc-marketplace.js
//
// Phase 4b note: imports priceModulator from npc-economy. No cycle —
// npc-economy doesn't import this module.
//
// Phase 1.5 — NPCs participate in the recipe marketplace as both sellers
// and buyers. The world feels alive because the marketplace listings
// aren't only player-authored: any NPC at level ≥ 25 with at least 3
// revisions on a recipe can list a snapshot of that recipe at a
// deterministic price. NPCs with surplus wealth_sparks buy
// archetype-complementary recipes from other factions.
//
// Royalty cascade applies — purchases of NPC-authored recipes pay the
// NPC's faction treasury (the existing economy/royalty-cascade.js path
// resolves creator_id → wealth_sparks update on the NPC row).
//
// Heartbeat: npc-marketplace-cycle (frequency 240, ~60 min). Per pass:
//   1. Find NPCs with sellable recipes (≥25 lvl, ≥3 revisions, no current
//      listing). List one variant at a tiered price.
//   2. Find NPCs with surplus wealth (> SELL_LISTING_PRICE_FLOOR × 5) and
//      acquire one recipe from a different faction's NPC if it
//      complements their archetype.

import crypto from "node:crypto";
import logger from "../logger.js";
import { priceModulator as _priceModulator } from "./npc-economy.js";

const MIN_NPC_LEVEL_FOR_LISTING = 25;
const MIN_REVISIONS_FOR_LISTING = 3;
const SELL_LISTING_PRICE_FLOOR = 50;     // sparks
const PRICE_PER_REVISION_MULT = 1.10;
const MAX_LISTINGS_PER_PASS = 30;
const MAX_PURCHASES_PER_PASS = 15;

// Maps archetype → preferred skill_kind to acquire from another faction.
// NPCs only buy what complements their fighting style — a warrior might
// pick up a mystic's spell to round out their kit, but won't buy a tech
// gadget recipe.
const ARCHETYPE_BUY_PREFERENCE = {
  warrior:        ["spell",          "biopower"],
  guard:          ["fighting_style", "spell"],
  scholar:        ["psionic",        "biopower"],
  mystic:         ["spell",          "biopower"],
  healer:         ["spell",          "biopower"],
  hunter:         ["fighting_style", "biopower"],
  trader:         ["fighting_style"],
  refusal_keeper: ["psionic",        "spell"],
  cyber:          ["cyber_ability",  "tech_gadget"],
};

// ── Sellable NPC recipes ────────────────────────────────────────────────────

function findSellableRecipes(db) {
  // Recipes owned by NPCs that meet the listing criteria AND don't already
  // have a current marketplace listing tied to them.
  // The marketplace listings table is the existing creative_artifact_listings
  // shape — we don't introduce a new listing schema; we just push more rows.
  return db.prepare(`
    SELECT d.id AS recipe_id, d.creator_id AS npc_id, d.title, d.skill_level,
           d.data AS meta_json, n.archetype, n.faction, n.level AS npc_level,
           n.wealth_sparks
    FROM dtus d
    JOIN world_npcs n ON n.id = d.creator_id
    WHERE d.type IN ('skill', 'spell_recipe', 'fighting_style_recipe', 'recipe')
      AND d.data LIKE '%"author_kind":"npc"%'
      AND COALESCE(n.is_dead, 0) = 0
      AND COALESCE(n.level, 1) >= ?
    LIMIT ?
  `).all(MIN_NPC_LEVEL_FOR_LISTING, MAX_LISTINGS_PER_PASS * 4);
}

function recipeRevisionNum(metaJson) {
  try { return Number(JSON.parse(metaJson || "{}").revision_num) || 0; } catch { return 0; }
}

function priceForRecipe(revisionNum) {
  return Math.round(SELL_LISTING_PRICE_FLOOR * Math.pow(PRICE_PER_REVISION_MULT, revisionNum));
}

// Phase 4b — NPC marketplace listings honor regional scarcity. The
// resourceKind hint comes from the recipe's element/skill_kind via a
// loose mapping (warriors' weapons couple to 'weapon' scarcity, mystics'
// remedies to 'remedy', etc.). Best-effort; defaults to 1.0× if scarcity
// is unavailable.
function priceForRecipeWithScarcity(db, worldId, revisionNum, recipeMeta) {
  const base = priceForRecipe(revisionNum);
  if (!db || !worldId) return base;
  try {
    const resourceHint = recipeResourceHint(recipeMeta);
    if (!resourceHint) return base;
    const mod = _priceModulator(db, worldId, resourceHint);
    return Math.round(base * mod);
  } catch { return base; }
}

function recipeResourceHint(meta) {
  if (!meta) return null;
  const kind = String(meta.skill_kind || "").toLowerCase();
  const element = String(meta.element || "").toLowerCase();
  if (kind === "fighting_style") return "weapon";
  if (kind === "spell" && (element === "bio" || element === "water")) return "remedy";
  if (kind === "spell") return "weapon";
  if (kind === "psionic") return "tool";
  if (kind === "biopower") return "remedy";
  return null;
}

function ensureMarketplaceListing(db, recipeId, npcId, price) {
  // We INSERT into marketplace_listings IF that table exists. On minimal
  // builds we fall back to a creative_artifact_listings row. Both paths
  // are best-effort — the cycle never crashes if neither table exists.
  try {
    const exists = db.prepare(`
      SELECT id FROM marketplace_listings
      WHERE artifact_id = ? AND status = 'active'
      LIMIT 1
    `).get(recipeId);
    if (exists) return { ok: true, action: "already_listed", id: exists.id };
    const listingId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO marketplace_listings (id, artifact_id, seller_id, price, status, listed_at)
      VALUES (?, ?, ?, ?, 'active', unixepoch())
    `).run(listingId, recipeId, npcId, price);
    return { ok: true, action: "listed", id: listingId, price };
  } catch (_e) {
    // Schema may differ; try the alternate shape.
    try {
      const listingId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO creative_artifact_listings (id, artifact_id, seller_id, price, currency, status, listed_at)
        VALUES (?, ?, ?, ?, 'sparks', 'active', unixepoch())
      `).run(listingId, recipeId, npcId, price);
      return { ok: true, action: "listed_alt", id: listingId, price };
    } catch (_e2) { return { ok: false, reason: "no_marketplace_schema" }; }
  }
}

export function listNpcRecipesPass(db) {
  const candidates = findSellableRecipes(db);
  const listed = [];
  for (const r of candidates) {
    if (listed.length >= MAX_LISTINGS_PER_PASS) break;
    const revisionNum = recipeRevisionNum(r.meta_json);
    if (revisionNum < MIN_REVISIONS_FOR_LISTING) continue;
    const price = priceForRecipe(revisionNum);
    const result = ensureMarketplaceListing(db, r.recipe_id, r.npc_id, price);
    if (result.ok && result.action !== "already_listed") {
      listed.push({ recipeId: r.recipe_id, npcId: r.npc_id, price, revisionNum });
    }
  }
  return { ok: true, listed: listed.length, samples: listed.slice(0, 5) };
}

// ── Intra-NPC purchases ─────────────────────────────────────────────────────

function findEligibleBuyers(db) {
  return db.prepare(`
    SELECT id, archetype, faction, level, wealth_sparks
    FROM world_npcs
    WHERE COALESCE(is_dead, 0) = 0
      AND COALESCE(level, 1) >= ?
      AND COALESCE(wealth_sparks, 0) > ?
    ORDER BY wealth_sparks DESC
    LIMIT ?
  `).all(MIN_NPC_LEVEL_FOR_LISTING, SELL_LISTING_PRICE_FLOOR * 5, MAX_PURCHASES_PER_PASS * 4);
}

function findPurchaseCandidate(db, buyer) {
  const prefs = ARCHETYPE_BUY_PREFERENCE[String(buyer.archetype || "").toLowerCase()];
  if (!prefs || prefs.length === 0) return null;

  // Find a recipe from a DIFFERENT faction whose meta.skill_kind is in prefs,
  // priced at most buyer.wealth_sparks / 4.
  const budget = Math.floor((buyer.wealth_sparks || 0) / 4);
  const placeholders = prefs.map(() => "?").join(",");
  const candidates = db.prepare(`
    SELECT d.id AS recipe_id, d.creator_id AS seller_id, d.data AS meta_json,
           n.faction AS seller_faction
    FROM dtus d
    JOIN world_npcs n ON n.id = d.creator_id
    WHERE d.creator_id != ?
      AND COALESCE(n.faction, '') != COALESCE(?, '')
      AND d.data LIKE '%"author_kind":"npc"%'
      AND d.kind IN ('skill', 'spell_recipe', 'fighting_style_recipe', 'recipe')
    LIMIT 50
  `).all(buyer.id, buyer.faction);

  for (const c of candidates) {
    let meta = {};
    try { meta = JSON.parse(c.meta_json || "{}"); } catch { continue; }
    if (!prefs.includes(meta.skill_kind)) continue;
    const revisionNum = Number(meta.revision_num) || 0;
    const price = priceForRecipe(revisionNum);
    if (price > budget) continue;
    return { recipeId: c.recipe_id, sellerNpcId: c.seller_id, price };
  }
  return null;
}

export function intraNpcPurchasePass(db) {
  const buyers = findEligibleBuyers(db);
  const purchased = [];
  for (const buyer of buyers) {
    if (purchased.length >= MAX_PURCHASES_PER_PASS) break;
    const candidate = findPurchaseCandidate(db, buyer);
    if (!candidate) continue;

    const tx = db.transaction(() => {
      // Deduct from buyer's wealth, credit the seller.
      const buyerRow = db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id = ?`).get(buyer.id);
      if (!buyerRow || (buyerRow.wealth_sparks || 0) < candidate.price) return false;

      db.prepare(`UPDATE world_npcs SET wealth_sparks = wealth_sparks - ? WHERE id = ?`)
        .run(candidate.price, buyer.id);
      db.prepare(`UPDATE world_npcs SET wealth_sparks = wealth_sparks + ? WHERE id = ?`)
        .run(candidate.price, candidate.sellerNpcId);

      db.prepare(`
        INSERT INTO npc_skill_acquisitions (id, buyer_npc_id, seller_npc_id, recipe_dtu_id, price, acquired_at)
        VALUES (?, ?, ?, ?, ?, unixepoch())
      `).run(crypto.randomUUID(), buyer.id, candidate.sellerNpcId, candidate.recipeId, candidate.price);

      return true;
    });

    let didPurchase = false;
    try { didPurchase = tx() === true; }
    catch (err) { try { logger.debug?.("npc-marketplace", "purchase_failed", { error: err?.message }); } catch { /* ignore */ } }
    if (didPurchase) purchased.push({ buyer: buyer.id, ...candidate });
  }
  return { ok: true, purchased: purchased.length, samples: purchased.slice(0, 5) };
}

export const _internal = {
  MIN_NPC_LEVEL_FOR_LISTING,
  MIN_REVISIONS_FOR_LISTING,
  SELL_LISTING_PRICE_FLOOR,
  PRICE_PER_REVISION_MULT,
  ARCHETYPE_BUY_PREFERENCE,
  recipeRevisionNum,
  priceForRecipe,
};
