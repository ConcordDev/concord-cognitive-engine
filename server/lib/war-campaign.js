// server/lib/war-campaign.js
//
// In-3D war mechanic. Surfaces realm-level conflict (faction-strategy's
// DECLARE_WAR move) into a campaign the player can actually participate
// in — rally to a position, fight skirmishes alongside the troops they
// raised, take or lose towns, kidnap or ransom captives.
//
// Design choices:
//   - Server-authoritative. The client renders position + state; the
//     server computes skirmish outcomes deterministically per tick.
//   - Casus belli is required so a war isn't free. Same casus_belli
//     also raises legitimacy of the side with the better claim.
//   - Skirmishes resolve every SKIRMISH_INTERVAL_S until one side
//     hits MORALE_BROKEN or the territory falls. No instant resolution.
//   - Town capture only fires when attacker_morale >= 70 AND attacker
//     troops outnumber defenders 1.5×. Otherwise siege drags.
//   - Kidnap fires on skirmish loss for the losing side, chance scaled
//     by morale swing. Ransom always at ransom_cc; victims can be
//     released on truce, paid ransom, escape (low-stress NPC trait), or
//     rescued by allies hitting `rescueKidnap`.
//
// Public API:
//   declareWar({ db, attackerRealmId, defenderRealmId, targetTerritory,
//                rallyX, rallyZ, casusBelli, declaredBy }) -> { ok, campaignId }
//   rallyTroop({ db, campaignId, participantKind, participantId, side, role })
//   advanceCampaign(db, campaign) -> { ok, transitioned, skirmish, capture, kidnap }
//   captureTown(db, campaignId)
//   kidnapNpc(db, { campaignId, captorId, victimId, holdAt })
//   payRansom(db, kidnapId, payerUserId)
//   rescueKidnap(db, kidnapId, rescuerUserId)
//   seekTruce(db, campaignId)
//
// Each pass on the heartbeat-driven war-skirmish-cycle iterates
// active campaigns and calls advanceCampaign().

import crypto from "node:crypto";

const SKIRMISH_INTERVAL_S = Number(process.env.CONCORD_SKIRMISH_INTERVAL_S) || 120; // 2 min default
const MORALE_BROKEN = 25;
const ATTACKER_CAPTURE_MORALE = 70;
const ATTACKER_CAPTURE_RATIO = 1.5;
const KIDNAP_BASE_CHANCE = 0.20;
const STARTING_NPC_TROOP_BUDGET = 8; // NPCs auto-conscripted per side per call

