// server/lib/consequence-cascades.js
//
// Wave C / C1 — long-arc consequence templates. Each big player action
// (royal kill, betrayal, mass atrocity) fires a chain of scheduled
// consequences that play out over hours/days of real time:
//
//   royal_kill   → radicalize_guards (+30min) → form_cult (+6h) → cult_attack_settlement (+12–30h)
//   betrayal     → gossip_spread (+1h)        → faction_distrust (+4h) → faction_blacklist (+24h)
//   mass_atrocity→ bard_legend (+2h)          → news_spread (+6h)     → bounty_posted (+12h)
//
// `fire(db, triggerKind, context)` looks up the template and schedules
// every step via lib/scheduled-consequences.js. Handlers ship in
// server/lib/consequence-handlers/ and are routed by the dispatcher.
//
// Templates are deterministic + data-driven — add a new cascade by
// adding an entry here + a handler module. No new heartbeat needed.

import { schedule } from "./scheduled-consequences.js";

const MINUTE = 60;
const HOUR = 60 * 60;

export const CASCADE_TEMPLATES = Object.freeze({
  // ── Royal kill ─────────────────────────────────────────────────────
  // Player kills a queen/king/ruler NPC. The fallout snowballs.
  royal_kill: {
    description: "Kill of a high-influence NPC. Guards radicalize, a cult forms, the cult attacks.",
    chain: [
      { kind: "royal_kill_radicalize",  fireAfterS: 30 * MINUTE },
      { kind: "royal_kill_form_cult",   fireAfterS: 6 * HOUR },
      // Randomised window so the player can't time-block the climax.
      { kind: "royal_kill_attack",      fireAfterS: 12 * HOUR, fireJitterS: 18 * HOUR },
    ],
  },

  // ── Betrayal ───────────────────────────────────────────────────────
  // Player breaks a faction allegiance / refuses a sworn quest /
  // attacks an ally. Reputation rots over a day.
  betrayal: {
    description: "Betrayal of an ally faction. Gossip → distrust → blacklist over 24h.",
    chain: [
      { kind: "betrayal_gossip",        fireAfterS: 1 * HOUR },
      { kind: "betrayal_distrust",      fireAfterS: 4 * HOUR },
      { kind: "betrayal_blacklist",     fireAfterS: 24 * HOUR },
    ],
  },

  // ── Mass atrocity ──────────────────────────────────────────────────
  // Player slaughters civilians / razes a settlement. World hears about it.
  mass_atrocity: {
    description: "Slaughter event. Legend composed, news spreads, bounty posted.",
    chain: [
      { kind: "mass_atrocity_legend",   fireAfterS: 2 * HOUR },
      { kind: "mass_atrocity_news",     fireAfterS: 6 * HOUR },
      { kind: "bounty_posted",          fireAfterS: 12 * HOUR },
    ],
  },
});

/**
 * Fire a cascade. Returns the list of scheduled-row ids so callers can
 * cancel the chain if the player completes a redemption arc.
 *
 * `context` carries the trigger metadata (which NPC died, which faction
 * was betrayed, etc.) — handlers read this from each scheduled row's
 * payload.
 */
export function fire(db, triggerKind, context = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const tpl = CASCADE_TEMPLATES[triggerKind];
  if (!tpl) return { ok: false, reason: "unknown_trigger", trigger: triggerKind };

  const scheduledIds = [];
  for (const step of tpl.chain) {
    const jitter = step.fireJitterS ? Math.floor(Math.random() * step.fireJitterS) : 0;
    const r = schedule(db, {
      kind: step.kind,
      fireInS: step.fireAfterS + jitter,
      source: context.source ?? null,
      target: context.target ?? null,
      worldId: context.worldId ?? null,
      payload: {
        triggerKind,
        chainStep: step.kind,
        actorUserId: context.actorUserId ?? null,
        victimNpcId: context.victimNpcId ?? null,
        factionId: context.factionId ?? null,
        location: context.location ?? null,
        meta: context.meta ?? null,
      },
    });
    if (r.ok) scheduledIds.push(r.id);
  }

  return { ok: true, trigger: triggerKind, scheduledIds, stepCount: scheduledIds.length };
}

/**
 * Helper: cancel an entire cascade by its scheduled row ids. Used for
 * player redemption arcs (e.g. raise the slain queen back from the dead
 * cancels the cult chain).
 */
export function cancelCascade(db, scheduledIds, reason = "redemption") {
  if (!db || !Array.isArray(scheduledIds)) return { ok: false, reason: "invalid_args" };
  let cancelled = 0;
  for (const id of scheduledIds) {
    try {
      const r = db.prepare(`
        UPDATE scheduled_consequences
        SET fired_at = unixepoch(), fire_result = ?
        WHERE id = ? AND fired_at IS NULL
      `).run(JSON.stringify({ cancelled: true, reason }), id);
      if (r.changes > 0) cancelled++;
    } catch { /* skip */ }
  }
  return { ok: true, cancelled };
}

export const _internal = { MINUTE, HOUR };
