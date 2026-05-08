// server/emergent/npc-marketplace-cycle.js
//
// Phase 1.5 heartbeat — NPCs participate in the recipe marketplace.
//
// Frequency: 240 ticks (~60 min). Two passes per tick:
//   1. List eligible NPC recipes for sale.
//   2. Have surplus-wealth NPCs buy archetype-complementary recipes from
//      different factions.
//
// Kill-switch: CONCORD_KNOWLEDGE_TRADE=0.
//
// Returns { ok, listed, purchased, reason? } never throws.

import logger from "../logger.js";
import { listNpcRecipesPass, intraNpcPurchasePass } from "../lib/npc-marketplace.js";

export async function runNpcMarketplaceCycle({ db, state: _state, tickCount: _tickCount } = {}) {
  if (process.env.CONCORD_KNOWLEDGE_TRADE === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let listResult = { listed: 0 };
  let purchaseResult = { purchased: 0 };

  try {
    listResult = listNpcRecipesPass(db);
  } catch (err) {
    try { logger.warn?.("npc-marketplace-cycle", "list_pass_failed", { error: err?.message }); }
    catch { /* ignore */ }
  }

  try {
    purchaseResult = intraNpcPurchasePass(db);
  } catch (err) {
    try { logger.warn?.("npc-marketplace-cycle", "purchase_pass_failed", { error: err?.message }); }
    catch { /* ignore */ }
  }

  return {
    ok: true,
    listed: listResult.listed || 0,
    purchased: purchaseResult.purchased || 0,
  };
}
