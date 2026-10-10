// server/lib/conkay/knowledge/lab-plan.js
//
// A laboratory test plan for USB Blend D, rendered from the formulation
// report. It quotes the source's claims and the verified standards already
// in standards.js. It does not copy a standard's procedure, and it does not
// invent a numeric limit the source does not state.
//
// A pass/fail line here is a criterion for a future test. Nothing in this
// document is a measured result.

export const LAB_PLAN_VERSION = "1.0.0";

// The source states no specimen count. Five is this plan's minimum, not a
// number read out of a standard. If the cited standard requires more, that
// requirement governs.
export const SPECIMEN_MINIMUM = {
  compound: 5,
  control: 5,
  state: "plan choice",
  basis: "USB Blend D states no specimen count. Use at least five of the compound and five of the unfilled HDPE control, or the cited standard's own minimum when that is higher.",
};

const INORGANIC = /basalt|caco3|silica/i;

const APPARATUS = {
  "ASTM D792": "balance and immersion vessel meeting ASTM D792",
  "ASTM D256": "pendulum Izod impact tester meeting ASTM D256",
  "ISO 180": "pendulum Izod impact tester meeting ISO 180",
  "ASTM D6110": "pendulum Charpy impact tester meeting ASTM D6110",
  "ISO 179-1": "pendulum Charpy impact tester meeting ISO 179-1",
  "ASTM D3763": "instrumented high-speed puncture machine meeting ASTM D3763",
  "ASTM D2990": "creep frame meeting ASTM D2990",
  "ASTM D638": "tensile testing machine and extensometer meeting ASTM D638",
  "ASTM D2240": "Shore D durometer meeting ASTM D2240",
  "ASTM D1434": "differential-pressure gas transmission cell meeting ASTM D1434, with hydrogen as the test gas",
  "ISO 15105-1": "differential-pressure gas transmission apparatus meeting ISO 15105-1, with hydrogen as the test gas",
  "CSA/ANSI CHMC 2": "high-pressure hydrogen exposure and permeation apparatus meeting CSA/ANSI CHMC 2",
  "ISO 11114-5": "plastic-liner hydrogen test apparatus meeting ISO 11114-5",
  "ISO 11114-2": "the compatibility assessment of ISO 11114-2 (guidance, not a coupon method)",
  "ISO 19881": "a finished container and the pressure, permeation and impact facilities ISO 19881 names",
  "SAE J2579": "a finished fuel system and the facilities SAE J2579 names",
  "ASTM D1238": "extrusion plastometer meeting ASTM D1238",
  "ASTM D3418": "differential scanning calorimeter meeting ASTM D3418",
  "ASTM E1131": "thermogravimetric analyser meeting ASTM E1131",
  "ASTM D5630": "furnace and balance meeting ASTM D5630",
  "ASTM D543": "immersion vessels meeting ASTM D543",
  "ASTM D1141": "substitute ocean water prepared to ASTM D1141",
  "ASTM G154": "fluorescent UV exposure apparatus meeting ASTM G154",
  "ISO 22007-2": "transient plane source (hot disc) instrument meeting ISO 22007-2",
  "ASTM E1461": "flash diffusivity apparatus meeting ASTM E1461",
};

function inorganicReference(fractions) {
  const rows = fractions.filter((f) => INORGANIC.test(f.id) || INORGANIC.test(f.name || ""));
  const units = rows.reduce((a, f) => a + f.units, 0);
  return { rows, pct: units / 10000 };
}

