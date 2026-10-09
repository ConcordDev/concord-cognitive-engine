// server/lib/conkay/knowledge/connectors/parse-values.js
//
// Candidate values from the free text of database records (PubChem PUG View
// "StringWithMarkup" strings). Deterministic, and conservative: a string is
// read only as far as its text supports. A number with no unit stays a number
// with no unit (it is not assumed to be g/cm3); "x at T1/T2" is a relative
// density with its sample and reference temperatures, not a density; a
// temperature given in two scales is checked for self-consistency. Whatever
// cannot be read is returned unparsed, with the reason, for review.

const NUM = String.raw`([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)`;
const DEG = String.raw`\s*(?:°|deg(?:rees)?\s*)?\s*`;
const TEMP_UNIT = String.raw`(?:°\s*|deg\.?\s*)?([CFK])\b`;

export const toKelvin = (v, u) => (u === "C" ? v + 273.15 : u === "F" ? (v - 32) * (5 / 9) + 273.15 : u === "K" ? v : NaN);

/** Half the last printed digit of a number string (its reported resolution). */
export function resolution(s) {
  const m = String(s).match(/\.(\d+)/);
  return 0.5 * 10 ** -(m ? m[1].length : 0);
}

/** Pressure in Pa from text like "at 760 mm Hg", "@760 [mm Hg]", "101.3 kPa". */
export function parsePressure(text) {
  const m = text.match(new RegExp(String.raw`${NUM}\s*\[?\s*(mm\s*Hg|mmHg|torr|kPa|MPa|Pa|atm|bar)\b\]?`, "i"));
  if (!m) return null;
  const v = Number(m[1]);
  const u = m[2].toLowerCase().replace(/\s+/g, "");
  const f = { mmhg: 133.322387415, torr: 133.322368421, kpa: 1e3, mpa: 1e6, pa: 1, atm: 101325, bar: 1e5 }[u];
  return f ? { pa: v * f, text: m[0].trim() } : null;
}

const ts0 = (t) => { const x = temperatures(t); return x.length ? { temperature: x[0].k } : {}; };

/** All temperatures in the text: [{ k, value, unit, text, index }]. */
export function temperatures(text) {
  const out = [];
  const re = new RegExp(String.raw`${NUM}${DEG}${TEMP_UNIT}`, "g");
  let m;
  while ((m = re.exec(text))) out.push({ k: toKelvin(Number(m[1]), m[2]), value: Number(m[1]), raw: m[1], unit: m[2], text: m[0], index: m.index });
  return out;
}

/**
 * A temperature-valued property (boiling, melting, flash point). Returns
 * { ok, valueK | rangeK, resolutionK, alternates, conditions: { pressure?, method? }, issues } or { ok:false, reason }.
 */
export function parseTemperatureValue(text) {
  const issues = [];
  const range = text.match(new RegExp(String.raw`^\s*${NUM}\s*(?:to|-|–)\s*${NUM}${DEG}${TEMP_UNIT}`));
  const ts = temperatures(text);
  if (!ts.length && !range) return { ok: false, reason: "no temperature with a unit found" };
  const conditions = {};
  const p = parsePressure(text);
  if (p) conditions.pressure = p.pa;
  if (/closed\s*cup|\bc\.\s*c\.|\bcc\b/i.test(text)) conditions.method = "closed cup";
  else if (/open\s*cup|\bo\.\s*c\.|\boc\b/i.test(text)) conditions.method = "open cup";
  if (range) {
    const lo = toKelvin(Number(range[1]), range[3]), hi = toKelvin(Number(range[2]), range[3]);
    return { ok: true, rangeK: { min: Math.min(lo, hi), max: Math.max(lo, hi) }, resolutionK: resolution(range[1]) * (range[3] === "F" ? 5 / 9 : 1), conditions, issues };
  }
  const first = ts[0];
  const alternates = ts.slice(1).filter((t) => !(conditions.pressure && /mm|hg|pa|atm|bar/i.test(text.slice(t.index, t.index + 12))));
  const res = resolution(first.raw) * (first.unit === "F" ? 5 / 9 : 1);
  for (const a of alternates) {
    const tol = res + resolution(a.raw) * (a.unit === "F" ? 5 / 9 : 1) + 1e-9;
    if (Math.abs(a.k - first.k) > tol) issues.push(`the text gives ${first.text} and ${a.text}, which differ by ${(Math.abs(a.k - first.k)).toFixed(2)} K (more than their printed precision)`);
  }
  return { ok: true, valueK: first.k, resolutionK: res, alternates: alternates.map((a) => a.text), conditions, issues };
}

