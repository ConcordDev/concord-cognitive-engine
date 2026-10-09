// server/lib/conkay/knowledge/assessments.js
//
// Curated evidence assessments: where a cited document bears on a kind of
// statement, the statement pattern, the property, the support state the
// evidence justifies, and why. Matching is by pattern, so the same
// assessment applies to any formulation that makes the same statement about
// an HDPE-based material. Each one names its documents (sources.js); none is
// produced by a model.

export const ASSESSMENTS = [
  {
    id: "h2-containment-hdpe",
    when: { statement: /stays contained/i, property: "hydrogen_permeability", polymer: /HDPE/i },
    support: "contradicted",
    docs: ["li-2023-h2-liner-review", "dong-2023-pa6-hdpe-permeability"],
    note: "Hydrogen permeates HDPE: for HDPE/PA Type IV liners 'hydrogen permeation is inevitable' (Li et al. 2023), and HDPE's measured H2 permeability is 5.88×10⁻¹⁴ cm³·cm/(cm²·s·Pa) at 288 K and 70 MPa, about 3.4× PA6's (Dong et al. 2023, Table 4). 'Stays contained' can only mean 'permeation below a stated limit' (ISO 19881 Type IV containers: < 6 NmL/(h·L) at NWP and 15 °C; < 46 NmL/(h·L) at 1.15 NWP and 55 °C), which has to be shown by permeation testing of this blend and then of the finished vessel. Fillers can lengthen the diffusion path, but by how much for Blend D is unknown until measured.",
    flag: "hydrogen-containment-contradicted",
  },
  {
    id: "h2-compat-hdpe",
    when: { statement: /resist\w*[^.]*\bhydrogen\b/i, property: "hydrogen_compatibility", polymer: /HDPE/i },
    support: "partially_supported",
    docs: ["li-2023-h2-liner-review"],
    note: "Partly supported: polymers do not suffer metal-type hydrogen embrittlement (Li et al. 2023, citing Sandia). Not supported as stated: dissolved hydrogen plasticises the polymer and 'the large gas permeability and dissolution rate can also lead to liner blistering and collapse' (Li et al. 2023). Compatibility therefore depends on pressure, temperature and decompression rate and must be tested (CSA/ANSI CHMC 2).",
    flag: "hydrogen-compatibility-overstated",
  },
  {
    id: "no-degradation-h2",
    when: { statement: /no degradation/i, property: "hydrogen_compatibility", polymer: /HDPE/i },
    support: "unsupported",
    docs: ["li-2023-h2-liner-review"],
    note: "Absolute claim with no conditions. The cited review reports blistering and collapse of HDPE/PA liners from hydrogen dissolution and decompression, so 'no degradation' cannot be assumed; it needs exposure and decompression-cycle testing at the service conditions. ('Fuel' is read as hydrogen, the text's context; any other fuel needs its own ASTM D543 test.)",
    flag: "hydrogen-compatibility-overstated",
  },
];

/** The assessment for a statement/property in a formulation whose polymer text matches. */
export function assessmentFor(statement, property, polymerText) {
  return ASSESSMENTS.find((a) => a.when.property === property && a.when.statement.test(statement) && a.when.polymer.test(polymerText)) || null;
}
