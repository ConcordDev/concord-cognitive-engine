// server/lib/conkay/chat/brief-parser.js
//
// Chat text -> Design IR, claims, clarifying questions, assumptions. Deterministic: every number comes from the
// user's text (read by chat/quantities.js, unit-aware, an unknown unit is an error) or from a cited default
// (chat/question-policy.js). Nothing is filled in silently: a field the user did not give is asked, defaulted from
// a cited standard or library entry (status "default", with the source), or left unknown and listed with the checks
// it blocks.
//
//   parseChatBrief(text, { llm = false, mapPhrases = null }) ->
//     { ok, domain, ir, claims: [...], questions: [...], later: [...], unknowns: [...], assumptions: [...],
//       errors: [...], rejectedMappings: [...] }
//
// Domains: car, bracket (a cantilever plate), beam, truss (planar Warren / Pratt / Howe), sentinel-part.
//
// LLM (optional, off by default): mapPhrases(text, domain, fields) -> [{ phrase, field }] may only say which words
// belong to which field. Each mapping is re-validated: the field must exist in the domain, the phrase must be in
// the text verbatim, and the value is read from the phrase by the same scanner (one quantity of the right kind).
// A mapping that fails any of these is rejected, never used.

import { scanQuantities, around, COUNT_NOUNS } from "./quantities.js";
import { FIELDS, STATUS, CITED_DEFAULTS, questionsFor } from "./question-policy.js";
import { resolveMaterialName } from "../materials/index.js";

export const BRIEF_PARSER_VERSION = "1.0.0";
export const DOMAINS = Object.freeze(["car", "bracket", "beam", "truss", "sentinel-part"]);

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** "four-seat" -> "4-seat", "three panels" -> "3 panels" (only before a count noun). */
function normalizeNumberWords(text) {
  return text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?=[\s-]+([a-z]+)\b)/gi, (w, _n, next) => (COUNT_NOUNS.has(String(next).toLowerCase()) ? String(NUMBER_WORDS[w.toLowerCase()]) : w));
}

export function detectDomain(text) {
  const t = text.toLowerCase();
  if (/\bsentinel\b|\bm1\b/.test(t) && /\b(knee|hip|ankle|actuator|bracket|mount|link|part)\b/.test(t)) return "sentinel-part";
  if (/\btruss\b|\bwarren\b|\bpratt\b|\bhowe\b/.test(t)) return "truss";
  if (/\bbracket\b|\bcantilever(?:ed)?\s+plate\b/.test(t)) return "bracket";
  if (/\bbeam\b|\bjoist\b|\bgirder\b/.test(t)) return "beam";
  if (/\b(car|vehicle|sedan|coupe|hatchback|suv|ev|roadster|supercar)\b/.test(t)) return "car";
  return null;
}

const claim = (field, label, value, { unit = null, display = null, status = STATUS.INPUT, source, note } = {}) => ({ field, label, value, unit, display: display ?? (value == null ? null : `${value}${unit && unit !== "1" ? ` ${unit}` : ""}`), status, source, ...(note ? { note } : {}) });

// ---- shared readers --------------------------------------------------------------------------------------------

const GRADE_RE = /\b(6061(?:-t6)?|7075(?:-t6)?|a36|a992|4140|8620|304\s+stainless|316\s+stainless|ti-?6al-?4v|stainless(?:\s+steel)?|steel|alumin(?:i)?um|titanium|cfrp|carbon\s+fib(?:re|er)|wood|timber|concrete)\b/i;
const GRADE_SPECIFIC = /^(6061|7075|a36|a992|4140|8620|304|316|ti)/i;

function readMaterial(text, kind) {
  const m = text.match(GRADE_RE);
  if (!m) return null;
  const word = m[1].toLowerCase().replace(/\s+steel$/, "");
  const r = resolveMaterialName(word.replace(/-t6$/, ""), { kind });
  if (!r) return claim("material", "material", null, { status: STATUS.UNKNOWN, source: `"${m[1]}"`, note: `no library entry for "${m[1]}": give a grade the library carries (for example A36 steel or 6061-T6 aluminium)` });
  if (GRADE_SPECIFIC.test(word)) return claim("material", "material", r.id, { source: `"${m[1]}"` });
  return claim("material", "material", r.id, { status: STATUS.DEFAULT, source: `"${m[1]}" read through the material library (server/lib/conkay/materials/index.js): ${r.note || `"${word}" -> ${r.id}`}`, note: "a grade was not named; name one to make it a design input" });
}

