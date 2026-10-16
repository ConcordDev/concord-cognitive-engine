// server/lib/conkay/knowledge/chemical-compatibility.js
//
// Blend D brief item 7: a static, sourced chemical-compatibility table. Every
// row cites a registered document; a row no source has been read for is
// "unknown" with the reason, never a guess. Ratings are the source's own words
// (PPI TR-19's "R to xx°F" code; the papers' statements), not a scale invented here.

import { evidenceRef } from "./sources.js";

const row = (id, environment, subject, rating, docs, { conditions = null, notes = [] } = {}) =>
  Object.freeze({ id, environment, subject, rating, conditions, notes, evidence: docs.map(evidenceRef) });
const unknown = (id, environment, subject, reason) => Object.freeze({ id, environment, subject, rating: "unknown", conditions: null, notes: [reason], evidence: [] });

export const COMPATIBILITY = Object.freeze([
  row("saltwater:hdpe", "salt water (aqueous sodium chloride)", "hdpe", "resistant (R) to 140 °F (60 °C)", ["ppi-tr19-2023"], {
    conditions: "saturated sodium chloride; PPI TR-19 code 'R to 140' for PE (MDPE, HDPE, PE-RT)",
    notes: ["TR-19: neutral salt solutions act like water on plastic piping; sea water's other constituents and marine fouling are not rated separately", "TR-19 is for piping and notes it 'May not be fully applicable to pressurized applications'"],
  }),
  row("h2:hdpe:embrittlement", "high-pressure hydrogen", "hdpe", "no metal-type hydrogen embrittlement", ["li-2023-h2-mechanism"], {
    notes: ["absorbed hydrogen stays molecular in polymers (Li 2023 §2, citing Sandia)"],
  }),
  row("h2:hdpe:plasticisation", "high-pressure hydrogen", "hdpe", "plasticised by dissolved hydrogen: strength reduced, toughness increased", ["li-2023-h2-mechanism"]),
  row("h2:hdpe:decompression", "high-pressure hydrogen, rapid pressure release", "hdpe", "liner blistering and collapse are reported failure modes", ["li-2023-h2-mechanism"], {
    notes: ["qualified by test: CSA/ANSI CHMC 2 and ISO 11114-5 hydrogen-compatibility methods (Li 2023 Table 1)"],
  }),
  row("uv:hdpe", "UV (sunlight)", "hdpe", "degrades (chain scission) unless protected; carbon black ~2–3 wt % (22–25 nm) is the protection used", ["lavoie-2021-membranes-hdpe-uv"]),
  row("acids:caco3", "acids", "caco3", "reacts: carbon dioxide evolved (effervescence)", ["pubchem-cid-10112-reactivity"], {
    notes: ["a CaCO3-filled part in acid loses filler at exposed surfaces; the rate in the compound is a test"],
  }),
  unknown("uv:silica", "UV (sunlight)", "silica", "no source read on whether silica stabilises HDPE against UV: not claimed either way"),
  unknown("uv:graphene", "UV (sunlight)", "graphene", "no source read on whether ~2.8 wt % graphene nanoplatelets protect HDPE against UV the way 2–3 wt % carbon black does: not claimed"),
  unknown("saltwater:basalt_fiber", "salt water", "basalt_fiber", "no source read on basalt fibre in salt water or on the fibre–HDPE interface there"),
  unknown("any:hdpe_hc_copolymer", "any", "hdpe_hc_copolymer", "the co-polymer is not identified: no compatibility can be read for it"),
  row("saltwater:recycled_impact_pp", "salt water (aqueous sodium chloride)", "recycled_impact_pp", "resistant (R) to 140 °F (60 °C)", ["ppi-tr19-2023"], {
    conditions: "saturated sodium chloride; PPI TR-19 Table 3 code 'R to 140' for PP (PP-R, PP-RCT)",
    notes: ["TR-19 rates PP homopolymer and random copolymers as a group; an impact (block) copolymer and a recycled stream are not rated separately", "TR-19 is for piping and notes it 'May not be fully applicable to pressurized applications'"],
  }),
  unknown("h2:recycled_impact_pp", "high-pressure hydrogen", "recycled_impact_pp", "no source read on polypropylene in high-pressure hydrogen (the liner literature read covers PE and PA)"),
  unknown("any:eva", "salt water, hydrogen, UV", "eva", "PPI TR-19 does not list EVA, and no source on EVA in salt water or hydrogen was read"),
]);

/** The rows that apply to a material IR's constituents (by class), plus the compound-level note. */
export function compatibilityFor(ir) {
  const classes = new Set(ir.constituents.map((c) => c.classId).filter(Boolean));
  const rows = COMPATIBILITY.filter((r) => classes.has(r.subject));
  const missing = ir.constituents.filter((c) => !c.classId || !COMPATIBILITY.some((r) => r.subject === c.classId)).map((c) => c.id);
  return {
    rows,
    notCovered: missing,
    compoundNote: "constituent-level evidence only: the compound's own behaviour (interfaces, additives, processing) is a test — weathering ASTM G154/G155, hydrogen CSA/ANSI CHMC 2, immersion per the service fluid",
  };
}
