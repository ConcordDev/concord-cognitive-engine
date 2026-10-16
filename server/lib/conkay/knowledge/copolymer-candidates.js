// server/lib/conkay/knowledge/copolymer-candidates.js
//
// Blend D's "HDPE/HC co-polymer" is not identified. Dutch (2026-10-16) targets
// discarded plastics and names two candidates to try in its place:
//   1. primary: recycled impact-grade polypropylene (ethylene–propylene
//      copolymer: tubs, caps, bins, crates, bumpers);
//   2. fallback: EVA (ethylene vinyl acetate: shoe and mat foam).
// Each candidate is a set of sourced claims (sources.js, locator + excerpt).
// Properties no source was read for are absent: a check that needs them is NOT
// COMPUTED. A candidate is a what-if, never the source's identity: the IR keeps
// the source's name and records the substitution.

import { makeClaim } from "./claims.js";
import { evidenceRef } from "./sources.js";

const MPA = 1e6;
const C2K = (c) => c + 273.15;

function claim(subject, property, unit, { range = null, value = null }, docs, { notes = [], flags = [], conditions = {} } = {}) {
  const lo = range ? range[0] : value, hi = range ? range[1] : value;
  return makeClaim({
    id: `${subject}.${property}`, subject, property, kind: "quantitative", unit,
    ...(range ? { range: { min: lo, max: hi } } : { value }),
    conditions: { method: "as reported by the cited sources", ...conditions },
    uncertainty: { type: "range", low: lo, high: hi, note: range ? "span of the cited values (grades, batches, reprocessing), not a measurement uncertainty" : "one cited value" },
    method: { kind: "source_document", description: "values read from the cited documents", standard: null, receiptRef: null, assumptions: [] },
    status: ["sourced"], support: "supported", evidence: docs.map(evidenceRef), notes, flags,
  });
}

const RPP = "material:recycled-impact-pp";
const EVA = "material:eva";

