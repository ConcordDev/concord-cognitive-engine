// server/lib/chat/compute-router.js
//
// Deterministic question router — compute-don't-guess that works on ANY model.
//
// A 1.9B self-hosted model scored 10/20 on a computational eval (it routed a
// heat-loss question to a weather lookup, answered kinetic energy as "12",
// garbled tool calls). Correct answers shouldn't depend on model size: when a
// question is FULLY specified and maps to one of Concord's engines, this router
// answers it from the engine before any model is involved. The model still
// handles everything open-ended.
//
// Honest by construction: every route returns null unless all inputs are
// present with recognised units — nothing is assumed except where a route
// discloses it in `assumed`. Each answer carries the formula and the engine.
// Pinned by tests/compute-router.test.js (+ a held-out phrasing set).

import { evaluate, differentiate, integrate, stringify } from "../compute/symbolic-math.js";
import { beamDeflection } from "../compute/physics-compute.js";
import { columnBuckling, voltageDrop, pipeSize, pumpHead, heatLoadCalc } from "../compute/engineering-compute.js";
import { molecularAnalysis } from "../compute/chemistry-compute.js";
import { extractBeamQuestion, formatDeflection } from "../engineering-question-extract.js";
import { arithmeticQuestion, formatArithmeticAnswer } from "../chat-compute-normalize.js";

const NUM = String.raw`(-?\d[\d,]*(?:\.\d+)?(?:[eE]-?\d+)?)`;
const num = (s) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const sig = (v, p = 4) => Number(Number(v).toPrecision(p));
const fmt = (v, p = 4) => sig(v, p).toLocaleString("en-US", { maximumFractionDigits: 10 });
const CONST = { pi: Math.PI, e: Math.E };
const m = (t, re) => t.match(re);

// ── unit tables (exact definitions) ─────────────────────────────────────────
const MASS = { kg: 1, kilogram: 1, kilograms: 1, g: 0.001, gram: 0.001, grams: 0.001, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, oz: 0.028349523125, ounce: 0.028349523125, ounces: 0.028349523125, ton: 907.18474, tons: 907.18474, tonne: 1000, tonnes: 1000 };
const LENGTH = { m: 1, meter: 1, meters: 1, metre: 1, metres: 1, km: 1000, kilometer: 1000, kilometers: 1000, cm: 0.01, centimeter: 0.01, centimeters: 0.01, mm: 0.001, millimeter: 0.001, millimeters: 0.001, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254, mi: 1609.344, mile: 1609.344, miles: 1609.344, yd: 0.9144, yard: 0.9144, yards: 0.9144 };
const VOLUME = { l: 1, liter: 1, liters: 1, litre: 1, litres: 1, ml: 0.001, milliliter: 0.001, milliliters: 0.001, gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784, qt: 0.946352946, quart: 0.946352946, quarts: 0.946352946, cup: 0.2365882365, cups: 0.2365882365 };
const TABLES = [MASS, LENGTH, VOLUME];
const TEMP = { c: "C", celsius: "C", f: "F", fahrenheit: "F", k: "K", kelvin: "K" };

function toC(v, u) { return u === "C" ? v : u === "F" ? (v - 32) * 5 / 9 : v - 273.15; }
function fromC(c, u) { return u === "C" ? c : u === "F" ? c * 9 / 5 + 32 : c + 273.15; }