const DENSITY_UNITS = { "g/cm3": 1000, "g/cucm": 1000, "g/cm^3": 1000, "g/cm³": 1000, "g/cc": 1000, "g/ml": 1000, "g/ml.": 1000, "kg/m3": 1, "kg/m³": 1, "g/l": 1, "kg/l": 1000, "lb/cuft": 16.018463373960138, "lb/ft3": 16.018463373960138 };
const OTHER_PHASE = /\((ice|solid|vapou?r|gas|crystal)\)|\b(of ice|ice density|solid density|vapou?r density|gas density)\b/i;
const OTHER_SUBSTANCE = /\b(sea\s*water|seawater|brine|aqueous solution|solution|% (?:aq|w\/w|v\/v))\b/i;

/**
 * A density-heading string. Returns one of:
 *   { ok, kind: "liquid_density", valueKgM3, resolution, conditions: { temperature? } }
 *   { ok, kind: "relative_density", value, resolution, conditions: { temperature?, reference_temperature? }, reference }
 *   { ok, kind: "unit_not_stated", value, resolution, conditions: { temperature? } }   (a number, no unit, no reference)
 *   { ok:false, reason }
 */
export function parseDensityValue(text) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, empty: true, reason: "empty string" };
  if (/\[Table#\d+\]/.test(t)) return { ok: false, table: true, reason: "the value is in a PubChem table this connector does not read" };
  const sub = t.match(OTHER_SUBSTANCE);
  if (sub) return { ok: true, kind: "other_substance", qualifier: sub[0], conditions: {} };
  const ph = t.match(OTHER_PHASE);
  if (ph) return { ok: true, kind: "other_phase", phase: (ph[1] || ph[2]).toLowerCase(), conditions: ts0(t) };
  const ts = temperatures(t);
  // relative density with sample / reference temperatures: "0.8100 at 0 °C/4 °C", "0.7866 at 25 °C/4 °C"
  const pair = t.match(new RegExp(String.raw`${NUM}\s*(?:at|@)\s*${NUM}${DEG}([CFK])?\s*/\s*${NUM}${DEG}${TEMP_UNIT}`));
  if (pair) {
    const u2 = pair[5];
    const u1 = pair[3] || u2;
    return { ok: true, kind: "relative_density", value: Number(pair[1]), resolution: resolution(pair[1]), reference: "water", conditions: { temperature: toKelvin(Number(pair[2]), u1), reference_temperature: toKelvin(Number(pair[4]), u2) } };
  }
  const rel = t.match(new RegExp(String.raw`relative density[^:]*\(water\s*=\s*1\)\s*:\s*${NUM}`, "i")) || t.match(new RegExp(String.raw`specific gravity[^\d]*${NUM}`, "i"));
  if (rel) {
    const cond = {};
    if (ts.length) cond.temperature = ts[0].k;
    return { ok: true, kind: "relative_density", value: Number(rel[1]), resolution: resolution(rel[1]), reference: "water", conditions: cond };
  }
  const withUnit = t.match(new RegExp(String.raw`${NUM}\s*(g\s*/\s*(?:cu\s*cm|cm3|cm\^3|cm³|cc|ml\.?|l)\b|kg\s*/\s*(?:m3|m³|l)|lb\s*/\s*(?:cu\s*ft|ft3))`, "i"));
  if (withUnit) {
    const unit = withUnit[2].toLowerCase().replace(/\s+/g, "");
    const f = DENSITY_UNITS[unit];
    if (!f) return { ok: false, reason: `unrecognised density unit "${withUnit[2]}"` };
    const cond = {};
    const tAfter = ts.find((x) => x.index > withUnit.index);
    if (tAfter) cond.temperature = tAfter.k;
    return { ok: true, kind: "liquid_density", valueKgM3: Number(withUnit[1]) * f, resolution: resolution(withUnit[1]) * f, unit: withUnit[2], conditions: cond };
  }
  const bare = t.match(new RegExp(String.raw`^${NUM}\b`));
  if (bare) {
    const cond = {};
    if (ts.length) cond.temperature = ts[0].k;
    return { ok: true, kind: "unit_not_stated", value: Number(bare[1]), resolution: resolution(bare[1]), conditions: cond };
  }
  return { ok: false, reason: "no number found" };
}
