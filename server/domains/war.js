// server/domains/war.js
//
// Player-facing surface for the war-in-3D mechanic. The HUD calls
// these macros to declare wars, rally troops, pay ransoms, sue for
// peace, and read campaign state.
//
// Read-only macros:
//   war.active             — list active campaigns in a world
//   war.get_campaign       — full state of one campaign
//   war.my_campaigns       — campaigns the calling player is in
//
// Write macros:
//   war.declare            — open a new campaign
//   war.rally              — player joins a side
//   war.pay_ransom         — release a kidnapped NPC
//   war.rescue             — release without payment (requires presence)
//   war.seek_truce         — end the campaign (either ruler can call)

import {
  declareWar,
  rallyTroop,
  payRansom,
  rescueKidnap,
  seekTruce,
  listActiveCampaigns,
  getCampaign,
} from "../lib/war-campaign.js";

export default function registerWarMacros(register) {
  register("war", "active", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, campaigns: listActiveCampaigns(db, input?.worldId || null) };
  }, { note: "List active war campaigns. Filter by worldId for the HUD." });

  register("war", "get_campaign", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input?.campaignId) return { ok: false, reason: "missing_campaign_id" };
    const c = getCampaign(db, input.campaignId);
    if (!c) return { ok: false, reason: "not_found" };
    return { ok: true, campaign: c };
  }, { note: "Full campaign state — troops, recent skirmishes, active kidnaps." });

  register("war", "my_campaigns", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const rows = db.prepare(`
      SELECT c.* FROM war_campaigns c
      JOIN war_troops t ON t.campaign_id = c.id
      WHERE t.participant_kind = 'player' AND t.participant_id = ?
        AND c.resolved_at IS NULL
      GROUP BY c.id ORDER BY c.declared_at DESC
    `).all(userId);
    return { ok: true, campaigns: rows, count: rows.length };
  }, { note: "Campaigns the calling player is rallied to." });

  register("war", "declare", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    // Only the ruler of the attacking realm may declare. Gate it here.
    const att = db.prepare(`
      SELECT ruler_kind, ruler_id, world_id FROM realms WHERE id = ?
    `).get(input?.attackerRealmId);
    if (!att) return { ok: false, reason: "attacker_not_found" };
    if (att.ruler_kind !== "player" || att.ruler_id !== userId) {
      return { ok: false, reason: "not_ruler_of_attacker" };
    }
    return declareWar(db, { ...input, declaredBy: userId });
  }, { note: "Declare war. Only the attacker's ruler can call." });

  register("war", "rally", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const side = input?.side;
    if (!side) return { ok: false, reason: "missing_side" };
    return rallyTroop(db, {
      campaignId: input.campaignId,
      participantKind: "player",
      participantId: userId,
      side,
      role: input.role || "soldier",
    });
  }, { note: "Player rallies to a side of an active campaign." });

  register("war", "pay_ransom", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!input?.kidnapId) return { ok: false, reason: "missing_kidnap_id" };
    // Caller's wallet debit is a separate concern — payRansom just
    // flips the release flag. Future: wire through wallet.debit here.
    return payRansom(db, input.kidnapId, userId);
  }, { note: "Pay ransom to release a kidnapped NPC." });

  register("war", "rescue", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!input?.kidnapId) return { ok: false, reason: "missing_kidnap_id" };
    return rescueKidnap(db, input.kidnapId, userId);
  }, { note: "Rescue a kidnapped NPC without payment. Caller must be present at hold_at." });

  register("war", "seek_truce", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!input?.campaignId) return { ok: false, reason: "missing_campaign_id" };
    // Either ruler can sue for peace.
    const camp = db.prepare(`
      SELECT a.ruler_id AS att_ruler, d.ruler_id AS def_ruler, c.* FROM war_campaigns c
      JOIN realms a ON a.id = c.attacker_realm_id
      JOIN realms d ON d.id = c.defender_realm_id
      WHERE c.id = ?
    `).get(input.campaignId);
    if (!camp) return { ok: false, reason: "not_found" };
    if (camp.att_ruler !== userId && camp.def_ruler !== userId) {
      return { ok: false, reason: "not_a_ruler_in_this_war" };
    }
    return seekTruce(db, input.campaignId);
  }, { note: "Sue for peace. Either ruler can call. Releases all kidnaps." });
}
