// server/lib/social/daily-life.js
//
// Slice-of-Life SL1 — the player's everyday "living" verbs (the webtoon rhythm).
// Concordia had the marriage/family SYSTEMS but no way to just *date / hang out /
// share a drink / spend an evening*. Each verb is ONE episodic-vignette beat that
// nudges the relationship — routed through the EXISTING engine so nothing is
// rebuilt: affinity via romance `courtInteraction`, consequence via
// `recordOpinionEvent` (the NPC's opinion of the player), shared drinks via the
// `intoxication` BAC system. Discipline: every verb feeds the consequence engine.
//
// Kill-switch CONCORD_SOCIAL_LIFE (gated at the domain layer); off → today.

import crypto from "crypto";
import { courtInteraction } from "../romance-engine.js";
import { recordOpinionEvent } from "../npc-opinions.js";
import { drink, getBac, getTier } from "../intoxication.js";

// sentiment feeds courtInteraction (-1..+1); opinion feeds character_opinions;
// cooldownS makes it a rhythm. go_drinking shares a real drink (BAC).
export const SOCIAL_VERB_TUNING = Object.freeze({
  hang_out:      { sentiment: 0.4, opinion: 3, cooldownS: 3600 },
  share_meal:    { sentiment: 0.5, opinion: 4, cooldownS: 7200 },
  go_drinking:   { sentiment: 0.6, opinion: 5, cooldownS: 7200, drinks: true },
  spend_evening: { sentiment: 0.7, opinion: 6, cooldownS: 14400 },
});

const VIGNETTES = {
  hang_out: ["You pass an unhurried hour together.", "Idle talk, easy silences — a good afternoon.", "You walk the district, going nowhere in particular."],
  share_meal: ["You break bread together; the table does the talking.", "A shared meal, a little warmer for it.", "Food, and the quiet that good company makes."],
  go_drinking: ["You share a round; the night loosens.", "Drinks, and the truths that come after a few.", "The cups empty and the stories start."],
  spend_evening: ["The evening folds around the two of you.", "A long evening — and what isn't said.", "You spend the evening together; the hour gets late."],
};

function dayBucket(at) { return Math.floor(at / 86400); }

function vignetteFor(verb, userId, partnerId, at) {
  const pool = VIGNETTES[verb] || [""];
  const h = crypto.createHash("sha1").update(`${verb}:${userId}:${partnerId}:${dayBucket(at)}`).digest();
  return pool[h[0] % pool.length];
}

/** Seconds until this verb can be used again with this partner (0 = ready). */
export function getCooldown(db, userId, verb, partnerKind, partnerId) {
  const tuning = SOCIAL_VERB_TUNING[verb];
  if (!tuning) return 0;
  const last = db.prepare(`
    SELECT at FROM player_social_log
    WHERE user_id=? AND verb=? AND partner_kind=? AND partner_id=? ORDER BY at DESC LIMIT 1
  `).get(String(userId), verb, partnerKind, String(partnerId));
  if (!last) return 0;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, tuning.cooldownS - (now - last.at));
}

// Consecutive-day streak: +1 if the last beat with this partner was yesterday's bucket.
function nextStreak(db, userId, verb, partnerKind, partnerId, nowSec) {
  const last = db.prepare(`
    SELECT at, streak FROM player_social_log
    WHERE user_id=? AND verb=? AND partner_kind=? AND partner_id=? ORDER BY at DESC LIMIT 1
  `).get(String(userId), verb, partnerKind, String(partnerId));
  if (!last) return 1;
  const d = dayBucket(nowSec) - dayBucket(last.at);
  if (d === 1) return last.streak + 1;
  if (d === 0) return last.streak; // same day, no streak change
  return 1; // gap → reset
}

/**
 * Perform one daily-living verb. Returns { ok, verb, affinity, opinion, streak,
 * vignette } or { ok:false, reason }. Routes affinity through courtInteraction
 * and (for NPC partners) records the NPC's opinion of the player.
 */
export function performDailyVerb(db, { userId, verb, partnerKind = "npc", partnerId, worldId = "concordia-hub" } = {}) {
  if (!db || !userId || !partnerId) return { ok: false, reason: "missing_inputs" };
  const tuning = SOCIAL_VERB_TUNING[verb];
  if (!tuning) return { ok: false, reason: "unknown_verb" };

  const cd = getCooldown(db, userId, verb, partnerKind, partnerId);
  if (cd > 0) return { ok: false, reason: "on_cooldown", cooldownRemaining: cd };

  const nowSec = Math.floor(Date.now() / 1000);
  const streak = nextStreak(db, userId, verb, partnerKind, partnerId, nowSec);

  // A streak warms the beat — scale sentiment up toward 1.0 (capped).
  const sentiment = Math.min(1, tuning.sentiment + Math.min(0.3, (streak - 1) * 0.05));

  let drunkPenalty = 0;
  if (tuning.drinks) {
    try {
      drink(db, userId, 1.0);
      const tier = getTier(getBac(db, userId));
      if (tier === "drunk" || tier === "stumbling") drunkPenalty = 2; // sloppy drunk reads worse
    } catch { /* intoxication optional */ }
  }

  const court = courtInteraction(db, userId, partnerKind, partnerId, sentiment);
  const opinionDelta = Math.max(0, tuning.opinion - drunkPenalty);
  let opinion = null;
  if (partnerKind === "npc" && opinionDelta > 0) {
    const r = recordOpinionEvent(db, { npcId: partnerId, targetKind: "player", targetId: userId }, opinionDelta, `social:${verb}`);
    opinion = r?.ok ? opinionDelta : 0;
  }

  db.prepare(`
    INSERT INTO player_social_log (user_id, verb, partner_kind, partner_id, world_id, streak, at)
    VALUES (?,?,?,?,?,?,?)
  `).run(String(userId), verb, partnerKind, String(partnerId), String(worldId), streak, nowSec);

  return {
    ok: true,
    verb,
    affinity: court?.affinity ?? null,
    opinion,
    streak,
    vignette: vignetteFor(verb, userId, partnerId, nowSec),
  };
}
