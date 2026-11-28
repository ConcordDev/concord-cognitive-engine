/**
 * Any-unit entry for the Workshop's number boxes (owner, 2026-11-26: "any
 * unit in, yours back"). A box has a unit (mm, kN); the person may type
 * "3/4 in", "2 ft 3 in", "5'6\"", "500 lbf", "2 kip" or "50 kg" (a mass in a
 * force box is its weight at standard gravity, and the note says so). A bare
 * number is in the box's own unit. Unknown units are refused, never guessed.
 */

const G = 9.80665;
const LENGTH_M: Record<string, number> = {
  mm: 1e-3, millimeter: 1e-3, millimeters: 1e-3, millimetre: 1e-3, millimetres: 1e-3,
  cm: 1e-2, m: 1, meter: 1, meters: 1, metre: 1, metres: 1, km: 1e3,
  in: 0.0254, inch: 0.0254, inches: 0.0254, '"': 0.0254, '″': 0.0254,
  ft: 0.3048, foot: 0.3048, feet: 0.3048, "'": 0.3048, '′': 0.3048,
  yd: 0.9144, yard: 0.9144, yards: 0.9144, mil: 2.54e-5, thou: 2.54e-5,
};
const FORCE_N: Record<string, number> = {
  n: 1, newton: 1, newtons: 1, kn: 1e3, mn: 1e6,
  lbf: 4.4482216152605, lb: 4.4482216152605, lbs: 4.4482216152605, pound: 4.4482216152605, pounds: 4.4482216152605,
  kip: 4448.2216152605, kips: 4448.2216152605, kgf: G, ozf: 0.27801385095378,
};
const MASS_KG: Record<string, number> = { kg: 1, kgs: 1, kilogram: 1, kilograms: 1, g: 1e-3, gram: 1e-3, grams: 1e-3, t: 1e3, tonne: 1e3, tonnes: 1e3, oz: 0.028349523125 };

export type FieldDim = 'length' | 'force';
export type FieldParse = { ok: true; value: number; note?: string } | { ok: false; error: string };

const VULGAR: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

/** "3", "3.5", "1/2", "1 1/2", "1-1/2", "¾", "1,200", "2e3" → number. */
export function parseNumberText(raw: string): number | null {
  const s = raw.trim().replace(/,(?=\d{3}\b)/g, '');
  const v = /^(\d*)\s*([½¼¾⅛⅜⅝⅞])$/.exec(s);
  if (v) return (v[1] ? Number(v[1]) : 0) + VULGAR[v[2]];
  const mixed = /^(\d+)[\s-]+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s)) return Number(s);
  return null;
}

const fmt = (n: number) => String(Number(n.toPrecision(4)));

/**
 * Parse what was typed into a box whose unit is `boxUnit` (mm / m / kN / N).
 * Returns the value in the box's unit.
 */
export function parseFieldInput(text: string, dim: FieldDim, boxUnit: string): FieldParse {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'blank' };
  const boxFactor = dim === 'length' ? LENGTH_M[boxUnit.toLowerCase()] : FORCE_N[boxUnit.toLowerCase()];
  if (!boxFactor) return { ok: false, error: `unknown box unit ${boxUnit}` };
  const bare = parseNumberText(raw);
  if (bare != null) return { ok: true, value: bare };
  if (dim === 'length') {
    // feet and inches: 5'6", 5 ft 6 in, 2 ft 3 1/2 in
    const fi = /^(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:"|″|in|inch|inches)?)?$/i.exec(raw);
    if (fi && (fi[2] || /['′]|ft|feet|foot/i.test(raw))) {
      const inches = fi[2] ? parseNumberText(fi[2]) ?? NaN : 0;
      const m = Number(fi[1]) * 0.3048 + inches * 0.0254;
      if (Number.isFinite(m)) return { ok: true, value: m / boxFactor, note: `${raw} = ${fmt(m / boxFactor)} ${boxUnit}` };
    }
  }
  const m = /^(.*?\d[\d./½¼¾⅛⅜⅝⅞\s-]*?)\s*([a-zA-Z"″'′]+)\.?$/.exec(raw);
  if (!m) return { ok: false, error: `“${raw}” is not a number with a unit` };
  const n = parseNumberText(m[1]);
  if (n == null) return { ok: false, error: `“${m[1].trim()}” is not a number` };
  const u = m[2].toLowerCase();
  if (dim === 'length') {
    const f = LENGTH_M[u] ?? LENGTH_M[m[2]];
    if (!f) return { ok: false, error: `“${m[2]}” is not a length unit` };
    return { ok: true, value: (n * f) / boxFactor, note: `${raw} = ${fmt((n * f) / boxFactor)} ${boxUnit}` };
  }
  const f = FORCE_N[u];
  if (f) return { ok: true, value: (n * f) / boxFactor, note: `${raw} = ${fmt((n * f) / boxFactor)} ${boxUnit}${u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds' ? ' (read as pound-force)' : ''}` };
  const kg = MASS_KG[u];
  if (kg) return { ok: true, value: (n * kg * G) / boxFactor, note: `${raw} weighs ${fmt((n * kg * G) / boxFactor)} ${boxUnit} (× 9.81 m/s²)` };
  return { ok: false, error: `“${m[2]}” is not a force or mass unit` };
}
