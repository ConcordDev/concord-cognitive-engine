// server/lib/conkay/physics/solvers/bolted-joint.js
//
// Bolted joint checks per AISC 360-16 (LRFD). A Joint node CONTAINS its
// bolts and the plates they clamp; shear loads on the joint come from the
// load cases and are taken as factored loads.
//
// Bolt shear (§J3.6): φRn = φ·Fnv·Ab·planes, φ = 0.75,
//   Fnv = 0.450·Fu (threads in the shear plane) or 0.563·Fu (excluded).
//   These are the ratios behind Table J3.2 for ASTM structural bolts.
// Bearing (§J3.10(a), Eq. J3-6a): φRn = φ·2.4·d·t·Fu(plate), φ = 0.75.
//
// Reference check (in the tests): one 7/8 in A325 bolt, threads included,
// single shear gives φrn = 24.3 kips, matching AISC Manual Table 7-1.

import { registerSolver } from "../registry.js";

const PHI = 0.75;
const AISC_BOLT_GRADES = new Set(["astm-a307", "astm-a325", "astm-a490"]);

function jointParts(ctx, id) {
  const kids = ctx.children(id, "CONTAINS");
  return { bolts: kids.filter((k) => k.kind === "Bolt"), plates: kids.filter((k) => k.kind === "Plate") };
}

function jointShears(ctx, id) {
  return ctx.loadsOn(id).filter((l) => Number.isFinite(l.shear) && l.shear > 0);
}

const jointTargets = (g) => g.nodesOfKind("Joint").map((n) => n.id).filter((id) => g.children(id).some((k) => k.kind === "Bolt"));

export const boltShear = registerSolver({
  id: "joint.bolt-shear",
  version: "1.0.0",
  domain: "structural.shear",
  fidelity: 1,
  method: "AISC 360-16 §J3.6: φRn = 0.75·Fnv·Ab·planes, Fnv = 0.450·Fu (N) / 0.563·Fu (X)",
  reference: "AISC Manual 15th ed. Table 7-1: 7/8 in A325-N single shear φrn = 24.3 kips",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts } = jointParts(ctx, id);
    const shears = jointShears(ctx, id);
    if (!shears.length) return { notComputed: "no shear load on this joint", covers: [id, ...bolts.map((b) => b.id)] };
    const planes = ctx.get(id, "props.shearPlanes") === 2 ? 2 : 1;
    const threadsExcluded = ctx.get(id, "props.threadsExcluded") === true;
    const ratio = threadsExcluded ? 0.563 : 0.450;
    const inputs = { shearPlanes: { value: planes }, threads: { value: threadsExcluded ? "excluded (X)" : "included (N)" }, bolts: { value: bolts.length } };
    const warnings = [];
    const margins = [];
    for (const b of bolts) {
      const d = ctx.get(b.id, "geometry.diameter");
      const mat = ctx.material(b.id);
      if (!mat || mat.ultimatePa == null) return { notComputed: `${b.id} has no material ultimate strength`, covers: [id, ...bolts.map((x) => x.id)] };
      const Ab = Math.PI * d * d / 4;
      const phiRn = PHI * ratio * mat.ultimatePa * Ab * planes;
      inputs[`${b.id}.diameter`] = { value: d, unit: "m" };
      inputs[`${b.id}.Fu`] = { value: mat.ultimatePa, unit: "Pa", source: mat.source };
      if (!AISC_BOLT_GRADES.has(mat.id)) {
        warnings.push(`${b.id}: AISC 360 Table J3.2 covers ASTM structural bolts; its ${ratio}·Fu ratio applied to ${mat.label} is a screening extrapolation.`);
      }
      for (const l of shears) {
        margins.push({ check: `${b.id} shear (${l.loadCase})`, demand: l.shear / bolts.length, capacity: phiRn, unit: "N" });
      }
    }
    for (const l of shears) inputs[`shear.${l.loadCase}`] = { value: l.shear, unit: "N" };
    const governing = margins.reduce((a, m) => (m.demand / m.capacity > a.demand / a.capacity ? m : a));
    return {
      inputs,
      outputs: { governingCheck: { value: governing.check }, governingCapacity: { value: governing.capacity, unit: "N" } },
      margins,
      warnings,
      assumptions: [
        "Loads are factored (LRFD) and shared equally by the bolts: concentric, no eccentricity or prying.",
        "Bolt area is the nominal unthreaded area, as AISC uses.",
      ],
      covers: [id, ...bolts.map((b) => b.id)],
    };
  },
});

export const boltBearing = registerSolver({
  id: "joint.bolt-bearing",
  version: "1.0.0",
  domain: "structural.bearing",
  fidelity: 1,
  method: "AISC 360-16 §J3.10(a) Eq. J3-6a: φRn = 0.75·2.4·d·t·Fu (plate)",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const shears = jointShears(ctx, id);
    const covers = [id, ...plates.map((p) => p.id)];
    if (!shears.length) return { notComputed: "no shear load on this joint", covers };
    if (!plates.length) return { notComputed: "no plates in this joint", covers };
    const inputs = {};
    const margins = [];
    for (const p of plates) {
      const t = ctx.get(p.id, "geometry.thickness");
      const mat = ctx.material(p.id);
      if (t == null) return { notComputed: `${p.id} has no thickness`, covers };
      if (!mat || mat.ultimatePa == null) return { notComputed: `${p.id} has no material ultimate strength`, covers };
      inputs[`${p.id}.thickness`] = { value: t, unit: "m" };
      inputs[`${p.id}.Fu`] = { value: mat.ultimatePa, unit: "Pa", source: mat.source };
      for (const b of bolts) {
        const d = ctx.get(b.id, "geometry.diameter");
        inputs[`${b.id}.diameter`] = { value: d, unit: "m" };
        const phiRn = PHI * 2.4 * d * t * mat.ultimatePa;
        for (const l of shears) {
          margins.push({ check: `${b.id} bearing on ${p.id} (${l.loadCase})`, demand: l.shear / bolts.length, capacity: phiRn, unit: "N" });
        }
      }
    }
    for (const l of shears) inputs[`shear.${l.loadCase}`] = { value: l.shear, unit: "N" };
    return {
      inputs,
      outputs: { checks: { value: margins.length } },
      margins,
      assumptions: [
        "Each plate carries the full bolt force (conservative for the outer plies of a double-shear joint).",
        "Deformation at the bolt hole is a design consideration (J3-6a).",
        "Tear-out (J3-6c) is not checked: the design has no edge distances.",
      ],
      covers,
    };
  },
});
