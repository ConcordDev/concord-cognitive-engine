// server/lib/conkay/units/universal.js
//
// Any unit in, SI to the solvers, the person's own unit back (owner,
// 2026-11-26: "it's hard to even input inputs like mm feet inches, oz for
// chemicals and stuff like that").
//
// A unit is a factor to SI, an exponent vector over the base dimensions
// [m, kg, s, A, K, mol, USD] and, for temperatures, an offset. Compound
// units are composed ("W/m·K", "L/min", "g/L", "lbf·ft", "mol/kg", "m^2"),
// so they need no table entry of their own. Numbers may be written as
// "1,250.5", "3/8", "1 1/2", "1-1/2", "½", "2.5e3"; lengths as 5'6", 5′6″,
// "5 ft 6 in", "6 feet 2 inches".
//
// Ambiguity is said, never guessed silently: "oz" is a mass ounce (a note
// says to write "fl oz" for volume); "ton" is refused (short, long or metric?);
// a bare "C" or "F" is read as a temperature only after a degree sign or the
// word, never as coulomb/farad by accident.

const D = { L: 0, M: 1, T: 2, I: 3, K: 4, N: 5, $: 6 };
const vec = (spec = {}) => { const v = [0, 0, 0, 0, 0, 0, 0]; for (const [k, e] of Object.entries(spec)) v[D[k]] = e; return v; };

