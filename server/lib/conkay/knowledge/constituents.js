// server/lib/conkay/knowledge/constituents.js
//
// Constituent records for the Blend D demo, each density a sourced claim
// with its interval and evidence. The interval is the span of what the cited
// sources report for the constituent CLASS (the formulation names no grade),
// so it is wide on purpose; a named grade's datasheet would replace it.
//
// "HDPE/HC co-polymer" is not identifiable from the formulation (which
// comonomer? which grade?), so its density is UNKNOWN: no value, no guess.

import { makeClaim } from "./claims.js";
import { evidenceRef } from "./sources.js";
import { SCHEMA_VERSION } from "./schema.js";

const G = 1000; // g/cm³ → kg/m³

function densityClaim(id, subject, [lo, hi], docs, { conditions = {}, notes = [] } = {}) {
  return makeClaim({
    id: `${id}.density`, subject, property: "density", kind: "quantitative",
    range: { min: lo * G, max: hi * G }, unit: "kg/m3",
    conditions: { method: "as reported by the cited sources (class-level values)", ...conditions },
    uncertainty: { type: "range", low: lo * G, high: hi * G, note: "span of the cited class-level values, not a measurement uncertainty" },
    method: { kind: "source_document", description: "values read from the cited documents", standard: null, receiptRef: null, assumptions: [] },
    status: ["sourced"], support: "supported",
    evidence: docs.map(evidenceRef), notes,
  });
}

function unknownDensity(id, subject, reason) {
  return makeClaim({
    id: `${id}.density`, subject, property: "density", kind: "quantitative", unit: "kg/m3",
    status: ["unknown"], support: "unsupported",
    requiredEvidence: [
      { kind: "identification", property: null, reason, testPlanRef: null },
      { kind: "source_document", property: "density", reason: "the named grade's datasheet density (ASTM D792 or D1505 basis)", testPlanRef: null },
    ],
  });
}

const entity = (id, name, category, density, extra = {}) => ({
  schemaVersion: SCHEMA_VERSION, id, kind: "material",
  identity: { name, aliases: extra.aliases || [], category, version: "class-level-1", identifiers: extra.identifiers || {}, variant: null },
  properties: [density],
});

/** Constituent entities keyed by the class id used in ingredient matching. */
export const CONSTITUENTS = {
  hdpe: entity("material:hdpe", "High-density polyethylene (grade unspecified)", "thermoplastic polymer",
    densityClaim("material:hdpe", "material:hdpe", [0.941, 0.970], ["astm-d4976-density-classes", "mol-hdpe-catalogue-2023", "exxonmobil-hma016"],
      { notes: ["ASTM D4976 calls >0.940 g/cm³ high density; MOL lists HDPE at 0.94–0.97 g/cm³; one named grade (ExxonMobil HMA 016) is 0.956 g/cm³."] })),
  hdpe_hc_copolymer: entity("material:hdpe-hc-copolymer", "HDPE/HC co-polymer (identity unknown)", "polymer (unidentified)",
    unknownDensity("material:hdpe-hc-copolymer", "material:hdpe-hc-copolymer", "identify the copolymer: comonomer(s), grade, supplier (\"HC\" is not a standard polymer designation)")),
  basalt_fiber: entity("material:basalt-fiber", "Basalt fibre (length, diameter and sizing unspecified)", "inorganic fibre",
    densityClaim("material:basalt-fiber", "material:basalt-fiber", [2.40, 3.05], ["basalt-fibre-bfrc-review-2023", "basalt-fibre-review-jcs-2022", "basalt-fibre-acs-2026"],
      { notes: ["Reported basalt fibre densities vary with oxide composition and manufacturer: 2.4–2.8 (BFRC review range row), 2.8–3.0 (J. Compos. Sci. 2022), 2.65–3.05 (ACS 2026)."] })),
  caco3: entity("substance:calcium-carbonate", "Calcium carbonate (form and particle size unspecified)", "mineral filler",
    densityClaim("substance:calcium-carbonate", "substance:calcium-carbonate", [2.70, 2.95], ["pubchem-cid-10112-density"], { conditions: { temperature: "25 °C for the 2.93 value; others unstated" } }),
    { identifiers: { cas: "471-34-1", pubchemCid: 10112 } }),
  graphene: entity("material:graphene-nanoplatelets", "Graphene (grade unspecified; density taken from graphene nanoplatelets)", "carbon nanofiller",
    densityClaim("material:graphene-nanoplatelets", "material:graphene-nanoplatelets", [2.00, 2.25], ["sigma-xgnp-c"],
      { notes: ["xGnP grade C true density ('relative gravity'). Applies to graphene nanoplatelets; Blend D does not say which graphene, so using it is assumption A3 of the estimate."] }),
    { identifiers: { cas: "7782-42-5" } }),
  silica: entity("substance:silica", "Silica (form unspecified: fumed, precipitated or crystalline)", "mineral filler",
    densityClaim("substance:silica", "substance:silica", [2.20, 2.65], ["pubchem-cid-24261-density"],
      { conditions: { temperature: "25 °C for the 2.2 value; others unstated" }, notes: ["2.2 g/cm³ for amorphous silica (NIOSH; Merck Index); 2.648 g/cm³ for alpha-quartz (IARC table). The interval spans amorphous to quartz because the form is unstated."] }),
    { identifiers: { cas: "7631-86-9", pubchemCid: 24261 } }),
};

/** The density claim of a constituent class, or null. */
export function constituentDensity(classId) {
  return CONSTITUENTS[classId]?.properties.find((p) => p.property === "density") || null;
}