function readSafetyFactor(text, material) {
  const m = text.match(/\b(?:safety\s+factor|factor\s+of\s+safety|fos|sf)\s*(?:of|=|:|is)?\s*(\d+(?:\.\d+)?)/i);
  if (m) return claim("safetyFactor", "safety factor", Number(m[1]), { unit: "1", source: `"${m[0].trim()}"` });
  if (material?.value && /^steel-/.test(material.value)) {
    const d = CITED_DEFAULTS.steelFlexureOmega;
    return claim("safetyFactor", "safety factor", d.value, { unit: "1", status: STATUS.DEFAULT, source: d.source, note: d.applies });
  }
  return null;
}

/** A force (or a mass, read as its weight at gn), with the words that place it. */
function forceOf(q) {
  if (q.dim === "force") return { N: q.si, note: null };
  if (q.dim === "mass") return { N: q.si * CITED_DEFAULTS.standardGravity.value, note: `the weight of ${q.raw} at gn = 9.80665 m/s² (${CITED_DEFAULTS.standardGravity.source})` };
  return null;
}

function lengthRole(text, q) {
  const { pre, post } = around(text, q, 28, 18);
  if (/\b(?:at|from)\s*$/.test(pre) || /^\s*from\s+(?:the\s+)?(?:left|right|wall|support|end|fixed)/.test(post)) return "position";
  if (/\b(?:thick(?:ness)?)\s*$/.test(pre) || /^\s*thick/.test(post)) return "thickness";
  if (/\b(?:wide|width)\s*$/.test(pre) || /^\s*wide/.test(post)) return "width";
  if (/\b(?:tall|high|height|deep|depth|rise)\s*(?:of)?\s*$/.test(pre) || /^\s*(?:tall|high|deep)\b/.test(post)) return "height";
  if (/\b(?:span(?:ning|s)?|length|long|arm|reach|over|across)\s*(?:of)?\s*$/.test(pre) || /^\s*(?:span|long|length|arm|reach)\b/.test(post)) return "length";
  return null;
}

// ---- domains ---------------------------------------------------------------------------------------------------

function parseCar(text, scan) {
  const claims = {};
  const lower = text.toLowerCase();
  const speeds = scan.quantities.filter((q) => q.dim === "velocity" && !/^\s*winds?\b/.test(around(text, q).post));
  if (speeds.length) {
    const q = speeds[0];
    claims.topSpeed = claim("topSpeed", "top speed (minimum)", r6(q.si), { unit: "m/s", display: q.raw, source: `"${q.raw}"`, note: "a car brief's speed is read as the top speed it must reach" });
  }
  const seatCount = scan.counts.find((c) => /^(people|persons?|passengers?|adults?|occupants?|seats?|seater)$/.test(c.noun));
  const seatsWord = lower.match(/\bseats?\s+(\d+)\b/);
  if (seatCount) claims.seats = claim("seats", "seats (minimum)", seatCount.value, { unit: "1", source: `"${seatCount.raw}"` });
  else if (seatsWord) claims.seats = claim("seats", "seats (minimum)", Number(seatsWord[1]), { unit: "1", source: `"${seatsWord[0]}"` });
  const mass = scan.quantities.find((q) => q.dim === "mass");
  if (mass) claims.mass = claim("mass", "mass (maximum)", r6(mass.si), { unit: "kg", display: mass.raw, source: `"${mass.raw}"`, note: "a car brief's mass is read as an upper limit" });
  const range = scan.quantities.find((q) => q.dim === "length" && (/(mi|mile)/.test(q.unit) || /^\s*(?:of\s+)?range\b/.test(around(text, q).post) || /\brange\s*(?:of)?\s*$/.test(around(text, q).pre)));
  if (range) claims.range = claim("range", "range (minimum)", r6(range.si), { unit: "m", display: range.raw, source: `"${range.raw}"` });
  const power = scan.quantities.find((q) => q.dim === "power");
  if (power) claims.power = claim("power", "power", r6(power.si), { unit: "W", display: power.raw, source: `"${power.raw}"` });
  const money = text.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?\b/i);
  if (money) claims.budget = claim("budget", "budget (maximum)", Number(money[1].replace(/,/g, "")) * (!money[2] ? 1 : money[2].toLowerCase() === "k" ? 1e3 : 1e6), { unit: "USD", source: `"${money[0]}"` });
  if (/\b(electric|ev|battery[-\s]electric|bev)\b/.test(lower)) claims.fuelType = claim("fuelType", "powertrain", "electric", { source: `"${lower.match(/\b(electric|ev|battery[-\s]electric|bev)\b/)[0]}"` });
  else if (/\b(gasoline|gas|petrol|v8|v6|combustion|ice)\b/.test(lower)) claims.fuelType = claim("fuelType", "powertrain", "gasoline", { source: `"${lower.match(/\b(gasoline|gas|petrol|v8|v6|combustion|ice)\b/)[0]}"` });
  return claims;
}