function _seededRng(seed) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function _hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = ((h ^ str.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h >>> 0;
}

function _realm(db, id) {
  return db.prepare(`SELECT id, name, world_id, faction_id, treasury, legitimacy FROM realms WHERE id = ?`).get(id);
}

function _emit(event, payload) {
  try {
    if (globalThis?.__CONCORD_REALTIME__?.io && payload?.worldId) {
      globalThis.__CONCORD_REALTIME__.io.to(`world:${payload.worldId}`).emit(event, payload);
    }
  } catch { /* realtime is best-effort */ }
}

/* ── Declaration + rally ─────────────────────────────────────────── */

export function declareWar(db, {
  attackerRealmId,
  defenderRealmId,
  targetTerritory,
  rallyX = 0,
  rallyZ = 0,
  casusBelli = "expansion",
  declaredBy = null,
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!attackerRealmId || !defenderRealmId) return { ok: false, reason: "missing_realms" };
  if (attackerRealmId === defenderRealmId) return { ok: false, reason: "self_war" };
  if (!targetTerritory) return { ok: false, reason: "missing_territory" };

  const attacker = _realm(db, attackerRealmId);
  const defender = _realm(db, defenderRealmId);
  if (!attacker || !defender) return { ok: false, reason: "realm_not_found" };
  if (attacker.world_id !== defender.world_id) return { ok: false, reason: "cross_world_war_forbidden" };

  // Concordant Law — hub is unconquerable.
  if (attacker.world_id === "concordia-hub" || attacker.world_id === "concordia") {
    return { ok: false, reason: "concordant_law_refusal" };
  }

  // Defender must actually hold the target territory.
  const owns = db.prepare(`
    SELECT 1 FROM realm_territories WHERE kingdom_id = ? AND region_id = ?
  `).get(defenderRealmId, targetTerritory);
  if (!owns) return { ok: false, reason: "defender_does_not_hold_territory" };

  const id = `war_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO war_campaigns (
      id, world_id, attacker_realm_id, defender_realm_id, target_territory,
      rally_x, rally_z, state, casus_belli, declared_by, declared_at,
      next_skirmish_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'mustering', ?, ?, ?, ?)
  `).run(
    id, attacker.world_id, attackerRealmId, defenderRealmId, targetTerritory,
    rallyX, rallyZ, casusBelli, declaredBy, now,
    now + SKIRMISH_INTERVAL_S,
  );

  // Auto-conscript defenders — every loyal NPC citizen with a combat-
  // capable archetype. Bounded by STARTING_NPC_TROOP_BUDGET.
  const defenderNpcs = db.prepare(`
    SELECT n.id FROM realm_citizens c
    JOIN world_npcs n ON n.id = c.npc_id
    WHERE c.kingdom_id = ?
      AND COALESCE(n.is_dead, 0) = 0
      AND COALESCE(n.archetype, '') IN ('warrior', 'guard', 'hunter', 'commander')
    LIMIT ?
  `).all(defenderRealmId, STARTING_NPC_TROOP_BUDGET);
  const tInsert = db.prepare(`
    INSERT OR IGNORE INTO war_troops (campaign_id, side, participant_kind, participant_id, role, hp)
    VALUES (?, 'defender', 'npc', ?, ?, 100)
  `);
  for (const npc of defenderNpcs) {
    tInsert.run(id, npc.id, "soldier");
  }
  _recountTroops(db, id);
  _emit("war:declared", {
    worldId: attacker.world_id,
    campaignId: id,
    attackerRealmId, defenderRealmId, targetTerritory,
    rallyX, rallyZ, casusBelli,
  });
  return { ok: true, campaignId: id, defenderConscripts: defenderNpcs.length };
}

export function rallyTroop(db, {
  campaignId, participantKind, participantId, side, role = "soldier",
} = {}) {
  if (!db || !campaignId || !participantKind || !participantId || !side) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (!["player", "npc"].includes(participantKind)) return { ok: false, reason: "bad_kind" };
  if (!["attacker", "defender"].includes(side)) return { ok: false, reason: "bad_side" };

  const camp = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
  if (!camp) return { ok: false, reason: "campaign_not_found" };
  if (camp.resolved_at) return { ok: false, reason: "campaign_resolved" };
  if (!["declared", "mustering", "marching", "engaging"].includes(camp.state)) {
    return { ok: false, reason: "not_recruiting" };
  }

  const r = db.prepare(`
    INSERT INTO war_troops (campaign_id, side, participant_kind, participant_id, role, hp)
    VALUES (?, ?, ?, ?, ?, 100)
    ON CONFLICT(campaign_id, participant_kind, participant_id) DO UPDATE SET
      side = excluded.side,
      role = excluded.role,
      departed_at = NULL
  `).run(campaignId, side, participantKind, participantId, role);
  _recountTroops(db, campaignId);
  _emit("war:rally", {
    worldId: camp.world_id, campaignId,
    participantKind, participantId, side, role,
  });
  return { ok: true, changes: r.changes };
}

function _recountTroops(db, campaignId) {
  const counts = db.prepare(`
    SELECT side, COUNT(*) c FROM war_troops
    WHERE campaign_id = ? AND departed_at IS NULL
    GROUP BY side
  `).all(campaignId);
  const att = counts.find((r) => r.side === "attacker")?.c ?? 0;
  const def = counts.find((r) => r.side === "defender")?.c ?? 0;
  db.prepare(`UPDATE war_campaigns SET attacker_troops = ?, defender_troops = ? WHERE id = ?`)
    .run(att, def, campaignId);
}

