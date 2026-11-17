// server/lib/conkay/orc/feasibility.js
//
// SX-ORC-04 — orc.feasibility: physics feasibility bounds before
// geometry (catalogue wave 0, PRG-17). Generalizes
// compiler/feasibility.js (electric-aircraft range only) into a bound
// library: each entry is a textbook closed-form CEILING that no design
// in its class can exceed, computed from declared inputs, with an
// optional claimed value compared against it.
//
//   carnot          eta <= 1 - Tc/Th                          (Çengel)
//   betz            Cp <= 16/27                               (Betz)
//   rocket          dv = Isp * g0 * ln(m0/mf)                 (Tsiolkovsky)
//   breguet-electric R = eta * (E*/g) * (L/D) * batteryFraction (Anderson)
//   specific-energy claimed Wh/kg vs a declared technology ceiling
//
// Verdicts: a claim inside the bound is "within-bound"; a claim past
// it is "exceeds-bound" — a successful computation with a negative
// verdict, returned as outputs with the violated bound named in
// warnings (envelope WARN), never as a solver failure and never
// softened. Missing/invalid inputs are NOT_COMPUTED / INVALID_INPUT
// naming the field. Best-case technology inputs (the specific-energy
// ceiling) are LABELLED: the default is echoed in assumptions as a
// defaulted best-case value, overridable by input — the ticket's
// validity envelope ("best-case technology inputs labelled").

import { registerSolver } from "../physics/registry.js";

const NS = "orc.feasibility";
const G0 = 9.80665;
export const DEFAULT_BATTERY_CEILING_WHKG = 300;

function field(props, name, { positive = true } = {}) {
  const v = props?.[name];
  if (v == null) return { error: `missing_input:${name}` };
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e300) return { error: `INVALID_INPUT: ${name} must be a finite number` };
  if (positive && n <= 0) return { error: `INVALID_INPUT: ${name} must be positive (got ${n})` };
  return { value: n };
}

function verdict(boundValue, claimed) {
  if (claimed == null) return { verdict: "bound-only", margin: null };
  const margin = boundValue - claimed;
  return { verdict: margin >= 0 ? "within-bound" : "exceeds-bound", margin };
}

const BOUNDS = {
  carnot: {
    citation: "Çengel & Boles, Thermodynamics — Carnot efficiency eta = 1 - Tc/Th (absolute temperatures)",
    run(props) {
      const th = field(props, "hotK");
      if (th.error) return th;
      const tc = field(props, "coldK");
      if (tc.error) return tc;
      if (tc.value >= th.value) return { error: "INVALID_INPUT: coldK must be below hotK for a heat engine bound" };
      const bound = 1 - tc.value / th.value;
      return { bound, unit: "1 (efficiency)", inputsUsed: { hotK: th.value, coldK: tc.value } };
    },
  },
  betz: {
    citation: "Betz limit — a wind turbine's power coefficient cannot exceed 16/27 ≈ 0.5926",
    run(props) {
      const bound = 16 / 27;
      return { bound, unit: "1 (power coefficient Cp)", inputsUsed: {} };
    },
  },
  rocket: {
    citation: "Tsiolkovsky rocket equation — dv = Isp * g0 * ln(m0/mf), g0 = 9.80665 m/s^2",
    run(props) {
      const isp = field(props, "ispS");
      if (isp.error) return isp;
      const m0 = field(props, "initialMassKg");
      if (m0.error) return m0;
      const mf = field(props, "finalMassKg");
      if (mf.error) return mf;
      if (mf.value >= m0.value) return { error: "INVALID_INPUT: finalMassKg must be below initialMassKg (mass ratio over 1)" };
      const bound = isp.value * G0 * Math.log(m0.value / mf.value);
      return { bound, unit: "m/s (delta-v)", inputsUsed: { ispS: isp.value, initialMassKg: m0.value, finalMassKg: mf.value } };
    },
  },
  "breguet-electric": {
    citation: "Anderson, Aircraft Performance & Design — electric Breguet range R = eta * (E*/g) * (L/D) * (battery mass / total mass)",
    run(props) {
      const eta = field(props, "efficiency");
      if (eta.error) return eta;
      if (eta.value > 1) return { error: "INVALID_INPUT: efficiency must be <= 1" };
      const e = field(props, "specificEnergyWhKg");
      if (e.error) return e;
      const ld = field(props, "liftDrag");
      if (ld.error) return ld;
      const frac = field(props, "batteryFraction");
      if (frac.error) return frac;
      if (frac.value > 1) return { error: "INVALID_INPUT: batteryFraction must be <= 1" };
      const bound = eta.value * ((e.value * 3600) / G0) * ld.value * frac.value;
      return {
        bound,
        unit: "m (range)",
        inputsUsed: { efficiency: eta.value, specificEnergyWhKg: e.value, liftDrag: ld.value, batteryFraction: frac.value },
      };
    },
  },
  "specific-energy": {
    citation: "declared best-case technology ceiling for lithium-ion pack specific energy (input-overridable; labelled, per the ticket's validity envelope)",
    run(props, ctx) {
      let ceiling = DEFAULT_BATTERY_CEILING_WHKG;
      if (props?.ceilingWhKg != null) {
        const c = field(props, "ceilingWhKg");
        if (c.error) return c;
        ceiling = c.value;
      } else {
        ctx.assumptions.push({
          field: "ceilingWhKg",
          value: ceiling,
          kind: "defaulted",
          source: "best-case current lithium-ion pack-level specific energy, declared default (labelled technology input, not a physical constant)",
        });
      }
      return { bound: ceiling, unit: "Wh/kg (specific energy)", inputsUsed: { ceilingWhKg: ceiling } };
    },
  },
};