function carIr(claims) {
  const v = (f) => claims[f]?.value ?? null;
  const req = { topSpeedMs: v("topSpeed"), seats: v("seats"), massMaxKg: v("mass"), rangeM: v("range"), budgetUsd: v("budget"), powerW: v("power") };
  // the compiler's brief form (car-from-library.js reads requirements from text): only what was given
  const parts = [];
  if (req.massMaxKg != null) parts.push(`weighs ${+(req.massMaxKg / 0.45359237).toFixed(1)} lb`);
  if (req.topSpeedMs != null) parts.push(`can go ${+(req.topSpeedMs / 0.44704).toFixed(2)} mph`);
  if (req.seats != null) parts.push(`seats ${req.seats} people`);
  return { kind: "car", requirements: req, config: v("fuelType") ? { fuelType: v("fuelType") } : {}, brief: parts.length ? `Design a car that ${parts.join(", ")}.` : null };
}

function loadsFrom(text, scan, { span = null } = {}) {
  const loads = [];
  const notes = [];
  const positions = scan.quantities.filter((q) => q.dim === "length" && lengthRole(text, q) === "position");
  for (const q of scan.quantities) {
    if (q.dim === "force_per_length") {
      loads.push({ type: "udl", Npm: r6(q.si), source: `"${q.raw}"` });
      continue;
    }
    const f = forceOf(q);
    if (!f) continue;
    if (q.dim === "mass" && !/\b(load(?:ed|s|ing)?|carr(?:y|ies|ying)|hold(?:s|ing)?|support(?:s|ing)?|hang(?:s|ing)?|weigh(?:t|s|ing)?)\b/.test(text.toLowerCase())) continue; // a mass not described as a load is not one
    const { pre, post } = around(text, q, 30, 40);
    let at = null;
    const pos = positions.find((p) => p.index > q.index && p.index - q.end < 12);
    if (pos) at = { xM: r6(pos.si), from: /right/.test(around(text, pos, 0, 30).post) ? "right" : "left", source: `"${pos.raw}"` };
    else if (/\bmid[\s-]?span\b|\bcent(?:er|re)\b|\bmiddle\b/.test(post + pre)) at = "midspan";
    else if (/\b(?:tip|free\s+end|end)\b/.test(post + pre)) at = "tip";
    else if (/\beach\s+(?:top\s+|bottom\s+)?(?:joint|panel\s+point|node)\b/.test(post)) at = /bottom/.test(post) ? "each bottom joint" : /top/.test(post) ? "each top joint" : "each joint";
    loads.push({ type: "point", N: r6(f.N), at, source: `"${q.raw}"` });
    if (f.note) notes.push(f.note);
  }
  void span;
  return { loads, notes };
}

function lengthsByRole(text, scan) {
  const out = {};
  const loose = [];
  for (const q of scan.quantities.filter((x) => x.dim === "length")) {
    const role = lengthRole(text, q);
    if (role === "position") continue;
    if (role) { if (!out[role]) out[role] = q; } else loose.push(q);
  }
  return { ...out, loose };
}

