// server/lib/conkay/physics/solvers/props-material.js
//
// props.material — SX-XC-02 (ConKay solver catalogue, Wave 0).
//
// Material properties vs temperature, from sourced tables with
// provenance per value. Rules, per the catalogue:
//
//   - Interpolation is linear BETWEEN sourced points of the same
//     property. Outside a property's sourced temperature range the
//     answer is NOT_COMPUTED — extrapolation is never served.
//   - A property a material has no sourced points for is NOT_COMPUTED
//     naming the property. No assumed values; the one declared default
//     (temperature 293.15 K) is echoed as defaulted when used.
//   - Temperature arrives as a bare number (kelvin, SI) or a quantity
//     {value, unit: K|°C|°F}; non-SI is converted exactly and the
//     conversion is echoed in the assumptions.
//   - The L1 fast path (registered with solver.select, SX-XC-01)
//     serves room-temperature values at any temperature, labelled
//     screening with a warning that temperature dependence is not
//     applied. The L2 solver below is the design-tier answer.
//
// Sources (free public only): MIL-HDBK-5J (public domain) for
// 6061-T6 and Ti-6Al-4V room-temperature anchors; ASTM A36 minima for
// carbon steel anchors with the EN 1993-1-2 Table 3.1 reduction
// factors for its temperature curves; publisher datasheet nominals
// for the thermal constants, declared as constants over their range.

import { registerSolver } from "../registry.js";
import { registerTier } from "../../select.js";

const RT_K = 293.15;

// Each property: unit + points [[temperatureK, value], ...] + the
// provenance of those points. Constant properties carry two identical
// points spanning their declared range.
export const MATERIAL_DATA = {
  "al-6061-t6": {
    name: "Aluminium 6061-T6",
    properties: {
      E: { unit: "Pa", points: [[RT_K, 68.9e9]], source: "MIL-HDBK-5J, Table 3.6.2.b (E = 10.0e3 ksi at RT)" },
      nu: { unit: "1", points: [[173, 0.33], [473, 0.33]], source: "MIL-HDBK-5J, Table 3.6.2.b (nu = 0.33)" },
      yieldStrength: { unit: "Pa", points: [[RT_K, 276e6]], source: "MIL-HDBK-5J, Table 3.6.2.b (Fty = 40 ksi at RT)" },
      ultimateStrength: { unit: "Pa", points: [[RT_K, 310e6]], source: "MIL-HDBK-5J, Table 3.6.2.b (Ftu = 45 ksi at RT)" },
      density: { unit: "kg/m3", points: [[173, 2700], [473, 2700]], source: "MIL-HDBK-5J (0.098 lb/in3)" },
      thermalConductivity: { unit: "W/(m K)", points: [[173, 167], [473, 167]], source: "6061-T6 datasheet nominal (k = 167 W/mK at 25 C)" },
      specificHeat: { unit: "J/(kg K)", points: [[173, 896], [473, 896]], source: "6061-T6 datasheet nominal (cp = 896 J/kgK at 25 C)" },
      thermalExpansion: { unit: "1/K", points: [[173, 23.6e-6], [473, 23.6e-6]], source: "6061-T6 datasheet nominal (alpha = 23.6 um/mK, 20-100 C)" },
    },
  },
  "steel-a36": {
    name: "Carbon steel ASTM A36",
    properties: {
      E: {
        unit: "Pa",
        points: [
          [293.15, 200e9], [373.15, 200e9], [473.15, 180e9], [573.15, 160e9],
          [673.15, 140e9], [773.15, 120e9], [873.15, 62e9], [973.15, 26e9], [1073.15, 18e9],
        ],
        source: "E(RT) = 200 GPa (ASTM A36 class) x EN 1993-1-2 Table 3.1 kE factors 1.00/1.00/0.90/0.80/0.70/0.60/0.31/0.13/0.09 at 20..800 C",
      },
      nu: { unit: "1", points: [[173, 0.30], [573, 0.30]], source: "Carbon steel datasheet nominal (nu = 0.30)" },
      yieldStrength: {
        unit: "Pa",
        points: [
          [293.15, 250e6], [673.15, 250e6], [773.15, 195e6],
          [873.15, 117.5e6], [973.15, 57.5e6], [1073.15, 27.5e6],
        ],
        source: "Fy = 250 MPa (ASTM A36 minimum) x EN 1993-1-2 Table 3.1 ky factors 1.00 to 400 C, 0.78/0.47/0.23/0.11 at 500/600/700/800 C",
      },
      ultimateStrength: { unit: "Pa", points: [[RT_K, 400e6]], source: "ASTM A36 (Fu = 400 MPa minimum at RT)" },
      density: { unit: "kg/m3", points: [[173, 7850], [1073, 7850]], source: "Carbon steel nominal (7850 kg/m3)" },
      thermalConductivity: { unit: "W/(m K)", points: [[173, 50], [573, 50]], source: "Carbon steel datasheet nominal (k ~ 50 W/mK at 25 C)" },
      specificHeat: { unit: "J/(kg K)", points: [[173, 486], [573, 486]], source: "Carbon steel datasheet nominal (cp = 486 J/kgK at 25 C)" },
      thermalExpansion: { unit: "1/K", points: [[173, 12e-6], [573, 12e-6]], source: "Carbon steel datasheet nominal (alpha = 12 um/mK)" },
    },
  },
  "ti-6al-4v": {
    name: "Titanium Ti-6Al-4V (annealed)",
    properties: {
      E: { unit: "Pa", points: [[RT_K, 113.8e9]], source: "MIL-HDBK-5J (E = 16.5e3 ksi at RT)" },
      nu: { unit: "1", points: [[173, 0.34], [473, 0.34]], source: "Ti-6Al-4V datasheet nominal (nu = 0.34)" },
      yieldStrength: { unit: "Pa", points: [[RT_K, 869e6]], source: "MIL-HDBK-5J (Fty = 126 ksi at RT, annealed)" },
      ultimateStrength: { unit: "Pa", points: [[RT_K, 950e6]], source: "MIL-HDBK-5J (Ftu = 138 ksi at RT, annealed)" },
      density: { unit: "kg/m3", points: [[173, 4430], [473, 4430]], source: "Ti-6Al-4V nominal (4430 kg/m3)" },
      thermalConductivity: { unit: "W/(m K)", points: [[173, 6.7], [473, 6.7]], source: "Ti-6Al-4V datasheet nominal (k = 6.7 W/mK at 25 C)" },
      specificHeat: { unit: "J/(kg K)", points: [[173, 526], [473, 526]], source: "Ti-6Al-4V datasheet nominal (cp = 526 J/kgK at 25 C)" },
      thermalExpansion: { unit: "1/K", points: [[173, 8.6e-6], [473, 8.6e-6]], source: "Ti-6Al-4V datasheet nominal (alpha = 8.6 um/mK)" },
    },
  },
};

