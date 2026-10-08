// server/lib/conkay/compiler/units.js
//
// Unit-aware quantities for the ConKay Design IR. Every quantity in a design
// carries its unit; everything is converted to SI on the way in, and an
// unknown unit is an error, never a silent default.

const UNITS = {
  // length → m
  m: ["length", 1], mm: ["length", 1e-3], cm: ["length", 1e-2], km: ["length", 1e3],
  in: ["length", 0.0254], ft: ["length", 0.3048],
  // mass → kg
  kg: ["mass", 1], g: ["mass", 1e-3], t: ["mass", 1e3], lb: ["mass", 0.45359237],
  // force → N
  N: ["force", 1], kN: ["force", 1e3], MN: ["force", 1e6], lbf: ["force", 4.4482216152605], kip: ["force", 4448.2216152605],
  // pressure / stress → Pa
  Pa: ["pressure", 1], kPa: ["pressure", 1e3], MPa: ["pressure", 1e6], GPa: ["pressure", 1e9],
  psi: ["pressure", 6894.757293168], ksi: ["pressure", 6894757.293168],
  // density → kg/m³
  "kg/m3": ["density", 1], "kg/m³": ["density", 1], "g/cm3": ["density", 1000], "g/cm³": ["density", 1000],
  // area → m²
  m2: ["area", 1], "m²": ["area", 1], mm2: ["area", 1e-6], "mm²": ["area", 1e-6], in2: ["area", 0.00064516], "in²": ["area", 0.00064516],
  // volume → m³
  m3: ["volume", 1], "m³": ["volume", 1], L: ["volume", 1e-3],
  // velocity → m/s
  "m/s": ["velocity", 1], "km/h": ["velocity", 1 / 3.6], mph: ["velocity", 0.44704],
  // power → W (hp is mechanical horsepower, 550 ft·lbf/s)
  W: ["power", 1], kW: ["power", 1e3], MW: ["power", 1e6], hp: ["power", 745.6998715822702],
  // money
  USD: ["money", 1], "USD/kg": ["price_per_mass", 1],
  // dimensionless
  "1": ["ratio", 1], "": ["ratio", 1],
};

export const SI_UNIT = {
  length: "m", mass: "kg", force: "N", pressure: "Pa", density: "kg/m3",
  area: "m2", volume: "m3", velocity: "m/s", power: "W", money: "USD", price_per_mass: "USD/kg", ratio: "1",
};

export function knownUnit(unit) {
  return Object.prototype.hasOwnProperty.call(UNITS, unit);
}

export function dimensionOf(unit) {
  return knownUnit(unit) ? UNITS[unit][0] : null;
}

/**
 * Parse a quantity: a number (dimensionless), "20 mm", or { value, unit }.
 * Returns { ok, si, dim, value, unit } or { ok:false, error }.
 */
export function parseQuantity(q, expectDim) {
  let value;
  let unit;
  if (typeof q === "number") { value = q; unit = "1"; }
  else if (typeof q === "string") {
    const m = q.trim().match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([A-Za-z/³²0-9]*)$/i);
    if (!m) return { ok: false, error: `cannot read quantity "${q}"` };
    value = Number(m[1]);
    unit = m[2] || "1";
  } else if (q && typeof q === "object") {
    value = Number(q.value);
    unit = q.unit == null ? "1" : String(q.unit);
  } else {
    return { ok: false, error: "quantity missing" };
  }
  if (!Number.isFinite(value)) return { ok: false, error: `not a number: ${JSON.stringify(q)}` };
  if (!knownUnit(unit)) return { ok: false, error: `unknown unit "${unit}"` };
  const [dim, factor] = UNITS[unit];
  if (expectDim && dim !== expectDim) {
    return { ok: false, error: `expected a ${expectDim}, got ${unit} (${dim})` };
  }
  return { ok: true, si: value * factor, dim, value, unit };
}

/** Convert an SI value to a display unit of the same dimension. */
export function fromSI(si, unit) {
  if (!knownUnit(unit)) throw new Error(`unknown unit "${unit}"`);
  return si / UNITS[unit][1];
}
