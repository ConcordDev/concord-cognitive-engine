// server/lib/engineering-question-extract.js
//
// Compute-don't-guess for the engineering wedge. Turns a written beam
// question — "a simply supported steel beam 20 ft long carries a 1000 lb
// point load at midspan, E = 29,000,000 psi, I = 200 in^4; max deflection?" —
// into the deterministic engine's inputs (physics.beamDeflection: lb, ft, psi,
// in⁴). Found by an Engineering-lens QA run: the chat model answered 1.58
// (wrong span, wrong number) instead of calling the engine (true: 0.0497 in).
//
// Honest by construction: returns null unless the question clearly asks for
// a deflection AND every required quantity is present with a recognised unit
// (a steel/aluminum mention may supply E, nothing else is ever assumed).
// Distributed loads aren't supported by the engine, so they return null too.
// Pinned by tests/engineering-question-extract.test.js.

const NUM = String.raw`(-?\d[\d,]*(?:\.\d+)?(?:\s*(?:[eE]|[x×]\s*10\^)\s*-?\d+)?)`;

function toNumber(raw) {
  const s = String(raw).replace(/,/g, "").replace(/\s+/g, "");
  const sci = s.match(/^(-?\d+(?:\.\d+)?)[x×]10\^(-?\d+)$/);
  if (sci) return Number(sci[1]) * 10 ** Number(sci[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const LOAD_UNITS = { lb: 1, lbs: 1, lbf: 1, pound: 1, pounds: 1, kip: 1000, kips: 1000, kn: 224.80894, n: 0.22480894, newton: 0.22480894, newtons: 0.22480894 };
const LEN_UNITS = { ft: 1, feet: 1, foot: 1, in: 1 / 12, inch: 1 / 12, inches: 1 / 12, m: 3.2808399, meter: 3.2808399, meters: 3.2808399, metre: 3.2808399, metres: 3.2808399, mm: 0.0032808399, cm: 0.032808399 };
const E_UNITS = { psi: 1, ksi: 1000, msi: 1e6, gpa: 145037.738, mpa: 145.037738, pa: 0.000145037738 };
const I_UNITS = { in: 1, mm: 1 / 416231.426, cm: 1 / 41.6231426, m: 2402509.61 };
const MATERIAL_E_PSI = { steel: 29e6, aluminum: 10e6, aluminium: 10e6 };

function firstMatch(text, re) {
  const m = text.match(re);
  return m || null;
}

/**
 * @returns {null | { supportType:"simple"|"cantilever"|"fixed", loadLbs:number,
 *   lengthFt:number, modulusE:number, momentI:number, assumed:string[] }}
 */
export function extractBeamQuestion(text) {
  const t = String(text || "");
  if (!/\bbeam|cantilever|joist|girder\b/i.test(t)) return null;
  if (!/\bdeflect(ion|s|ed)?\b|\bsag\b/i.test(t)) return null;
  if (/\b(uniform(ly)?|distributed|udl|per (foot|ft|meter|metre|m)|\/\s*(ft|m)\b|lb\/ft|kn\/m)\b/i.test(t)) return null;

  const supportType = /\bcantilever/i.test(t) ? "cantilever"
    : /\bfixed[- ](fixed|at both ends|both ends)|\bboth ends fixed/i.test(t) ? "fixed"
      : /\bsimply[- ]supported|\bsimple(-| )span|\bsimply supported/i.test(t) ? "simple" : null;
  if (!supportType) return null;

  // Load: a force with a force unit (lb/kip/kN/N).
  const loadM = firstMatch(t, new RegExp(`${NUM}\\s*(lbs?|lbf|pounds?|kips?|kN|newtons?|N)\\b`, "i"));
  // Length: a span with a length unit, preferring "<n> ft long" / "span of <n> m".
  const lenM = firstMatch(t, new RegExp(`${NUM}\\s*(ft|feet|foot|in|inch|inches|m|meters?|metres?|mm|cm)\\b(?=[^.]{0,20}\\b(long|span|length)\\b)`, "i"))
    || firstMatch(t, new RegExp(`\\b(?:span|length|long)\\b[^0-9]{0,12}${NUM}\\s*(ft|feet|foot|in|inch|inches|m|meters?|metres?|mm|cm)\\b`, "i"));
  const eM = firstMatch(t, new RegExp(`\\bE\\s*(?:=|is|of)\\s*${NUM}\\s*(psi|ksi|msi|GPa|MPa|Pa)\\b`, "i"))
    || firstMatch(t, new RegExp(`modulus[^0-9]{0,30}${NUM}\\s*(psi|ksi|msi|GPa|MPa|Pa)\\b`, "i"));
  const iM = firstMatch(t, new RegExp(`\\bI\\s*(?:=|is|of)\\s*${NUM}\\s*(in|mm|cm|m)\\s*(?:\\^\\s*4|⁴|4)`, "i"))
    || firstMatch(t, new RegExp(`moment of inertia[^0-9]{0,30}${NUM}\\s*(in|mm|cm|m)\\s*(?:\\^\\s*4|⁴|4)`, "i"));
  if (!loadM || !lenM || !iM) return null;

  const assumed = [];
  const loadFactor = LOAD_UNITS[loadM[2].toLowerCase().replace(/s$/, "") in LOAD_UNITS ? loadM[2].toLowerCase().replace(/s$/, "") : loadM[2].toLowerCase()];
  const lenFactor = LEN_UNITS[lenM[2].toLowerCase()];
  const iFactor = I_UNITS[iM[2].toLowerCase()];
  let modulusE;
  if (eM) {
    const eFactor = E_UNITS[eM[2].toLowerCase()];
    const eVal = toNumber(eM[1]);
    if (eFactor == null || eVal == null) return null;
    modulusE = eVal * eFactor;
  } else {
    const mat = Object.keys(MATERIAL_E_PSI).find((k) => new RegExp(`\\b${k}\\b`, "i").test(t));
    if (!mat) return null;
    modulusE = MATERIAL_E_PSI[mat];
    assumed.push(`E = ${modulusE.toLocaleString("en-US")} psi (typical ${mat})`);
  }
  const loadVal = toNumber(loadM[1]), lenVal = toNumber(lenM[1]), iVal = toNumber(iM[1]);
  if ([loadFactor, lenFactor, iFactor, loadVal, lenVal, iVal].some((v) => v == null)) return null;

  return {
    supportType,
    loadLbs: Math.abs(loadVal) * loadFactor,
    lengthFt: lenVal * lenFactor,
    modulusE,
    momentI: iVal * iFactor,
    assumed,
  };
}

/** One deterministic answer line for a computed deflection (inches + mm). */
export function formatDeflection(deltaIn, formula) {
  const sig = (v) => Number(v.toPrecision(4));
  return `Maximum deflection δ = ${sig(deltaIn)} in (${sig(deltaIn * 25.4)} mm), from ${formula}.`;
}