function parseBracket(text, scan, assumptions) {
  const claims = {};
  claims.support = claim("support", "support", "cantilever", { source: '"bracket": a cantilever plate fixed at the wall (this parser\'s definition of a bracket)' });
  const L = lengthsByRole(text, scan);
  const len = L.length || (L.loose.length === 1 ? L.loose[0] : null);
  if (len) claims.length = claim("length", "arm length", r6(len.si), { unit: "m", display: len.raw, source: `"${len.raw}"`, ...(L.length ? {} : { note: "the only length given, read as the arm length" }) });
  if (L.thickness) claims.thickness = claim("thickness", "plate thickness", r6(L.thickness.si), { unit: "m", display: L.thickness.raw, source: `"${L.thickness.raw}"` });
  if (L.width) claims.width = claim("width", "plate width", r6(L.width.si), { unit: "m", display: L.width.raw, source: `"${L.width.raw}"` });
  const { loads, notes } = loadsFrom(text, scan);
  if (loads.length) {
    const l = loads[0];
    claims.load = claim("load", "load", l.N, { unit: "N", display: `${l.N} N${l.at ? ` at ${typeof l.at === "string" ? l.at : `${l.at.xM} m`}` : ""}`, source: l.source, ...(notes.length ? { note: notes.join("; ") } : {}) });
    if (!l.at) claims.load.note = [claims.load.note, "where it acts was not said: a cantilever's load is checked at the tip, its worst place"].filter(Boolean).join("; ");
    if (loads.length > 1) assumptions.push(`${loads.length} loads found; the bracket carries the first (${l.source}); the others are listed in ir.otherLoads`);
  }
  const mat = readMaterial(text);
  if (mat) claims.material = mat;
  const sf = readSafetyFactor(text, mat);
  if (sf) claims.safetyFactor = sf;
  return { claims, loads };
}

function parseBeam(text, scan, assumptions) {
  const claims = {};
  const lower = text.toLowerCase();
  const support = /\bsimply[\s-]?supported\b|\bsimple\s+supports?\b|\bpin(?:ned)?\s+(?:and|&)\s+roller\b/.test(lower) ? "simply-supported"
    : /\bpropped\s+cantilever\b/.test(lower) ? "propped-cantilever"
      : /\bcantilever(?:ed)?\b/.test(lower) ? "cantilever"
        : /\bfixed[\s-]fixed\b|\bfixed\s+(?:at\s+)?both\s+ends\b|\bbuilt[\s-]in\s+at\s+both\b/.test(lower) ? "fixed-fixed" : null;
  if (support) claims.support = claim("support", "supports", support, { source: `"${lower.match(/simply[\s-]?supported|simple\s+supports?|pin(?:ned)?\s+(?:and|&)\s+roller|propped\s+cantilever|cantilever(?:ed)?|fixed[\s-]fixed|fixed\s+(?:at\s+)?both\s+ends|built[\s-]in\s+at\s+both/)[0]}"` });
  const L = lengthsByRole(text, scan);
  const span = L.length || (L.loose.length === 1 ? L.loose[0] : null);
  if (span) claims.span = claim("span", "span", r6(span.si), { unit: "m", display: span.raw, source: `"${span.raw}"`, ...(L.length ? {} : { note: "the only length given, read as the span" }) });
  else if (L.loose.length > 1) assumptions.push(`lengths ${L.loose.map((q) => q.raw).join(", ")} were given without saying which is the span: none is used as the span`);
  const { loads, notes } = loadsFrom(text, scan);
  if (loads.length) claims.loads = claim("loads", "loads", loads, { display: loads.map((l) => (l.type === "udl" ? `${l.Npm} N/m distributed` : `${l.N} N${l.at ? ` at ${typeof l.at === "string" ? l.at : `${l.at.xM} m from the ${l.at.from}`}` : ""}`)).join("; "), source: loads.map((l) => l.source).join(", "), ...(notes.length ? { note: notes.join("; ") } : {}) });
  for (const l of loads) if (l.type === "point" && !l.at) assumptions.push(`where ${l.source} acts was not said: ask, or give "at midspan" / "at 2 m from the left"`);
  const mat = readMaterial(text);
  if (mat) claims.material = mat;
  const sf = readSafetyFactor(text, mat);
  if (sf) claims.safetyFactor = sf;
  return { claims, loads };
}

