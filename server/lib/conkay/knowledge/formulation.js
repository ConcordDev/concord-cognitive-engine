// server/lib/conkay/knowledge/formulation.js
//
// Formulation engine (start of deliverable 3).
//
//   parseFormulationText(text)    deterministic line parser (no LLM): title,
//                                 ingredient lines with ranges, stated total,
//                                 process temperature lines, prose sentences.
//   sourceFormulation(text)       the original as an immutable record (frozen,
//                                 content-hashed, verbatim text kept).
//   checkComposition(ingredients) min/max sums vs 100 %, in integer units of
//                                 0.0001 % so the arithmetic is exact.
//   proposeVersion(source)        an explicit formulation version with exact
//                                 fractions, by a recorded rule that keeps
//                                 every ingredient inside its range.
//   processVersion(source)        the process as stated, as its own record.
//
// The rule ("uniform-range-position"): every ingredient sits at the same
// fraction λ of the way from its minimum to its maximum, with
// λ = (100 − Σmin) / (Σmax − Σmin). That is the unique choice that treats all
// ranges alike, it stays inside every range whenever the ranges can sum to
// 100 at all, and it equals "start at the midpoints, then share the
// remaining deficit (or surplus) in proportion to each ingredient's headroom
// (or legroom)". Plain proportional scaling of the midpoints is NOT used: for
// Blend D it would push HDPE to 71.4 %, outside its 65–70 % range. Values are
// rounded to 0.0001 % by largest remainder so they sum to exactly 100.

import crypto from "node:crypto";
import { SCHEMA_VERSION } from "./schema.js";
import { normalizeTemperature } from "./units.js";

export const UNITS_PER_PERCENT = 10000; // 1 unit = 0.0001 %
const TOTAL_UNITS = 100 * UNITS_PER_PERCENT;
const toUnits = (pct) => Math.round(pct * UNITS_PER_PERCENT);
const fromUnits = (u) => u / UNITS_PER_PERCENT;

export const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const ING_RANGE = new RegExp(String.raw`^\s*[-•*]\s*(.+?):\s*${NUM}\s*(?:%\s*)?(?:-|–|—|to)\s*${NUM}\s*(wt%|vol%|mol%|%)\s*(?:[—–-]\s*(.*))?$`, "i");
const ING_EXACT = new RegExp(String.raw`^\s*[-•*]\s*(.+?):\s*${NUM}\s*(wt%|vol%|mol%|%)\s*(?:[—–-]\s*(.*))?$`, "i");
const TOTAL = new RegExp(String.raw`^\s*total:\s*${NUM}\s*(wt%|vol%|mol%|%)`, "i");
const TEMP = /^\s*([A-Za-z ]*?temperature):\s*(-?\d+(?:\.\d+)?)\s*(°C|°F|K|C|F)\b\s*(?:[—–-]\s*(.*))?$/i;
const BASIS = { "wt%": "mass", "vol%": "volume", "mol%": "mole", "%": "unspecified" };

/** Split an ingredient's note into clauses (comma separated). */
const clauses = (note) => (note || "").split(/,\s*/).map((s) => s.trim()).filter(Boolean);

/**
 * Parse formulation text line by line. Every non-blank line is accounted for:
 * as the title, an ingredient, the total, a process temperature, a section
 * header or prose. Nothing is dropped.
 */