// unit symbol (case-sensitive first, then lower-case aliases) → [factor, vector, offset?, name?]
const BASE = {};
function def(names, factor, spec, extra = {}) {
  for (const n of names) BASE[n] = { factor, vec: vec(spec), ...extra };
}
// length
def(["m", "meter", "meters", "metre", "metres"], 1, { L: 1 });
def(["mm", "millimeter", "millimeters", "millimetre", "millimetres"], 1e-3, { L: 1 });
def(["cm", "centimeter", "centimeters", "centimetre", "centimetres"], 1e-2, { L: 1 });
def(["km", "kilometer", "kilometers", "kilometre", "kilometres"], 1e3, { L: 1 });
def(["µm", "um", "micron", "microns", "micrometer", "micrometers"], 1e-6, { L: 1 });
def(["nanometer", "nanometers"], 1e-9, { L: 1 });
def(["in", "inch", "inches", '"', "″"], 0.0254, { L: 1 });
def(["ft", "foot", "feet", "'", "′"], 0.3048, { L: 1 });
def(["yd", "yard", "yards"], 0.9144, { L: 1 });
def(["mi", "mile", "miles"], 1609.344, { L: 1 });
def(["thou", "mil", "mils"], 2.54e-5, { L: 1 });
// area (beyond composed powers)
def(["acre", "acres"], 4046.8564224, { L: 2 });
def(["ha", "hectare", "hectares"], 1e4, { L: 2 });
// volume
def(["L", "l", "liter", "liters", "litre", "litres"], 1e-3, { L: 3 });
def(["mL", "ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc"], 1e-6, { L: 3 });
def(["µL", "uL", "ul", "microliter", "microliters"], 1e-9, { L: 3 });
def(["fl oz", "floz", "fl. oz", "fluid ounce", "fluid ounces"], 29.5735295625e-6, { L: 3 });
def(["cup", "cups"], 236.5882365e-6, { L: 3 });
def(["tbsp", "tablespoon", "tablespoons"], 14.78676478125e-6, { L: 3 });
def(["tsp", "teaspoon", "teaspoons"], 4.92892159375e-6, { L: 3 });
def(["pt", "pint", "pints"], 473.176473e-6, { L: 3 });
def(["qt", "quart", "quarts"], 946.352946e-6, { L: 3 });
def(["gal", "gallon", "gallons"], 3.785411784e-3, { L: 3 });
def(["imp gal", "imperial gallon", "imperial gallons"], 4.54609e-3, { L: 3 });
def(["bbl", "barrel", "barrels"], 0.158987294928, { L: 3 });
def(["cf", "cu ft", "cubic foot", "cubic feet"], 0.028316846592, { L: 3 });
// mass
def(["kg", "kilogram", "kilograms", "kgs"], 1, { M: 1 });
def(["g", "gram", "grams", "gm"], 1e-3, { M: 1 });
def(["mg", "milligram", "milligrams"], 1e-6, { M: 1 });
def(["µg", "ug", "microgram", "micrograms"], 1e-9, { M: 1 });
def(["t", "tonne", "tonnes", "metric ton", "metric tons"], 1e3, { M: 1 });
def(["lb", "lbs", "pound", "pounds", "lbm"], 0.45359237, { M: 1 });
def(["oz", "ounce", "ounces"], 0.028349523125, { M: 1 }, { note: 'read "oz" as a mass ounce (28.35 g); write "fl oz" for a volume' });
def(["gr", "grain", "grains"], 6.479891e-5, { M: 1 });
def(["slug", "slugs"], 14.593902937, { M: 1 });
def(["short ton", "short tons"], 907.18474, { M: 1 });
def(["long ton", "long tons"], 1016.0469088, { M: 1 });
// time
def(["s", "sec", "secs", "second", "seconds"], 1, { T: 1 });
def(["ms", "millisecond", "milliseconds"], 1e-3, { T: 1 });
def(["min", "mins", "minute", "minutes"], 60, { T: 1 });
def(["h", "hr", "hrs", "hour", "hours"], 3600, { T: 1 });
def(["day", "days"], 86400, { T: 1 });
def(["week", "weeks", "wk"], 604800, { T: 1 });
def(["year", "years", "yr", "yrs"], 31557600, { T: 1 });
// frequency / rotation
def(["Hz", "hz", "hertz"], 1, { T: -1 });
def(["kHz", "khz"], 1e3, { T: -1 });
def(["MHz", "mhz"], 1e6, { T: -1 });
def(["GHz", "ghz"], 1e9, { T: -1 });
def(["rpm", "RPM", "rev/min"], (2 * Math.PI) / 60, { T: -1 }, { name: "angular_velocity" });
def(["mph", "MPH", "mi/h"], 0.44704, { L: 1, T: -1 });
def(["kph", "km/h", "kmh", "km/hr"], 1 / 3.6, { L: 1, T: -1 });
def(["kt"], 0.514444, { L: 1, T: -1 }, { caseOnly: true });
def(["knot", "knots"], 0.514444, { L: 1, T: -1 });
def(["gpm", "GPM"], 3.785411784e-3 / 60, { L: 3, T: -1 });
def(["cfm", "CFM"], 0.028316846592 / 60, { L: 3, T: -1 });
def(["rad/s"], 1, { T: -1 }, { name: "angular_velocity" });
// angle (dimensionless)
def(["deg", "degree", "degrees", "°"], Math.PI / 180, {}, { name: "angle" });
def(["rad", "radian", "radians"], 1, {}, { name: "angle" });
// force
def(["N", "n", "newton", "newtons"], 1, { M: 1, L: 1, T: -2 });
def(["kN", "kn", "kilonewton", "kilonewtons"], 1e3, { M: 1, L: 1, T: -2 });
def(["MN"], 1e6, { M: 1, L: 1, T: -2 });
def(["lbf", "pound-force", "pounds-force"], 4.4482216152605, { M: 1, L: 1, T: -2 });
def(["kip", "kips"], 4448.2216152605, { M: 1, L: 1, T: -2 });
def(["kgf", "kilogram-force"], 9.80665, { M: 1, L: 1, T: -2 });
def(["dyn", "dyne"], 1e-5, { M: 1, L: 1, T: -2 });
// pressure
def(["Pa", "pa", "pascal", "pascals"], 1, { M: 1, L: -1, T: -2 });
def(["kPa", "kpa"], 1e3, { M: 1, L: -1, T: -2 });
def(["MPa", "mpa"], 1e6, { M: 1, L: -1, T: -2 });
def(["mPa"], 1e-3, { M: 1, L: -1, T: -2 }, { caseOnly: true });
def(["cP", "cp", "centipoise", "mPa·s", "mPa s", "mPas"], 1e-3, { M: 1, L: -1, T: -1 }, { name: "dynamic_viscosity" });
def(["W/m²K", "W/m2K", "W/m^2K", "W/m²·K", "W/m2·K"], 1, { M: 1, T: -3, K: -1 }, { name: "heat_transfer_coefficient" });
def(["GPa", "gpa"], 1e9, { M: 1, L: -1, T: -2 });
def(["bar", "bars"], 1e5, { M: 1, L: -1, T: -2 });
def(["mbar"], 100, { M: 1, L: -1, T: -2 });
def(["atm", "atmosphere", "atmospheres"], 101325, { M: 1, L: -1, T: -2 });
def(["psi", "psig", "psia"], 6894.757293168, { M: 1, L: -1, T: -2 });
def(["ksi"], 6894757.293168, { M: 1, L: -1, T: -2 });
def(["Mpsi", "msi", "Msi"], 6894757293.168, { M: 1, L: -1, T: -2 });
def(["torr", "mmHg"], 133.322368421, { M: 1, L: -1, T: -2 });
def(["inHg"], 3386.389, { M: 1, L: -1, T: -2 });
// energy
def(["J", "joule", "joules"], 1, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["kJ", "kj"], 1e3, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["MJ", "mj"], 1e6, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["Wh", "wh"], 3600, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["kWh", "kwh"], 3.6e6, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["cal", "calorie", "calories"], 4.184, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["kcal", "Cal", "kilocalorie", "kilocalories"], 4184, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["BTU", "btu", "Btu"], 1055.05585262, { M: 1, L: 2, T: -2 }, { name: "energy" });
def(["eV", "ev"], 1.602176634e-19, { M: 1, L: 2, T: -2 }, { name: "energy" });
// torque (same vector as energy; named by symbol)
// "nm" after a number in a brief is almost always torque ("50 nm motor"); write "nanometer" for length.
def(["Nm", "N·m", "N-m", "N.m", "nm"], 1, { M: 1, L: 2, T: -2 }, { name: "torque" });
def(["kNm", "kN·m", "knm"], 1e3, { M: 1, L: 2, T: -2 }, { name: "torque" });
def(["lbf·ft", "lb·ft", "lb-ft", "ft-lb", "ft·lbf", "ft-lbf", "ft·lb", "foot-pound", "foot-pounds"], 1.3558179483314, { M: 1, L: 2, T: -2 }, { name: "torque" });
def(["lbf·in", "lb-in", "in-lb", "in·lbf", "inch-pound", "inch-pounds"], 0.1129848290276, { M: 1, L: 2, T: -2 }, { name: "torque" });
// power
def(["W", "w", "watt", "watts"], 1, { M: 1, L: 2, T: -3 });
def(["mW", "mw"], 1e-3, { M: 1, L: 2, T: -3 });
def(["kW", "kw", "kilowatt", "kilowatts"], 1e3, { M: 1, L: 2, T: -3 });
def(["MW"], 1e6, { M: 1, L: 2, T: -3 });
def(["hp", "HP", "horsepower", "bhp"], 745.6998715822702, { M: 1, L: 2, T: -3 });
def(["BTU/h", "Btu/h", "btu/h", "BTU/hr", "btu/hr", "BTUH"], 0.29307107017, { M: 1, L: 2, T: -3 });
def(["ton of refrigeration", "TR"], 3516.8528420667, { M: 1, L: 2, T: -3 });
// electrical
def(["A", "amp", "amps", "ampere", "amperes"], 1, { I: 1 });
def(["mA", "ma", "milliamp", "milliamps"], 1e-3, { I: 1 });
def(["V", "v", "volt", "volts"], 1, { M: 1, L: 2, T: -3, I: -1 });
def(["mV", "mv"], 1e-3, { M: 1, L: 2, T: -3, I: -1 });
def(["kV", "kv"], 1e3, { M: 1, L: 2, T: -3, I: -1 });
def(["Ω", "ohm", "ohms"], 1, { M: 1, L: 2, T: -3, I: -2 });
def(["kΩ", "kohm", "kohms"], 1e3, { M: 1, L: 2, T: -3, I: -2 });
def(["MΩ", "Mohm", "megohm"], 1e6, { M: 1, L: 2, T: -3, I: -2 });
def(["Ah", "ah", "amp-hour", "amp-hours"], 3600, { I: 1, T: 1 }, { name: "charge" });
def(["mAh", "mah"], 3.6, { I: 1, T: 1 }, { name: "charge" });
def(["coulomb", "coulombs"], 1, { I: 1, T: 1 }, { name: "charge" });
def(["farad", "farads"], 1, { M: -1, L: -2, T: 4, I: 2 });
def(["µF", "uF", "uf"], 1e-6, { M: -1, L: -2, T: 4, I: 2 });
def(["nF"], 1e-9, { M: -1, L: -2, T: 4, I: 2 });
def(["pF"], 1e-12, { M: -1, L: -2, T: 4, I: 2 });
def(["H", "henry"], 1, { M: 1, L: 2, T: -2, I: -2 }, { caseOnly: true });
def(["mH"], 1e-3, { M: 1, L: 2, T: -2, I: -2 });
def(["T", "tesla"], 1, { M: 1, T: -2, I: -1 }, { caseOnly: true });
// temperature (affine) and temperature difference
def(["K", "kelvin"], 1, { K: 1 }, { name: "temperature", caseOnly: true });
def(["°C", "degC", "deg C", "celsius", "Celsius", "℃"], 1, { K: 1 }, { name: "temperature", offset: 273.15 });
def(["°F", "degF", "deg F", "fahrenheit", "Fahrenheit", "℉"], 5 / 9, { K: 1 }, { name: "temperature", offset: 255.3722222222222 });
// A bare C or F after a number is a temperature far more often than a coulomb or a farad; say so.
def(["C"], 1, { K: 1 }, { name: "temperature", offset: 273.15, caseOnly: true, note: 'read "C" as °C (write "coulomb" for charge)' });
def(["F"], 5 / 9, { K: 1 }, { name: "temperature", offset: 255.3722222222222, caseOnly: true, note: 'read "F" as °F (write "farad" for capacitance)' });
def(["°R", "rankine"], 5 / 9, { K: 1 }, { name: "temperature" });
// amount of substance and concentration
def(["mol", "mole", "moles"], 1, { N: 1 });
def(["mmol", "millimole", "millimoles"], 1e-3, { N: 1 });
def(["kmol"], 1e3, { N: 1 });
def(["M", "molar"], 1000, { N: 1, L: -3 }, { name: "molar_concentration", caseOnly: true });
def(["mM", "millimolar"], 1, { N: 1, L: -3 }, { name: "molar_concentration", caseOnly: true });
def(["µM", "uM", "micromolar"], 1e-3, { N: 1, L: -3 }, { name: "molar_concentration" });
def(["molal", "mol/kg"], 1, { N: 1, M: -1 }, { name: "molality" });
// fractions (dimensionless)
def(["%", "percent", "pct"], 0.01, {}, { name: "ratio" });
def(["wt%", "w/w%", "% w/w", "mass%", "wt. %", "wt %"], 0.01, {}, { name: "mass_fraction" });
def(["vol%", "v/v%", "% v/v", "vol %"], 0.01, {}, { name: "volume_fraction" });
def(["mol%", "mole%", "mol %"], 0.01, {}, { name: "mole_fraction" });
def(["ppm"], 1e-6, {}, { name: "ratio" });
def(["ppb"], 1e-9, {}, { name: "ratio" });
// money
def(["USD", "usd", "$", "dollar", "dollars"], 1, { $: 1 });
// dimensionless
def(["1", ""], 1, {}, { name: "ratio" });