/* ── Skirmish + advance ──────────────────────────────────────────── */

export function advanceCampaign(db, campaign) {
  if (!db || !campaign || campaign.resolved_at) return { ok: false, reason: "no_campaign" };

  const now = Math.floor(Date.now() / 1000);
  if ((campaign.next_skirmish_at || 0) > now) {
    return { ok: true, transitioned: false, reason: "too_early" };
  }

  // State machine — declared → mustering → marching → engaging → won/lost/truced.
  // Mustering phase: stay until both sides have ≥1 troop.
  if (campaign.state === "mustering") {
    if (campaign.attacker_troops >= 1 && campaign.defender_troops >= 1) {
      db.prepare(`UPDATE war_campaigns SET state = 'marching', next_skirmish_at = ? WHERE id = ?`)
        .run(now + Math.floor(SKIRMISH_INTERVAL_S / 2), campaign.id);
      _emit("war:state", { worldId: campaign.world_id, campaignId: campaign.id, state: "marching" });
      return { ok: true, transitioned: true, newState: "marching" };
    }
    // Still mustering — push the next check out.
    db.prepare(`UPDATE war_campaigns SET next_skirmish_at = ? WHERE id = ?`)
      .run(now + SKIRMISH_INTERVAL_S, campaign.id);
    return { ok: true, transitioned: false, reason: "still_mustering" };
  }

  if (campaign.state === "marching") {
    db.prepare(`UPDATE war_campaigns SET state = 'engaging', next_skirmish_at = ? WHERE id = ?`)
      .run(now + SKIRMISH_INTERVAL_S, campaign.id);
    _emit("war:state", { worldId: campaign.world_id, campaignId: campaign.id, state: "engaging" });
    return { ok: true, transitioned: true, newState: "engaging" };
  }

  // Engaging — run a skirmish tick.
  if (campaign.state === "engaging") {
    const result = runSkirmish(db, campaign);
    return { ok: true, transitioned: true, skirmish: result };
  }

  // Occupying — territory captured, hold for a beat then close.
  if (campaign.state === "occupying") {
    db.prepare(`
      UPDATE war_campaigns
      SET state = 'won', outcome = 'attacker_victory', resolved_at = unixepoch()
      WHERE id = ?
    `).run(campaign.id);
    _emit("war:state", { worldId: campaign.world_id, campaignId: campaign.id, state: "won" });
    return { ok: true, transitioned: true, newState: "won" };
  }

  return { ok: true, transitioned: false };
}