export const COPOLYMER_CANDIDATES = Object.freeze({
  "recycled-impact-pp": Object.freeze({
    rank: "primary",
    classId: "recycled_impact_pp",
    label: "recycled impact-grade polypropylene (ethylene–propylene copolymer)",
    feedstock: "tubs, caps, bins, crates, bumpers (Dutch, 2026-10-16)",
    properties: Object.freeze({
      density: claim(RPP, "density", "kg/m3", { range: [902, 940] }, ["vinmar-verdant-rrpi1520k", "vinmar-vinpol-rrpi50y", "mba-pp2143-tds"],
        { notes: ["0.902 (VERDANT RRPI1520K, post-industrial, ASTM D-792A); 0.91 (VINPOL RRPI50Y, post-industrial, ASTM D-792); 0.94 (MBA PP 2143, post-consumer, 'MBA Method'). The post-consumer grade is the densest: its filler/contaminant content is not stated."] }),
      youngsModulus: claim(RPP, "youngs_modulus", "Pa", { range: [900 * MPA, 1305 * MPA] }, ["mba-pp2143-tds", "vinmar-verdant-rrpi1520k", "vinmar-vinpol-rrpi50y", "takayama-2025-polymers-pp-reuse"],
        { flags: ["mixed-test-methods"], notes: ["900 MPa flexural (ISO 178) and 1100 MPa tensile (ISO 527), MBA PP 2143; 965–1165 MPa flexural (ASTM D-790), VERDANT RRPI1520K; 966 MPa flexural, VINPOL RRPI50Y; block copolymer BC03AD 1305 → 1046 MPa tensile after 0 → 5 extrusion cycles (Takayama 2025 Table 7)."] }),
      poisson: claim(RPP, "poisson_ratio", "1", { range: [0.341, 0.370] }, ["takayama-2025-polymers-pp-reuse"],
        { flags: ["single-source"], notes: ["Block-type PP (Novatec BC03AD), 0 / 1 / 3 / 5 extrusion cycles: 0.361 / 0.370 / 0.350 / 0.341 (Takayama 2025 Table 7, small-strain tensile model). No recycled-grade datasheet states a Poisson's ratio."] }),
      yieldStrength: claim(RPP, "tensile_yield_strength", "Pa", { range: [19 * MPA, 22.2 * MPA] }, ["vinmar-vinpol-rrpi50y", "mba-pp2143-tds", "takayama-2025-polymers-pp-reuse"],
        { notes: ["19 MPa (VINPOL RRPI50Y, ASTM D-638); 20 MPa (MBA PP 2143, ISO 527); 22.2 → 20.3 MPa over 0 → 5 extrusion cycles (Takayama 2025 Table 7). VERDANT's 25–26 MPa is labelled 'Tensile Strength' without 'at yield' and is not included."] }),
      conductivity: claim(RPP, "thermal_conductivity", "W/(m·K)", { value: 0.17 }, ["yun-2023-polymers-basalt-particulate"],
        { flags: ["single-source", "virgin-pp", "compiled"], notes: ["PP 0.17 W/mK, compiled in Yun 2023 Table 1 (refs 29–34): a generic PP, not a recycled impact copolymer."] }),
      cte: claim(RPP, "linear_thermal_expansion", "1/K", { value: 104e-6 }, ["yun-2023-polymers-basalt-particulate"],
        { flags: ["single-source", "virgin-pp", "compiled"], notes: ["PP 104 × 10⁻⁶ 1/K, compiled in Yun 2023 Table 1: a generic PP, not a recycled impact copolymer."] }),
      degradationOnset: claim(RPP, "degradation_onset_inert", "K", { value: C2K(344.2) }, ["zhiltsova-2025-polymers-rpp"],
        { flags: ["single-source", "nitrogen"], conditions: { atmosphere: "nitrogen", rate: "20 K/min", method: "ASTM E2550" }, notes: ["Post-consumer recycled PP T_on 344.2 °C under nitrogen (Zhiltsova 2025 Table 6); virgin PP 325.5 °C. Inert-atmosphere onset: not the oxidative limit of a melt in air."] }),
      oitAt200C: claim(RPP, "oxidation_induction_time_200C", "s", { range: [50.8 - 8.3, 50.8 + 8.3] }, ["zhiltsova-2025-polymers-rpp"],
        { flags: ["single-source"], conditions: { temperature: "200 °C", method: "ASTM D3895" }, notes: ["Post-consumer recycled PP 50.8 ± 8.3 s vs virgin 277.6 ± 55.3 s at 200 °C (Table 5): an 82 % drop — its stabiliser is largely spent."] }),
      meltTemperature: claim(RPP, "melting_temperature", "K", { range: [C2K(165.0), C2K(165.8)] }, ["takayama-2025-polymers-pp-reuse"],
        { flags: ["single-source"], notes: ["Block-PP DSC peak 165.0–165.8 °C over 0–5 extrusion cycles (Takayama 2025 Table 9); a virgin block copolymer reprocessed in the lab, not a post-consumer stream."] }),
    }),
    unknown: "a recycled-grade thermal conductivity and CTE (the values carried are a generic PP's), crystallization temperature, hydrogen permeability, relaxation spectrum",
    variability: "recycled grades span 0.902–0.94 g/cm³ and 900–1165 MPa flexural modulus across three datasheets (two post-industrial, one post-consumer); reprocessing alone lowered a block copolymer's tensile modulus 20 % (1305 → 1046 MPa over five extrusions, Takayama 2025). A discarded-plastics stream is mixed: measure each lot (ASTM D792, D638/D790, D1238, D3418).",
  }),
  eva: Object.freeze({
    rank: "fallback",
    classId: "eva",
    label: "ethylene vinyl acetate copolymer (EVA)",
    feedstock: "shoe and mat foam (Dutch, 2026-10-16)",
    properties: Object.freeze({
      density: claim(EVA, "density", "kg/m3", { range: [935, 953] }, ["vinmar-vinpol-ev0218", "vinmar-vinpol-ev0627"],
        { notes: ["0.935 g/cm³ at 18 wt % VA (VINPOL EV0218, ASTM D-1505); 0.953 at 26.7 wt % VA (VINPOL EV0627). Solid resin, not foam: a foam's density is far lower and is not this property."] }),
      youngsModulus: claim(EVA, "youngs_modulus", "Pa", { range: [20.1 * MPA, 60 * MPA] }, ["vinmar-vinpol-ev0218", "vinmar-vinpol-ev0627", "rondon-2026-edt-eva-mouthguard"],
        { flags: ["mixed-test-methods"], notes: ["60 MPa flexural (EV0218, ASTM D-790); 23 MPa 1 % secant flexural (EV0627); 20.1–36.8 MPa tensile on three EVA sheets (Rondon 2026 Table 3). Falls as VA content rises."] }),
      poisson: claim(EVA, "poisson_ratio", "1", { range: [0.24, 0.34] }, ["rondon-2026-edt-eva-mouthguard"],
        { flags: ["single-source", "identical-across-materials"], notes: ["Rondon 2026 Table 3 prints 0.29 ± 0.05 for all three EVA sheets (DIC, ASTM D638, small strain); the span is mean ± 1 SD. The identical value for three different sheets is as printed and has not been checked against the paper's raw data."] }),
      yieldStrength: claim(EVA, "tensile_yield_strength", "Pa", { value: 5.2 * MPA }, ["vinmar-vinpol-ev0218"],
        { flags: ["single-source"], notes: ["5.2 MPa at 18 wt % VA (EV0218, ASTM D-638)."] }),
      degradationOnset: claim(EVA, "degradation_onset", "K", { range: [C2K(305), C2K(331.6)] }, ["rajabifar-2026-acsami-eva-foam", "slonov-2023-polymers-pe-eva"],
        { flags: ["mixed-atmosphere"], notes: ["Deacetylation (acetic acid release) begins 305 °C under nitrogen (Rajabifar 2026); T5% 331.6 °C in air at 5 °C/min for a 12 % VA EVA (Slonov 2023 Table 5). The feedstock's VA content is unknown."] }),
      meltTemperature: claim(EVA, "melting_temperature", "K", { range: [C2K(72), C2K(87)] }, ["vinmar-vinpol-ev0218", "vinmar-vinpol-ev0627"],
        { notes: ["87 °C at 18 % VA (EV0218, ASTM D-3418); 72 °C peak at 26.7 % VA (EV0627, supplier method)."] }),
    }),
    unknown: "thermal conductivity, CTE, crystallization temperature, hydrogen permeability, relaxation spectrum, and any recycled-EVA grade: only virgin resin datasheets were read",
    variability: "the properties depend on VA content (18 vs 26.7 wt % here) and the discarded feedstock's VA is unknown. Shoe and mat foams are commonly crosslinked and foamed; whether that stock melts and blends like the resin above is not established — measure the feedstock's melt flow (ASTM D1238) and density (ASTM D792) first.",
  }),
});

