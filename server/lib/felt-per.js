// server/lib/felt-per.js
//
// Wave 7 / Layer 6 — the FELT-PER appraisal: the "missing middle" that turns a log
// into a diary. Memory stores WHAT happened (events) and character stores WHO you
// are (drives), but nothing between them stores HOW EACH MOMENT FELT. This layer is
// that middle. It has three jobs, all from one appraisal:
//
//   1. qualia texture — appraiseExperience(event, state) tags one experience with
//      how it felt {valence, arousal, dominantDrive, intensity}, RELATIVE to the
//      agent's current state. The same bread is relief when starving, nothing when
//      sated. The loop: prior character (state.affect) colors the next appraisal —
//      a grieving agent appraises everything darker (mood congruence).
//   2. memory filter — peakEnd(fragments) keeps the felt PEAK + the END and drops the
//      dull middle (Kahneman peak-end rule + duration neglect). The diary line.
//   3. salience / retention — feltPeakBonus(feltPer) is the term forgetting adds so
//      emotionally-intense memories outlive dull ones, and consolidation clusters
//      character around what was felt strongly.
//
// Pure + total. Rides on dtu.machine.feltPer (zero migration). Reuses Layer 2
// (computeCoreAffect) for the baseline and Layer 3 (the Panksepp drive vocabulary).

import { computeCoreAffect } from "./ecosystem/core-affect.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const clamp11 = (x) => Math.max(-1, Math.min(1, Number(x) || 0));

// Mood-congruence weight: how much the agent's current baseline colors a new
// appraisal (the loop — character shapes perception). 0 = pure stimulus, 1 = pure mood.
const MOOD_COLOR = 0.3;

// Appraisal rules per experience kind. `needKey` events (eat/drink/rest/mate) scale
// by the LIVE deficit they relieve — that's what makes the same event feel different
// by state. Harm events scale by an explicit `magnitude` hint (e.g. damage / 100).
const APPRAISAL = Object.freeze({
  eat:         { valence: +1.0, arousal: 0.40, drive: "SEEKING", needKey: "hunger" },
  drink:       { valence: +1.0, arousal: 0.40, drive: "SEEKING", needKey: "thirst" },
  rest:        { valence: +0.6, arousal: 0.10, drive: "PLAY",    needKey: "energy" },
  mate:        { valence: +0.9, arousal: 0.70, drive: "LUST",    needKey: "reproduction" },
  attacked:    { valence: -1.0, arousal: 0.90, drive: "FEAR" },
  pain:        { valence: -0.9, arousal: 0.80, drive: "FEAR" },
  predator:    { valence: -0.8, arousal: 0.90, drive: "FEAR" },
  kill_prey:   { valence: +0.7, arousal: 0.70, drive: "RAGE" },
  victory:     { valence: +0.8, arousal: 0.70, drive: "RAGE" },
  defeat:      { valence: -0.8, arousal: 0.60, drive: "PANIC" },
  social_warm: { valence: +0.6, arousal: 0.40, drive: "CARE" },
  social_snub: { valence: -0.5, arousal: 0.40, drive: "PANIC" },
  bonding:     { valence: +0.7, arousal: 0.40, drive: "CARE" },
  explore:     { valence: +0.3, arousal: 0.30, drive: "SEEKING" },
  acquire:     { valence: +0.4, arousal: 0.30, drive: "SEEKING" },
  loss:        { valence: -0.9, arousal: 0.60, drive: "PANIC" },
  grief:       { valence: -1.0, arousal: 0.50, drive: "PANIC" },
  idle:        { valence: 0.0,  arousal: 0.05, drive: null },
});

/**
 * Map a raw fragment (dream-engine gatherFragments shape: damage_events, pain,
 * inventory, world_visits, dtus) to an appraisal `kind`. Best-effort + total —
 * unknown shapes fall through to "idle" (a dull moment).
 */
