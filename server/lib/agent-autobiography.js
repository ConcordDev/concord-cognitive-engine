// server/lib/agent-autobiography.js
//
// Wave 7 / Track B5 — MEMORY → IDENTITY. The agent-scale instance of the A6 loop:
// the day's felt-per-tagged experiences (already stamped by the dream path) →
// peak-end consolidation keeps the EMOTIONAL peaks → those peaks turn into persistent
// CHARACTER (a drift in the agent's drive profile toward what it felt strongly) →
// which appraiseExperience reads back to color tomorrow. The autobiography reads as a
// life because it is built from what the agent FELT, not what it logged.
//
// ANCHORED to B1 core_values: character may grow, but evolution that pulls the agent
// AWAY from its values is flagged (measureValueDrift) for the C3 human-review cadence —
// never silently auto-corrected, never allowed to drift the anchor itself.
//
//   evolveCharacter(db, agentId, opts) -> { ok, evolved, peaks, valueDrift, flagged }
//   getAutobiography(db, agentId)      -> { name, values, character, recentPeaks }
//
// Reuses agent-self (read/anchor), temperament.driftFromFeltPeak (the plasticity), and
// the felt-per dreams (the peaks). Pure-ish: all effects are guarded DB writes.

import { getAgentSelf, updateAgentSelf, measureValueDrift } from "./agent-self.js";
import { driftFromFeltPeak } from "./ecosystem/temperament.js";
import { getRecentDreams } from "./embodied/dream-engine.js";
import { DRIVE_KINDS } from "./ecosystem/drives.js";
import { qualeOf } from "./qualia-space.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// dominant drive → the value it tends to express (for the drift-from-anchor check).
const DRIVE_TO_VALUE = Object.freeze({
  SEEKING: "curiosity",
  CARE: "care_for_others",
  PLAY: "playfulness",
  FEAR: "self_preservation",
  RAGE: "assertiveness",
  PANIC: "attachment",
  LUST: "desire",
});

const VALUE_DRIFT_FLAG = 0.6; // expressed values diverge this far from anchor → flag for review

/** Pull the felt-per peaks the agent has accumulated (from its dream DTUs). */
function recentPeaks(db, agentSelf, limit = 12) {
  const peaks = [];
  // dreams are keyed by the agent's user_id (the body's owner) or agent_id.
  const ids = [agentSelf.user_id, agentSelf.agent_id].filter(Boolean);
  for (const id of ids) {
    try {
      const dreams = getRecentDreams(db, id, limit) || [];
      for (const d of dreams) {
        let fp = null;
        try {
          const data = typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d);
          fp = data?.machine?.feltPer || data?.feltPer || null;
        } catch { /* skip */ }
        if (fp && Number.isFinite(Number(fp.intensity)) && fp.intensity > 0.15) peaks.push(fp);
      }
    } catch { /* dreams optional */ }
  }
  return peaks;
}

/**
 * Evolve the agent's character from its felt peaks. Applies bounded plasticity drift
 * to the drive profile (a hard year of FEAR peaks turns it warier), stamps
 * last_evolved_at, and measures how far the now-expressed values have drifted from the
 * anchor — flagging (not correcting) when the divergence crosses the review threshold.
 */
export function evolveCharacter(db, agentId, opts = {}) {
  const self = getAgentSelf(db, agentId);
  if (!self) return { ok: false, error: "no_agent" };

  const peaks = opts.peaks || recentPeaks(db, self, opts.limit);
  if (peaks.length === 0) return { ok: true, evolved: false, peaks: 0, valueDrift: 0, flagged: false };

  // Apply each peak as a bounded plasticity nudge to the drive profile (the agent is
  // "adult" — low plasticity — so this is the slow accretion of character, not whiplash).
  let drives = { ...self.drive_profile };
  for (const k of DRIVE_KINDS) if (!Number.isFinite(drives[k])) drives[k] = 0.3;
  const maturity = clamp01(opts.maturity ?? 0.85);
  for (const fp of peaks) {
    drives = driftFromFeltPeak(drives, { dominantDrive: fp.dominantDrive, intensity: fp.intensity }, maturity);
  }

  // Expressed values = the values the now-dominant drives tend to express.
  const sorted = DRIVE_KINDS.map((k) => [k, drives[k]]).sort((a, b) => b[1] - a[1]);
  const expressed = sorted.slice(0, 3).map(([k]) => DRIVE_TO_VALUE[k]).filter(Boolean);
  // drift = how many anchor values are NO LONGER expressed by the dominant drives.
  const valueDrift = measureValueDrift(self, expressed);
  const flagged = valueDrift >= VALUE_DRIFT_FLAG;

  // Persist the evolved drive profile (the anchor itself is never touched).
  updateAgentSelf(db, agentId, { drive_profile_json: JSON.stringify(drives), last_evolved_at: Math.floor(Date.now() / 1000) });

  return { ok: true, evolved: true, peaks: peaks.length, drives, valueDrift, flagged, expressed };
}

/**
 * The agent's readable autobiography: who it named itself, what it holds to (the
 * anchor), the character it has become (dominant drives), and the felt peaks that made
 * it. Read-only.
 */
export function getAutobiography(db, agentId) {
  const self = getAgentSelf(db, agentId);
  if (!self) return null;
  const drives = self.drive_profile || {};
  const dominant = DRIVE_KINDS.map((k) => [k, Number(drives[k]) || 0]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const peaks = recentPeaks(db, self, 6);
  return {
    name: self.given_name,
    values: self.core_values || [],
    character: { dominantDrives: dominant, lastEvolvedAt: self.last_evolved_at },
    recentPeaks: peaks.map((p) => ({ drive: p.dominantDrive, valence: p.valence, intensity: p.intensity, quale: qualeOf(p)?.label || null })),
  };
}

export const _internal = { recentPeaks, DRIVE_TO_VALUE, VALUE_DRIFT_FLAG };