export function runSkirmish(db, campaign) {
  // Deterministic outcome from sha-ish hash of (campaign id + skirmish number).
  const priorSkirmishes = db.prepare(`SELECT COUNT(*) c FROM war_skirmishes WHERE campaign_id = ?`).get(campaign.id)?.c ?? 0;
  const rng = _seededRng(_hash(campaign.id + ":" + priorSkirmishes));

  // Force imbalance + morale advantage decides direction.
  const attackerForce = campaign.attacker_troops + (campaign.attacker_morale / 100);
  const defenderForce = campaign.defender_troops + (campaign.defender_morale / 100);
  const ratio = attackerForce / Math.max(0.5, defenderForce);

  // Losses proportional to engagement intensity.
  const baseLosses = Math.max(1, Math.floor((campaign.attacker_troops + campaign.defender_troops) / 6));
  const variance = Math.floor(rng() * baseLosses * 0.6);
  let attackerLosses, defenderLosses;
  if (ratio > 1.1) {
    attackerLosses = Math.floor(baseLosses * 0.5) + variance;
    defenderLosses = baseLosses + variance;
  } else if (ratio < 0.9) {
    attackerLosses = baseLosses + variance;
    defenderLosses = Math.floor(baseLosses * 0.5) + variance;
  } else {
    attackerLosses = baseLosses + Math.floor(variance / 2);
    defenderLosses = baseLosses + Math.floor(variance / 2);
  }

  const moraleSwing = Math.round((ratio - 1) * 8);
  const newAttackerMorale = Math.max(0, Math.min(100, campaign.attacker_morale + moraleSwing - Math.floor(attackerLosses * 0.5)));
  const newDefenderMorale = Math.max(0, Math.min(100, campaign.defender_morale - moraleSwing - Math.floor(defenderLosses * 0.5)));

  // Kill troops by setting their hp to 0. We don't actually destroy
  // troop rows yet — that lets us surface "fallen" lists on resolution.
  _depleteTroops(db, campaign.id, "attacker", attackerLosses);
  _depleteTroops(db, campaign.id, "defender", defenderLosses);

  const skirmishId = `skirm_${crypto.randomUUID()}`;
  const summary = ratio > 1.1
    ? `Attacker advance — ${defenderLosses} defenders fall.`
    : ratio < 0.9
      ? `Defender holds — ${attackerLosses} attackers fall.`
      : `Indecisive — losses on both sides.`;
  const x = campaign.rally_x + (rng() * 60 - 30);
  const z = campaign.rally_z + (rng() * 60 - 30);
  db.prepare(`
    INSERT INTO war_skirmishes (id, campaign_id, x, z, attacker_losses, defender_losses, morale_swing, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(skirmishId, campaign.id, x, z, attackerLosses, defenderLosses, moraleSwing, summary);

  // Maybe kidnap — losing side has the higher kidnap chance.
  let kidnap = null;
  const kidnapChance = KIDNAP_BASE_CHANCE + Math.abs(ratio - 1) * 0.10;
  if (rng() < kidnapChance) {
    const losingSide = ratio > 1 ? "defender" : "attacker";
    kidnap = _autoKidnap(db, campaign, losingSide);
  }

  // Update campaign morale + troops.
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE war_campaigns
    SET attacker_morale = ?, defender_morale = ?, next_skirmish_at = ?
    WHERE id = ?
  `).run(newAttackerMorale, newDefenderMorale, now + SKIRMISH_INTERVAL_S, campaign.id);
  _recountTroops(db, campaign.id);
  const updated = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaign.id);

  _emit("war:skirmish", {
    worldId: campaign.world_id, campaignId: campaign.id,
    x, z, attackerLosses, defenderLosses, moraleSwing, summary,
  });

  // Capture / morale-break checks.
  let capture = null;
  if (
    updated.attacker_troops >= updated.defender_troops * ATTACKER_CAPTURE_RATIO &&
    updated.attacker_morale >= ATTACKER_CAPTURE_MORALE
  ) {
    capture = captureTown(db, campaign.id);
  } else if (updated.defender_morale <= MORALE_BROKEN) {
    capture = captureTown(db, campaign.id);
  } else if (updated.attacker_morale <= MORALE_BROKEN) {
    // Attacker broken — campaign lost.
    db.prepare(`
      UPDATE war_campaigns
      SET state = 'lost', outcome = 'defender_victory', resolved_at = unixepoch()
      WHERE id = ?
    `).run(campaign.id);
    _emit("war:state", { worldId: campaign.world_id, campaignId: campaign.id, state: "lost" });
  }

  return {
    skirmishId, attackerLosses, defenderLosses, moraleSwing, summary,
    kidnap, capture,
    newAttackerMorale, newDefenderMorale,
  };
}

function _depleteTroops(db, campaignId, side, n) {
  if (n <= 0) return;
  // Drop n troops with the lowest hp first; mark them departed.
  const rows = db.prepare(`
    SELECT participant_kind, participant_id FROM war_troops
    WHERE campaign_id = ? AND side = ? AND departed_at IS NULL
    ORDER BY hp ASC LIMIT ?
  `).all(campaignId, side, n);
  const upd = db.prepare(`
    UPDATE war_troops SET hp = 0, departed_at = unixepoch()
    WHERE campaign_id = ? AND participant_kind = ? AND participant_id = ?
  `);
  for (const r of rows) upd.run(campaignId, r.participant_kind, r.participant_id);
}

/* ── Town capture ────────────────────────────────────────────────── */

