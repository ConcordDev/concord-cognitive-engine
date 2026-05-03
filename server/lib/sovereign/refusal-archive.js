// server/lib/sovereign/refusal-archive.js
//
// The Sovereign's Refusal Archive: a Shadow DTU collection. Every time a
// player uses a unique combat skill DTU, we record a Shadow tagged
// 'sovereign_archive' so the existing EvoAsset evolution scheduler can
// later refine the recorded power and the Sovereign can "manifest" an
// evolved form during a raid encounter.
//
// Lore anchor:
//   "I didn't learn them. I simply refused to accept that I could only
//   have one." — The Sovereign refuses the limit of having one power set.
//
// Mechanism:
//   - recordPlayerPowerForArchive() fires from the skill:use socket path.
//   - Shadow DTU id = `shadow_sovereign_${dtuId}_${playerId}`. Idempotent
//     by id (only the first observation is recorded; subsequent uses by
//     the same player against the Sovereign feed the existing
//     evo_asset_interactions table via the parallel
//     recordInteractionFromPlayer() path so the evolution scheduler
//     refines the power over time).
//   - Tags: ['sovereign_archive', 'social_awareness'] — riding on the
//     existing shadow-graph 2000-cap and richness-based TTL.
//
// Sovereign manifestation (deferred to mass-raid scaffold):
//   draftSovereignManifestation() picks N random shadows and produces a
//   merged "fused" combat skill blueprint. The raid runner reads it.

const ARCHIVE_TAG = "sovereign_archive";
const SUMMARY_MAX_CHARS = 200;
const ARCHIVE_DRAW_LIMIT = 5;

/**
 * Record a player skill use into the Sovereign's archive. Called from
 * skill:use server-side path. Idempotent — re-uses by the same player
 * are no-ops at the shadow level (interaction density is tracked
 * separately by evo-asset/npc-shadow-bridge.recordInteractionFromPlayer).
 *
 * @param {object} state    — STATE.shadowDtus is required
 * @param {object} skillDtu — the combat_skill DTU row
 * @param {string} playerId
 */
export function recordPlayerPowerForArchive(state, skillDtu, playerId) {
  if (!state || !skillDtu?.id || !playerId) return { ok: false, reason: "missing_args" };
  if (!state.shadowDtus) state.shadowDtus = new Map();

  const shadowId = `shadow_sovereign_${skillDtu.id}_${playerId}`;
  if (state.shadowDtus.has(shadowId)) return { ok: true, deduped: true };

  // Build a brief summary the Sovereign can manifest later. Keep meta
  // verbatim so the manifestation pass can fuse multiple powers.
  let meta = {};
  try { meta = typeof skillDtu.meta === "object" ? skillDtu.meta : (JSON.parse(skillDtu.body_json || "{}").meta ?? {}); }
  catch { /* malformed; safe to ignore */ }

  state.shadowDtus.set(shadowId, {
    id: shadowId,
    kind: "shadow",
    tags: [ARCHIVE_TAG, "social_awareness"],
    core: {
      summary: (skillDtu.title ?? skillDtu.name ?? "unknown power").toString().slice(0, SUMMARY_MAX_CHARS),
    },
    sourceDtuId: skillDtu.id,
    observedFrom: playerId,
    meta,
    weight: 0.7,
    createdAt: Date.now(),
  });

  return { ok: true, shadowId };
}

/**
 * Draft a single "manifestation" — N random archive shadows fused into one
 * blueprint. Each fight against the Sovereign uses a fresh draft. Powers
 * the Sovereign manifests are stripped of original cooldown / cost limits
 * because, in the lore, he refuses the original limitations.
 *
 * @param {object} state
 * @param {object} [opts]
 * @param {number} [opts.draws]          — number of powers to fuse, default 3
 * @param {string} [opts.preferTargetId] — if set, prioritize shadows seen
 *                                         from this player (the Archive
 *                                         "remembers" players who keep
 *                                         coming back)
 * @returns {object} A fused combat-skill blueprint (not persisted; raids
 *                   throw it away after the encounter).
 */
export function draftSovereignManifestation(state, opts = {}) {
  const draws = Math.max(1, Math.min(ARCHIVE_DRAW_LIMIT, opts.draws ?? 3));
  if (!state?.shadowDtus) {
    return _fallbackManifestation();
  }

  const archive = Array.from(state.shadowDtus.values())
    .filter((s) => Array.isArray(s.tags) && s.tags.includes(ARCHIVE_TAG));
  if (archive.length === 0) return _fallbackManifestation();

  // Bias toward shadows from the preferred player (the lore says the
  // Sovereign starts to recognise people who keep coming back).
  const ranked = archive.slice().sort((a, b) => {
    const aPref = opts.preferTargetId && a.observedFrom === opts.preferTargetId ? 1 : 0;
    const bPref = opts.preferTargetId && b.observedFrom === opts.preferTargetId ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return Math.random() - 0.5;
  });

  const picked = ranked.slice(0, draws);
  const fusedDamage = picked.reduce((sum, s) => sum + (Number(s.meta?.damageRange?.[1]) || 12), 0) / picked.length;
  const fusedSummary = picked.map((s) => s.core?.summary).filter(Boolean).join(" + ");

  return {
    name:       `Refusal Manifestation: ${picked.length} powers`,
    summary:    fusedSummary || "the Sovereign manifests an unfamiliar shape",
    sources:    picked.map((s) => s.sourceDtuId),
    damageRange: [Math.round(fusedDamage * 0.8), Math.round(fusedDamage * 1.4)],
    // Refused limitations: cooldown + costs zeroed because the Sovereign
    // refuses the original limits of the powers he's seen.
    cooldownMs:  0,
    staminaCost: 0,
    apCost:      0,
    refusedLimits: ["cooldown", "stamina_cost", "ap_cost"],
  };
}

function _fallbackManifestation() {
  return {
    name: "Refusal Manifestation: empty archive",
    summary: "the Sovereign refuses to bother",
    sources: [],
    damageRange: [10, 18],
    cooldownMs: 0, staminaCost: 0, apCost: 0,
    refusedLimits: ["cooldown", "stamina_cost", "ap_cost"],
  };
}

export const SOVEREIGN_ARCHIVE_TAG = ARCHIVE_TAG;