export const PROPERTY_NAMES = [
  "E", "nu", "yieldStrength", "ultimateStrength", "density",
  "thermalConductivity", "specificHeat", "thermalExpansion",
];

/** Temperature input → kelvin, or {error}. Bare number = kelvin (SI). */
export function toKelvin(t) {
  if (t == null) return { kelvin: null };
  if (typeof t === "number") return { kelvin: t };
  if (typeof t === "object" && Number.isFinite(t.value)) {
    const unit = String(t.unit || "K");
    if (unit === "K") return { kelvin: t.value };
    if (unit === "°C" || unit === "C") return { kelvin: t.value + 273.15, given: `${t.value} °C` };
    if (unit === "°F" || unit === "F") return { kelvin: (t.value - 32) * (5 / 9) + 273.15, given: `${t.value} °F` };
    return { error: `invalid_input:temperature unit "${unit}" not one of K, °C, °F` };
  }
  return { error: "invalid_input:temperature must be a number (K) or {value, unit}" };
}

/** Interpolate within the sourced points; null outside the sourced range. */
export function interpolate(points, kelvin) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const lo = sorted[0][0];
  const hi = sorted[sorted.length - 1][0];
  if (kelvin < lo || kelvin > hi) return { outOfRange: [lo, hi] };
  for (let i = 0; i < sorted.length; i += 1) {
    if (kelvin === sorted[i][0]) {
      return { value: sorted[i][1], bracket: [sorted[i], sorted[i]], interpolated: false };
    }
    if (i + 1 < sorted.length && kelvin > sorted[i][0] && kelvin < sorted[i + 1][0]) {
      const [t0, v0] = sorted[i];
      const [t1, v1] = sorted[i + 1];
      const f = (kelvin - t0) / (t1 - t0);
      return { value: v0 + f * (v1 - v0), bracket: [sorted[i], sorted[i + 1]], interpolated: true };
    }
  }
  return { outOfRange: [lo, hi] };
}