function criterion(property, ctx) {
  const none = "The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set.";
  switch (property) {
    case "impact_resistance":
      return [
        "Claims 'bends not breaks on impact' and 'deforms under impact'.",
        "Break type is the criterion those words support. FAIL the claim if any compound specimen is recorded as a complete break under the cited method.",
        "Impact energy has no limit in the source. " + none,
        "Run one system only. ASTM D256 and ISO 180 are not interchangeable, and ASTM D6110 and ISO 179-1 are not interchangeable.",
      ].join(" ");
    case "viscoelastic_recovery":
      return [
        "Claims 'returns to shape', 'springs back', and 'a viscoelastic chamber deforms ... springs back'.",
        "ASTM D2990: creep, then unload, and record recovery against time. The source states no stress, no duration and no recovered fraction.",
        "ASTM D3763 below perforation: record residual dent depth after a recovery time the laboratory writes down before the test. The source states no dent depth and no recovery time.",
        none + " A coupon result does not by itself pass the chamber claim; that claim is also under vessel containment.",
      ].join(" ");
    case "tensile_properties":
      return [
        "Claim 'tensile reinforcement without adding brittleness', read as a comparison with the unfilled HDPE control in the same run.",
        "Reading of those words, not a margin from the source: FAIL if the compound's mean elongation at break is lower than the control's mean. A difference inside the method's repeatability does not fail.",
        "Tensile strength and modulus are reported. The source states no minimum for either.",
      ].join(" ");
    case "surface_hardness":
      return "Claim that CaCO3 provides surface hardness. Report Shore D of the compound and of the unfilled HDPE control. " + none;
    case "hydrogen_permeability":
      return [
        "Material screening (ASTM D1434 or ISO 15105-1, then CSA/ANSI CHMC 2 or ISO 11114-5 at pressure) reports the permeability of this compound.",
        none,
        "These coupon numbers do not pass 'Hydrogen stays contained'. That sentence is a finished-vessel claim. See vessel containment.",
      ].join(" ");
    case "hydrogen_compatibility":
      return [
        "Claims 'inherently resistant to ... hydrogen' and 'No degradation from fuel contact', read here as hydrogen.",
        "CSA/ANSI CHMC 2 exposure and decompression cycles, at a pressure and temperature the laboratory states. Track mass, dimensions, appearance, and ASTM D638 tensile strength and elongation against unexposed controls from the same batch.",
        "FAIL 'no degradation' if blistering or collapse is observed, or if a tracked property changes by more than that method's repeatability. The source allows no change and states no percentage.",
        "'Inherently resistant' is not awarded by one exposure. Record the result against the claim and leave the wording unsettled.",
      ].join(" ");
    case "vessel_containment":
      return [
        "Claim 'Hydrogen stays contained through the crash', and 'maintains seal integrity'. A material coupon cannot pass these.",
        "Pass only on a finished vessel: ISO 19881 permeation under 6 NmL/(h·L) at nominal working pressure and 15 °C, and under 46 NmL/(h·L) at 1.15 times nominal working pressure and 55 °C, AND the vessel's impact or drop sequence in ISO 19881 or SAE J2579, after which permeation still meets those rates.",
        "Those rates are the Type IV container limits quoted from Li et al. 2023 (the ISO 19881 entry in standards.js). They are not a material limit for Blend D, and Blend D states no nominal working pressure.",
        "Nominal working pressure is unknown until the vessel is specified. Do not insert one.",
      ].join(" ");
    case "pressure_containment":
      return [
        "Claim that pressure resistance is retained. The source states no pressure.",
        "Material: ASTM D2990 creep at a stress the laboratory computes from a stated wall and pressure. No such wall is in the source, so the stress stays blank until a vessel drawing exists.",
        "Vessel: ISO 19881 hydraulic burst and pressure cycling. A coupon creep curve does not pass the vessel.",
      ].join(" ");
    case "composition_verification":
      return [
        `Reference inorganic loading of this formulation version: basalt + CaCO3 + silica = ${ctx.inorganicPct.toFixed(4)} % (computed from the version's fractions; graphene is not included, because what it does in an ash test is unknown).`,
        "Measure ash by ASTM D5630 and the composition by ASTM E1131 on the same batch.",
        `The source states no tolerance. Report the measured residue and the difference from ${ctx.inorganicPct.toFixed(4)} %. Do not pass or fail a tolerance that was not set.`,
        "The version is one point inside ranges that sum from 86 % to 103 %. A batch made to a different point in those ranges is a different composition. Identify the version on the report.",
        "A comparison with the marine blend cannot pass here. That blend is not on record, so measuring this batch does not show a higher polymer ratio than it.",
      ].join(" ");
    case "density":
      return "ASTM D792 on the moulded compound. This replaces the rule-of-mixtures estimate. The source states no density. Report the value and the difference from the conditional estimate. The difference is a void indication, not a pass limit. The strict density is unknown because the HDPE/HC copolymer has no cited density.";
    case "melt_flow_rate":
      return "ASTM D1238 on the HDPE lot and on the compound. The catalog's usual polyethylene condition is 190 °C / 2.16 kg; record the condition actually used. The source states no melt-flow number. " + none;
    case "thermal_transitions":
      return "ASTM D3418 melting and crystallisation peaks of the HDPE lot and of the compound. Report the peaks. No transition temperature is stated as a requirement except as used under processing temperature.";
    case "processing_temperature":
      return [
        "The source says 'Cure temperature: 200 °C'. HDPE is not cured. The process version records 200 °C (473.15 K) as a melt-processing temperature.",
        "FAIL that reading if the compound's ASTM D3418 melting peak is at or above 200 °C: the stated temperature would not melt it.",
        "The source does not say whether 200 °C is barrel, melt or mould, and it states no time at temperature, no machine and no cooling profile. Record those. Do not fill them in.",
      ].join(" ");
    case "saltwater_resistance":
      return "Claim of chemical resistance to saltwater. Immerse per ASTM D543 in ASTM D1141 substitute ocean water. Report mass, dimensions, appearance, and ASTM D638 retention. " + none;
    case "uv_weathering":
      return "Claim of weather and UV stability. Expose per ASTM G154, then ASTM D638 and ASTM D256 against unexposed controls. The source states no irradiance, no duration and no retained-property fraction. " + none;
    case "thermal_conductivity":
      return "Claim that graphene provides thermal conductivity for heat dissipation. ISO 22007-2 in-plane and through-thickness, or ASTM E1461 diffusivity with a measured density and specific heat. The source states no conductivity. " + none;
    default:
      return none;
  }
}

