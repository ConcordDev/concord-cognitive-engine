// server/lib/prop-verb-registry.js
//
// Phase II Wave 27 — every prop has 3-6 verbs.
//
// Existing signal-propagation.js handles thermal/moisture/electric
// cascades. This module gives each gameplay prop a verb table that
// the world routes interaction through. Verbs may emit signals into
// the signal-propagation cascade, in which case downstream entities
// react organically (e.g. break a lamp → ambient_db spike + light
// drop → witnesses).

export const PROP_VERBS = Object.freeze({
  lever: [
    { verb: "activate", signal: null, cooldownMs: 500 },
    { verb: "force",    signal: { kind: "tactile_force_os.structural_stress", value: 0.5 }, cooldownMs: 2000 },
  ],
  barrel: [
    { verb: "roll",     signal: null, cooldownMs: 500 },
    { verb: "explode",  signal: { kind: "thermal_os.ambient_temp", value: +18, ttlSec: 12 }, cooldownMs: 30000 },
    { verb: "smash",    signal: { kind: "sonic_os.ambient_db", value: 18, ttlSec: 4 }, cooldownMs: 1000 },
  ],
  statue: [
    { verb: "topple",   signal: { kind: "sonic_os.ambient_db", value: 22, ttlSec: 6 }, cooldownMs: 30000 },
    { verb: "climb",    signal: null, cooldownMs: 1000 },
    { verb: "deface",   signal: null, cooldownMs: 2000 },
  ],
  lamp: [
    { verb: "ignite",   signal: { kind: "sight_os.illumination", value: +30000, ttlSec: 600 }, cooldownMs: 500 },
    { verb: "extinguish", signal: { kind: "sight_os.illumination", value: -30000, ttlSec: 600 }, cooldownMs: 500 },
    { verb: "break",    signal: { kind: "sight_os.illumination", value: -30000, ttlSec: 86400 }, cooldownMs: 2000 },
  ],
  door: [
    { verb: "open",     signal: null, cooldownMs: 300 },
    { verb: "lock",     signal: null, cooldownMs: 500 },
    { verb: "kick",     signal: { kind: "sonic_os.ambient_db", value: 12, ttlSec: 4 }, cooldownMs: 1500 },
  ],
  brazier: [
    { verb: "ignite",   signal: { kind: "thermal_os.ambient_temp", value: +6, ttlSec: 600 }, cooldownMs: 500 },
    { verb: "douse",    signal: { kind: "thermal_os.ambient_temp", value: -6, ttlSec: 600 }, cooldownMs: 500 },
  ],
  crate: [
    { verb: "open",    signal: null, cooldownMs: 300 },
    { verb: "smash",   signal: { kind: "sonic_os.ambient_db", value: 10, ttlSec: 3 }, cooldownMs: 1500 },
    { verb: "stack",   signal: null, cooldownMs: 800 },
  ],
  rope: [
    { verb: "cut",      signal: null, cooldownMs: 500 },
    { verb: "climb",    signal: null, cooldownMs: 500 },
    { verb: "lasso",    signal: null, cooldownMs: 1500 },
  ],
  fountain: [
    { verb: "drink",    signal: { kind: "chemical_os.humidity", value: +0.05, ttlSec: 60 }, cooldownMs: 1000 },
    { verb: "poison",   signal: { kind: "chemical_os.air_quality", value: -0.6, ttlSec: 3600 }, cooldownMs: 5000 },
    { verb: "purify",   signal: { kind: "chemical_os.air_quality", value: +0.4, ttlSec: 600 }, cooldownMs: 5000 },
  ],
});

export function getVerbsForProp(propKind) {
  return PROP_VERBS[String(propKind || "").toLowerCase()] || [];
}

export function hasVerb(propKind, verb) {
  return getVerbsForProp(propKind).some((v) => v.verb === verb);
}

export function listAllPropKinds() {
  return Object.keys(PROP_VERBS);
}

export function resolveVerbInvocation(propKind, verb) {
  const all = getVerbsForProp(propKind);
  const found = all.find((v) => v.verb === verb);
  if (!found) return { ok: false, reason: "unknown_verb", availableVerbs: all.map((v) => v.verb) };
  return {
    ok: true,
    propKind,
    verb,
    signal: found.signal || null,
    cooldownMs: found.cooldownMs,
  };
}
