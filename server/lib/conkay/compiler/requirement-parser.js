// server/lib/conkay/compiler/requirement-parser.js
//
// Brief → requirements, the first stage of the ConKay build loop. Pulls the
// numeric targets out of a free-text brief, each with its unit (converted to
// SI) and the exact words it came from. Anything it can't turn into a
// number stays as unparsed intent, reported back, never dropped and never
// guessed into a target.
//
//   "a car that weighs 2,500 lb, does 180 mph, seats 4, futuristic aero look"
//   → mass ≤ 1133.98 kg · topSpeed ≥ 80.47 m/s · seats = 4
//     intent: "a car that …, futuristic aero look"

import { parseQuantity } from "./units.js";

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
const num = (s) => Number(String(s).replace(/,/g, ""));

// [metric, regex, unit-group index or fixed unit, bound]
const RULES = [
  { metric: "mass", re: new RegExp(String.raw`(?:weigh(?:s|ing)?|mass(?:\s+of)?|weight(?:\s+of)?)\s+(?:under\s+|at most\s+|about\s+|around\s+)?${NUM}\s*(lb|lbs|kg|t|tonnes?)\b`, "i"), bound: "max" },
  { metric: "mass", re: new RegExp(String.raw`${NUM}\s*(lb|lbs|kg)\s+(?:[a-z-]+\s+){0,2}(?:car|vehicle|drone|aircraft|plane|boat|frame|robot|bike)\b`, "i"), bound: "max", keepTail: true },
  { metric: "designWindSpeed", re: new RegExp(String.raw`${NUM}\s*(mph|km/h|kph|m/s)\s+winds?\b`, "i"), bound: "min" },
  { metric: "topSpeed", re: new RegExp(String.raw`(?:does|top speed(?:\s+of)?|reach(?:es)?|goes?|hits?|at least)\s+${NUM}\s*(mph|km/h|kph|m/s)\b`, "i"), bound: "min" },
  { metric: "topSpeed", re: new RegExp(String.raw`${NUM}\s*(mph|km/h|kph)\s+top speed`, "i"), bound: "min" },
  { metric: "power", re: new RegExp(String.raw`${NUM}\s*(hp|kw|mw)\b`, "i"), bound: "min" },
  { metric: "range", re: new RegExp(String.raw`(?:range(?:\s+of)?|travels?|flies|fly|goes)\s+${NUM}\s*(miles?|mi|km)\b`, "i"), bound: "min" },
  { metric: "range", re: new RegExp(String.raw`${NUM}\s*(miles?|mi|km)\s+(?:of\s+)?range`, "i"), bound: "min" },
  { metric: "range", re: new RegExp(String.raw`${NUM}\s*(miles?|mi|km)\b`, "i"), bound: "min", note: "a bare distance, read as range" },
  { metric: "seats", re: new RegExp(String.raw`seats?\s+${NUM}\b`, "i"), bound: "min", unitless: true },
  { metric: "seats", re: new RegExp(String.raw`(?:for|carries|carrying)\s+${NUM}\s*(?:people|persons?|passengers?|adults?|occupants?)\b`, "i"), bound: "min", unitless: true },
  { metric: "seats", re: new RegExp(String.raw`${NUM}\s*(?:people|persons?|passengers?|seats|seater|occupants?)\b`, "i"), bound: "min", unitless: true },
  { metric: "budget", re: new RegExp(String.raw`(?:under|below|less than|budget(?:\s+of)?|at most)\s+\$\s?${NUM}\s*(k|m)?\b`, "i"), bound: "max", money: true },
];

const UNIT_ALIASES = { lbs: "lb", tonne: "t", tonnes: "t", kph: "km/h", kw: "kW", mw: "MW", mile: "mi", miles: "mi" };
const LENGTH_UNITS = { mi: 1609.344, km: 1000 };

function toSI(value, unit) {
  const u = UNIT_ALIASES[unit.toLowerCase()] || unit.toLowerCase();
  if (LENGTH_UNITS[u]) return { si: value * LENGTH_UNITS[u], unit: u, dim: "length" };
  const canonical = { lb: "lb", kg: "kg", t: "t", mph: "mph", "km/h": "km/h", "m/s": "m/s", hp: "hp", kW: "kW", MW: "MW" }[u] || { kw: "kW", mw: "MW" }[u] || u;
  const q = parseQuantity({ value, unit: canonical });
  return q.ok ? { si: q.si, unit: canonical, dim: q.dim } : null;
}

export function parseBrief(text) {
  const brief = String(text || "");
  const requirements = [];
  const used = [];
  for (const rule of RULES) {
    if (requirements.some((r) => r.metric === rule.metric)) continue; // first match per metric wins
    const m = brief.match(rule.re);
    if (!m) continue;
    const value = num(m[1]);
    let req;
    if (rule.unitless) {
      req = { metric: rule.metric, [rule.bound]: { si: value, unit: "1", dim: "ratio" } };
    } else if (rule.money) {
      const mult = !m[2] ? 1 : m[2].toLowerCase() === "k" ? 1e3 : 1e6;
      req = { metric: rule.metric, [rule.bound]: { si: value * mult, unit: "USD", dim: "money" } };
    } else {
      const q = toSI(value, m[2]);
      if (!q) continue;
      req = { metric: rule.metric, [rule.bound]: { si: q.si, unit: q.unit, given: value, dim: q.dim } };
    }
    req.source = m[0].trim();
    if (rule.note) req.note = rule.note;
    requirements.push(req);
    // keepTail: the words after the unit ("electric aircraft") stay in the intent.
    used.push(rule.keepTail ? m[0].slice(0, m[0].indexOf(m[2]) + m[2].length) : m[0]);
  }
  let rest = brief;
  for (const u of used) rest = rest.replace(u, " ");
  const intent = rest.replace(/\s*,\s*(,\s*)+/g, ", ").replace(/\s{2,}/g, " ").replace(/^[\s,]+|[\s,.]+$/g, "");
  return { requirements, intent, note: requirements.length ? null : "no numeric targets found in the brief" };
}