export function parseFormulationText(text) {
  const lines = String(text).split(/\r?\n/);
  const out = { title: null, descriptor: null, ingredients: [], statedTotal: null, temperatures: [], sections: [], prose: [], unparsed: [] };
  let section = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const locator = `line ${i + 1}`;
    if (!line) return;
    let m;
    if (out.title == null) {
      m = /^(.+?)\s*[—–-]\s*\((.+?)\)\s*:?\s*$/.exec(line);
      out.title = m ? m[1].trim() : line.replace(/:$/, "");
      out.descriptor = m ? m[2].trim() : null;
      return;
    }
    if ((m = ING_RANGE.exec(line))) {
      out.ingredients.push({ name: m[1].trim(), min: Number(m[2]), max: Number(m[3]), unit: m[4], note: m[5]?.trim() || null, clauses: clauses(m[5]), locator, quote: line });
      return;
    }
    if ((m = ING_EXACT.exec(line)) && !/^\s*total/i.test(m[1])) {
      out.ingredients.push({ name: m[1].trim(), min: Number(m[2]), max: Number(m[2]), unit: m[3], note: m[4]?.trim() || null, clauses: clauses(m[4]), locator, quote: line });
      return;
    }
    if ((m = TOTAL.exec(line))) { out.statedTotal = { value: Number(m[1]), unit: m[2], locator, quote: line }; return; }
    if ((m = TEMP.exec(line))) {
      out.temperatures.push({ label: m[1].trim(), value: Number(m[2]), unit: m[3].startsWith("°") ? m[3] : `°${m[3].toUpperCase()}`, note: m[4]?.trim() || null, locator, quote: line });
      return;
    }
    if (/:\s*$/.test(line)) { section = line.replace(/:\s*$/, ""); out.sections.push({ title: section, locator }); return; }
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    for (const s of sentences) out.prose.push({ text: s, section, locator });
  });
  return out;
}

/** Composition check on [{ id, min, max }] in percent. Exact integer arithmetic. */
export function checkComposition(ingredients, statedTotal = null) {
  const minU = ingredients.reduce((a, g) => a + toUnits(g.min), 0);
  const maxU = ingredients.reduce((a, g) => a + toUnits(g.max), 0);
  const bad = ingredients.filter((g) => !(g.min <= g.max)).map((g) => g.id);
  const feasible = bad.length === 0 && minU <= TOTAL_UNITS && TOTAL_UNITS <= maxU;
  const stated = statedTotal ? toUnits(statedTotal.value) : null;
  return {
    minSumPct: fromUnits(minU),
    maxSumPct: fromUnits(maxU),
    feasible,
    invertedRanges: bad,
    exact: minU === maxU,
    statedTotalPct: stated == null ? null : fromUnits(stated),
    statedTotalWithinRange: stated == null ? null : minU <= stated && stated <= maxU,
    statedTotalFixedByRanges: stated == null ? null : minU === stated && maxU === stated,
    note: feasible
      ? (minU === maxU ? "ranges fix the composition exactly" : `the ranges allow totals from ${fromUnits(minU)} % to ${fromUnits(maxU)} %; 100 % is reachable but not fixed, so an explicit version is required`)
      : `the ranges cannot sum to 100 % (min ${fromUnits(minU)} %, max ${fromUnits(maxU)} %)`,
  };
}

/**
 * Exact fractions by the uniform-range-position rule. Returns
 * { ok, fractions: [{ id, pct, units, min, max }], rule } or { ok:false, error }.
 */
export function uniformRangePosition(ingredients) {
  const mins = ingredients.map((g) => toUnits(g.min));
  const spans = ingredients.map((g) => toUnits(g.max) - toUnits(g.min));
  const minSum = mins.reduce((a, b) => a + b, 0);
  const spanSum = spans.reduce((a, b) => a + b, 0);
  const num = TOTAL_UNITS - minSum; // λ = num / den
  const den = spanSum;
  if (num < 0 || num > den || (den === 0 && num !== 0)) return { ok: false, error: "the ranges cannot sum to 100 %" };
  const D = den === 0 ? 1 : den;
  // x_i = min_i + span_i·num/den, in units: floor plus remainder
  const exact = ingredients.map((g, i) => {
    const n = mins[i] * D + spans[i] * (den === 0 ? 0 : num);
    return { i, floor: Math.floor(n / D), rem: n % D };
  });
  let leftover = TOTAL_UNITS - exact.reduce((a, e) => a + e.floor, 0);
  const order = [...exact].sort((a, b) => b.rem - a.rem || a.i - b.i);
  const units = exact.map((e) => e.floor);
  for (const e of order) { if (leftover <= 0) break; if (e.rem > 0) { units[e.i] += 1; leftover -= 1; } }
  if (leftover !== 0) return { ok: false, error: "rounding could not close the total (internal error)" };
  const fractions = ingredients.map((g, i) => ({ id: g.id, name: g.name, pct: fromUnits(units[i]), units: units[i], min: g.min, max: g.max }));
  for (const f of fractions) {
    if (f.units < toUnits(f.min) || f.units > toUnits(f.max)) return { ok: false, error: `${f.id} left its range after rounding (internal error)` };
  }
  const g = gcd(num, D);
  return {
    ok: true,
    fractions,
    rule: {
      name: "uniform-range-position",
      version: "1.0.0",
      statement: "x_i = min_i + λ·(max_i − min_i), λ = (100 − Σmin)/(Σmax − Σmin); rounded to 0.0001 % by largest remainder (ties by ingredient order) so Σx = 100 exactly",
      equivalentTo: "midpoints, then the deficit to 100 % shared in proportion to each ingredient's headroom (max − midpoint)",
      lambda: den === 0 ? 0 : num / den,
      lambdaExact: den === 0 ? "0" : `${num / g}/${D / g}`,
      roundingUnitPct: 1 / UNITS_PER_PERCENT,
      rejectedAlternative: "proportional scaling of midpoints (can leave a range; see note)",
    },
  };
}

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; }

