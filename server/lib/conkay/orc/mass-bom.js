// server/lib/conkay/orc/mass-bom.js
//
// SX-ORC-07 — orc.mass-bom: mass per part and total, BOM budget
// (catalogue wave 0, PRG-17). Every part's mass comes from its exact
// B-rep volume (cad.mass-properties-brep, SX-CAD-03) times a SOURCED
// density — a declared densityKgM3 or a material-library resolution.
// No stand-in density exists in this solver: a part whose density
// cannot be resolved is reported MASSLESS WITH ITS REASON (the
// catalogue's reference case), listed in outputs.masslessParts, and
// excluded from the totals with the exclusion named in warnings.
//
// Assembly properties follow mass.cg's discipline: the CG is
// sum(m_i * r_i) / sum(m_i) over positioned massive parts, and a
// massive part WITHOUT a position makes the CG (and the assembly
// inertia) NOT_COMPUTED naming the part — nothing is assumed to sit
// at the origin. Inertia is the full tensor about the assembly CG by
// the parallel-axis theorem; part orientations are translations only
// at this tier (a rotated part is out of scope and there is no input
// for it — named in the doc, not silently zero).
//
// Budget: with budgetKg declared, the total (and the total with the
// declared maturity contingency applied) is compared and the verdict
// returned; over-budget is a WARN verdict, not a solver failure. The
// contingency fraction is a declared policy input; absent means 0 and
// the 0 is echoed in inputs — no silent contingency.

import { registerSolver } from "../physics/registry.js";
import { massPropertiesBrep } from "../cad/mass-properties-brep.js";

const NS = "orc.mass-bom";

function shiftTensor(I, m, d) {
  // Parallel axis: I' = I + m * (|d|^2 * 1 - d d^T)
  const [x, y, z] = d;
  const q = x * x + y * y + z * z;
  return {
    Ixx: I.Ixx + m * (q - x * x),
    Iyy: I.Iyy + m * (q - y * y),
    Izz: I.Izz + m * (q - z * z),
    Ixy: I.Ixy - m * x * y,
    Ixz: I.Ixz - m * x * z,
    Iyz: I.Iyz - m * y * z,
  };
}