function claimsFor(report, property) {
  return (report.unsupportedClaims || [])
    .filter((c) => c.property === property && c.statement)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {object} report  buildFormulationReport() output
 * @returns {string} markdown a laboratory can quote
 */
export function renderLabPlan(report) {
  if (!report?.testPlan?.items?.length) throw new Error("renderLabPlan: report has no test plan");
  if (!report.proposedVersion?.fractions) throw new Error("renderLabPlan: no formulation version");
  const fractions = report.proposedVersion.fractions;
  const inorganic = inorganicReference(fractions);
  const versionId = report.proposedVersion.record?.id || "(no id)";
  const processId = report.processVersion?.id || "(no process id)";
  const tempK = report.processVersion?.process?.steps?.[0]?.conditions?.temperatureK;
  const lines = [];
  const p = (s = "") => lines.push(s);
  p("# USB Blend D — laboratory test plan");
  p();
  p(`Document version ${LAB_PLAN_VERSION}. Rendered from the formulation report. Source sha256 \`${report.sourceSha256}\`.`);
  p(`Formulation version \`${versionId}\`. Process version \`${processId}\`.`);
  p();
  p("This is a plan for tests that have not been run. It is not a result, and a criterion below is not a measurement. Where the source states no limit, the plan says so and does not invent one.");
  p();
  p("## Material under test");
  p();
  p("The source ranges sum to 86 % at their minima and 103 % at their maxima, so they do not fix a composition. The batch is the formulation version below (uniform-range-position rule), not 'whatever is inside the ranges'.");
  p();
  p("| Ingredient | Version |");
  p("|---|---:|");
  for (const f of fractions) p(`| ${f.name} | ${f.pct.toFixed(4)} % |`);
  p(`| **Total** | **${(fractions.reduce((a, f) => a + f.units, 0) / 10000).toFixed(4)} %** |`);
  p();
  p(`Inorganic reference for the ash and TGA checks (basalt + CaCO3 + silica, graphene excluded): **${inorganic.pct.toFixed(4)} %**.`);
  p();
  p(tempK == null
    ? "Process temperature: not on the process version."
    : `Process temperature on the version: ${tempK} K (the source's 200 °C), recorded as a melt-processing temperature. It is not a cure.`);
  p();
  p("The HDPE grade, the HDPE/HC copolymer, the basalt grade and the graphene grade are not identified in the source. Name the supplier lot on the test report. A result on a different lot is not a result on this version.");
  p();
  p("## Specimens, conditioning, equipment");
  p();
  p(`- Specimens: at least ${SPECIMEN_MINIMUM.compound} of the compound and ${SPECIMEN_MINIMUM.control} of the unfilled HDPE control for each material test, moulded from this formulation version and this process version. ${SPECIMEN_MINIMUM.basis} Status: ${SPECIMEN_MINIMUM.state}.`);
  p("- Conditioning: the source states none. Follow the conditioning clause of the cited standard and record the temperature, humidity and time. Do not substitute a conditioning the source did not state.");
  p("- Equipment: the apparatus named with each method. That name is the plan's description of the standard's title. It is not a procedure, and it is not a copy of the standard.");
  p("- Controls: the unfilled HDPE is the same lot used as the version's HDPE base. Vessel tests have no coupon control; they are tests of a finished container.");
  p("- Report with every result: batch, supplier lots, deviations, specimen orientation, and the conditions listed under the test.");
  p();
  p("## Tests");
  p();
  for (const item of report.testPlan.items) {
    const claims = claimsFor(report, item.property);
    p(`### ${item.property}`);
    p();
    p(`Priority: ${item.priority}. Scope: ${item.scope || "material"}.`);
    p();
    p(criterion(item.property, { inorganicPct: inorganic.pct }));
    p();
    p("Methods:");
    for (const t of item.tests) {
      const names = t.standards.map((s) => s.designation).join(", ");
      p(`- ${names}. ${t.what}`);
      for (const s of t.standards) {
        const gear = APPARATUS[s.designation] || "apparatus meeting the cited standard";
        p(`  - ${s.designation}: ${s.title}. ${gear}. ${s.url}`);
      }
    }
    p();
    p(`Conditions to record: ${(item.conditionsToRecord || []).join(", ") || "none listed"}.`);
    p();
    if (claims.length) {
      p("Claims this test is aimed at:");
      for (const c of claims) p(`- \`${c.id}\` (${c.support}): ${c.statement}`);
    } else {
      p("No open claim is tied to this property. It is a prerequisite characterisation, so that a later result can be traced to a batch.");
    }
    p();
  }
  const excluded = report.testPlan.excluded || [];
  p("## Claims with no laboratory test in this plan");
  p();
  if (!excluded.length) p("None. Every unsupported claim that named a test is in a section above.");
  else for (const e of excluded) p(`- \`${e.claim}\`: ${e.reason}`);
  p();
  p("## What a pass does not mean");
  p();
  p("A completed row in this plan is a measurement against the criterion written here. It does not qualify a hydrogen vessel, it does not establish a service life, and it does not turn the source's wording into evidence. Vessel containment stays failed until a finished vessel is tested. Coupon permeability, however low, does not pass 'Hydrogen stays contained through the crash'.");
  p();
  return lines.join("\n");
}