function parseTruss(text, scan) {
  const claims = {};
  const lower = text.toLowerCase();
  const type = lower.match(/\b(warren|pratt|howe)\b/);
  if (type) claims.type = claim("type", "truss type", type[1], { source: `"${type[0]}"` });
  const panels = scan.counts.find((c) => /^(panels?|bays?)$/.test(c.noun));
  if (panels) claims.panels = claim("panels", "panels", panels.value, { unit: "1", source: `"${panels.raw}"` });
  const L = lengthsByRole(text, scan);
  if (L.length) claims.span = claim("span", "span", r6(L.length.si), { unit: "m", display: L.length.raw, source: `"${L.length.raw}"` });
  if (L.height) claims.height = claim("height", "height", r6(L.height.si), { unit: "m", display: L.height.raw, source: `"${L.height.raw}"` });
  const { loads, notes } = loadsFrom(text, scan);
  if (loads.length) claims.loads = claim("loads", "joint loads", loads, { display: loads.map((l) => `${l.N} N${l.at ? ` at ${typeof l.at === "string" ? l.at : `${l.at.xM} m`}` : ""}`).join("; "), source: loads.map((l) => l.source).join(", "), ...(notes.length ? { note: notes.join("; ") } : {}) });
  const sup = /\bpin(?:ned)?\s+(?:and|&)\s+roller\b|\bsimply[\s-]?supported\b/.test(lower);
  claims.support = sup
    ? claim("support", "supports", "pin + roller", { source: `"${lower.match(/pin(?:ned)?\s+(?:and|&)\s+roller|simply[\s-]?supported/)[0]}"` })
    : claim("support", "supports", CITED_DEFAULTS.trussSupports.value, { status: STATUS.DEFAULT, source: CITED_DEFAULTS.trussSupports.source, note: CITED_DEFAULTS.trussSupports.applies });
  const mat = readMaterial(text);
  if (mat) claims.material = mat;
  return { claims, loads };
}

function parseSentinel(text) {
  const claims = {};
  const lower = text.toLowerCase();
  if (/\bm1\b/.test(lower) || /\bsentinel\b/.test(lower)) claims.robot = claim("robot", "robot", "Sentinel M1", { source: `"${lower.match(/\bm1\b|\bsentinel\b/)[0]}"`, note: "armor stays off M1" });
  const joint = lower.match(/\b(knee|hip|ankle)\b/);
  if (joint) claims.joint = claim("joint", "joint", joint[1], { source: `"${joint[0]}"` });
  const part = lower.match(/\b(actuator\s+bracket|actuator\s+mount|bracket|mount|link|housing)\b/);
  if (part) claims.part = claim("part", "part", part[1], { source: `"${part[0]}"` });
  if (/\bgait\b|\bpeak\b|\bwalking\b/.test(lower) && joint) {
    claims.loadCase = claim("loadCase", "load case", { solver: "sentinel/gait.js quasiStaticGait", output: `peaks.conservativeNm.${joint[1]}` }, {
      status: STATUS.COMPUTED, display: `gait-cycle peak ${joint[1]} torque (computed by the Sentinel motion check, not typed)`,
      source: `"${lower.match(/gait[\w\s-]*|peak[\w\s-]*|walking/)[0].trim()}"`, note: "the value is the solver's output when the design runs; the parser does not supply it",
    });
  }
  const mat = readMaterial(text);
  if (mat) claims.material = mat;
  return { claims, loads: [] };
}

// ---- entry -----------------------------------------------------------------------------------------------------

const FIELD_DIMS = { topSpeed: ["velocity"], mass: ["mass"], range: ["length"], length: ["length"], span: ["length"], height: ["length"], load: ["force", "mass"], power: ["power"] };

