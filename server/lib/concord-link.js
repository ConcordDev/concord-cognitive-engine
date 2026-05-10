// server/lib/concord-link.js
// The Concord Link — runtime substrate for cross-world communication.
//
// Implements the user's spec:
//   - 7 message types (text, voice, data, dream, physical, broadcast, echo)
//   - Per-type cost calculation, scaled by source-and-dest-world distance
//   - Shadow Burn rate-limiting (overuse → temporary cooldown)
//   - Corruption rolls based on Veil stability + encryption level
//   - Emotional weight surfaces high-importance messages to The Enforcer
//   - Link Walker dispatch for physical message delivery
//
// Composes with the existing substrate:
//   - emitToUser (server.js helper from Phase 8) for realtime delivery to
//     the recipient if they're a player who's online
//   - Atlas DTU pipeline for sensitive messages requiring archival
//   - Cross-world skill effectiveness — sender's "shadow_reasoning" affinity
//     in their current world affects their cost + burn resistance

import crypto from "crypto";
import { getWorldMeta } from "./cross-world-effectiveness.js";
import { listAvailableWalkers, hireWalker } from "./concord-link-walkers.js";

// ── Cost matrix ─────────────────────────────────────────────────────────────

const BASE_COST = Object.freeze({
  text:      1,
  voice:     5,
  data:      10,
  dream:     2,
  echo:      8,
  physical:  100,   // Link Walker dispatch
  broadcast: 500,
});

const SAME_WORLD_DISCOUNT = 0.3;   // intra-world messages: 30% of cost
const HIGH_ENCRYPTION_FACTOR = 2;
const SHADOW_ENCRYPTION_FACTOR = 4;

// ── Shadow Burn tuning ──────────────────────────────────────────────────────

const BURN_THRESHOLD_PER_DAY = 50;  // messages/day before burn starts
const BURN_SEVERITY_MAX = 5;
const COOLDOWN_BASE_SEC = 30;       // 30s × severity^2

// ── Corruption tuning ───────────────────────────────────────────────────────

