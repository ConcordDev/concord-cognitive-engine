// server/lib/combat/match-chronicle.js
//
// Mint a chronicle DTU when a combat encounter ends. The chronicle
// captures location + time + weather + faction context + per-fighter
// action summary, so the encounter becomes retellable lore — readable
// by other players, citable in derivative DTUs, surfaced in the
// EmergentEventFeed, and (optionally) referenced by NPCs in future
// dialogue prompts via the world-facts bridge.
//
// Pre-this-module, recordCombatFlow wrote per-action rows but no
// end-of-match summary existed. PvP encounters were data without
// narrative; players couldn't retell the fight in a portable form.
// Chronicles are the bridge from substrate to story.
//
// Coherence anchors: the chronicle DTU's `metadata.coherence_anchors`
// names the world, district, faction policy state, weather, and
// time-of-day at mint time. If the world state changes (faction
// dissolved, district renamed), the chronicle remains valid because
// it cites point-in-time state, not live state.

import { createDTU } from "../../economy/dtu-pipeline.js";

/**
 * Mint a chronicle DTU summarizing a finished combat encounter.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.matchId       — training-match id, or null for ad-hoc PvP
 * @param {string} opts.winnerId      — user id of the victor; null if draw
 * @param {string} opts.loserId       — user id of the defeated; null if draw
 * @param {string} opts.endedReason   — "kill" | "forfeit" | "cap" | "timeout" | "draw"
 * @param {string} opts.worldId
 * @param {object} [opts.worldContext] — { districtId, weather, timeOfDay, factionPolicy }
 * @returns {{ ok: boolean, chronicleId?: string, error?: string }}
 */
export function mintMatchChronicle(db, {
  matchId, winnerId, loserId, endedReason,
  worldId = "concordia-hub", worldContext = {},
} = {}) {
  if (!winnerId && !loserId) return { ok: false, error: "no_participants" };

  // Defensive participant check: when a matchId is supplied, verify the
  // claimed winner/loser actually fought in that match. Pre-this guard
  // any caller could mint a chronicle for any pair of users on any
  // match they didn't participate in. The function is exported so
  // the check has to live here, not at the call sites.
  if (matchId && db) {
    try {
      const m = db.prepare(
        `SELECT initiator_id, opponent_id FROM training_matches WHERE id = ?`,
      ).get(matchId);
      if (m) {
        const valid = new Set([m.initiator_id, m.opponent_id].filter(Boolean));
        const winnerOk = !winnerId || valid.has(winnerId);
        const loserOk  = !loserId  || valid.has(loserId);
        if (!winnerOk || !loserOk) {
          return { ok: false, error: "participants_not_in_match" };
        }
      }
    } catch { /* table absent or query failure — fall through to mint without check */ }
  }

  // Pull each fighter's recent flow rows so the chronicle includes a
  // recognizable action signature ("favored low sweeps with feinted
  // off-hand counters"). 30-row window covers a full bout comfortably.
  const flowRows = db.prepare(`
    SELECT fighter_id, fighter_kind, context, style, action, hit, damage, is_crit
    FROM combat_flows
    WHERE fighter_id IN (?, ?) AND ts > unixepoch() - 600
    ORDER BY ts DESC
    LIMIT 60
  `).all(winnerId || "", loserId || "");

  const winnerActions = flowRows.filter((r) => r.fighter_id === winnerId);
  const loserActions  = flowRows.filter((r) => r.fighter_id === loserId);

  const summarize = (actions) => {
    if (actions.length === 0) return "no recorded actions";
    const styles = {};
    for (const a of actions) {
      const s = a.style || a.action || "unknown";
      styles[s] = (styles[s] || 0) + 1;
    }
    const top = Object.entries(styles).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const totalDmg = actions.reduce((s, a) => s + Number(a.damage || 0), 0);
    const hits = actions.filter((a) => a.hit).length;
    const hitRate = actions.length > 0 ? Math.round((hits / actions.length) * 100) : 0;
    return `${top.map(([k, v]) => `${k}×${v}`).join(", ")} · ${totalDmg} dmg · ${hitRate}% hit`;
  };

  const winnerSig = summarize(winnerActions);
  const loserSig  = summarize(loserActions);

  const title =
    endedReason === "draw"
      ? `Bout — ${worldContext.districtId || worldId}`
      : `${winnerId || "?"} bested ${loserId || "?"} — ${worldContext.districtId || worldId}`;

  const human = {
    summary:
      endedReason === "draw"
        ? `Both fighters held. ${winnerSig} vs ${loserSig}.`
        : `${winnerId} ended ${loserId} via ${endedReason}. Winner: ${winnerSig}. Defeated: ${loserSig}.`,
  };

  // Coherence anchors: point-in-time state cited so the chronicle stays
  // valid even if live world state changes later.
  const coherence_anchors = {
    worldId,
    districtId:    worldContext.districtId ?? null,
    weather:       worldContext.weather    ?? null,
    timeOfDay:     worldContext.timeOfDay  ?? null,
    factionPolicy: worldContext.factionPolicy ?? null,
    mintedAt:      new Date().toISOString(),
  };

  // Citation mode "original" — chronicles don't derive from another DTU;
  // they cite world state via metadata, not via parent DTU lineage.
  const result = createDTU(db, {
    creatorId:    winnerId || loserId,
    title,
    content: {
      human,
      core: {
        endedReason,
        winnerId,
        loserId,
        winnerActions: winnerSig,
        loserActions:  loserSig,
        flowRowCount:  flowRows.length,
      },
      machine: {
        kind: "match_chronicle",
        matchId,
      },
    },
    contentType: "match_chronicle",
    lensId: "world",
    tags: [
      "match_chronicle",
      `world:${worldId}`,
      ...(matchId ? [`match:${matchId}`] : []),
      ...(endedReason ? [`reason:${endedReason}`] : []),
    ],
    metadata: {
      participants: [winnerId, loserId].filter(Boolean),
      coherence_anchors,
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, chronicleId: result.dtu?.id ?? null };
}
