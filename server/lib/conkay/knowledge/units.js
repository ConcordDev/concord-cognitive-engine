// server/lib/conkay/knowledge/units.js
//
// Units for the knowledge layer: composition fractions (with their basis),
// temperature (affine) and density. Each quantity is normalised to one
// canonical unit and keeps what was written. An unknown unit is an error,
// never a default; a fraction with no stated basis stays basis "unspecified"
// rather than being assumed to be by mass.
//
// Kept separate from compiler/units.js (the Design IR's SI table) so the two
// can evolve independently; the density factors agree with it.

/** Canonical units. */
export const CANONICAL = { fraction: "1", temperature: "K", density: "kg/m3" };

// fraction → dimensionless (0..1). The basis comes from the unit when the unit
// says it (wt%, vol%, mol%), otherwise from the caller, otherwise "unspecified".
const FRACTION_UNITS = {
  "1": { factor: 1, basis: null }, fraction: { factor: 1, basis: null },
  "%": { factor: 0.01, basis: null },
  "wt%": { factor: 0.01, basis: "mass" }, "w/w%": { factor: 0.01, basis: "mass" }, "mass%": { factor: 0.01, basis: "mass" },
  "vol%": { factor: 0.01, basis: "volume" }, "v/v%": { factor: 0.01, basis: "volume" },
  "mol%": { factor: 0.01, basis: "mole" },
  ppm: { factor: 1e-6, basis: null },
};
export const FRACTION_BASES = ["mass", "volume", "mole", "unspecified"];

// temperature → K (affine: K = (x + offset) * scale ... expressed per unit)
const TEMPERATURE_UNITS = {
  K: (x) => x,
  "°C": (x) => x + 273.15, C: (x) => x + 273.15, degC: (x) => x + 273.15,
  "°F": (x) => (x - 32) * (5 / 9) + 273.15, F: (x) => (x - 32) * (5 / 9) + 273.15, degF: (x) => (x - 32) * (5 / 9) + 273.15,
};
const FROM_K = {
  K: (k) => k,
  "°C": (k) => k - 273.15,
  "°F": (k) => (k - 273.15) * (9 / 5) + 32,
};

// density → kg/m³
const DENSITY_UNITS = {
  "kg/m3": 1, "kg/m³": 1,
  "g/cm3": 1000, "g/cm³": 1000, "g/cc": 1000, "g/mL": 1000, "g/ml": 1000,
  "kg/L": 1000, "g/L": 1,
  "lb/ft3": 16.018463373960138, "lb/ft³": 16.018463373960138,
};

const num = (v) => (typeof v === "number" ? v : Number(v));

/** Normalise a fraction. Returns { ok, value (0..1), basis, original } or { ok:false, error }. */
export function normalizeFraction(value, unit, { basis } = {}) {
  const v = num(value);
  if (!Number.isFinite(v)) return { ok: false, error: `fraction is not a number: ${JSON.stringify(value)}` };
  const u = FRACTION_UNITS[String(unit ?? "")];
  if (!u) return { ok: false, error: `unknown fraction unit "${unit}"` };
  if (basis != null && !FRACTION_BASES.includes(basis)) return { ok: false, error: `unknown fraction basis "${basis}"` };
  if (u.basis && basis && basis !== "unspecified" && basis !== u.basis) {
    return { ok: false, error: `unit ${unit} says basis ${u.basis} but basis ${basis} was given` };
  }
  const out = v * u.factor;
  if (out < 0 || out > 1 + 1e-12) return { ok: false, error: `fraction ${v} ${unit} is outside 0..100%` };
  return { ok: true, value: out, basis: u.basis || basis || "unspecified", original: { value: v, unit: String(unit) } };
}

/** Normalise a temperature to K. */
export function normalizeTemperature(value, unit) {
  const v = num(value);
  if (!Number.isFinite(v)) return { ok: false, error: `temperature is not a number: ${JSON.stringify(value)}` };
  const f = TEMPERATURE_UNITS[String(unit ?? "")];
  if (!f) return { ok: false, error: `unknown temperature unit "${unit}"` };
  const k = f(v);
  if (k < 0) return { ok: false, error: `temperature ${v} ${unit} is below absolute zero` };
  return { ok: true, value: k, unit: "K", original: { value: v, unit: String(unit) } };
}

/** Convert kelvin to °C, °F or K for display. */
export function fromKelvin(k, unit) {
  const f = FROM_K[unit];
  if (!f) throw new Error(`unknown temperature unit "${unit}"`);
  return f(k);
}

/** Normalise a density to kg/m³. */
export function normalizeDensity(value, unit) {
  const v = num(value);
  if (!Number.isFinite(v)) return { ok: false, error: `density is not a number: ${JSON.stringify(value)}` };
  const f = DENSITY_UNITS[String(unit ?? "")];
  if (f == null) return { ok: false, error: `unknown density unit "${unit}"` };
  if (v <= 0) return { ok: false, error: `density must be positive (got ${v} ${unit})` };
  return { ok: true, value: v * f, unit: "kg/m3", original: { value: v, unit: String(unit) } };
}

/** Convert kg/m³ to another density unit. */
export function fromKgM3(si, unit) {
  const f = DENSITY_UNITS[unit];
  if (f == null) throw new Error(`unknown density unit "${unit}"`);
  return si / f;
}

/**
 * Convert mass fractions to volume fractions given each component's density
 * (any consistent unit). Exact algebra: φ_i = (w_i/ρ_i) / Σ(w_j/ρ_j).
 * Assumes ideal (additive) volumes and no voids; the caller must say so.
 */
export function massToVolumeFractions(w, rho) {
  if (w.length !== rho.length) throw new Error("mass fractions and densities differ in length");
  const sv = w.map((wi, i) => wi / rho[i]);
  const tot = sv.reduce((a, b) => a + b, 0);
  return sv.map((x) => x / tot);
}

export const KNOWN_UNITS = {
  fraction: Object.keys(FRACTION_UNITS),
  temperature: Object.keys(TEMPERATURE_UNITS),
  density: Object.keys(DENSITY_UNITS),
};