export function classifyFragment(fragment) {
  const f = fragment || {};
  if (f.kind && APPRAISAL[f.kind]) return f.kind;
  const t = String(f.type || f.source || f.event || "").toLowerCase();
  if (/attack|hit|wound|damage_taken|hurt/.test(t)) return "attacked";
  if (/pain/.test(t)) return "pain";
  if (/predator|threat/.test(t)) return "predator";
  if (/kill|slay/.test(t)) return "kill_prey";
  if (/eat|food|cook|meal/.test(t)) return "eat";
  if (/drink|water/.test(t)) return "drink";
  if (/rest|sleep/.test(t)) return "rest";
  if (/death|died|grief|funeral|tomb/.test(t)) return "grief";
  if (/loss|lost|stolen|destroyed/.test(t)) return "loss";
  if (/visit|explore|travel|discover/.test(t)) return "explore";
  if (/acquire|gain|loot|inventory|craft/.test(t)) return "acquire";
  if (/snub|ignored|rejected/.test(t)) return "social_snub";
  if (/friend|bond|warm|greet/.test(t)) return "social_warm";
  if (/win|victory|triumph/.test(t)) return "victory";
  if (/defeat|lose/.test(t)) return "defeat";
  return "idle";
}

/**
 * Appraise ONE discrete experience against the agent's CURRENT state. This is the
 * qualia texture — what this moment was like for THIS agent right now.
 *
 * @param {object} event  { kind?, magnitude? } — kind from APPRAISAL or auto-classified
 * @param {object} state  { needs?, affect?:{v,a}, drives? } — the live agent state.
 *                        If affect omitted, it is derived from needs via computeCoreAffect.
 * @returns {{ valence:number, arousal:number, dominantDrive:string|null, intensity:number }}
 */
export function appraiseExperience(event, state = {}) {
  const s = state || {};
  const kind = (event && event.kind && APPRAISAL[event.kind]) ? event.kind : classifyFragment(event);
  const rule = APPRAISAL[kind] || APPRAISAL.idle;
  const needs = s.needs || {};

  // Baseline affect — the MOOD the experience lands in (used only for mood-congruent
  // coloring of the felt valence, i.e. the loop). Provided, else derived from the
  // live needs — reuses Layer 2.
  const prior = (s.affect && Number.isFinite(Number(s.affect.v)))
    ? { v: clamp11(s.affect.v), a: clamp01(s.affect.a) }
    : computeCoreAffect({ salience: 0 }, needs, {});

  // need-scaled events: magnitude is the live deficit being relieved. This is what
  // makes eating-when-starving a big event and eating-when-full ~nil.
  const scale = rule.needKey ? clamp01(needs[rule.needKey]) : 1;
  const magHint = Number.isFinite(Number(event?.magnitude)) ? clamp01(event.magnitude) : 1;

  const rawValence = clamp11(rule.valence * scale * magHint);
  const arousal = clamp01(rule.arousal * (rule.needKey ? (0.3 + 0.7 * scale) : 1) * magHint);

  // Mood congruence (the loop): the felt valence is pulled toward the baseline, so a
  // grieving agent darkens even a positive event.
  const valence = clamp11((1 - MOOD_COLOR) * rawValence + MOOD_COLOR * prior.v);

  // Intensity = how much it MOVED you: arousal × the raw valence shift from neutral
  // (state-scaled). A starving bread (large raw relief) scores high; a sated bread
  // (raw relief ≈ 0 because the deficit is gone) ≈ nil.
  const intensity = clamp01(arousal * Math.abs(rawValence));

  return { valence, arousal, dominantDrive: rule.drive, intensity };
}

/**
 * Kahneman peak-end selection over a list of appraised fragments. Returns the
 * highest-intensity fragment (the peak) and the last one (the end) — the two
 * moments memory actually keeps. Each fragment may carry `.feltPer` (an appraisal)
 * or be appraised already. Total: empty/garbage → { peak:null, end:null }.
 */
export function peakEnd(fragments) {
  const list = Array.isArray(fragments) ? fragments.filter((f) => f != null) : [];
  if (list.length === 0) return { peak: null, end: null };
  let peak = null;
  let peakI = -1;
  for (const f of list) {
    const fp = f.feltPer || f;
    const i = clamp01(fp?.intensity);
    if (i > peakI) { peakI = i; peak = f; }
  }
  return { peak, end: list[list.length - 1] };
}

/**
 * The retention term the forgetting-engine adds (emotionalBonus). Emotionally
 * intense AND valence-extreme memories stick — a quiet moment fades, a peak or a
 * trauma endures. 0..1. Total.
 */
export function feltPeakBonus(feltPer) {
  if (!feltPer || typeof feltPer !== "object") return 0;
  const intensity = clamp01(feltPer.intensity);
  const extremity = clamp01(Math.abs(Number(feltPer.valence) || 0));
  return clamp01(0.6 * intensity + 0.4 * extremity);
}

export const _internal = { MOOD_COLOR, APPRAISAL };