// ── routes ──────────────────────────────────────────────────────────────────
const ROUTES = [
  {
    id: "beam-deflection",
    detect: (t) => extractBeamQuestion(t),
    run: (p) => { const r = beamDeflection(p); return r && r.ok !== false ? { value: r.value, text: formatDeflection(r.value, r.formula), assumed: p.assumed, engine: "physics.beamDeflection" } : null; },
  },
  {
    id: "column-buckling",
    detect: (t) => {
      if (!/\bbuckl/i.test(t)) return null;
      const L = m(t, new RegExp(`${NUM}\\s*(ft|feet|foot|in|inch|inches|m|meters?)\\b`, "i"));
      const E = m(t, new RegExp(`\\bE\\s*(?:=|is|of)\\s*${NUM}\\s*(psi|ksi)\\b`, "i"));
      const I = m(t, new RegExp(`\\bI\\s*(?:=|is|of)\\s*${NUM}\\s*in\\s*(?:\\^\\s*4|⁴|4)`, "i"));
      if (!L || !I) return null;
      const lenFt = num(L[1]) * ({ ft: 1, feet: 1, foot: 1, in: 1 / 12, inch: 1 / 12, inches: 1 / 12, m: 3.2808399, meter: 3.2808399, meters: 3.2808399 }[L[2].toLowerCase()]);
      const assumed = [];
      let modulusE;
      if (E) modulusE = num(E[1]) * (E[2].toLowerCase() === "ksi" ? 1000 : 1);
      else if (/\bsteel\b/i.test(t)) { modulusE = 29e6; assumed.push("E = 29,000,000 psi (typical steel)"); } else return null;
      const kFactor = /fixed[- ]free|cantilever|flagpole/i.test(t) ? 2 : /fixed[- ](fixed|both)|both ends fixed/i.test(t) ? 0.5 : /fixed[- ]pinned|pinned[- ]fixed/i.test(t) ? 0.7 : /pinned|pin[- ]ended|hinged/i.test(t) ? 1 : null;
      if (kFactor == null) return null;
      return { loadKips: 0, lengthFt: lenFt, modulusE, momentI: num(I[1]), kFactor, assumed };
    },
    run: (p) => { const r = columnBuckling(p); return r?.value ? { value: r.value, text: `Euler critical buckling load Pcr = ${fmt(r.value)} kips (${fmt(r.value * 1000, 5)} lb), from Pcr = π²EI/(KL)² with K = ${p.kFactor}.`, assumed: p.assumed, engine: "engineering.columnBuckling" } : null; },
  },
  {
    id: "voltage-drop",
    detect: (t) => {
      if (!/voltage drop/i.test(t)) return null;
      const I = m(t, new RegExp(`${NUM}\\s*(?:a|amps?|amperes?)\\b`, "i"));
      const L = m(t, new RegExp(`${NUM}\\s*(?:ft|feet|foot)\\b`, "i"));
      const awg = m(t, /\b#?\s*(\d{1,2}|[0-4]\/0)\s*(?:awg|gauge|ga)\b|\bawg\s*#?\s*(\d{1,2})\b/i);
      const V = m(t, new RegExp(`${NUM}\\s*v(?:olts?)?\\b`, "i"));
      if (!I || !L || !awg) return null;
      return { current: num(I[1]), length: num(L[1]), awg: String(awg[1] || awg[2]), material: /alumin/i.test(t) ? "aluminum" : "copper", voltage: V ? num(V[1]) : 120, phase: /three[- ]phase|3[- ]?phase|3φ/i.test(t) ? 3 : 1, assumed: V ? [] : ["120 V"] };
    },
    run: (p) => { const r = voltageDrop(p); return Number.isFinite(r?.value) ? { value: r.value, text: `Voltage drop = ${fmt(r.value, 3)} V (${fmt((r.value / p.voltage) * 100, 3)}% of ${p.voltage} V), from ${r.formula}.${(r.warnings || []).length ? ` Note: ${r.warnings.join("; ")}.` : ""}`, assumed: p.assumed, engine: "engineering.voltageDrop" } : null; },
  },
  {
    id: "pump-bhp",
    detect: (t) => {
      if (!/\bpump\b/i.test(t) || !/horsepower|\bbhp\b|\bhp\b/i.test(t)) return null;
      const Q = m(t, new RegExp(`${NUM}\\s*gpm\\b`, "i"));
      const H = m(t, new RegExp(`${NUM}\\s*(?:ft|feet)\\s*(?:of\\s*)?(?:total\\s*)?(?:dynamic\\s*)?head\\b`, "i")) || m(t, new RegExp(`head\\s*(?:of\\s*)?${NUM}\\s*(?:ft|feet)\\b`, "i"));
      const eff = m(t, new RegExp(`${NUM}\\s*%\\s*(?:pump\\s*)?efficien`, "i")) || m(t, new RegExp(`efficiency\\s*(?:of\\s*)?${NUM}\\s*%`, "i"));
      if (!Q || !H || !eff) return null;
      return { flowGpm: num(Q[1]), totalDynamicHead: num(H[1]), efficiency: num(eff[1]) / 100, specificGravity: 1, assumed: ["water (specific gravity 1.0)"] };
    },
    run: (p) => { const r = pumpHead(p); return Number.isFinite(r?.value) ? { value: r.value, text: `Brake horsepower = ${fmt(r.value)} hp, from BHP = Q·H·SG / (3960·η).`, assumed: p.assumed, engine: "engineering.pumpHead" } : null; },
  },
  {
    id: "pipe-size",
    detect: (t) => {
      if (!/\bpipe\b/i.test(t) || !/diameter|size/i.test(t)) return null;
      const Q = m(t, new RegExp(`${NUM}\\s*gpm\\b`, "i"));
      const v = m(t, new RegExp(`${NUM}\\s*(?:ft\\/s|fps|feet per second|ft per second)\\b`, "i"));
      if (!Q || !v) return null;
      return { flowGpm: num(Q[1]), velocity: num(v[1]) };
    },
    run: (p) => { const r = pipeSize(p); return Number.isFinite(r?.value) ? { value: r.value, text: `Required inside diameter = ${fmt(r.value, 3)} in, from D = √(4Q/(πv)).`, engine: "engineering.pipeSize" } : null; },
  },
  {
    id: "heat-loss",
    detect: (t) => {
      if (!/heat (loss|gain|flow|transfer)|conductive/i.test(t)) return null;
      const A = m(t, new RegExp(`${NUM}\\s*(?:sq\\.?\\s*ft|square feet|sf|ft\\^?2|ft²)\\b`, "i"));
      const R = m(t, new RegExp(`\\bR[- ]?(?:value\\s*(?:of\\s*)?)?${NUM}\\b`, "i"));
      const dT = m(t, new RegExp(`${NUM}\\s*°?\\s*F?\\s*(?:degree\\s*)?(?:temperature\\s*)?(?:difference|delta|ΔT)`, "i")) || m(t, new RegExp(`(?:difference|delta|ΔT)\\s*(?:of\\s*)?${NUM}`, "i"));
      if (!A || !R || !dT) return null;
      return { areaSqft: num(A[1]), rValue: num(R[1]), deltaTemp: num(dT[1]), solarGain: 0 };
    },
    run: (p) => { const r = heatLoadCalc(p); return Number.isFinite(r?.value) ? { value: r.value, text: `Heat loss = ${fmt(r.value)} BTU/h, from Q = A·ΔT/R.`, engine: "engineering.heatLoadCalc" } : null; },
  },
  {
    id: "unit-convert",
    detect: (t) => {
      let c = m(t, new RegExp(`${NUM}\\s*(?:degrees?\\s*)?([a-zA-Z]+)\\s+(?:to|into|in)\\s+(?:degrees?\\s*)?([a-zA-Z]+)`, "i"));
      // "how many feet in 3 meters" / "how many ounces are in a pound"
      const hm = m(t, new RegExp(`how many\\s+([a-zA-Z]+)\\s+(?:are\\s+)?in\\s+(?:an?\\s+)?(?:${NUM}\\s*)?([a-zA-Z]+)`, "i"));
      if (!c && hm) c = [null, hm[2] ?? "1", hm[3], hm[1]];
      if (!c || !/\bconvert|\bhow many|\bwhat is|\bin\b/i.test(t)) return null;
      const [, v, fromU, toU] = c;
      const f = fromU.toLowerCase(), to = toU.toLowerCase();
      if (TEMP[f] && TEMP[to]) return { kind: "temp", v: num(v), from: TEMP[f], to: TEMP[to] };
      for (const tbl of TABLES) if (tbl[f] && tbl[to]) return { kind: "linear", v: num(v), f, to, factor: tbl[f] / tbl[to] };
      return null;
    },
    run: (p) => {
      const value = p.kind === "temp" ? fromC(toC(p.v, p.from), p.to) : p.v * p.factor;
      const label = p.kind === "temp" ? `${p.v} °${p.from} = ${fmt(value)} °${p.to}` : `${p.v} ${p.f} = ${fmt(value, 6)} ${p.to}`;
      return { value, text: `${label}.`, engine: "units (exact definitions)" };
    },
  },
  {
    id: "percent-of",
    detect: (t) => { const x = m(t, new RegExp(`${NUM}\\s*%\\s*of\\s*\\$?${NUM}`, "i")); return x ? { p: num(x[1]), of: num(x[2]) } : null; },
    run: ({ p, of }) => { const value = evaluate(`${p}/100*${of}`); return { value, text: `${p}% of ${of} = ${fmt(value, 8)}.`, engine: "symbolic.evaluate" }; },
  },
  {
    id: "derivative",
    detect: (t) => { const x = m(t, /\bderivative\s+of\s+([^?]+?)(?:\s+with respect to\s+([a-z]))?\s*\??$/i) || m(t, /\bd\/d([a-z])\s*(?:of\s*)?\(?([^?]+?)\)?\s*\??$/i); if (!x) return null; return x[0].toLowerCase().startsWith("d/d") ? { expr: x[2], v: x[1] } : { expr: x[1], v: x[2] || "x" }; },
    run: ({ expr, v }) => { try { const ast = differentiate(cleanExpr(expr), v); const d = casText(ast); return /integral|derivative/.test(stringify(ast)) ? null : { value: d, text: `d/d${v} [${expr.trim()}] = ${d}`, engine: "symbolic.differentiate" }; } catch { return null; } },
  },
  {
    id: "integral",
    detect: (t) => { const x = m(t, /\b(?:integral|antiderivative)\s+of\s+([^?]+?)(?:\s+(?:with respect to|d)\s*([a-z]))?\s*\??$/i) || m(t, /\bintegrate\s+([^?]+?)(?:\s+(?:with respect to|d)\s*([a-z]))?\s*\??$/i); return x ? { expr: x[1], v: x[2] || "x" } : null; },
    run: ({ expr, v }) => { try { const ast = integrate(cleanExpr(expr), v); const i = casText(ast); return /integral\(/.test(stringify(ast)) ? null : { value: i, text: `∫ ${expr.trim()} d${v} = ${i} + C`, engine: "symbolic.integrate" }; } catch { return null; } },
  },
  {
    id: "ohms-law",
    detect: (t) => {
      if (!/\bohm|resist|current|volt/i.test(t)) return null;
      const V = m(t, new RegExp(`${NUM}\\s*v(?:olts?)?\\b`, "i")), I = m(t, new RegExp(`${NUM}\\s*(?:a|amps?|amperes?)\\b`, "i")), R = m(t, new RegExp(`${NUM}\\s*(?:ohms?|Ω)`, "i"));
      const want = /\bwhat (?:is the )?current|how much current|current (?:flows|through)/i.test(t) ? "I" : /\bwhat (?:is the )?resistance/i.test(t) ? "R" : /\bwhat (?:is the )?voltage/i.test(t) ? "V" : null;
      if (want === "I" && V && R && !I) return { want, V: num(V[1]), R: num(R[1]) };
      if (want === "R" && V && I && !R) return { want, V: num(V[1]), I: num(I[1]) };
      if (want === "V" && I && R && !V) return { want, I: num(I[1]), R: num(R[1]) };
      return null;
    },
    run: (p) => { const value = p.want === "I" ? p.V / p.R : p.want === "R" ? p.V / p.I : p.I * p.R; const unit = { I: "A", R: "Ω", V: "V" }[p.want]; return { value, text: `${p.want} = ${fmt(value)} ${unit}, from Ohm's law V = I·R.`, engine: "ohms-law" }; },
  },
  {
    id: "kinetic-energy",
    detect: (t) => { if (!/kinetic energy/i.test(t)) return null; const M = m(t, new RegExp(`${NUM}\\s*kg\\b`, "i")), V = m(t, new RegExp(`${NUM}\\s*m\\/s\\b`, "i")); return M && V ? { m: num(M[1]), v: num(V[1]) } : null; },
    run: ({ m: mass, v }) => { const value = 0.5 * mass * v * v; return { value, text: `Kinetic energy = ${fmt(value)} J, from KE = ½·m·v².`, engine: "physics (KE = ½mv²)" }; },
  },
  {
    id: "stats",
    detect: (t) => {
      const kind = /standard deviation|std\.? ?dev|stdev/i.test(t) ? "sd" : /variance/i.test(t) ? "var" : /\bmedian\b/i.test(t) ? "median" : /\bmean\b|\baverage\b/i.test(t) ? "mean" : null;
      if (!kind) return null;
      const list = (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (list.length < 2) return null;
      const sample = /\bsample\b/i.test(t);
      const population = /\bpopulation\b/i.test(t);
      if ((kind === "sd" || kind === "var") && !sample && !population) return { kind, list, sample: false, assumed: ["population (not sample) statistic"] };
      return { kind, list, sample, assumed: [] };
    },
    run: ({ kind, list, sample, assumed }) => {
      const n = list.length, mean = list.reduce((a, b) => a + b, 0) / n;
      let value, label;
      if (kind === "mean") { value = mean; label = "Mean"; }
      else if (kind === "median") { const s = [...list].sort((a, b) => a - b); value = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; label = "Median"; }
      else { const ss = list.reduce((a, b) => a + (b - mean) ** 2, 0); const variance = ss / (sample ? n - 1 : n); value = kind === "var" ? variance : Math.sqrt(variance); label = `${sample ? "Sample" : "Population"} ${kind === "var" ? "variance" : "standard deviation"}`; }
      return { value, text: `${label} of [${list.join(", ")}] = ${fmt(value, 6)}.`, assumed, engine: "statistics" };
    },
  },
  {
    id: "molar-mass",
    detect: (t) => { if (!/molar mass|molecular (weight|mass)|formula weight/i.test(t)) return null; const f = m(t, /\b((?:[A-Z][a-z]?\d*|\([A-Za-z0-9]+\)\d*){2,})\b/); return f ? { formula: f[1] } : null; },
    run: ({ formula }) => { const r = molecularAnalysis({ formula }); return r?.ok && Number.isFinite(r.molarMass) ? { value: r.molarMass, text: `Molar mass of ${formula} = ${fmt(r.molarMass, 6)} g/mol.`, engine: "chemistry.molecularAnalysis" } : null; },
  },
  {
    id: "compound-interest",
    detect: (t) => {
      if (!/compound/i.test(t)) return null;
      const P = m(t, new RegExp(`\\$\\s*${NUM}`)) || m(t, new RegExp(`${NUM}\\s*(?:dollars|usd)\\b`, "i"));
      const r = m(t, new RegExp(`${NUM}\\s*%`)), y = m(t, new RegExp(`${NUM}\\s*years?\\b`, "i"));
      if (!P || !r || !y) return null;
      const n = /monthly/i.test(t) ? 12 : /quarterly/i.test(t) ? 4 : /daily/i.test(t) ? 365 : /semi-?annual/i.test(t) ? 2 : /annual|yearly/i.test(t) ? 1 : null;
      return n ? { P: num(P[1]), r: num(r[1]) / 100, y: num(y[1]), n } : null;
    },
    run: ({ P, r, y, n }) => { const value = P * (1 + r / n) ** (n * y); return { value, text: `Future value = $${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, from A = P(1 + r/n)^(n·t) with n = ${n}.`, engine: "finance (compound interest)" }; },
  },
  {
    id: "circle",
    detect: (t) => { if (!/\bcircle\b/i.test(t)) return null; const want = /area/i.test(t) ? "area" : /circumference|perimeter/i.test(t) ? "circ" : null; const r = m(t, new RegExp(`radius\\s*(?:of\\s*)?${NUM}`, "i")); const d = m(t, new RegExp(`diameter\\s*(?:of\\s*)?${NUM}`, "i")); if (!want || (!r && !d)) return null; return { want, r: r ? num(r[1]) : num(d[1]) / 2 }; },
    run: ({ want, r }) => { const value = want === "area" ? Math.PI * r * r : 2 * Math.PI * r; return { value, text: `${want === "area" ? "Area = πr²" : "Circumference = 2πr"} = ${fmt(value, 6)} (r = ${r}).`, engine: "geometry" }; },
  },
  {
    id: "arithmetic",
    detect: (t) => {
      const expr = arithmeticQuestion(t);
      if (expr) return { expr };
      // functions/constants: "sqrt(2) times pi", "what is sin(pi/2)"
      const s = t.replace(/\btimes\b/gi, "*").replace(/\bdivided by\b/gi, "/").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-");
      const f = m(s, /^\s*(?:what(?:'?s| is)|calculate|compute|evaluate)\s+([a-z0-9\s+\-*/^().]+?)\s*\??$/i);
      if (f && /(sqrt|sin|cos|tan|log|ln|exp|pi)\b/.test(f[1]) && /\d|pi/.test(f[1])) return { expr: f[1].trim() };
      return null;
    },
    run: ({ expr }) => { try { const value = evaluate(expr, CONST); return Number.isFinite(value) ? { value, text: formatArithmeticAnswer(expr, Number(value.toPrecision(12))), engine: "symbolic.evaluate" } : null; } catch { return null; } },
  },
];

// Readable CAS output: fold numeric coefficients (5·(2x) → 10x) and print with
// minimal parentheses ("3x^2 + 2", not "((3 * (x ^ 2)) + 2)"). Formatting only —
// the value itself comes from symbolic-math.js.
const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
function fold(n) {
  if (!n || n.type !== "op") return n?.type === "fn" ? { ...n, arg: fold(n.arg) } : n;
  const args = n.args.map(fold);
  if (n.op === "*" && args.length === 2) {
    const [a, b] = args;
    if (a.type === "num" && b.type === "num") return { type: "num", value: a.value * b.value };
    if (a.type === "num" && b.type === "op" && b.op === "*" && b.args[0].type === "num") return fold({ type: "op", op: "*", args: [{ type: "num", value: a.value * b.args[0].value }, b.args[1]] });
    if (a.type === "num" && b.type === "op" && b.op === "/" && b.args[1].type === "num" && a.value === b.args[1].value) return b.args[0];
    if (b.type === "num" && a.type !== "num") return fold({ type: "op", op: "*", args: [b, a] });
    if (a.type === "num" && a.value === 1) return b;
  }
  if ((n.op === "+" || n.op === "-") && args.length === 2 && args[0].type === "num" && args[1].type === "num") return { type: "num", value: n.op === "+" ? args[0].value + args[1].value : args[0].value - args[1].value };
  return { ...n, args };
}
function pretty(n, parentPrec = 0) {
  if (!n) return "";
  if (n.type === "num") return String(Number(n.value.toPrecision(12)));
  if (n.type === "var") return n.name;
  if (n.type === "fn") return `${n.name}(${pretty(n.arg)})`;
  if (n.type !== "op" || !n.args) return stringify(n);
  if (n.args.length === 1) return `-${pretty(n.args[0], 4)}`;
  const p = PREC[n.op] ?? 1;
  const [a, b] = n.args;
  let out;
  if (n.op === "*" && a.type === "num" && (b.type === "var" || (b.type === "op" && b.op === "^") || b.type === "fn")) out = `${pretty(a, p)}${pretty(b, p)}`;
  else if (n.op === "^") out = `${pretty(a, p + 1)}^${pretty(b, p + 1)}`;
  else out = `${pretty(a, p)} ${n.op} ${pretty(b, n.op === "-" || n.op === "/" ? p + 1 : p)}`;
  return p < parentPrec ? `(${out})` : out;
}
const casText = (ast) => pretty(fold(ast));

function cleanExpr(s) {
  return String(s).trim().replace(/(\d)\s*([a-z(])/gi, "$1*$2").replace(/\s+/g, " ");
}

/**
 * Route a user message to a deterministic engine.
 * @returns {null | { route:string, value:any, text:string, assumed:string[], engine:string }}
 */
export function routeComputeQuestion(message) {
  const text = String(message || "").trim();
  if (!text || text.length > 600) return null;
  for (const r of ROUTES) {
    let params;
    try { params = r.detect(text); } catch { params = null; }
    if (!params) continue;
    let out;
    try { out = r.run(params); } catch { out = null; }
    if (out) return { route: r.id, value: out.value, text: out.text, assumed: out.assumed || params.assumed || [], engine: out.engine };
  }
  return null;
}

/** The user-facing reply for a routed answer, with any assumption disclosed. */
export function composeRoutedReply(routed) {
  const assumed = routed.assumed?.length ? ` Assumed: ${routed.assumed.join("; ")}.` : "";
  return `${routed.text}${assumed} (Computed by Concord's ${routed.engine} engine.)`;
}

export const ROUTE_IDS = ROUTES.map((r) => r.id);