// Composed or plain dimension names, by vector. The first name for a vector is
// the default; a unit's own `name` overrides it (torque vs energy, rpm vs Hz).
const NAMES = [
  ["length", { L: 1 }], ["area", { L: 2 }], ["volume", { L: 3 }], ["mass", { M: 1 }], ["time", { T: 1 }],
  ["frequency", { T: -1 }], ["velocity", { L: 1, T: -1 }], ["acceleration", { L: 1, T: -2 }],
  ["force", { M: 1, L: 1, T: -2 }], ["pressure", { M: 1, L: -1, T: -2 }], ["energy", { M: 1, L: 2, T: -2 }],
  ["power", { M: 1, L: 2, T: -3 }], ["density", { M: 1, L: -3 }], ["force_per_length", { M: 1, T: -2 }],
  ["volume_flow", { L: 3, T: -1 }], ["mass_flow", { M: 1, T: -1 }], ["mass_concentration", { M: 1, L: -3 }],
  ["current", { I: 1 }], ["charge", { I: 1, T: 1 }], ["voltage", { M: 1, L: 2, T: -3, I: -1 }], ["resistance", { M: 1, L: 2, T: -3, I: -2 }],
  ["capacitance", { M: -1, L: -2, T: 4, I: 2 }], ["inductance", { M: 1, L: 2, T: -2, I: -2 }], ["magnetic_flux_density", { M: 1, T: -2, I: -1 }],
  ["temperature", { K: 1 }], ["amount", { N: 1 }], ["molar_concentration", { N: 1, L: -3 }], ["molality", { N: 1, M: -1 }],
  ["molar_mass", { M: 1, N: -1 }], ["thermal_conductivity", { M: 1, L: 1, T: -3, K: -1 }],
  ["heat_transfer_coefficient", { M: 1, T: -3, K: -1 }], ["specific_heat", { L: 2, T: -2, K: -1 }],
  ["heat_flux", { M: 1, T: -3 }], ["dynamic_viscosity", { M: 1, L: -1, T: -1 }], ["kinematic_viscosity", { L: 2, T: -1 }],
  ["specific_energy", { L: 2, T: -2 }], ["resistivity", { M: 1, L: 3, T: -3, I: -2 }], ["power_per_volume", { M: 1, L: -1, T: -3 }], ["money", { $: 1 }], ["price_per_mass", { $: 1, M: -1 }], ["ratio", {}],
];
const key = (v) => v.join(",");
const NAME_OF = new Map();
for (const [n, spec] of NAMES) { const k = key(vec(spec)); if (!NAME_OF.has(k)) NAME_OF.set(k, n); }
const SI_SYMBOL = {
  length: "m", area: "m²", volume: "m³", mass: "kg", time: "s", frequency: "Hz", velocity: "m/s", acceleration: "m/s²",
  force: "N", pressure: "Pa", energy: "J", torque: "N·m", power: "W", density: "kg/m³", force_per_length: "N/m",
  volume_flow: "m³/s", mass_flow: "kg/s", mass_concentration: "kg/m³", current: "A", charge: "C", voltage: "V",
  resistance: "Ω", capacitance: "F", inductance: "H", magnetic_flux_density: "T", temperature: "K", amount: "mol",
  molar_concentration: "mol/m³", molality: "mol/kg", molar_mass: "kg/mol", thermal_conductivity: "W/(m·K)",
  heat_transfer_coefficient: "W/(m²·K)", specific_heat: "J/(kg·K)", heat_flux: "W/m²", dynamic_viscosity: "Pa·s",
  kinematic_viscosity: "m²/s", resistivity: "Ω·m", power_per_volume: "W/m³", specific_energy: "J/kg", money: "USD", price_per_mass: "USD/kg", ratio: "1",
  angle: "rad", angular_velocity: "rad/s", mass_fraction: "1", volume_fraction: "1", mole_fraction: "1",
};
export const dimensionName = (v, prefer) => prefer || NAME_OF.get(key(v)) || `[${v.join(",")}]`;
export const siSymbol = (dim) => SI_SYMBOL[dim] || "SI";