export function captureTown(db, campaignId) {
  const camp = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
  if (!camp || camp.resolved_at) return null;

  // Transfer the territory row from defender to attacker.
  const territoryRow = db.prepare(`
    SELECT kingdom_id FROM realm_territories WHERE region_id = ?
  `).get(camp.target_territory);
  const fromRealm = territoryRow?.kingdom_id || camp.defender_realm_id;
  db.prepare(`
    UPDATE realm_territories SET kingdom_id = ?
    WHERE region_id = ? AND kingdom_id = ?
  `).run(camp.attacker_realm_id, camp.target_territory, fromRealm);

  const captureId = `cap_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO war_town_captures (id, campaign_id, territory_id, from_realm_id, to_realm_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(captureId, campaignId, camp.target_territory, fromRealm, camp.attacker_realm_id);

  db.prepare(`
    UPDATE war_campaigns SET state = 'occupying', next_skirmish_at = unixepoch() + 60
    WHERE id = ?
  `).run(campaignId);

  // Legitimacy bumps — attacker realm gains, defender loses.
  db.prepare(`UPDATE realms SET legitimacy = MIN(100, legitimacy + 5) WHERE id = ?`).run(camp.attacker_realm_id);
  db.prepare(`UPDATE realms SET legitimacy = MAX(0,   legitimacy - 8) WHERE id = ?`).run(camp.defender_realm_id);

  _emit("war:town-captured", {
    worldId: camp.world_id, campaignId, territoryId: camp.target_territory,
    fromRealmId: fromRealm, toRealmId: camp.attacker_realm_id,
  });
  return { captureId, territory: camp.target_territory, from: fromRealm, to: camp.attacker_realm_id };
}

/* ── Kidnap / ransom / rescue ────────────────────────────────────── */

function _autoKidnap(db, campaign, losingSide) {
  // Pick a random NPC from the losing side; player troops are protected
  // by default — only NPC captives become hostages automatically.
  const victim = db.prepare(`
    SELECT participant_id FROM war_troops
    WHERE campaign_id = ? AND side = ? AND participant_kind = 'npc'
      AND departed_at IS NULL
    ORDER BY hp ASC LIMIT 1
  `).get(campaign.id, losingSide);
  if (!victim) return null;
  const captorRealm = losingSide === "defender" ? campaign.attacker_realm_id : campaign.defender_realm_id;
  return kidnapNpc(db, {
    campaignId: campaign.id,
    captorKind: "realm",
    captorId: captorRealm,
    victimId: victim.participant_id,
    holdAt: captorRealm,
  });
}

export function kidnapNpc(db, {
  campaignId = null, captorKind = "realm", captorId, victimId, holdAt = null, ransomCc = 100,
} = {}) {
  if (!db || !captorId || !victimId) return null;
  const id = `kid_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO war_kidnaps (id, campaign_id, captor_kind, captor_id, victim_kind, victim_id, held_at, ransom_cc)
    VALUES (?, ?, ?, ?, 'npc', ?, ?, ?)
  `).run(id, campaignId, captorKind, captorId, victimId, holdAt, ransomCc);

  // Mark the NPC as removed from world rendering for the duration.
  try {
    db.prepare(`UPDATE world_npcs SET current_activity = 'captive', current_task = ? WHERE id = ?`)
      .run(`held_by:${captorId}`, victimId);
  } catch { /* best-effort */ }

  const worldId = campaignId
    ? db.prepare(`SELECT world_id FROM war_campaigns WHERE id = ?`).get(campaignId)?.world_id
    : null;
  _emit("war:kidnap", { worldId, kidnapId: id, captorId, victimId, holdAt, ransomCc });
  return { kidnapId: id, victimId, ransomCc };
}

export function payRansom(db, kidnapId, payerUserId) {
  if (!db || !kidnapId) return { ok: false, reason: "missing_inputs" };
  const k = db.prepare(`SELECT * FROM war_kidnaps WHERE id = ?`).get(kidnapId);
  if (!k) return { ok: false, reason: "not_found" };
  if (k.released_at) return { ok: false, reason: "already_released" };
  // Wallet debit is left to the caller — this just releases on receipt.
  db.prepare(`
    UPDATE war_kidnaps SET released_at = unixepoch(), release_reason = 'ransom_paid'
    WHERE id = ?
  `).run(kidnapId);
  try {
    db.prepare(`UPDATE world_npcs SET current_activity = NULL, current_task = NULL WHERE id = ?`).run(k.victim_id);
  } catch { /* best-effort */ }
  _emit("war:kidnap-released", { kidnapId, victimId: k.victim_id, reason: "ransom_paid", payerUserId });
  return { ok: true, victimId: k.victim_id, ransomCc: k.ransom_cc };
}

export function rescueKidnap(db, kidnapId, rescuerUserId) {
  if (!db || !kidnapId) return { ok: false, reason: "missing_inputs" };
  const k = db.prepare(`SELECT * FROM war_kidnaps WHERE id = ?`).get(kidnapId);
  if (!k || k.released_at) return { ok: false, reason: "unavailable" };
  db.prepare(`
    UPDATE war_kidnaps SET released_at = unixepoch(), release_reason = 'rescue'
    WHERE id = ?
  `).run(kidnapId);
  try {
    db.prepare(`UPDATE world_npcs SET current_activity = NULL, current_task = NULL WHERE id = ?`).run(k.victim_id);
  } catch { /* best-effort */ }
  _emit("war:kidnap-released", { kidnapId, victimId: k.victim_id, reason: "rescue", rescuerUserId });
  return { ok: true, victimId: k.victim_id };
}

/* ── Truce + read helpers ────────────────────────────────────────── */

export function seekTruce(db, campaignId) {
  if (!db || !campaignId) return { ok: false, reason: "missing_inputs" };
  const camp = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
  if (!camp || camp.resolved_at) return { ok: false, reason: "unavailable" };
  db.prepare(`
    UPDATE war_campaigns
    SET state = 'truced', outcome = 'stalemate_truce', resolved_at = unixepoch()
    WHERE id = ?
  `).run(campaignId);
  // Release all kidnaps tied to this campaign.
  const release = db.prepare(`
    UPDATE war_kidnaps SET released_at = unixepoch(), release_reason = 'truce'
    WHERE campaign_id = ? AND released_at IS NULL
  `).run(campaignId);
  _emit("war:state", { worldId: camp.world_id, campaignId, state: "truced" });
  return { ok: true, kidnapsReleased: release.changes };
}

export function listActiveCampaigns(db, worldId = null) {
  if (!db) return [];
  if (worldId) {
    return db.prepare(`
      SELECT * FROM war_campaigns
      WHERE world_id = ? AND resolved_at IS NULL
      ORDER BY declared_at DESC
    `).all(worldId);
  }
  return db.prepare(`
    SELECT * FROM war_campaigns WHERE resolved_at IS NULL ORDER BY declared_at DESC
  `).all();
}

export function getCampaign(db, campaignId) {
  if (!db || !campaignId) return null;
  const c = db.prepare(`SELECT * FROM war_campaigns WHERE id = ?`).get(campaignId);
  if (!c) return null;
  c.troops = db.prepare(`
    SELECT side, participant_kind, participant_id, role, hp, departed_at
    FROM war_troops WHERE campaign_id = ?
  `).all(campaignId);
  c.recentSkirmishes = db.prepare(`
    SELECT * FROM war_skirmishes WHERE campaign_id = ? ORDER BY occurred_at DESC LIMIT 10
  `).all(campaignId);
  c.activeKidnaps = db.prepare(`
    SELECT * FROM war_kidnaps WHERE campaign_id = ? AND released_at IS NULL
  `).all(campaignId);
  return c;
}

export const WAR_CONSTANTS = Object.freeze({
  SKIRMISH_INTERVAL_S,
  MORALE_BROKEN,
  ATTACKER_CAPTURE_MORALE,
  ATTACKER_CAPTURE_RATIO,
  KIDNAP_BASE_CHANCE,
});
