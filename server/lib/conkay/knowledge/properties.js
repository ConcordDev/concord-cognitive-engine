// server/lib/conkay/knowledge/properties.js
//
// The property catalog: for each property a claim can be about, its unit (or
// null for a qualitative/pass-fail property), the conditions a value is
// meaningless without, and the test methods that establish it. A claim about
// a property here gets `missingConditions` filled from `requiredConditions`;
// a claim about a property that isn't here is flagged for review rather than
// guessed at. `scope: "component"` marks properties a material coupon can't
// establish: they need the finished part or vessel.

import { standard } from "./standards.js";

const P = (def) => Object.freeze(def);

export const PROPERTIES = {
  density: P({
    label: "Density", unit: "kg/m3",
    requiredConditions: ["temperature", "method", "specimen_preparation"],
    tests: [{ standards: ["ASTM D792"], what: "density / specific gravity by displacement, on compression- or injection-moulded specimens of the exact formulation and process version" }],
  }),
  impact_resistance: P({
    label: "Impact resistance (notched pendulum and instrumented puncture)", unit: null,
    requiredConditions: ["test_standard", "temperature", "notch", "specimen_thickness", "specimen_orientation", "processing_history"],
    tests: [
      { standards: ["ASTM D256", "ISO 180"], what: "notched Izod impact energy (ASTM and ISO results are not interchangeable: pick one system and keep it)" },
      { standards: ["ASTM D6110", "ISO 179-1"], what: "notched Charpy impact energy" },
      { standards: ["ASTM D3763"], what: "instrumented high-speed puncture: load-displacement curve, energy to peak and to failure, ductile vs brittle failure mode; repeat at the lowest service temperature" },
    ],
  }),
  viscoelastic_recovery: P({
    label: "Viscoelastic response and shape recovery after deformation", unit: null,
    requiredConditions: ["load_or_strain", "temperature", "duration", "recovery_time", "specimen_orientation"],
    tests: [
      { standards: ["ASTM D2990"], what: "creep under constant load, then unload and record recovery over time (the 'returns to shape' claim)" },
      { standards: ["ASTM D3763"], what: "sub-perforation impacts at increasing energy, then measure residual dent depth after a stated recovery time (no single standard defines 'springs back'; the acceptance threshold must be set for the part)" },
    ],
  }),
  tensile_properties: P({
    label: "Tensile strength, modulus and elongation at break", unit: "Pa",
    requiredConditions: ["test_standard", "specimen_type", "test_speed", "temperature", "conditioning", "specimen_orientation", "processing_history"],
    tests: [{ standards: ["ASTM D638"], what: "tensile strength, modulus and elongation at break (elongation is the 'no added brittleness' check); fibre-reinforced compounds need flow-direction and cross-flow specimens" }],
  }),
  surface_hardness: P({
    label: "Surface hardness", unit: null,
    requiredConditions: ["scale", "temperature", "dwell_time", "specimen_thickness"],
    tests: [{ standards: ["ASTM D2240"], what: "Shore D durometer hardness against the unfilled base resin as control" }],
  }),
  hydrogen_permeability: P({
    label: "Hydrogen permeability / permeation rate", unit: "mol·m/(m²·s·Pa)",
    requiredConditions: ["gas", "temperature", "pressure", "specimen_thickness", "conditioning"],
    tests: [
      { standards: ["ASTM D1434", "ISO 15105-1"], what: "differential-pressure H2 transmission rate and permeability on sheet specimens (screening, low pressure)" },
      { standards: ["CSA/ANSI CHMC 2", "ISO 11114-5"], what: "high-pressure hydrogen permeation (HPHP method) at service pressure and temperature, specimens made by the production process" },
    ],
  }),
  hydrogen_compatibility: P({
    label: "Compatibility with hydrogen (property change after exposure, rapid decompression, blistering)", unit: null,
    requiredConditions: ["pressure", "temperature", "exposure_time", "decompression_rate", "cycles"],
    tests: [
      { standards: ["CSA/ANSI CHMC 2"], what: "polymer compatibility in compressed hydrogen: property retention after exposure and decompression cycles" },
      { standards: ["ISO 11114-2"], what: "compatibility assessment of non-metallic materials with the gas content (guidance)" },
    ],
  }),
  vessel_containment: P({
    label: "Containment / seal integrity of the finished vessel (incl. after impact)", unit: null, scope: "component",
    requiredConditions: ["nominal_working_pressure", "temperature", "vessel_geometry", "impact_condition"],
    tests: [{ standards: ["ISO 19881", "SAE J2579"], what: "vessel-level qualification (permeation, pressure cycling, drop/impact, burst) on the finished container; a material coupon cannot establish this" }],
  }),
  pressure_containment: P({
    label: "Pressure resistance", unit: "Pa", scope: "component",
    requiredConditions: ["pressure", "temperature", "duration", "geometry"],
    tests: [
      { standards: ["ASTM D2990"], what: "long-term creep and creep-rupture of the material under the stress the wall will see" },
      { standards: ["ISO 19881"], what: "hydraulic burst and pressure-cycle qualification of the finished container" },
    ],
  }),
  saltwater_resistance: P({
    label: "Resistance to salt water", unit: null,
    requiredConditions: ["medium", "temperature", "duration", "strain", "properties_tracked"],
    tests: [{ standards: ["ASTM D543", "ASTM D1141", "ASTM D638"], what: "immersion in ASTM D1141 substitute ocean water per ASTM D543; report mass, dimension and appearance change and ASTM D638 property retention" }],
  }),
  uv_weathering: P({
    label: "Weathering and UV stability", unit: null,
    requiredConditions: ["cycle", "irradiance", "duration", "properties_tracked"],
    tests: [{ standards: ["ASTM G154", "ASTM D638", "ASTM D256"], what: "fluorescent-UV cycle exposure per ASTM G154, then tensile and impact retention vs unexposed controls" }],
  }),
  thermal_conductivity: P({
    label: "Thermal conductivity", unit: "W/(m·K)",
    requiredConditions: ["temperature", "direction", "method"],
    tests: [
      { standards: ["ISO 22007-2"], what: "thermal conductivity by transient plane source (hot disc), in-plane and through-thickness" },
      { standards: ["ASTM E1461"], what: "thermal diffusivity by flash (conductivity also needs density and specific heat)" },
    ],
  }),
  melt_flow_rate: P({
    label: "Melt flow rate", unit: "g/10 min",
    requiredConditions: ["temperature", "load"],
    tests: [{ standards: ["ASTM D1238"], what: "melt flow rate of the HDPE grade and of the compound (190 °C / 2.16 kg is the usual PE condition)" }],
  }),
  thermal_transitions: P({
    label: "Melting and crystallisation temperatures", unit: "K",
    requiredConditions: ["heating_rate", "atmosphere"],
    tests: [{ standards: ["ASTM D3418"], what: "DSC melting / crystallisation peaks: fixes the melt-processing window the 'cure temperature' must sit in" }],
  }),
  processing_temperature: P({
    label: "Processing (melt) temperature", unit: "K",
    requiredConditions: ["where_measured", "duration", "equipment"],
    tests: [{ standards: ["ASTM D3418", "ASTM D1238"], what: "DSC of the HDPE grade and of the compound to fix the melt window; melt flow rate at the stated temperature range to check processability" }],
  }),
  composition_verification: P({
    label: "As-made composition (filler and fibre loading)", unit: "1",
    requiredConditions: ["method", "atmosphere", "batch"],
    tests: [
      { standards: ["ASTM E1131"], what: "thermogravimetric compositional analysis (polymer vs inorganic residue) of each batch" },
      { standards: ["ASTM D5630"], what: "ash content: total inorganic loading (basalt + CaCO3 + silica) against the formulation version" },
    ],
  }),
  // Fluids and pure substances (knowledge connectors, demo 2). A property with no verified standard has
  // an empty test list: the plan then says no verified standard is on file, never invents one.
  liquid_density: P({
    label: "Liquid density", unit: "kg/m3",
    requiredConditions: ["temperature", "pressure"],
    tests: [{ standards: ["ASTM D4052"], what: "density of the liquid by digital density meter at the stated temperature" }],
  }),
  relative_density: P({
    label: "Relative density (specific gravity)", unit: "1",
    requiredConditions: ["temperature", "reference_temperature"],
    tests: [{ standards: ["ASTM D4052"], what: "relative density by digital density meter, stating the sample and the water reference temperature" }],
  }),
  dynamic_viscosity: P({
    label: "Dynamic viscosity", unit: "Pa.s",
    requiredConditions: ["temperature", "pressure"],
    tests: [{ standards: ["ASTM D445"], what: "kinematic viscosity at the stated temperature, times the measured density for dynamic viscosity" }],
  }),
  specific_heat_capacity: P({
    label: "Isobaric specific heat capacity", unit: "J/(kg.K)",
    requiredConditions: ["temperature", "pressure"],
    tests: [{ standards: ["ASTM E1269"], what: "specific heat capacity by DSC over the stated temperature range (sealed pans for a volatile liquid)" }],
  }),
  liquid_thermal_conductivity: P({
    label: "Thermal conductivity of a liquid", unit: "W/(m.K)",
    requiredConditions: ["temperature", "pressure"],
    tests: [{ standards: ["ASTM D7896"], what: "transient hot wire; the standard's scope is engine coolants and related fluids, so the laboratory confirms it applies" }],
  }),
  flash_point: P({
    label: "Flash point", unit: "K",
    requiredConditions: ["method"],
    tests: [{ standards: ["ASTM D56"], what: "closed-cup flash point (Tag) of the exact liquid" }],
  }),
  normal_boiling_point: P({
    label: "Boiling point", unit: "K",
    requiredConditions: ["pressure"],
    tests: [{ standards: ["ASTM D1078"], what: "distillation range at the stated pressure (initial boiling point and range; not an equilibrium bubble point)" }],
  }),
  melting_point: P({
    label: "Melting point", unit: "K",
    requiredConditions: ["pressure"],
    tests: [{ standards: ["ASTM E324"], what: "initial and final melting points and the melting range" }],
  }),
};

/** Expand a property's test entries with the verified standard records. */
export function testsFor(property) {
  const p = PROPERTIES[property];
  if (!p) return null;
  return p.tests.map((t) => ({ what: t.what, standards: t.standards.map(standard) }));
}

/** Conditions a claim on `property` lacks. Unknown property → null (caller flags it). */
export function missingConditionsFor(property, conditions = {}) {
  const p = PROPERTIES[property];
  if (!p) return null;
  return p.requiredConditions.filter((c) => conditions[c] == null || conditions[c] === "");
}