function lookup(material, property, kelvin) {
  const mat = MATERIAL_DATA[material];
  if (!mat) return { notComputed: `unknown_material:${material}` };
  const prop = mat.properties[property];
  if (!prop) return { notComputed: `missing_property:${material}.${property} has no sourced points (SC-03: not assumed)` };
  const r = interpolate(prop.points, kelvin);
  if (r.outOfRange) {
    return {
      notComputed:
        `out_of_envelope:temperature ${kelvin} K outside the sourced range ` +
        `[${r.outOfRange[0]}, ${r.outOfRange[1]}] K for ${material}.${property} (extrapolation is not served)`,
    };
  }
  return { value: r.value, unit: prop.unit, source: prop.source, interpolated: r.interpolated, bracket: r.bracket };
}

function runProps(ctx, target) {
  const inputs = ctx?.inputs || {};
  const material = inputs.material;
  if (!material) return { notComputed: "missing_input:material (SC-03: no material assumed)" };
  if (!PROPERTY_NAMES.includes(target)) return { notComputed: `unknown_property:${target}` };
  const t = toKelvin(inputs.temperature);
  if (t.error) return { notComputed: t.error };
  const assumptions = [];
  let kelvin = t.kelvin;
  if (kelvin == null) {
    kelvin = RT_K;
    assumptions.push(`temperature defaulted to ${RT_K} K (declared default, echoed per SC-03)`);
  }
  if (!Number.isFinite(kelvin) || kelvin < 0) {
    return { notComputed: `invalid_input:temperature ${inputs.temperature} is not a physical temperature` };
  }
  if (t.given) assumptions.push(`temperature given as ${t.given} = ${kelvin} K (converted exactly, SC-04)`);
  const r = lookup(material, target, kelvin);
  if (r.notComputed) return { notComputed: r.notComputed };
  return {
    inputs: { material, temperature: kelvin },
    outputs: {
      [target]: { value: r.value, unit: r.unit },
      provenance: r.source,
      interpolated: r.interpolated,
      sourcedBracketK: [r.bracket[0][0], r.bracket[1][0]],
    },
    margins: [],
    assumptions,
    covers: [target],
  };
}

export const propsMaterial = registerSolver({
  id: "props.material",
  version: "1.0.0",
  domain: "materials",
  domains: ["materials", "physics"],
  fidelity: 2,
  method: "sourced property tables with provenance per value; linear interpolation between sourced points only; extrapolation NOT_COMPUTED",
  reference: "MIL-HDBK-5J (public domain); ASTM A36; EN 1993-1-2 Table 3.1; publisher datasheet nominals for thermal constants",
  regime: "sourced temperature range per property (see points); single-point properties serve only at their sourced temperature",
  units: { inputs: "material id, temperature K (or {value, unit: K|°C|°F})", outputs: "SI per property (Pa, kg/m3, W/(m K), J/(kg K), 1/K, 1)" },
  tolerance: "exact at sourced points; linear between them",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape); design-graph nodes are not its targets
  run: runProps,
});

// L1 fast path via solver.select: room-temperature values at any
// temperature, labelled screening, temperature dependence NOT applied.
registerTier({
  solverId: "props.material",
  tier: 1,
  version: "1.0.0",
  domain: "materials",
  domains: ["materials", "physics"],
  method: "room-temperature sourced values (screening fast path)",
  reference: "MIL-HDBK-5J; ASTM A36 (RT anchors of the L2 tables)",
  screening: true,
  run(ctx, target) {
    const inputs = ctx?.inputs || {};
    if (!inputs.material) return { notComputed: "missing_input:material (SC-03: no material assumed)" };
    if (!PROPERTY_NAMES.includes(target)) return { notComputed: `unknown_property:${target}` };
    const r = lookup(inputs.material, target, RT_K);
    if (r.notComputed) return { notComputed: r.notComputed };
    return {
      inputs: { material: inputs.material, temperature: inputs.temperature ?? null },
      outputs: {
        [target]: { value: r.value, unit: r.unit },
        provenance: r.source,
        interpolated: false,
        sourcedBracketK: [RT_K, RT_K],
      },
      margins: [],
      warnings: ["screening fast path: room-temperature properties; temperature dependence not applied"],
      covers: [target],
    };
  },
});
