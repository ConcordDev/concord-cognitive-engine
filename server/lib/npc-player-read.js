/**
 * npc-player-read — D3 (depth/balance plan).
 *
 * Turns the player's four-axis ecosystem metrics into a short, qualitative
 * "what I notice about you" descriptor so NPCs react to WHO THE PLAYER HAS
 * BECOME — not only to a stored opinion of past one-on-one interactions. This
 * is the RDR2 "they see me" lever from the depth research: ambient reactivity
 * to the player's current standing reads as a living world.
 *
 * Pure + deterministic. Exposes only a qualitative read an NPC could plausibly
 * sense from the player's bearing/notoriety — never raw numbers or secrets.
 * Returns up to `max` of the strongest signals as prose prompt lines.
 *
 * Metrics (server/lib/ecosystem/score-engine.js#getMetrics): ecosystem_score,
 * concord_alignment, concordia_alignment, refusal_debt — each may be ±.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function describePlayerStateForNpc(metrics, opts = {}) {
  const { max = 2, notorious = false } = opts;
  const m = metrics || {};
  const eco = num(m.ecosystem_score);
  const concord = num(m.concord_alignment);
  const concordia = num(m.concordia_alignment);
  const refusal = num(m.refusal_debt);

  // Each signal carries a weight; the strongest few surface. Thresholds are
  // bounded + qualitative (playtest fodder, documented in BALANCE_DIALS).
  const signals = [];

  // refusal_debt is the heaviest read — the Sovereign's mark on a person.
  if (refusal >= 15) signals.push({ w: 100, line: "This one carries unpaid refusals — there is a weight on them you can feel." });
  else if (refusal >= 6) signals.push({ w: 60, line: "Something unsettled clings to them, as if a debt rides their shoulders." });

  if (concordia >= 12) signals.push({ w: 75, line: "They walk in the goddess's favour — Concordia's warmth is on them." });
  else if (concordia <= -12) signals.push({ w: 75, line: "The goddess's warmth has cooled toward this one; you sense the chill." });

  if (eco <= -12) signals.push({ w: 55, line: "They have taken more from the world than they've returned — the land remembers." });
  else if (eco >= 15) signals.push({ w: 40, line: "The land eases around them; they've tended more than they've taken." });

  if (concord >= 15) signals.push({ w: 45, line: "They carry themselves like one aligned with Concord's order." });

  if (notorious) signals.push({ w: 90, line: "Their notoriety precedes them — be wary; trouble tends to follow." });

  signals.sort((a, b) => b.w - a.w);
  return signals.slice(0, Math.max(0, max)).map((s) => s.line);
}