const BASE_CORRUPTION_CHANCE = {
  none:   0.08,
  basic:  0.04,
  high:   0.01,
  shadow: 0.001,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the cost of sending a message. Pure function.
 *
 * @param {object} args
 * @param {string} args.messageType
 * @param {string} args.sourceWorld
 * @param {string} args.destWorld
 * @param {string} [args.encryption='basic']
 * @returns {{ cost: number, breakdown: object }}
 */
export function computeMessageCost({ messageType, sourceWorld, destWorld, encryption = "basic" }) {
  const base = BASE_COST[messageType] ?? BASE_COST.text;
  const sameWorld = sourceWorld === destWorld;
  const distance = sameWorld ? SAME_WORLD_DISCOUNT : 1;
  const encMult = encryption === "high" ? HIGH_ENCRYPTION_FACTOR
    : encryption === "shadow" ? SHADOW_ENCRYPTION_FACTOR
    : 1;
  const cost = Math.ceil(base * distance * encMult);
  return {
    cost,
    base,
    sameWorldDiscount: sameWorld,
    encryptionMultiplier: encMult,
    breakdown: { base, distance_factor: distance, encryption_factor: encMult },
  };
}

/**
 * Roll for message corruption. Higher emotional weight + lower encryption
 * = higher chance the Veil distorts the message in transit.
 */
export function rollCorruption({ encryption = "basic", emotionalWeight = 0, veilStability = 1.0 }) {
  const baseChance = BASE_CORRUPTION_CHANCE[encryption] ?? BASE_CORRUPTION_CHANCE.basic;
  const weightFactor = 1 + Math.max(0, emotionalWeight) * 0.5;
  const stabilityFactor = 1 / Math.max(0.1, veilStability);
  const chance = Math.min(0.5, baseChance * weightFactor * stabilityFactor);
  const corrupted = Math.random() < chance;
  return { corrupted, chance };
}

/**
 * Apply / advance Shadow Burn for a sender. Returns the current state +
 * whether the next message would be blocked by cooldown.
 */
export function applyShadowBurn(db, senderId) {
  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor(now / 86400);


  let row = db.prepare(`SELECT * FROM concord_link_shadow_burn WHERE sender_id = ?`).get(senderId);
  if (!row) {
    db.prepare(`
      INSERT INTO concord_link_shadow_burn (sender_id, messages_today, burn_severity, last_reset_day, last_message_at)
      VALUES (?, 0, 0, ?, ?)
    `).run(senderId, today, now);
    row = { sender_id: senderId, messages_today: 0, burn_severity: 0, cooldown_until: null, last_reset_day: today, last_message_at: now };
  }

  // Daily reset
  if (row.last_reset_day < today) {
    db.prepare(`
      UPDATE concord_link_shadow_burn
         SET messages_today = 0, burn_severity = MAX(0, burn_severity - 1),
             last_reset_day = ?, cooldown_until = NULL
       WHERE sender_id = ?
    `).run(today, senderId);
    row.messages_today = 0;
    row.burn_severity = Math.max(0, row.burn_severity - 1);
    row.cooldown_until = null;
  }

  // Cooldown active?
  if (row.cooldown_until && row.cooldown_until > now) {
    return { blocked: true, cooldownRemaining: row.cooldown_until - now, severity: row.burn_severity, messagesToday: row.messages_today };
  }

  // Increment + maybe trigger burn
  const messagesToday = row.messages_today + 1;
  let severity = row.burn_severity;
  let cooldownUntil = null;
  if (messagesToday > BURN_THRESHOLD_PER_DAY) {
    severity = Math.min(BURN_SEVERITY_MAX, severity + 1);
    cooldownUntil = now + COOLDOWN_BASE_SEC * severity * severity;
  }

  db.prepare(`
    UPDATE concord_link_shadow_burn
       SET messages_today = ?, burn_severity = ?, cooldown_until = ?, last_message_at = ?
     WHERE sender_id = ?
  `).run(messagesToday, severity, cooldownUntil, now, senderId);

  return { blocked: false, severity, messagesToday, cooldownUntil };
}

/**
 * Send a message through the Concord Link. Handles cost computation,
 * shadow-burn check, corruption roll, and database persistence. If
 * `emitToUser` is supplied and the receiver is a player, also fires the
 * realtime `concord-link:message` socket event.
 *
 * @returns {{ ok: boolean, messageId?: string, status?: string, reason?: string, cost?: number }}
 */
export function sendMessage(db, opts, deps = {}) {
  const {
    senderId, senderKind = "user",
    receiverId, receiverKind = "user",
    sourceWorld, destWorld,
    messageType = "text",
    payload,
    encryption = "basic",
    emotionalWeight = 0,
    veilStability = 1.0,
  } = opts;

  if (!senderId || !sourceWorld || !destWorld) {
    return { ok: false, reason: "missing_required_fields" };
  }
  if (messageType !== "broadcast" && !receiverId) {
    return { ok: false, reason: "receiver_required_for_non_broadcast" };
  }

  // Shadow Burn gate
  const burn = applyShadowBurn(db, senderId);
  if (burn.blocked) {
    return { ok: false, reason: "shadow_burn_cooldown", cooldownRemaining: burn.cooldownRemaining };
  }

  // Cost calculation
  const { cost } = computeMessageCost({ messageType, sourceWorld, destWorld, encryption });

  // Corruption roll
  const { corrupted, chance: corruptionChance } = rollCorruption({ encryption, emotionalWeight, veilStability });
  const status = corrupted ? "corrupted" : "delivered";
  const corruptionNote = corrupted ? `Corruption chance was ${(corruptionChance * 100).toFixed(2)}%` : null;

  const messageId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Atomic debit + insert. The sparks check + debit + message insert run
  // inside a single SQLite transaction so a sender can never spend sparks
  // they don't have, and the message row only persists if the debit
  // succeeded. NPCs and system senders skip the wallet check (they don't
  // have a sparks balance — the cost is recorded for accounting but not
  // charged anywhere).
  const isWalletSender = senderKind === "user" && cost > 0;
  let debitFailedReason = null;
  const tx = db.transaction(() => {
    if (isWalletSender) {
      const u = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(senderId);
      if (!u) { debitFailedReason = "sender_unknown"; throw new Error("sender_unknown"); }
      const have = u.sparks ?? 0;
      if (have < cost) {
        debitFailedReason = `insufficient_sparks:have_${have}_need_${cost}`;
        throw new Error("insufficient_sparks");
      }
      db.prepare(`UPDATE users SET sparks = sparks - ? WHERE id = ?`).run(cost, senderId);
    }
    db.prepare(`
      INSERT INTO concord_link_messages (
        id, sender_id, sender_kind, receiver_id, receiver_kind,
        source_world, dest_world, message_type, payload,
        encryption_level, cost_paid, cost_currency, emotional_weight,
        status, corruption_note, sent_at, delivered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId, senderId, senderKind, receiverId ?? null, receiverKind ?? null,
      sourceWorld, destWorld, messageType, String(payload ?? ""),
      encryption, cost, "sparks", emotionalWeight,
      status, corruptionNote, now, status === "delivered" ? now : null,
    );
  });
  try {
    tx();
  } catch (_e) {
    return { ok: false, reason: debitFailedReason || "send_failed", cost };
  }

  // Physical messages dispatch a Link Walker. The message status stays
  // 'sent' (not 'delivered') until the walker completes its journey on a
  // future heartbeat tick. If no walker is available, the message is
  // already in the inbox so the user has at least their record; the
  // dispatch attempt is best-effort.
  let dispatchedWalker = null;
  if (messageType === "physical" && status !== "corrupted") {
    try {
      const candidates = listAvailableWalkers(db, { homeWorld: sourceWorld, limit: 5 });
      const pick = candidates[0]; // highest reputation already
      if (pick) {
        const hire = hireWalker(db, {
          walkerId:     pick.id,
          payerId:      senderId,
          sourceWorld,
          destWorld,
          messageId,
          feeSparks:    0, // sparks already debited via cost above
        });
        if (hire?.ok) {
          dispatchedWalker = hire.walker;
          // Override status: the message is in_transit, not delivered.
          db.prepare(`UPDATE concord_link_messages SET status='sent', delivered_at=NULL WHERE id=?`).run(messageId);
          // Sprint B Phase 11.3 — broadcast walker:dispatched to both
          // source and destination world rooms so frontend
          // WalkerOnHorizon listeners can render the walker on the
          // horizon. Best-effort; emit failures must not block dispatch.
          if (typeof deps.emitToWorld === "function") {
            try {
              const route = (() => {
                try { return JSON.parse(hire.walker?.route_anchors || "[]"); }
                catch { return []; }
              })();
              const payload = {
                walkerId: hire.walker?.id,
                fromWorld: sourceWorld,
                toWorld: destWorld,
                messageId,
                contractId: hire.contract?.id || null,
                route,
                dispatchedAt: now,
              };
              deps.emitToWorld(sourceWorld, "walker:dispatched", payload);
              if (destWorld !== sourceWorld) {
                deps.emitToWorld(destWorld, "walker:dispatched", payload);
              }
            } catch { /* realtime best-effort */ }
          }
        }
      }
    } catch { /* dispatch best-effort; message row already exists */ }
  }

  // Realtime push to recipient if player + online
  if (status === "delivered" && receiverKind === "user" && deps.emitToUser) {
    try {
      deps.emitToUser(receiverId, "concord-link:message", {
        messageId,
        senderId,
        senderKind,
        sourceWorld,
        destWorld,
        messageType,
        payload,
        emotionalWeight,
        encryption,
        ts: new Date(now * 1000).toISOString(),
      });
    } catch { /* realtime is best-effort */ }
  }

  // The Enforcer's awareness — high-emotional-weight messages surface
  // to Elias's NPC for narrative purposes (his power can sense them in
  // the Veil per the user's spec). Lands as a low-priority shadow DTU
  // tagged for narrative consumption.
  if (emotionalWeight >= 0.7 && deps.notifyEnforcer) {
    try {
      deps.notifyEnforcer({
        messageId, sourceWorld, destWorld, emotionalWeight, senderKind,
      });
    } catch { /* notification is best-effort */ }
  }

  return { ok: true, messageId, status, cost, corrupted, walker: dispatchedWalker };
}

/**
 * List messages for a recipient. Players query their inbox; NPCs query
 * via the emergent system.
 */
export function listInbox(db, receiverId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT * FROM concord_link_messages
     WHERE receiver_id = ?
     ORDER BY sent_at DESC
     LIMIT ?
  `).all(receiverId, limit);
}

export function markRead(db, messageId, readerId) {
  db.prepare(`
    UPDATE concord_link_messages
       SET read_at = unixepoch()
     WHERE id = ? AND receiver_id = ? AND read_at IS NULL
  `).run(messageId, readerId);
}

/**
 * List anchor points for a given world. Read by frontend so UI can show
 * the player how to access the Link in their current world.
 */
export function listAnchorsForWorld(db, worldId) {
  return db.prepare(`
    SELECT * FROM concord_link_anchors WHERE world_id = ? ORDER BY name
  `).all(worldId);
}

/**
 * Seed authored anchor points from world meta files. Called by the
 * content-seeder for each world that declares concord_link.anchors in
 * its meta.json. Idempotent.
 */
export function seedAnchorsFromWorldMeta(db, meta) {
  const worldId = meta?.world_id;
  const anchors = meta?.concord_link?.anchors;
  if (!worldId || !Array.isArray(anchors)) return 0;

  const insert = db.prepare(`
    INSERT INTO concord_link_anchors (id, world_id, name, access_method, description, location, controlled_by_faction, stability)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_method = excluded.access_method,
      description = excluded.description,
      location = excluded.location,
      controlled_by_faction = excluded.controlled_by_faction,
      stability = excluded.stability
  `);

  let count = 0;
  for (const a of anchors) {
    if (!a?.id) continue;
    insert.run(
      a.id, worldId, a.name || a.id,
      a.access_method || "unknown",
      a.description || null,
      a.location || null,
      a.controlled_by_faction || null,
      typeof a.stability === "number" ? a.stability : 1.0,
    );
    count += 1;
  }
  return count;
}