/** Proportional scaling of midpoints, kept only to show why it is not the rule. */
export function scaledMidpoints(ingredients) {
  const mids = ingredients.map((g) => (g.min + g.max) / 2);
  const s = mids.reduce((a, b) => a + b, 0);
  return ingredients.map((g, i) => {
    const pct = (mids[i] * 100) / s;
    return { id: g.id, pct, withinRange: pct >= g.min - 1e-12 && pct <= g.max + 1e-12 };
  });
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const CLASS_MATCHERS = [
  [/co-?polymer/i, "hdpe_hc_copolymer", "copolymer"],
  [/\bHDPE\b|high[- ]density polyethylene/i, "hdpe", "polymer"],
  [/basalt/i, "basalt_fiber", "fiber"],
  [/CaCO3|calcium carbonate/i, "caco3", "mineral_filler"],
  [/graphene/i, "graphene", "nanofiller"],
  [/silica|SiO2/i, "silica", "mineral_filler"],
];

/** Which constituent class an ingredient name refers to (null if none). */
export function constituentClassOf(name) {
  for (const [re, id, cls] of CLASS_MATCHERS) if (re.test(name)) return { classId: id, materialClass: cls };
  return { classId: null, materialClass: "other" };
}

/**
 * The original formulation as an immutable source record (entity kind
 * "formulation", version "source"). `meta.slug` names it.
 */
export function sourceFormulation(text, meta = {}) {
  const parsed = parseFormulationText(text);
  const base = meta.slug || slug(parsed.title || "formulation");
  const contentSha256 = sha256(String(text));
  const units = new Set(parsed.ingredients.map((g) => g.unit));
  const basis = units.size === 1 ? BASIS[[...units][0]] : "unspecified";
  const ingredients = parsed.ingredients.map((g) => ({
    id: slug(g.name),
    name: g.name,
    ref: null,
    amount: { min: g.min, max: g.max, unit: "%" },
    tolerance: null,
    role: g.note,
    locator: g.locator,
  }));
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: `formulation:${base}:source`,
    kind: "formulation",
    identity: { name: parsed.title, aliases: parsed.descriptor ? [`${parsed.title} (${parsed.descriptor})`] : [], category: "polymer composite formulation", version: "source", identifiers: {}, variant: null },
    composition: {
      basis,
      ingredients,
      statedTotal: parsed.statedTotal ? { value: parsed.statedTotal.value, unit: "%" } : null,
      structure: null,
      exact: parsed.ingredients.every((g) => g.min === g.max),
    },
    process: {
      versionRef: null,
      steps: parsed.temperatures.map((t, i) => ({
        id: `stated-temperature-${i + 1}`, order: i, action: "thermal processing (as stated)", equipment: null,
        conditions: { temperature: { value: t.value, unit: t.unit } }, constraints: [], statedAs: t.quote, locator: t.locator,
      })),
      missing: [],
    },
    evidence: [{
      kind: "user_statement", sourceId: "user_statement", title: `${parsed.title} as written by its author`, url: null,
      document: meta.document || null, author: meta.author || null, date: meta.date || null, retrieved: null,
      locator: "whole text", excerpt: String(text), sha256: contentSha256, license: null, receiptRef: null,
    }],
    relationships: [],
    extensions: {
      materials: {
        polymerClass: "thermoplastic",
        constituents: parsed.ingredients.map((g) => {
          const { materialClass } = constituentClassOf(g.name);
          return {
            ingredientId: slug(g.name), class: materialClass,
            grade: null, supplier: null, variant: null, particleSize: null, fiberLength: null, fiberDiameter: null,
            sizing: null, surfaceTreatment: null, purity: null, meltFlowRate: null,
          };
        }),
        mixingOrder: null,
        processingTemperatures: parsed.temperatures.map((t) => ({ label: t.label, value: t.value, unit: t.unit, locator: t.locator })),
        coolingProfile: null,
        curingProfile: null,
      },
    },
    provenance: { createdBy: meta.author || null, createdAt: meta.date || null, immutable: true, contentSha256, derivedFrom: null },
  };
  return { record: deepFreeze(record), parsed: deepFreeze(parsed) };
}

