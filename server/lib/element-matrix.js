// server/lib/element-matrix.js
//
// Universal Move System — WS-CHEMISTRY. The single declarative source of truth for
// how elements interact, modelled on Breath of the Wild's "Elements vs Materials"
// (multiplicative gameplay from a few consistent rules):
//   Rule 1 — an element can change a MATERIAL's state (fire ignites wood).
//   Rule 2 — an element can change another ELEMENT's state (water douses fire → steam).
//   Rule 3 — materials don't change other materials.
//
// This is the table the chemistry verbs (ignite/douse/freeze/electrify/create-steam),
// the combat element coupling (embodied/skill-environment.js), the signal-propagation
// cascade (embodied/signal-propagation.js), and the "[System]" affordance prompter all
// read — so a player can reason "fire + this = that" everywhere, the same way.
// Pure + symmetric-aware; no DB.

// Canonical elements (aligned with move-catalog ELEMENT_EFFECT_BIAS).
export const ELEMENTS = [
  "fire", "water", "ice", "frost", "lightning", "energy", "bio", "poison",
  "earth", "air", "wind", "nature", "light", "shadow", "physical",
];

// Materials a cell/target/building can be made of (BOTW "materials").
export const MATERIALS = [
  "wood", "thatch", "grass", "stone", "metal", "water_surface", "oil", "ice_sheet", "flesh", "cloth",
];

// ── Rule 2: element × element → reaction (order-independent) ──────────────────
// Each entry: { result, note, douses?, freezes?, conducts? }
const EE = {
  "fire|water":     { result: "steam",    douses: true,  note: "water quenches fire, billows steam (cleanses poison)" },
  "fire|ice":       { result: "water",    douses: true,  note: "fire melts ice into water" },
  "fire|frost":     { result: "water",    douses: true,  note: "fire melts frost into water" },
  "fire|nature":    { result: "wildfire", note: "fire ignites growth — spreads" },
  "fire|poison":    { result: "burnoff",  note: "fire burns off the toxin cloud" },
  "water|lightning":{ result: "electrocute", conducts: true, note: "lightning electrifies water — chains to anything wet" },
  "ice|lightning":  { result: "shatter",  note: "lightning shatters ice" },
  "water|ice":      { result: "freeze",   freezes: true, note: "cold water freezes to ice" },
  "water|frost":    { result: "freeze",   freezes: true, note: "frost freezes standing water" },
  "fire|air":       { result: "flare",    note: "wind fans flame — bigger, hotter" },
  "fire|wind":      { result: "flare",    note: "wind fans flame — bigger, hotter" },
  "lightning|energy": { result: "overload", note: "compounding charge — overload burst" },
};

// ── Rule 1: element × material → reaction ─────────────────────────────────────
const EM = {
  "fire|wood":          { result: "ignite", ignites: true, note: "wood catches fire" },
  "fire|thatch":        { result: "ignite", ignites: true, note: "thatch catches fast" },
  "fire|grass":         { result: "ignite", ignites: true, note: "grass burns and spreads" },
  "fire|oil":           { result: "ignite", ignites: true, note: "oil erupts" },
  "fire|ice_sheet":     { result: "melt",   note: "ice sheet melts to water" },
  "fire|cloth":         { result: "ignite", ignites: true, note: "cloth burns" },
  "ice|water_surface":  { result: "freeze", freezes: true, note: "water surface freezes solid — walkable" },
  "frost|water_surface":{ result: "freeze", freezes: true, note: "water surface freezes solid" },
  "lightning|metal":    { result: "conduct", conducts: true, note: "metal conducts — arcs to holder" },
  "lightning|water_surface": { result: "conduct", conducts: true, note: "standing water conducts the bolt" },
  "water|fire_source":  { result: "douse",  douses: true, note: "douses a burning source" },
  "water|oil":          { result: "spread", note: "oil floats and spreads on water" },
  "bio|earth":          { result: "bloom",  note: "growth accelerates in soil" },
  "nature|earth":       { result: "bloom",  note: "growth accelerates in soil" },
};

const key2 = (a, b) => [a, b].sort().join("|");

// Normalize EE to sorted-pair keys so the literal table above can be authored in
// any order while lookups stay order-independent.
const EE_NORM = {};
for (const [k, v] of Object.entries(EE)) { const [a, b] = k.split("|"); EE_NORM[key2(a, b)] = v; }

/** Element × element reaction (order-independent), or null. */
export function elementVsElement(a, b) {
  if (!a || !b) return null;
  return EE_NORM[key2(String(a).toLowerCase(), String(b).toLowerCase())] || null;
}

/** Element × material reaction, or null. (Materials never change materials — Rule 3.) */
export function elementVsMaterial(element, material) {
  if (!element || !material) return null;
  return EM[`${String(element).toLowerCase()}|${String(material).toLowerCase()}`] || null;
}

/** Does this element ignite this material? (combat/terrain spread hook) */
export function ignites(element, material) {
  return !!elementVsMaterial(element, material)?.ignites;
}

/** Does applying `incoming` to a cell already carrying `present` douse/extinguish it? */
export function douses(incoming, present) {
  const r = elementVsElement(incoming, present);
  return !!(r && r.douses);
}

/** All reactions a given element can drive — powers the "[System]" affordance prompter. */
export function reactionsFor(element) {
  const el = String(element || "").toLowerCase();
  const out = [];
  for (const [k, v] of Object.entries(EE)) { const [a, b] = k.split("|"); if (a === el || b === el) out.push({ with: a === el ? b : a, kind: "element", ...v }); }
  for (const [k, v] of Object.entries(EM)) { const [e, m] = k.split("|"); if (e === el) out.push({ with: m, kind: "material", ...v }); }
  return out;
}
