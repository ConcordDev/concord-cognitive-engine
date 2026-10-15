// server/lib/conkay/chat/quantities.js
//
// Every number in a chat message, with the unit written after it, read to SI through compiler/units.js. A word
// after a number is a unit, a count noun ("4 seats"), a connector ("2 to 5"), or an error: an unknown unit is
// never guessed ("500 zorks" is an error, not 500 N). Ambiguous units are errors too ("ton": short, long or
// metric?). Numbers inside a word or a grade ("M1", "6061-T6", "A36") are not quantities.
//
//   scanQuantities(text) -> { quantities: [{ raw, value, unitText, unit, dim, si, index, end }],
//                             counts: [{ raw, value, noun, index, end }], bare: [{ raw, value, index, end }],
//                             errors: [{ raw, index, error }] }

import { parseQuantity } from "../compiler/units.js";

export const CHAT_QUANTITIES_VERSION = "1.0.0";

const LOWER_TO_UNIT = {
  // length
  mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  km: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  in: "in", inch: "in", inches: "in", '"': "in",
  ft: "ft", foot: "ft", feet: "ft", "'": "ft",
  // force
  n: "N", newton: "N", newtons: "N", kn: "kN", kilonewton: "kN", kilonewtons: "kN", mn: "MN",
  lbf: "lbf", kip: "kip", kips: "kip",
  // mass (a mass given as a load is converted to its weight, and said so)
  kg: "kg", kilogram: "kg", kilograms: "kg", g: "g", gram: "g", grams: "g", tonne: "t", tonnes: "t",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  // speed
  mph: "mph", "km/h": "km/h", kph: "km/h", kmh: "km/h", "m/s": "m/s",
  // power
  hp: "hp", horsepower: "hp", w: "W", watt: "W", watts: "W", kw: "kW", kilowatt: "kW", kilowatts: "kW", mw: "MW",
  // pressure / stress
  pa: "Pa", kpa: "kPa", mpa: "MPa", gpa: "GPa", psi: "psi", ksi: "ksi",
  // energy
  wh: "Wh", kwh: "kWh",
  // torque
  nm: "Nm", "n·m": "Nm", "n-m": "Nm",
};

// units the compiler's units.js does not carry: [dimension, factor to SI]
const LBF_PER_FT = 4.4482216152605 / 0.3048; // N/m in one lbf/ft
const EXTRA = {
  mi: ["length", 1609.344], mile: ["length", 1609.344], miles: ["length", 1609.344],
  "n/m": ["force_per_length", 1], "kn/m": ["force_per_length", 1e3], "lbf/ft": ["force_per_length", LBF_PER_FT],
  plf: ["force_per_length", LBF_PER_FT], klf: ["force_per_length", 1000 * LBF_PER_FT], "kip/ft": ["force_per_length", 1000 * LBF_PER_FT],
  "kn·m": ["torque", 1e3], knm: ["torque", 1e3],
  deg: ["angle", Math.PI / 180], degree: ["angle", Math.PI / 180], degrees: ["angle", Math.PI / 180], "°": ["angle", Math.PI / 180],
  "%": ["ratio", 0.01], percent: ["ratio", 0.01],
};

const AMBIGUOUS = { ton: "short (907 kg), long (1016 kg) or metric (1000 kg) ton? Write tonne, or the mass in kg or lb", tons: "short (907 kg), long (1016 kg) or metric (1000 kg) ton? Write tonne, or the mass in kg or lb" };

export const COUNT_NOUNS = new Set([
  "people", "person", "persons", "passenger", "passengers", "adult", "adults", "occupant", "occupants", "seat", "seats", "seater",
  "door", "doors", "wheel", "wheels", "panel", "panels", "bay", "bays", "member", "members", "joint", "joints", "node", "nodes",
  "axle", "axles", "kid", "kids", "child", "children",
]);

// words that may follow a number without being its unit
const CONNECTORS = new Set(["and", "or", "to", "of", "by", "at", "with", "for", "per", "x", "plus", "times", "more", "less", "is", "the", "a", "an"]);

// material grades and part designations: numbers inside them are not quantities
const MASKS = [/\$\s?\d[\d,]*(?:\.\d+)?\s*[kKmM]?\b/g, /\b(?:aluminu?m|aluminium)?\s*(?:6061|7075|6063|2024)(?:-t\d+)?\b/gi, /\b[a-z]+\d+[a-z0-9-]*\b/gi, /\b(?:304|316)\s+stainless\b/gi, /\b(?:4140|8620)\s+steel\b/gi];

const NUMBER = /(?<![\w.])(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(-)\s*|\s*)(%|°|["']|[a-zA-Z][a-zA-Z·]*(?:\/[a-zA-Z]+)?)?/g;

function toSI(value, unitText) {
  const lower = unitText.toLowerCase();
  if (EXTRA[lower]) return { unit: lower, dim: EXTRA[lower][0], si: value * EXTRA[lower][1] };
  const unit = LOWER_TO_UNIT[lower] ?? LOWER_TO_UNIT[unitText];
  if (!unit) return null;
  const q = parseQuantity({ value, unit });
  return q.ok ? { unit, dim: q.dim, si: q.si } : null;
}

export function scanQuantities(text) {
  const src = String(text || "");
  // blank out masked spans (same length, so indices hold)
  let masked = src;
  for (const re of MASKS) masked = masked.replace(re, (m) => " ".repeat(m.length));
  const out = { quantities: [], counts: [], bare: [], errors: [] };
  for (const m of masked.matchAll(NUMBER)) {
    const raw = src.slice(m.index, m.index + m[0].length).trim();
    const value = Number(m[1].replace(/,/g, ""));
    const unitText = m[3] || "";
    const end = m.index + m[0].length;
    if (!unitText) { out.bare.push({ raw, value, index: m.index, end }); continue; }
    const lower = unitText.toLowerCase();
    if (AMBIGUOUS[lower]) { out.errors.push({ raw, index: m.index, error: `ambiguous unit "${unitText}": ${AMBIGUOUS[lower]}` }); continue; }
    const q = toSI(value, unitText);
    if (q) { out.quantities.push({ raw, value, unitText, unit: q.unit, dim: q.dim, si: q.si, index: m.index, end }); continue; }
    if (COUNT_NOUNS.has(lower)) { out.counts.push({ raw, value, noun: lower, index: m.index, end }); continue; }
    if (CONNECTORS.has(lower) && !m[2]) { out.bare.push({ raw: m[1], value, index: m.index, end: m.index + m[1].length }); continue; }
    out.errors.push({ raw, index: m.index, error: `unknown unit "${unitText}" after ${m[1]}: not read as any quantity (write it in N, kN, lbf, kg, lb, mm, m, in, ft, mph, km/h, ...)` });
  }
  return out;
}

/** The words around a match (lower case), for reading what a quantity is. */
export function around(text, q, before = 40, after = 24) {
  const s = String(text);
  return { pre: s.slice(Math.max(0, q.index - before), q.index).toLowerCase(), post: s.slice(q.end, q.end + after).toLowerCase() };
}
