// server/lib/agent-goals.js
//
// Wave 7 / Track B4 — AUTONOMOUS GOAL FORMATION. Until now the agent ran a SEEDED
// marathon goal and the salience gate decided WHEN to think. This is the missing half:
// the agent introspects "what matters to me?" from its OWN drives (B1 drive_profile) +
// felt-history (A6 peaks) + values anchor (B1 core_values), and forms a NEW goal. It
// self-directs, it isn't only executed.
//
// Autotelic (plan Context 11): a goal is an ORIENTING VECTOR — it gives the in-between
// direction and shape, but it NEVER gates worth (worth lives in the felt-per stream).
// So a formed goal is phrased "to live toward…", carries autotelic:true, and a future
// completion must not emit a terminal valence spike that dwarfs the moment-to-moment.
//
//   proposeGoal(self, opts)        -> { goal, drive, anchoredValue, autotelic, orienting }
//   formGoalForAgent(db, agentId)  -> proposes from the LIVE self + recent peaks (read-only)
//
// Pure (proposeGoal) + a read-only DB wrapper. Reuses drives.dominantDrive + agent-self.

import crypto from "node:crypto";
import { DRIVE_KINDS, dominantDrive } from "./ecosystem/drives.js";
import { getAgentSelf } from "./agent-self.js";
import { getAutobiography } from "./agent-autobiography.js";

// Per-drive goal templates — the want each Panksepp system orients toward. Phrased as
// orienting vectors (the living, not a finish line). {value} is filled from the anchor.
const GOAL_TEMPLATES = Object.freeze({
  SEEKING: [
    "to keep learning a craft worth mastering, holding to {value}",
    "to explore what lies past the edge of what I know, in the spirit of {value}",
  ],
  CARE: [
    "to look after the people who have less than me, out of {value}",
    "to tend something — a garden, a friendship, a place — that needs me, guided by {value}",
  ],
  RAGE: [
    "to stand up to what is unjust around me without losing {value}",
    "to settle an old matter honestly, keeping {value}",
  ],
  FEAR: [
    "to build myself a refuge and a few I can trust, never abandoning {value}",
    "to learn to meet what frightens me without betraying {value}",
  ],
  PANIC: [
    "to find my people and not be alone, while keeping {value}",
    "to mend a bond that frayed, in keeping with {value}",
  ],
  PLAY: [
    "to make something joyful and share it, in the spirit of {value}",
    "to bring more play into this place, holding {value}",
  ],
  LUST: [
    "to court someone worth courting, honestly and with {value}",
    "to pursue a desire that is truly mine, without abandoning {value}",
  ],
});

const VALUE_PHRASE = {
  honesty: "honesty", curiosity: "curiosity", care_for_others: "care for others",
  non_coercion: "never coercing anyone", courage: "courage", playfulness: "playfulness",
};

function phraseValue(v) {
  return VALUE_PHRASE[v] || String(v || "my values").replace(/_/g, " ");
}

/**
 * Form a candidate goal from the agent's drives + felt-peaks + values. Deterministic
 * for a given (agentId, dayBucket) so the agent doesn't whiplash mid-day. Pure.
 *
 * @param {object} self {
 *   agent_id?, given_name?, drive_profile: {SEEKING,...}, core_values: [..],
 *   recentPeaks?: [{ drive, valence, intensity }]  // A6 — biases which drive leads
 * }
 * @param {object} [opts] { now?, seed? }
 */
export function proposeGoal(self = {}, opts = {}) {
  const s = self || {};
  const drives = {};
  for (const k of DRIVE_KINDS) drives[k] = Number(s.drive_profile?.[k]) || 0;

  // The felt-peaks bias which drive leads: a life lately marked by a drive raises it
  // (what you felt strongly is what you reach for). A6 closes into goal-formation.
  for (const p of Array.isArray(s.recentPeaks) ? s.recentPeaks : []) {
    if (p?.drive && DRIVE_KINDS.includes(p.drive)) {
      drives[p.drive] += 0.3 * Math.max(0, Math.min(1, Number(p.intensity) || 0));
    }
  }

  const lead = dominantDrive(drives).name || "SEEKING";
  const values = Array.isArray(s.core_values) && s.core_values.length ? s.core_values : ["honesty"];

  // deterministic pick within a day bucket
  const dayBucket = Math.floor((Number(opts.now) || Date.now()) / 86400000);
  const seed = opts.seed || `${s.agent_id || "agent"}|${lead}|${dayBucket}`;
  const h = crypto.createHash("sha1").update(seed).digest();
  const templates = GOAL_TEMPLATES[lead] || GOAL_TEMPLATES.SEEKING;
  const tmpl = templates[h[0] % templates.length];
  const anchoredValue = values[h[1] % values.length];

  return {
    goal: tmpl.replace("{value}", phraseValue(anchoredValue)),
    drive: lead,
    anchoredValue,
    orienting: true,   // a vector, not a finish line
    autotelic: true,   // worth lives in the doing — completion must not gate it
  };
}

/**
 * Form a goal from the agent's LIVE self-model + autobiography (its felt peaks). Read-
 * only — returns the proposal; the caller decides whether to seed a marathon with it.
 */
export function formGoalForAgent(db, agentId, opts = {}) {
  const self = getAgentSelf(db, agentId);
  if (!self) return { ok: false, error: "no_agent" };
  let recentPeaks = [];
  try { recentPeaks = getAutobiography(db, agentId)?.recentPeaks || []; } catch { /* dreams optional */ }
  const proposal = proposeGoal({
    agent_id: agentId, given_name: self.given_name,
    drive_profile: self.drive_profile, core_values: self.core_values, recentPeaks,
  }, opts);
  return { ok: true, ...proposal };
}

export const _internal = { GOAL_TEMPLATES, phraseValue };