/** A proposed exact formulation version derived from a source record. */
export function proposeVersion(source, { label = "v1-proposed" } = {}) {
  const ings = source.composition.ingredients.map((g) => ({ id: g.id, name: g.name, min: g.amount.min ?? g.amount.value, max: g.amount.max ?? g.amount.value }));
  const check = checkComposition(ings, source.composition.statedTotal);
  if (!check.feasible) return { ok: false, check, error: check.note };
  const r = uniformRangePosition(ings);
  if (!r.ok) return { ok: false, check, error: r.error };
  const base = source.id.replace(/:source$/, "");
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: `${base}:${label}`,
    kind: "formulation",
    identity: { ...source.identity, aliases: [...source.identity.aliases], identifiers: { ...source.identity.identifiers }, version: label },
    composition: {
      basis: source.composition.basis,
      ingredients: r.fractions.map((f) => {
        const g = source.composition.ingredients.find((x) => x.id === f.id);
        return { id: f.id, name: f.name, ref: null, amount: { value: f.pct, unit: "%" }, tolerance: null, role: g.role, locator: g.locator };
      }),
      statedTotal: { value: 100, unit: "%" },
      structure: null,
      exact: true,
    },
    relationships: [{ type: "derived_from", target: source.id, note: "exact fractions by rule; ranges unchanged" }],
    provenance: {
      createdBy: "conkay knowledge layer (deterministic rule)", createdAt: null, immutable: true,
      contentSha256: sha256(JSON.stringify(r.fractions.map((f) => [f.id, f.units]))),
      rule: r.rule, derivedFrom: source.id,
    },
    validation: {
      tests: [], referenceResults: [], failedChecks: [], confidence: "none",
      knownLimitations: [
        "PROPOSED by arithmetic only. It is not a formulation decision: the formulator must confirm or replace it.",
        `Composition basis is ${source.composition.basis === "unspecified" ? "unstated (wt% or vol%?)" : source.composition.basis}; the fractions are in that same basis.`,
      ],
    },
  };
  return { ok: true, record, check, fractions: r.fractions, rule: r.rule, rejected: scaledMidpoints(ings) };
}

/** The process exactly as stated, as its own process-version record. */
export function processVersion(source, { label = "p1-as-stated" } = {}) {
  const base = source.id.replace(/:source$/, "").replace(/^formulation:/, "");
  const steps = source.process.steps.map((s) => {
    const t = s.conditions.temperature;
    const k = normalizeTemperature(t.value, t.unit);
    return {
      ...s,
      action: "melt processing (compounding / moulding); stated as a 'cure' temperature",
      conditions: { ...s.conditions, temperatureK: k.ok ? k.value : null },
      constraints: [],
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `process:${base}:${label}`,
    kind: "process",
    identity: { name: `${source.identity.name} process`, aliases: [], category: "polymer compounding process", version: label, identifiers: {}, variant: null },
    process: {
      versionRef: label,
      steps,
      missing: ["equipment (extruder type, screw configuration)", "mixing order / feeding points", "residence time and screw speed", "filler drying", "forming method (injection, compression, rotational moulding, extrusion)", "cooling profile", "post-processing / conditioning"],
    },
    relationships: [{ type: "process_for", target: source.id, note: "applies to any formulation version derived from this source until changed" }],
    provenance: { createdBy: "conkay knowledge layer", createdAt: null, immutable: true, contentSha256: sha256(JSON.stringify(steps)), derivedFrom: source.id },
  };
}
