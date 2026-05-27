// server/lib/disguise-system.js
//
// Phase II Wave 27 — disguise + recognition.
//
// A player can acquire a disguise (NPC kill, quest reward) and wear
// it to fool NPCs. Recognition probability is computed per look-at:
//
//   recognise = base_recognition (0.30)
//             + familiarity / 100 × 0.40            // known characters are harder to fool
//             + same_faction × 0.15
//             - lighting / 200                       // bright = easier to recognise, dark hides
//             - distance / 30                        // far = harder to recognise
//
// Caller passes the inputs (familiarity is the character_opinions
// score for that observer, faction match is a bool, lighting is the
// embodied/signals.js illumination value). Engine returns a 0..1
// probability; the caller rolls.

export const DISGUISE_BASE_RECOGNITION = 0.30;

export function probabilityOfRecognition(opts = {}) {
  // Use Number.isFinite checks (not `|| default`) since q=0 and dist=0
  // are valid finite values that the falsy-fallback would override.
  const familiarity = Math.max(0, Math.min(100, Number.isFinite(Number(opts.familiarity)) ? Number(opts.familiarity) : 0));
  const sameFaction = !!opts.sameFaction;
  const lighting    = Math.max(0, Math.min(80000, Number.isFinite(Number(opts.illuminationLux)) ? Number(opts.illuminationLux) : 0));
  const distanceM   = Math.max(0, Math.min(100, Number.isFinite(Number(opts.distanceM)) ? Number(opts.distanceM) : 5));
  const disguiseQ   = Math.max(0, Math.min(1, Number.isFinite(Number(opts.disguiseQuality)) ? Number(opts.disguiseQuality) : 0.5));
  let p =
    DISGUISE_BASE_RECOGNITION
    + (familiarity / 100) * 0.40
    + (sameFaction ? 0.15 : 0)
    - (lighting / 200000)
    - (distanceM / 30);
  p -= disguiseQuality_modifier(disguiseQ);
  return Math.max(0, Math.min(1, p));
}

function disguiseQuality_modifier(q) {
  // Quality 0 = generic peasant cloak (almost no benefit);
  // Quality 1 = bespoke prosthetic-mask disguise (huge benefit).
  return q * 0.45;
}

/**
 * Roll recognition against a probability.
 *   - opts.rollOverride forces a deterministic outcome (tests)
 */
export function rollRecognition(opts = {}) {
  const p = probabilityOfRecognition(opts);
  const roll = Number.isFinite(opts.rollOverride) ? Number(opts.rollOverride) : Math.random();
  const recognised = roll < p;
  return { ok: true, recognised, probability: p, roll };
}

export const DISGUISE_CONSTANTS = Object.freeze({
  DISGUISE_BASE_RECOGNITION,
});
