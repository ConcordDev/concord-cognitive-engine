/**
 * Concordia megaworld — world identity is a spatial field, not a separate map.
 *
 * Every point on the supercontinent has overlapping civilization influences.
 * Local rules (magic, tech, domain affinity) are derived from that field.
 * Geographic effectiveness is physics: the same formula for a player, an NPC,
 * a boss, a dragon, a summoned creature, a faction army, or equipment.
 *
 * Discrete WorldId combat (`cross-world-potency.js`) remains the live path
 * until travel streams continuous (x,z). This module is the continuous law.
 *
 * Hub is a suppression well (Flower Law), not a ninth combat physics.
 * Authored skill_affinity tables at field centers are the blend weights —
 * do not invent a second affinity table.
 *
 *   cd server && node --test tests/concordia-world-field.test.js
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NEUTRAL_AFFINITY } from "./skill-domains.js";

/** Actor kinds the field treats identically. Branching on kind is a bug. */
export const FIELD_ACTOR_KINDS = Object.freeze([
  "player", "person", "npc", "boss", "dragon", "creature", "summoned",
  "faction", "equipment", "infrastructure",
]);

/**
 * Field channels. Keys are short; world ids map through FIELD_WORLD_IDS.
 * Sere has no Link gate — it still has a center (off-ring, no teleport).
 */
export const FIELD_KEYS = Object.freeze([
  "hub", "fantasy", "crime", "cyber", "superhero", "frontier", "tunya", "sovereign", "lattice", "sere",
]);

export const FIELD_WORLD_IDS = Object.freeze({
  hub: "concordia-hub",
  fantasy: "fantasy",
  crime: "crime",
  cyber: "cyber",
  superhero: "superhero",
  frontier: "concord-link-frontier",
  tunya: "tunya",
  sovereign: "sovereign-ruins",
  lattice: "lattice-crucible",
  sere: "sere",
});

const WORLD_TO_KEY = Object.freeze(Object.fromEntries([
  ...Object.entries(FIELD_WORLD_IDS).map(([k, id]) => [id, k]),
  ["hub", "hub"],
  ["concordia-hub", "hub"],
]));

/**
 * Gate bearings copied from Unity Canon.Gates (radians).
 * These are civilization field centers on one plane, not portal destinations.
 * Pin: tests/concordia-world-field.test.js reads Canon.cs.
 */
export const FIELD_GATE_ANGLES = Object.freeze({
  cyber: 0,
  sovereign: Math.PI / 4,
  fantasy: Math.PI / 2,
  tunya: 3 * Math.PI / 4,
  frontier: Math.PI,
  crime: 5 * Math.PI / 4,
  superhero: 3 * Math.PI / 2,
  lattice: 7 * Math.PI / 4,
});

/** Megaworld kilometres. Not Unity Hub plaza metres (Canon.RingRadius = 34). */
export const MEGAWORLD_KM = Object.freeze({
  civilizationRadius: 400,
  sigma: 410,
  hubCourt: 12,
  hubMetro: 40,
});

/** Softmax-ish: nearest center owns core physics; neighbors mix in the bands. */
export const BLEND_SHARPNESS = 8;

/** Same cap as Pillar-3 MASTER_LEVEL default — Fire 94 → crime floor ≈ 0.29. */
export const GEO_NATIVE_CAP = 200;

const CONTENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../content/world");

const FOLDER_FOR_KEY = Object.freeze({
  fantasy: "fantasy",
  crime: "crime",
  cyber: "cyber",
  superhero: "superhero",
  frontier: "concord-link-frontier",
  tunya: "tunya",
  sovereign: "sovereign-ruins",
  lattice: "lattice-crucible",
  sere: "sere",
  hub: null,
});

const _affinityCache = new Map();
const _inject = new Map();

export function fieldKeyForWorld(worldId) {
  const id = String(worldId || "").trim().toLowerCase();
  return WORLD_TO_KEY[id] || null;
}

export function worldIdForFieldKey(key) {
  return FIELD_WORLD_IDS[key] || null;
}

/** Test-only: override a center's affinity table. */
export function injectCenterAffinity(key, table) {
  _inject.set(key, table && typeof table === "object" ? table : null);
}

