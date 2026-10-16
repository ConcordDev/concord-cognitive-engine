// server/lib/conkay/knowledge/prediction-tests.js
//
// Blend D brief item 10: every number a material.*, process.* or vessel.*
// solver predicts is mapped to the laboratory test that would replace it, and
// to the source of its pass criterion — or to "criterion not set" when no
// source sets one. A prediction is a screen; the test is the evidence.
// Every designation here must be in standards.js (verified titles).

import { standard } from "./standards.js";

export const CRITERION_NOT_SET = "criterion not set";
const NOT_SET = (why) => ({ state: CRITERION_NOT_SET, reason: why });
const BLEND_D_NO_LIMIT = "USB Blend D states no numeric limit for this property; report the measured value with the method's repeatability";

const LI_2023 = "Li et al., Materials 2023, 16(15), 5366 (sources.js li-2023-h2-liner-review; h2-permeation.js H2_LIMITS)";

/** solver id → { predicts, tests: [{ designations, what }], criterion } */
export const PREDICTION_TESTS = Object.freeze({
  "material.composition-check": {
    predicts: "whether the stated ranges can sum to 100 %",
    tests: [{ designations: ["ASTM D5630", "ASTM E1131"], what: "ash and thermogravimetric composition of the batch against the version's inorganic reference" }],
    criterion: NOT_SET("the source states no composition tolerance"),
  },
  "material.density-rom": {
    predicts: "rule-of-mixtures density (strict, or conditional and labelled)",
    tests: [{ designations: ["ASTM D792"], what: "density of the moulded compound by displacement" }],
    criterion: NOT_SET(`${BLEND_D_NO_LIMIT}; the difference from the estimate is a void indication, not a limit`),
  },
  "material.mass-to-volume": {
    predicts: "constituent volume fractions from mass fractions and cited densities",
    tests: [{ designations: ["ASTM D792", "ASTM E1131"], what: "measured density and filler content, from which the volume fractions are recomputed" }],
    criterion: NOT_SET("a derived quantity; no source sets a limit"),
  },
  "material.basis-discriminator": {
    predicts: "density and ash residue under the mass and the volume reading of the percentages",
    tests: [{ designations: ["ASTM D5630", "ASTM E1131"], what: "ash / inorganic residue of a moulded batch: the band it falls in names the basis, independent of voids" }, { designations: ["ASTM D792"], what: "density of the same batch: decides only together with a void estimate" }],
    criterion: { state: "computed decision rule", text: "the reading whose predicted band contains the measured residue; a value in neither band means the batch or the recipe differs from the stated ranges", source: "material.basis-discriminator receipt (exact bands over the stated ranges; CaCO3 → CaO factor from CIAAW atomic weights, sources.js ciaaw-abridged-atomic-weights)" },
  },
  "material.modulus-bounds": {
    predicts: "Voigt/Reuss bounds on Young's modulus",
    tests: [{ designations: ["ASTM D638"], what: "tensile modulus" }, { designations: ["ASTM D790"], what: "flexural modulus (a different test from tensile: report both, never interchange them)" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.modulus-halpin-tsai": {
    predicts: "Halpin–Tsai modulus band",
    tests: [{ designations: ["ASTM D638"], what: "tensile modulus, specimen orientation recorded (fibre/platelet alignment)" }, { designations: ["ASTM D790"], what: "flexural modulus" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.modulus-mori-tanaka": {
    predicts: "Mori–Tanaka modulus for spherical fillers",
    tests: [{ designations: ["ASTM D638"], what: "tensile modulus" }, { designations: ["ASTM D4065", "ASTM D5026"], what: "storage modulus in tension at a stated frequency and temperature" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.tensile-bounds": {
    predicts: "Kelly–Tyson tensile strength band",
    tests: [{ designations: ["ASTM D638"], what: "tensile strength, elongation at break, against the unfilled HDPE control" }],
    criterion: { state: "set by the plan's reading", text: "'without adding brittleness': the compound's mean elongation at break not below the control's (lab-plan.js tensile_properties)", source: "USB Blend D claim wording, as read in lab-plan.js; no numeric strength minimum is stated" },
  },
  "material.k-maxwell-garnett": {
    predicts: "Maxwell–Garnett thermal conductivity",
    tests: [{ designations: ["ISO 22007-2", "ASTM E1530"], what: "thermal conductivity, through-thickness and in-plane recorded separately" }, { designations: ["ASTM D5470"], what: "through-thickness thermal transmission (scope check first)" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.k-lewis-nielsen": {
    predicts: "Lewis–Nielsen thermal conductivity",
    tests: [{ designations: ["ISO 22007-2", "ASTM E1530"], what: "thermal conductivity" }, { designations: ["ASTM E1461"], what: "diffusivity, with measured density and specific heat" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.cte-turner": {
    predicts: "Turner coefficient of thermal expansion",
    tests: [{ designations: ["ASTM E831"], what: "linear thermal expansion by TMA over the stated temperature range" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.cte-schapery": {
    predicts: "Schapery coefficient of thermal expansion bounds",
    tests: [{ designations: ["ASTM E831"], what: "linear thermal expansion by TMA, orientation recorded" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.thermal-transitions": {
    predicts: "melting and crystallization temperatures (matrix, sourced)",
    tests: [{ designations: ["ASTM D3418"], what: "DSC melting and crystallization peaks of the HDPE lot and of the compound" }],
    criterion: NOT_SET("no transition temperature is a requirement, except as used by process.window"),
  },
  "material.heat-dissipation-screen": {
    predicts: "whether the graphene loading can support the heat-dissipation claim",
    tests: [{ designations: ["ISO 22007-2", "ASTM E1530"], what: "conductivity of the compound against the unfilled control" }],
    criterion: NOT_SET("the claim 'graphene provides thermal conductivity for heat dissipation' states no conductivity or gain"),
  },
  "material.viscoelastic-prony": {
    predicts: "Prony relaxation modulus E(t)",
    tests: [{ designations: ["ASTM D4065", "ASTM D5026"], what: "dynamic mechanical frequency/temperature sweeps of the compound" }, { designations: ["ASTM D2990"], what: "tensile creep and recovery" }],
    criterion: NOT_SET(BLEND_D_NO_LIMIT),
  },
  "material.impact-recovery-screen": {
    predicts: "E′, E″, tan δ at the load frequency and the dissipated-energy ratio",
    tests: [{ designations: ["ASTM D4065", "ASTM D5026"], what: "E′, E″, tan δ at the stated frequency" }, { designations: ["ASTM D256", "ISO 179-1"], what: "notched impact, break type recorded (one system only)" }, { designations: ["ASTM D3763"], what: "puncture below perforation, residual dent after a pre-stated recovery time" }],
    criterion: { state: "set by the plan's reading", text: "'bends not breaks': FAIL if any compound specimen is a complete break (lab-plan.js impact_resistance); impact energy and recovery have no limit", source: "USB Blend D claim wording, as read in lab-plan.js" },
  },
  "vessel.h2-permeation": {
    predicts: "hydrogen permeability (material) and leak rate per litre (vessel)",
    tests: [{ designations: ["ASTM D1434", "ISO 15105-1"], what: "gas permeability of the compound with hydrogen" }, { designations: ["CSA/ANSI CHMC 2"], what: "high-pressure hydrogen permeation" }, { designations: ["ISO 19881", "SAE J2579"], what: "finished-vessel permeation" }],
    criterion: { state: "sourced", text: "liner material P ≤ 1e-13 (15 °C), ≤ 1e-12 (55 °C) cm³·cm/(cm²·s·Pa) (T/CATSI 02 007); vessel < 6 NmL/(h·L) at NWP, 15 °C and < 46 NmL/(h·L) at 1.15 NWP, 55 °C (ISO 19881)", source: LI_2023 },
  },
  "material.chemical-compatibility": {
    predicts: "constituent-level compatibility statements (sourced lookup)",
    tests: [{ designations: ["CSA/ANSI CHMC 2", "ISO 11114-2"], what: "hydrogen exposure and decompression of the compound, with tensile retention" }, { designations: ["ASTM D543", "ASTM D1141"], what: "saltwater immersion" }],
    criterion: { state: "set by the plan's reading", text: "'no degradation': FAIL on blistering or collapse, or a tracked property change beyond the method's repeatability (lab-plan.js hydrogen_compatibility)", source: "USB Blend D claim wording, as read in lab-plan.js; no percentage is stated" },
  },
  "process.window": {
    predicts: "whether the stated 200 °C sits in the sourced HDPE melt windows, above melting and below the inert onset",
    tests: [{ designations: ["ASTM D3418"], what: "melting peak of the compound (must be below 200 °C)" }, { designations: ["ASTM D1238"], what: "melt flow rate of the lot and the compound at the condition used" }, { designations: ["ASTM E1131"], what: "decomposition onset of the compound" }],
    criterion: { state: "sourced", text: "melt temperature in the HDPE window 170–220 / 180–220 / 200–220 °C by process; compound melting peak below the processing temperature", source: "windows: MOL Group HDPE Product Catalogue 2023 p.9 (sources.js mol-hdpe-catalogue-2023-processing); the melting-peak check is the plan's reading (lab-plan.js processing_temperature); the melt-flow number has no criterion" },
  },
  "vessel.hoop-stress": {
    predicts: "wall hoop stress at working pressure",
    tests: [{ designations: ["ISO 19881", "SAE J2579"], what: "hydraulic proof/burst and pressure cycling of a finished vessel (strain-gauged if the stress is to be checked)" }],
    criterion: NOT_SET("no working pressure or wall is specified for a Blend D vessel; the material strength is a test (ASTM D638)"),
  },
  "vessel.burst-margin": {
    predicts: "burst pressure and ratio to NWP",
    tests: [{ designations: ["ISO 19881", "SAE J2579"], what: "hydraulic burst of a finished vessel" }],
    criterion: { state: "sourced", text: "burst ≥ 200 % NWP (≥ 350 % for glass-fibre-primary containers), within ±10 % of BPO", source: "UN Regulation No. 134, 02 series, Amend. 3 (2024) §5.1.1 (sources.js un-r134-02-amend3-burst)" },
  },
  "vessel.crash-seal-screen": {
    predicts: "mean wall strain in a crash case; the seal verdict is never predicted",
    tests: [{ designations: ["ISO 19881", "SAE J2579"], what: "the vessel impact/drop sequence, then permeation and leak" }, { designations: ["ASTM D7791"], what: "uniaxial fatigue of the compound in air (a coupon property; not hydrogen cycling)" }],
    criterion: { state: "sourced", text: "after the impact/drop sequence, permeation still meets the ISO 19881 rates", source: LI_2023 },
  },
});

/** Tests the brief asks for that no solver predicts: measurement-only rows. */
export const MEASUREMENT_ONLY = Object.freeze([
  { property: "UV and weathering", designations: ["ASTM G154", "ASTM G155"], what: "exposure, then ASTM D638 and impact retention against unexposed controls", criterion: NOT_SET("the source states no irradiance, duration or retained fraction") },
  { property: "hydrogen pressure cycling", designations: ["ISO 19881", "SAE J2579"], what: "vessel hydrogen cycling; ASTM D7791 is coupon fatigue in air and does not replace it", criterion: NOT_SET("no NWP or cycle count is specified for a Blend D vessel") },
  { property: "surface hardness", designations: ["ASTM D2240"], what: "Shore D of compound and control", criterion: NOT_SET(BLEND_D_NO_LIMIT) },
]);

/** Rows for every given solver id; an id with no mapping is returned in `unmapped`. */
export function predictionTestMatrix(solverIds) {
  const rows = [], unmapped = [];
  for (const id of solverIds) {
    const m = PREDICTION_TESTS[id];
    if (!m) { unmapped.push(id); continue; }
    rows.push({ solver: id, predicts: m.predicts, tests: m.tests.map((t) => ({ what: t.what, standards: t.designations.map(standard) })), criterion: m.criterion });
  }
  return { rows, unmapped };
}
