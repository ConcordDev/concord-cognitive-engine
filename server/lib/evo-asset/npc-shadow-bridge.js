// server/lib/evo-asset/npc-shadow-bridge.js
// Bridges NPC Shadow DTUs to EvoAsset improvement requests.
//
// CLAUDE.md describes Shadow DTUs as transient internal-reasoning DTUs
// that NPCs use without affecting the canonical knowledge base. The
// existing `maybeWriteLinguisticShadowDTU` infrastructure (server.js
// 3265-3306) writes Shadow DTUs with a 48h half-life; "rich" Shadows
// survive longer based on enrichment.
//
// This bridge gives NPCs a way to express opinions about visual assets
// they encounter — "this sword's edge is too dull", "the temple wall
// could be more weathered" — and turn those opinions into evolution
// pressure on the corresponding EvoAsset.
//
// Flow:
//   1. NPC interacts with an asset (e.g. uses a sword in combat,
//      enters a building).
//   2. The simulator calls recordInteractionFromNPC() — increments the
//      asset's interaction_points.
//   3. If the NPC has any aesthetic complaint about the asset (decided
//      by the NPC's brain via a Shadow DTU), the bridge bumps the
//      interaction weight and tags the Shadow with `evo-improvement-request`.
//   4. The scheduler picks the asset up faster on next tick.

import { recordInteraction } from "./registry.js";

/**
 * NPC has interacted with an asset. Records standard interaction.
 * If the optional `improvementRequest` is supplied, the interaction
 * weight is doubled and a Shadow DTU is written tagging the request.
 *
 * @param {object} STATE        server STATE
 * @param {import('better-sqlite3').Database} db
 * @param {string} assetId
 * @param {string} npcId
 * @param {string} action       e.g. 'used_in_combat', 'walked_through', 'crafted_with'
 * @param {object} [opts]
 * @param {string} [opts.improvementRequest]  e.g. "edges feel too rounded"
 * @param {Function} [opts.maybeWriteShadowDTU] injected reference to server's shadow-DTU writer
 */
export function recordInteractionFromNPC(STATE, db, assetId, npcId, action, opts = {}) {
  const weight = opts.improvementRequest ? 2.0 : 1.0;
  recordInteraction(db, assetId, { kind: "npc", id: npcId }, action, weight);

  if (opts.improvementRequest && opts.maybeWriteShadowDTU) {
    try {
      opts.maybeWriteShadowDTU(STATE, {
        author: { kind: "npc", id: npcId },
        text: opts.improvementRequest,
        tags: ["evo-asset", "improvement-request", `asset:${assetId}`],
        ttlSeconds: 7 * 24 * 3600, // longer than default 48h half-life because actionable
      });
    } catch { /* shadow write is best-effort */ }
  }
}

/**
 * Mirror of the above for player-driven interactions. No Shadow DTU
 * channel — players express opinions via UI (favorites, ratings)
 * which is a separate path.
 */
export function recordInteractionFromPlayer(db, assetId, userId, action, weight = 1.0) {
  recordInteraction(db, assetId, { kind: "user", id: userId }, action, weight);
}