/** The pure solver function. Exported for direct testing. */
export function massBom(props = {}) {
  const parts = props?.parts;
  if (!Array.isArray(parts) || !parts.length) {
    return { notComputed: "missing_input:parts", inputs: {} };
  }
  let contingency = 0;
  if (props?.contingencyFraction != null) {
    const c = Number(props.contingencyFraction);
    if (!Number.isFinite(c) || c < 0 || c >= 1) {
      return { notComputed: "INVALID_INPUT: contingencyFraction must be a finite fraction in [0, 1)", inputs: {} };
    }
    contingency = c;
  }
  let budget = null;
  if (props?.budgetKg != null) {
    const b = Number(props.budgetKg);
    if (!Number.isFinite(b) || b <= 0 || Math.abs(b) >= 1e300) {
      return { notComputed: "INVALID_INPUT: budgetKg must be a positive finite number", inputs: {} };
    }
    budget = b;
  }

  const partRows = [];
  const masslessParts = [];
  const warnings = [];
  let totalMass = 0;

  for (const [i, part] of parts.entries()) {
    const id = part?.id;
    if (typeof id !== "string" || !id) {
      return { notComputed: `INVALID_INPUT: parts[${i}].id must be a non-empty string`, inputs: {} };
    }
    if (!part?.massProperties || typeof part.massProperties !== "object") {
      return { notComputed: `missing_input:parts[${i}].massProperties`, inputs: {} };
    }
    let position = null;
    if (part.position != null) {
      if (!Array.isArray(part.position) || part.position.length !== 3 || !part.position.every((v) => Number.isFinite(Number(v)))) {
        return { notComputed: `INVALID_INPUT: parts[${i}].position must be [x, y, z] of finite numbers`, inputs: {} };
      }
      position = part.position.map(Number);
    }
    const mp = massPropertiesBrep(part.massProperties);
    if (mp.notComputed) {
      // The reference case's shape: an unresolvable part is massless
      // WITH its reason — density gaps land here, as do bad dims (the
      // reason carries which; the BOM names it either way).
      masslessParts.push({ id, reason: mp.notComputed });
      partRows.push({ id, massKg: 0, massless: true, reason: mp.notComputed, position });
      warnings.push(`part "${id}" is massless: ${mp.notComputed}`);
      continue;
    }
    const centroidAbs = mp.outputs.centroidM.map((c, j) => c + (position ? position[j] : 0));
    partRows.push({
      id,
      massKg: mp.outputs.massKg,
      volumeM3: mp.outputs.volumeM3,
      densitySource: mp.outputs.densitySource,
      centroidM: centroidAbs,
      position,
      inertiaAboutOwnCentroid: mp.outputs.inertiaKgM2,
    });
    totalMass += mp.outputs.massKg;
  }

  const massive = partRows.filter((p) => p.massKg > 0);
  const unpositioned = massive.filter((p) => !p.position);
  let cg = null;
  let inertiaAboutCg = null;
  let cgNotComputed = null;
  if (!massive.length) {
    cgNotComputed = "no massive parts — every part is massless (see masslessParts)";
  } else if (unpositioned.length) {
    cgNotComputed = `massive part(s) without a position: ${unpositioned.map((p) => p.id).join(", ")} — nothing is assumed to sit at the origin`;
  } else {
    cg = [0, 1, 2].map((axis) => massive.reduce((s, p) => s + p.massKg * p.centroidM[axis], 0) / totalMass);
    inertiaAboutCg = { Ixx: 0, Iyy: 0, Izz: 0, Ixy: 0, Ixz: 0, Iyz: 0 };
    for (const p of massive) {
      const d = p.centroidM.map((c, j) => c - cg[j]);
      const shifted = shiftTensor(p.inertiaAboutOwnCentroid, p.massKg, d);
      for (const k of Object.keys(inertiaAboutCg)) inertiaAboutCg[k] += shifted[k];
    }
  }
  if (cgNotComputed) warnings.push(`assembly CG/inertia not computed: ${cgNotComputed}`);

  const totalWithContingency = totalMass * (1 + contingency);
  let budgetVerdict = null;
  if (budget != null) {
    budgetVerdict = {
      budgetKg: budget,
      marginKg: budget - totalWithContingency,
      verdict: totalWithContingency <= budget ? "within-budget" : "over-budget",
    };
    if (budgetVerdict.verdict === "over-budget") {
      warnings.push(`BOM over budget: total with contingency ${totalWithContingency} kg exceeds the declared budget ${budget} kg`);
    }
  }

  return {
    inputs: { parts, contingencyFraction: contingency, ...(budget != null ? { budgetKg: budget } : {}) },
    outputs: {
      parts: partRows.map(({ inertiaAboutOwnCentroid, ...rest }) => rest),
      masslessParts,
      totalMassKg: totalMass,
      contingencyFraction: contingency,
      totalWithContingencyKg: totalWithContingency,
      cgM: cg,
      cgNotComputed,
      inertiaAboutCgKgM2: inertiaAboutCg,
      budget: budgetVerdict,
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function bomTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function bomRun(ctx, id) {
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
  return massBom(props);
}

registerSolver({
  id: "orc.mass-bom",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "mass-bom.roll-up",
  fidelity: 2,
  regime: "assemblies of analytic-solid parts (the CAD-03 solver's shapes) with declared or library densities and translation positions",
  units: "SI: kg, m, kg m2; densities kg/m3 from declared inputs or the material library, always sourced in the output",
  tolerance: "exact closed-form per part; assembly sums asserted to 1e-9 relative",
  screening: false,
  reference: "per-part material sources (material library / declared density); assembly mass = sum of parts — server/tests/conkay-orc-mass-bom.test.js",
  graphProp: NS,
  targets: bomTargets,
  run: bomRun,
});

export default { massBom };