const LOWER = new Map();
for (const [k, u] of Object.entries(BASE)) if (!u.caseOnly && !LOWER.has(k.toLowerCase())) LOWER.set(k.toLowerCase(), k);

const AMBIGUOUS = {
  ton: "short (907 kg), long (1016 kg) or metric (1000 kg) ton? Write tonne, short ton or long ton",
  tons: "short (907 kg), long (1016 kg) or metric (1000 kg) ton? Write tonne, short ton or long ton",
};

function lookupAtom(sym) {
  const s = sym.trim();
  if (!s) return null;
  if (BASE[s]) return { sym: s, ...BASE[s] };
  const k = LOWER.get(s.toLowerCase());
  return k ? { sym: k, ...BASE[k] } : null;
}

/** Parse a unit expression ("W/m·K", "L/min", "lbf·ft", "m^2", "kg/m³"). */
export function parseUnit(text) {
  let raw = String(text ?? "").trim().replace(/\s+/g, " ");
  if (raw === "") return { ok: true, sym: "", factor: 1, vec: vec(), dim: "ratio" };
  if (AMBIGUOUS[raw.toLowerCase()]) return { ok: false, error: `ambiguous unit "${raw}": ${AMBIGUOUS[raw.toLowerCase()]}` };
  const whole = lookupAtom(raw);
  if (whole) return finish(whole.sym, whole.factor, whole.vec, whole.name, whole.offset, whole.note);
  // per / over as a slash: "miles per hour", "liters per minute"
  raw = raw.replace(/\s+per\s+/gi, "/");
  const [numPart, ...dens] = raw.split("/");
  const parseProduct = (s) => {
    const parts = String(s).replace(/[()]/g, "").split(/\s*[·*.-]\s*|\s+/).filter(Boolean);
    let f = 1; const v = vec();
    for (const p of parts) {
      const m = /^(.+?)(?:\^?(-?\d+)|([²³]))?$/.exec(p);
      if (!m) return null;
      const atom = lookupAtom(m[1]);
      if (!atom || atom.offset) return null;
      const e = m[2] ? Number(m[2]) : m[3] === "²" ? 2 : m[3] === "³" ? 3 : 1;
      f *= atom.factor ** e;
      for (let i = 0; i < v.length; i++) v[i] += atom.vec[i] * e;
    }
    return { f, v };
  };
  const top = numPart.trim() === "" || numPart.trim() === "1" ? { f: 1, v: vec() } : parseProduct(numPart);
  if (!top) return { ok: false, error: `unknown unit "${text}"` };
  let f = top.f; const v = top.v.slice();
  for (const d of dens) {
    const b = parseProduct(d);
    if (!b) return { ok: false, error: `unknown unit "${text}"` };
    f /= b.f;
    for (let i = 0; i < v.length; i++) v[i] -= b.v[i];
  }
  // g/L, mg/mL: a concentration in a solution, not a material's density (same vector).
  const perVolume = key(v) === key(vec({ M: 1, L: -3 })) && /\/\s*(?:m?L|dL|l|ml|µL|uL|gal|qt|pt|cup)\b/.test(raw);
  if (perVolume) return finish(String(text).trim(), f, v, "mass_concentration");
  const torqueish = /(?:N|lbf|lb|kN)\s*[·*.-]\s*(?:m|ft|in)|(?:ft|in)\s*[·*.-]\s*(?:lbf|lb)/i.test(raw) && key(v) === key(vec({ M: 1, L: 2, T: -2 }));
  return finish(String(text).trim(), f, v, torqueish ? "torque" : undefined);
}
function finish(sym, factor, v, name, offset, note) {
  return { ok: true, sym, factor, vec: v, dim: dimensionName(v, name), ...(offset ? { offset } : {}), ...(note ? { note } : {}) };
}