export function resetCenterAffinityInjects() {
  _inject.clear();
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function hypot2(x, z) {
  return Math.hypot(Number(x) || 0, Number(z) || 0);
}

function gaussian(distanceKm, sigmaKm) {
  const s = sigmaKm || MEGAWORLD_KM.sigma;
  const d = Number(distanceKm) || 0;
  return Math.exp(-((d / s) * (d / s)));
}

/**
 * Field-center coordinates. Hub is the origin. Gated civs sit on the
 * Canon ring. Sere has no gate — off-ring, crime-adjacent, farther out.
 */
export function fieldCenter(key) {
  if (key === "hub") return { key: "hub", x: 0, z: 0, hasLinkGate: true, radiusKm: 0 };
  const R = MEGAWORLD_KM.civilizationRadius;
  if (key === "sere") {
    const angle = FIELD_GATE_ANGLES.crime + 0.35;
    const r = R * 1.35;
    return {
      key, x: r * Math.cos(angle), z: r * Math.sin(angle),
      hasLinkGate: false, radiusKm: r, angle,
    };
  }
  const angle = FIELD_GATE_ANGLES[key];
  if (angle == null) return null;
  return {
    key, x: R * Math.cos(angle), z: R * Math.sin(angle),
    hasLinkGate: true, radiusKm: R, angle,
  };
}

export function allFieldCenters() {
  return FIELD_KEYS.map(fieldCenter).filter(Boolean);
}

function hubWell(distanceKm) {
  const { hubCourt, hubMetro } = MEGAWORLD_KM;
  if (distanceKm <= hubCourt) return 1;
  if (distanceKm >= hubMetro) return 0;
  const t = (distanceKm - hubCourt) / (hubMetro - hubCourt);
  return clamp01(1 - t * t);
}

function loadAuthoredAffinity(key) {
  if (_inject.has(key)) {
    const inj = _inject.get(key);
    return inj || { ...NEUTRAL_AFFINITY, default: 0.7 };
  }
  if (_affinityCache.has(key)) return _affinityCache.get(key);
  const folder = FOLDER_FOR_KEY[key];
  if (!folder) {
    const hub = { ...NEUTRAL_AFFINITY, default: 0.7 };
    _affinityCache.set(key, hub);
    return hub;
  }
  try {
    const raw = JSON.parse(readFileSync(join(CONTENT_ROOT, folder, "meta.json"), "utf8"));
    const table = raw?.skill_affinity && typeof raw.skill_affinity === "object"
      ? raw.skill_affinity
      : { ...NEUTRAL_AFFINITY, default: 0.7 };
    _affinityCache.set(key, table);
    return table;
  } catch {
    const fallback = { ...NEUTRAL_AFFINITY, default: 0.7 };
    _affinityCache.set(key, fallback);
    return fallback;
  }
}

export function centerAffinity(key, domain) {
  const table = loadAuthoredAffinity(key);
  if (table[domain] != null && Number.isFinite(Number(table[domain]))) {
    return clamp01(table[domain]);
  }
  if (table.default != null && Number.isFinite(Number(table.default))) {
    return clamp01(table.default);
  }
  return clamp01(NEUTRAL_AFFINITY[domain] ?? 0.7);
}

function pickTransition(influences, hubInfluence) {
  if (hubInfluence >= 0.45) return { ok: false, reason: "hub_well" };
  const ranked = FIELD_KEYS
    .filter((k) => k !== "hub")
    .map((k) => ({ key: k, v: influences[k] || 0 }))
    .sort((a, b) => b.v - a.v);
  const a = ranked[0];
  const b = ranked[1];
  if (!a || !b) return { ok: false, reason: "no_pair" };
  if (a.v < 0.22 || b.v < 0.22) return { ok: false, reason: "single_dominant" };
  if (Math.abs(a.v - b.v) > 0.35) return { ok: false, reason: "single_dominant" };
  return { ok: true, a: a.key, b: b.key, aInfluence: a.v, bInfluence: b.v };
}

/**
 * WorldField at a megaworld (x, z) in kilometres.
 */
export function fieldAt(x, z) {
  const px = Number(x);
  const pz = Number(z);
  if (!Number.isFinite(px) || !Number.isFinite(pz)) {
    return { ok: false, reason: "missing_position" };
  }
  const influences = {};
  for (const key of FIELD_KEYS) {
    if (key === "hub") continue;
    const c = fieldCenter(key);
    influences[key] = gaussian(Math.hypot(px - c.x, pz - c.z), MEGAWORLD_KM.sigma);
  }
  const distHub = hypot2(px, pz);
  const hub = hubWell(distHub);
  influences.hub = hub;
  let dominant = "hub";
  let best = hub;
  for (const key of FIELD_KEYS) {
    if ((influences[key] || 0) > best) {
      best = influences[key];
      dominant = key;
    }
  }
  const flowerLaw = hub >= 0.85 || distHub <= MEGAWORLD_KM.hubCourt;
  const transition = pickTransition(influences, hub);
  return {
    ok: true,
    x: px,
    z: pz,
    ...influences,
    dominant,
    transition,
    flowerLaw,
    steelLive: !flowerLaw,
    chaosSuppressed: hub,
    distanceFromHubKm: distHub,
  };
}

/**
 * Discrete WorldId fallback: sample the field at that civilization's center.
 * This is what live Unity Travel still implies (region rebuild).
 */
export function fieldAtWorld(worldId) {
  const key = fieldKeyForWorld(worldId);
  if (!key) return { ok: false, reason: "unknown_world" };
  if (key === "hub") return fieldAt(0, 0);
  const c = fieldCenter(key);
  return fieldAt(c.x, c.z);
}

function blendAffinity(field, domain) {
  let num = 0;
  let den = 0;
  for (const key of FIELD_KEYS) {
    if (key === "hub") continue;
    const inf = field[key] || 0;
    if (inf < 0.02) continue;
    const w = inf ** BLEND_SHARPNESS;
    num += w * centerAffinity(key, domain);
    den += w;
  }
  let mixed = den > 0 ? num / den : 0.7;
  const well = field.chaosSuppressed || 0;
  if (well > 0) mixed = mixed * (1 - well) + 0.7 * well;
  return clamp01(mixed);
}

/**
 * Local physics derived from the field. Magic/tech are the magic/tech affinities.
 */
export function localRules(field) {
  if (!field?.ok) return { ok: false, reason: field?.reason || "no_field" };
  const magic = blendAffinity(field, "magic");
  const tech = blendAffinity(field, "tech");
  return {
    ok: true,
    magic,
    tech,
    affinity: {
      magic,
      tech,
      gun: blendAffinity(field, "gun"),
      hacking: blendAffinity(field, "hacking"),
      bio_powers: blendAffinity(field, "bio_powers"),
    },
    flowerLaw: field.flowerLaw,
    steelLive: field.steelLive,
    transition: field.transition,
  };
}

export function localAffinity(field, domain) {
  if (!field?.ok) return 0.7;
  return blendAffinity(field, domain || "athletics");
}

function skillFloor(nativeStrength, adaptation) {
  const native = Math.max(0, Number(nativeStrength) || 0);
  const adapt = clamp01(adaptation);
  const fromSkill = 0.10 + 0.40 * Math.min(1, native / GEO_NATIVE_CAP);
  const fromAdapt = 0.10 + 0.50 * adapt;
  return Math.max(fromSkill, fromAdapt);
}

/**
 * Effective power at a point. Physics, not a player debuff.
 * actorKind is recorded and MUST NOT change the multiplier.
 */
export function geographicEffectiveness(opts = {}) {
  const {
    origin = null,
    x, z,
    domain = "magic",
    nativeStrength = 0,
    adaptation = 0,
    actorKind = "player",
  } = opts;
  const field = fieldAt(x, z);
  if (!field.ok) return field;
  const homeKey = fieldKeyForWorld(origin) || (FIELD_KEYS.includes(origin) ? origin : null);
  const homeInfluence = homeKey ? (field[homeKey] || 0) : 0;
  const physics = localAffinity(field, domain);
  const floor = skillFloor(nativeStrength, adaptation);
  const presence = homeKey ? homeInfluence : 1;
  const coupled = physics * (0.55 + 0.45 * presence);
  const multiplier = clamp01(Math.max(floor, coupled));
  const native = Math.max(0, Number(nativeStrength) || 0);
  const kind = FIELD_ACTOR_KINDS.includes(actorKind) ? actorKind : "player";
  return {
    ok: true,
    actorKind: kind,
    origin: homeKey,
    domain,
    nativeStrength: native,
    adaptation: clamp01(adaptation),
    x: field.x,
    z: field.z,
    homeInfluence,
    localPhysics: physics,
    coupled,
    floor,
    multiplier,
    effective: native * multiplier,
    flowerLaw: field.flowerLaw,
    steelLive: field.steelLive,
    transition: field.transition,
    dominant: field.dominant,
  };
}

/**
 * Why is this weaker here? Causal, from field + authored affinity.
 * Never a fabricated "-42% Magic Damage" popup as the mechanism.
 */
export function explainGeographicEffectiveness(opts = {}) {
  const g = geographicEffectiveness(opts);
  if (!g.ok) return g;
  const originName = g.origin || "unknown origin";
  let because;
  if (g.flowerLaw) {
    because = "The Unburned Court suppresses regional physics. Flower Law holds. Live steel does not.";
  } else if (g.transition.ok) {
    because = `Transition between ${g.transition.a} and ${g.transition.b}. Local ${g.domain} physics is ${g.localPhysics.toFixed(2)}.`;
  } else if (g.multiplier === g.coupled || Math.abs(g.multiplier - (g.localPhysics * (0.55 + 0.45 * g.homeInfluence))) < 1e-9) {
    because = `Local ${g.domain} physics is ${g.localPhysics.toFixed(2)} (${g.dominant} field). Distance from ${originName} couples at ${g.homeInfluence.toFixed(2)}.`;
  } else {
    because = `Local ${g.domain} physics is ${g.localPhysics.toFixed(2)}; residual competence from training holds a floor of ${g.floor.toFixed(2)}.`;
  }
  return {
    ok: true,
    effective: g.effective,
    multiplier: g.multiplier,
    localPhysics: g.localPhysics,
    homeInfluence: g.homeInfluence,
    floor: g.floor,
    flowerLaw: g.flowerLaw,
    because,
  };
}

/**
 * Until W3 streams (x,z), live combat has a WorldId not a megaworld point.
 * Sample the civilization center. Not a claim that Unity already walks the field.
 */
export function geographicEffectivenessAtWorld(opts = {}) {
  const key = fieldKeyForWorld(opts.worldId);
  if (!key) return { ok: false, reason: "unknown_world" };
  const c = key === "hub" ? { x: 0, z: 0 } : fieldCenter(key);
  return geographicEffectiveness({ ...opts, x: c.x, z: c.z });
}