export function parseChatBrief(text, { llm = false, mapPhrases = null } = {}) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, errors: [{ error: "empty message" }] };
  const norm = normalizeNumberWords(text.trim());
  const domain = detectDomain(norm);
  if (!domain) return { ok: false, domain: null, errors: [{ error: `not a design ConKay's chat can read yet: it reads ${DOMAINS.join(", ")}` }] };
  const scan = scanQuantities(norm);
  if (scan.errors.length) return { ok: false, domain, errors: scan.errors };
  const assumptions = [];
  let parsed;
  if (domain === "car") parsed = { claims: parseCar(norm, scan), loads: [] };
  else if (domain === "bracket") parsed = parseBracket(norm, scan, assumptions);
  else if (domain === "beam") parsed = parseBeam(norm, scan, assumptions);
  else if (domain === "truss") parsed = parseTruss(norm, scan);
  else parsed = parseSentinel(norm);
  const claims = parsed.claims;

  // the optional language-model mapping: words -> fields only, re-validated, never a number of its own
  const rejectedMappings = [];
  if (llm && typeof mapPhrases === "function") {
    const known = new Set((FIELDS[domain] || []).map((f) => f.field));
    for (const m of mapPhrases(norm, domain, [...known]) || []) {
      const reject = (why) => rejectedMappings.push({ ...m, reason: why });
      if (!known.has(m?.field)) { reject("not a field of this design"); continue; }
      if (typeof m.phrase !== "string" || !norm.includes(m.phrase)) { reject("the phrase is not in the message"); continue; }
      if (claims[m.field] && claims[m.field].status !== STATUS.UNKNOWN) { reject("the parser already read this field"); continue; }
      const dims = FIELD_DIMS[m.field];
      if (!dims) { reject("this field is not read from a number"); continue; }
      const qs = scanQuantities(m.phrase);
      const hits = qs.quantities.filter((q) => dims.includes(q.dim));
      if (qs.errors.length || hits.length !== 1) { reject(`the phrase must hold exactly one ${dims.join(" or ")} (found ${hits.length})`); continue; }
      const q = hits[0];
      const value = m.field === "load" ? r6(forceOf(q).N) : r6(q.si);
      const unit = { velocity: "m/s", mass: "kg", length: "m", force: "N", power: "W" }[m.field === "load" ? "force" : q.dim];
      claims[m.field] = claim(m.field, m.field, value, { unit, display: q.raw, source: `"${m.phrase}" (mapped to ${m.field} by the language model; the value read by the parser)` });
    }
  }

  // unknown fields: listed with what they block
  const { questions, later, unknowns } = questionsFor(domain, claims);
  for (const f of FIELDS[domain] || []) if (!claims[f.field]) claims[f.field] = claim(f.field, f.label, null, { status: STATUS.UNKNOWN, source: null, ...(f.note ? { note: f.note } : {}) });
  for (const c of Object.values(claims)) if (c.status === STATUS.DEFAULT) assumptions.push(`${c.label}: ${c.display ?? c.value} (default: ${c.source})`);

  const v = (f) => (claims[f]?.status === STATUS.UNKNOWN ? null : claims[f]?.value ?? null);
  let ir;
  if (domain === "car") ir = carIr(Object.fromEntries(Object.entries(claims).filter(([, c]) => c.status !== STATUS.UNKNOWN)));
  else if (domain === "bracket") ir = { kind: "bracket", support: "cantilever", lengthM: v("length"), loadN: v("load"), loadAt: parsed.loads[0]?.at ?? (v("load") != null ? "tip" : null), otherLoads: parsed.loads.slice(1), material: v("material"), safetyFactor: v("safetyFactor"), thicknessM: v("thickness"), widthM: v("width"), section: null };
  else if (domain === "beam") ir = { kind: "beam", spanM: v("span"), support: v("support"), loads: v("loads") || [], material: v("material"), safetyFactor: v("safetyFactor"), section: null };
  else if (domain === "truss") ir = { kind: "truss", type: v("type"), panels: v("panels"), spanM: v("span"), heightM: v("height"), loads: v("loads") || [], supports: v("support"), material: v("material") };
  else ir = { kind: "sentinel-part", robot: v("robot"), joint: v("joint"), part: v("part"), loadCase: v("loadCase"), material: v("material"), armor: "off" };

  return {
    ok: true, version: BRIEF_PARSER_VERSION, domain, text: norm, ir,
    claims: Object.values(claims), questions, later, unknowns, assumptions, errors: [], rejectedMappings,
  };
}