export const CANDIDATE_IDS = Object.freeze(Object.keys(COPOLYMER_CANDIDATES));

const summary = (c) => ({ lo: c.range ? c.range.min : c.value, hi: c.range ? c.range.max : c.value, unit: c.unit, claimRef: c.id, ...(c.flags?.length ? { flags: [...c.flags] } : {}) });

/**
 * The material IR with the unidentified co-polymer replaced by a candidate.
 * Properties the candidate has no source for are null (NOT COMPUTED downstream).
 */
export function withCopolymerCandidate(ir, candidateId) {
  const cand = COPOLYMER_CANDIDATES[candidateId];
  if (!cand) throw new RangeError(`unknown co-polymer candidate "${candidateId}" (${CANDIDATE_IDS.join(", ")})`);
  const idx = ir.constituents.findIndex((c) => c.classId === "hdpe_hc_copolymer");
  if (idx < 0) throw new Error("this formulation has no unidentified co-polymer to substitute");
  const old = ir.constituents[idx];
  const props = Object.fromEntries(Object.keys(old.properties).map((k) => [k, null]));
  for (const [k, c] of Object.entries(cand.properties)) props[k] = summary(c);
  const constituents = ir.constituents.map((c, i) => (i !== idx ? c : {
    ...c,
    classId: cand.classId,
    properties: props,
    unknown: { other: cand.unknown },
    candidate: { id: candidateId, rank: cand.rank, label: cand.label, feedstock: cand.feedstock, replaces: old.name, variability: cand.variability, basis: "what-if substitution requested by Dutch 2026-10-16; the source does not identify the co-polymer" },
  }));
  return { ...ir, id: `${ir.id}+${candidateId}`, constituents };
}