// ── numbers ───────────────────────────────────────────────────────────
const VULGAR = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875, "⅓": 1 / 3, "⅔": 2 / 3 };
const NUM_SRC = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?`;
/** "1,250.5", "3/8", "1 1/2", "1-1/2", "½", "1½", "2.5e3" → number, or null. */
export function parseNumber(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  let m = /^([-+]?\d+)?\s*([½¼¾⅛⅜⅝⅞⅓⅔])$/.exec(s);
  if (m) { const w = m[1] ? Number(m[1]) : 0; return w < 0 ? w - VULGAR[m[2]] : w + VULGAR[m[2]]; }
  m = /^([-+]?\d+)[\s-]+(\d+)\/(\d+)$/.exec(s);
  if (m) { const w = Number(m[1]); const fr = Number(m[2]) / Number(m[3]); return w < 0 ? w - fr : w + fr; }
  m = /^([-+]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  if (!new RegExp(`^${NUM_SRC}$`).test(s) || !/\d/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ── amounts ───────────────────────────────────────────────────────────
const FEET_INCHES = /^\s*([-+]?\d+(?:\.\d+)?)\s*(?:'|′|ft\.?|foot|feet)\s*(?:,?\s*(?:and\s+)?(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:"|″|in\.?|inch|inches)?)?\s*$/i;

/**
 * Parse one amount: "12 oz", "5'6\"", "3/8 in", "250 mL", "0.5 M", "350 °F",
 * "40 BTU/h", "{ value, unit }", or a bare number (SI of expectDim when given).
 * Returns { ok, value, unit, si, dim, vec, display, note? } or { ok:false, error }.
 */
export function parseAmount(input, { expectDim } = {}) {
  if (input == null) return { ok: false, error: "quantity missing" };
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, error: "not a number" };
    if (expectDim && expectDim !== "ratio") return { ok: true, value: input, unit: siSymbol(expectDim), si: input, dim: expectDim, vec: null, coercedBare: true };
    return { ok: true, value: input, unit: "", si: input, dim: "ratio", vec: vec() };
  }
  if (typeof input === "object") return parseAmount(`${input.value} ${input.unit ?? ""}`.trim(), { expectDim });
  const s = String(input).trim().replace(/\s+/g, " ");
  if (!s) return { ok: false, error: "quantity missing" };
  // 5'6", 5 ft 6 in
  const fi = FEET_INCHES.exec(s);
  if (fi && (fi[2] || /'|′|ft|foot|feet/i.test(s))) {
    const ft = Number(fi[1]); const inch = fi[2] ? parseNumber(fi[2]) : 0;
    if (inch == null) return { ok: false, error: `cannot read "${s}"` };
    const si = (Math.abs(ft) * 0.3048 + inch * 0.0254) * Math.sign(ft || 1);
    return check({ ok: true, value: fi[2] ? ft + inch / 12 : ft, unit: "ft", si, dim: "length", vec: vec({ L: 1 }), display: s }, expectDim);
  }
  // number then unit: split at the first char that cannot belong to a number
  const m = /^([-+]?(?:\d+\s+\d+\/\d+|\d+-\d+\/\d+|\d+(?:\.\d+)?\/\d+(?:\.\d+)?|\d*[½¼¾⅛⅜⅝⅞⅓⅔]|(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?))\s*(.*)$/.exec(s);
  if (!m || !/\d|[½¼¾⅛⅜⅝⅞⅓⅔]/.test(m[1])) return { ok: false, error: `cannot read quantity "${s}"` };
  const value = parseNumber(m[1]);
  if (value == null) return { ok: false, error: `cannot read the number in "${s}"` };
  let unitText = m[2].trim();
  // "°" alone, "deg C": temperature words
  unitText = unitText.replace(/^degrees?\s+(celsius|fahrenheit|c|f)$/i, (_x, u) => (/^c/i.test(u) ? "°C" : "°F")).replace(/^°\s*([CF])$/i, (_x, u) => `°${u.toUpperCase()}`);
  if (!unitText) {
    if (expectDim && expectDim !== "ratio") return { ok: true, value, unit: siSymbol(expectDim), si: value, dim: expectDim, vec: null, coercedBare: true };
    return { ok: true, value, unit: "", si: value, dim: "ratio", vec: vec() };
  }
  const u = parseUnit(unitText);
  if (!u.ok) return u;
  const si = u.offset ? value * u.factor + u.offset : value * u.factor;
  return check({ ok: true, value, unit: u.sym, si, dim: u.dim, vec: u.vec, display: s, ...(u.offset ? { affine: true } : {}), ...(u.note ? { note: u.note } : {}) }, expectDim);
}
function check(r, expectDim) {
  if (!r.ok || !expectDim) return r;
  if (r.dim === expectDim) return r;
  // energy/torque and stress/pressure share vectors: a name mismatch on the same vector is fine
  const same = new Map([["torque", "energy"], ["energy", "torque"], ["stress", "pressure"], ["pressure", "stress"], ["density", "mass_concentration"], ["mass_concentration", "density"]]);
  if (same.get(expectDim) === r.dim) return { ...r, dim: expectDim };
  return { ok: false, error: `expected a ${expectDim.replace(/_/g, " ")}, got "${r.display ?? r.unit}" (a ${r.dim.replace(/_/g, " ")})` };
}

/** Express an SI value in a unit of the same dimension. */
export function convertFromSI(si, unit) {
  const u = parseUnit(unit);
  if (!u.ok) throw new Error(u.error);
  return u.offset ? (si - u.offset) / u.factor : si / u.factor;
}
/** Convert between two units; throws on a dimension mismatch. */
export function convert(value, from, to) {
  const a = parseUnit(from); const b = parseUnit(to);
  if (!a.ok) throw new Error(a.error);
  if (!b.ok) throw new Error(b.error);
  if (key(a.vec) !== key(b.vec)) throw new Error(`cannot convert ${a.dim} (${from}) to ${b.dim} (${to})`);
  const si = a.offset ? value * a.factor + a.offset : value * a.factor;
  return b.offset ? (si - b.offset) / b.factor : si / b.factor;
}

const sig = (n, d = 4) => (n === 0 || !Number.isFinite(n) ? String(n) : String(Number(n.toPrecision(d))));
/** "1.2 m (3.937 ft)": the value in the person's unit, with SI alongside when different. */
// SI with an engineering prefix where people read it that way (23.2 MPa, not 23210000 Pa).
const SI_PREFIXED = {
  pressure: [[1e9, "GPa"], [1e6, "MPa"], [1e3, "kPa"], [1, "Pa"]],
  stress: [[1e9, "GPa"], [1e6, "MPa"], [1e3, "kPa"], [1, "Pa"]],
  force: [[1e6, "MN"], [1e3, "kN"], [1, "N"]],
  power: [[1e6, "MW"], [1e3, "kW"], [1, "W"]],
  energy: [[1e6, "MJ"], [1e3, "kJ"], [1, "J"]],
  length: [[1e3, "km"], [1, "m"], [1e-3, "mm"], [1e-6, "µm"]],
  mass: [[1e3, "t"], [1, "kg"], [1e-3, "g"]],
};
function siText(si, dim) {
  const steps = SI_PREFIXED[dim];
  if (!steps || !Number.isFinite(si) || si === 0) return `${sig(si)} ${siSymbol(dim)}`;
  const a = Math.abs(si);
  const [f, sym] = steps.find(([k]) => a >= k) || steps[steps.length - 1];
  return `${sig(si / f)} ${sym}`;
}

export function formatAmount(si, dim, preferUnit) {
  const siSym = siSymbol(dim);
  if (preferUnit) {
    try {
      const v = convertFromSI(si, preferUnit);
      const same = parseUnit(preferUnit);
      if (same.ok && same.factor === 1 && !same.offset) return `${sig(v)} ${preferUnit}`;
      return `${sig(v)} ${preferUnit} (${siText(si, dim)})`;
    } catch { /* fall through to SI */ }
  }
  return siSym === "SI" ? `${sig(si)} ${siSym}` : siText(si, dim);
}

// ── scanning free text ────────────────────────────────────────────────
const SCAN = /(?<![\w.])([-+]?\d+(?:\.\d+)?\s*(?:'|′)\s*\d+(?:\.\d+)?\s*(?:"|″)?|[-+]?\d+\s*(?:ft|feet|foot)\s+\d+(?:\.\d+)?\s*(?:in|inch|inches)\b|[-+]?\d+\s+\d+\/\d+|[-+]?\d+-\d+\/\d+|[-+]?\d+(?:\.\d+)?\/\d+(?:\.\d+)?|[-+]?\d*[½¼¾⅛⅜⅝⅞]|[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?)(\s*(?:(?:degrees?\s+)?(?:celsius|fahrenheit)|°\s*[CFR]|[℃℉]|fl\.?\s*oz|fluid\s+ounces?|imp(?:erial)?\s+gal(?:lons?)?|short\s+tons?|long\s+tons?|metric\s+tons?|cu\s*ft|(?:wt|vol|mol|mass)\s*\.?\s*%|%\s*[wv]\/[wv]|%|[A-Za-zµΩ°$"″'′][A-Za-zµΩ°³²·/\-^0-9]*(?:\s*\/\s*[A-Za-zµΩ°³²·\-^0-9]+)*))?/g;
const NOT_UNITS = new Set(["and", "or", "to", "of", "by", "at", "with", "for", "per", "x", "plus", "times", "more", "less", "is", "the", "a", "an", "on", "from", "people", "persons", "panels", "bays", "seats", "doors", "wheels", "legs", "arms", "d", "D"]);
// "5 in the box" is not five inches; "a 3 in bolt" is.
const IN_NOT_INCH = /^\s*(?:the|a|an|my|your|our|this|that|these|those|each|total|stock|it|them|one|all|order|a row|front|place|case|addition|time|my)\b/i;

/** Every amount in a sentence, with where it is. Unknown words after a number are reported, not guessed. */
export function scanAmounts(text) {
  const src = String(text || "");
  const out = { amounts: [], bare: [], errors: [] };
  for (const m of src.matchAll(SCAN)) {
    const numTxt = m[1]; const unitTxtRaw = (m[2] || "").trim();
    const index = m.index; const end = index + m[0].length;
    if (/['′]/.test(numTxt) || /ft|feet|foot/.test(numTxt)) {
      const r = parseAmount(numTxt);
      if (r.ok) out.amounts.push({ raw: numTxt.trim(), ...r, index, end: index + numTxt.length });
      continue;
    }
    const nextWords = src.slice(end);
    if (!unitTxtRaw || NOT_UNITS.has(unitTxtRaw) || (unitTxtRaw === 'in' && IN_NOT_INCH.test(nextWords))) {
      const v = parseNumber(numTxt);
      if (v != null) out.bare.push({ raw: numTxt, value: v, index, end: index + numTxt.length });
      continue;
    }
    // try the longest unit first, then shorter prefixes ("12 oz water" → "oz")
    const words = unitTxtRaw.split(/\s+/);
    let hit = null;
    for (let n = words.length; n >= 1 && !hit; n--) {
      const u = words.slice(0, n).join(" ");
      const r = parseAmount(`${numTxt} ${u}`);
      if (r.ok && r.dim !== "ratio") hit = { r, used: u };
      else if (r.ok && /%|ppm|ppb|percent/i.test(u)) hit = { r, used: u };
    }
    if (hit) {
      const usedEnd = src.indexOf(hit.used, index + numTxt.length) + hit.used.length;
      out.amounts.push({ raw: src.slice(index, usedEnd).trim(), ...hit.r, index, end: usedEnd });
    } else {
      const amb = AMBIGUOUS[words[0].toLowerCase()];
      if (amb) out.errors.push({ raw: m[0].trim(), index, error: `ambiguous unit "${words[0]}": ${amb}` });
      else {
        const v = parseNumber(numTxt);
        if (v != null) out.bare.push({ raw: numTxt, value: v, index, end: index + numTxt.length, followedBy: words[0] });
      }
    }
  }
  return out;
}