/** The pure solver function. Exported for direct testing. */
export function feasibilityBound(props = {}) {
  const bound = props?.bound;
  if (typeof bound !== "string" || !bound) {
    return { notComputed: "missing_input:bound", inputs: {} };
  }
  const entry = BOUNDS[bound];
  if (!entry) {
    return {
      notComputed: `unknown_bound: "${bound}" — the library holds ${Object.keys(BOUNDS).join(", ")}`,
      inputs: { bound },
    };
  }
  const ctx = { assumptions: [] };
  const r = entry.run(props, ctx);
  if (r.error) return { notComputed: r.error, inputs: { bound } };

  let claimed = null;
  if (props?.claimed != null) {
    const c = Number(props.claimed);
    if (!Number.isFinite(c) || Math.abs(c) >= 1e300) {
      return { notComputed: "INVALID_INPUT: claimed must be a finite number", inputs: { bound } };
    }
    claimed = c;
  }
  const v = verdict(r.bound, claimed);
  const warnings = [];
  if (v.verdict === "exceeds-bound") {
    warnings.push(`feasibility verdict: claimed ${claimed} exceeds the ${bound} bound ${r.bound} ${r.unit} by ${Math.abs(v.margin)}`);
  }
  return {
    inputs: { bound, ...r.inputsUsed, ...(claimed != null ? { claimed } : {}) },
    outputs: {
      bound,
      boundValue: r.bound,
      unit: r.unit,
      claimed,
      verdict: v.verdict,
      margin: v.margin,
      citation: entry.citation,
    },
    assumptions: ctx.assumptions,
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function feasTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function feasRun(ctx, id) {
  let all = null;
  try {
    all = ctx.get(id, "props");
  } catch {
    all = null;
  }
  const props = all ? all[NS] : null;
  if (!props || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
    return { notComputed: `props.${NS} is empty or absent on node ${id}`, inputs: {} };
  }
  return feasibilityBound(props);
}

registerSolver({
  id: "orc.feasibility",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "feasibility.bounds",
  fidelity: 1,
  regime: "class-level physical ceilings: heat engines (Carnot), wind rotors (Betz), rockets (Tsiolkovsky), electric aircraft range (Breguet energy form), battery specific energy vs a declared technology ceiling",
  units: "SI: kelvin, seconds (Isp), kg, m, m/s; specific energy in Wh/kg as the field's working unit, converted exactly (x3600) inside",
  tolerance: "closed-form exact; reference cases asserted to 1e-9 relative",
  screening: true,
  reference: "textbook closed forms — Anderson (aircraft performance), Turns (combustion/energy), Çengel (thermodynamics), Ashby (materials/energy bounds)",
  graphProp: NS,
  targets: feasTargets,
  run: feasRun,
});

export default { feasibilityBound, DEFAULT_BATTERY_CEILING_WHKG };
