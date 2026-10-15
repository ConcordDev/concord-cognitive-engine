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
// Tear-out (§J3.10(c), Eq. J3-6c): φRn = φ·1.5·Lc·t·Fu(plate), bounded
//   above by J3-6a. Lc = L_e − d_h/2 is the clear distance parallel to
//   the load. L_e is the edge distance from the hole center to the
//   plate edge; d_h is the nominal hole diameter (typically d_bolt +
//   1/16 in standard holes, d_bolt + 1/8 in oversized, per AISC §J3.3).
//
// All three checks share the same per-bolt, per-plate material inputs.
// AISC 360-16 is the *only* design code currently implemented; the
// solver method field records this explicitly because the 1.5 factor
// is calibration-specific to AISC (Eurocode 3 Part 1-8 uses 0.5·f_u
// for edge shear, BS 5950 uses a different formulation again).
//
// Reference checks (in the tests):
//   - shear:  one 7/8 in A325 bolt, threads included, single shear
//     gives φrn = 24.3 kips, matching AISC Manual Table 7-1.
//   - tear-out: same bolt, 1.5 in edge distance, 15/16 in hole, 1/2 in
//     plate, A36 (Fu 58 ksi). Lc = 1.5 − 15/16/2 = 1.03125 in.
//     J3-6a = 0.75·2.4·7/8·0.5·58 = 45.6 kips (bearing cap).
//     J3-6c = 0.75·1.5·1.03125·0.5·58 = 33.7 kips (tear-out, governs).

import { registerSolver } from "../registry.js";

const PHI = 0.75;        // AISC §J3 resistance factor for bolt shear, bearing, tearout, tension
const PHI_GROSS = 0.90;  // AISC §D2-1 resistance factor for tensile yielding on gross section
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
        "Tear-out (J3-6c) is checked by joint.bolt-tearout when edge distance is supplied on the Joint node.",
      ],
      covers,
    };
  },
});

// AISC 360-16 §J3.10(c) Eq. J3-6c: bolt tear-out (edge shear) capacity.
//
// φRn_tearout = 0.75 · 1.5 · Lc · t · Fu(plate), bounded above by the
// J3-6a bearing capacity. Lc = L_e − d_h/2 is the clear distance from
// the edge of the hole to the edge of the plate, measured parallel to
// the direction of the applied force.
//
// Required inputs on the Joint node:
//   - props.edgeDistance  (L_e, length, parallel to load)
//   - props.holeDiameter  (d_h, length, nominal hole diameter)
//
// Each bolt + each plate combination produces a margin. The governing
// margin is the one with the highest demand/capacity ratio.
//
// The solver does not invent defaults: if either edgeDistance or
// holeDiameter is missing, it returns notComputed with a structured
// reason naming the missing field. The governing-check aggregator
// treats this as a blocked check → joint verdict is INCOMPLETE.
export const boltTearout = registerSolver({
  id: "joint.bolt-tearout",
  version: "1.0.0",
  domain: "structural.tearout",
  fidelity: 1,
  method: "AISC 360-16 §J3.10(c) Eq. J3-6c: φRn = 0.75·1.5·Lc·t·Fu(plate), Lc = L_e − d_h/2, bounded above by Eq. J3-6a bearing capacity (φRn ≤ 0.75·2.4·d·t·Fu).",
  reference: "AISC Manual 15th ed. Part 9, Table 9-3a examples. Calibration of the 1.5 factor is AISC-specific (Eurocode 3 Part 1-8 uses 0.5·f_u; BS 5950 differs again).",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const shears = jointShears(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!shears.length) return { notComputed: "no shear load on this joint", covers };
    if (!plates.length) return { notComputed: "no plates in this joint", covers };
    if (!bolts.length) return { notComputed: "no bolts in this joint", covers };

    // Read edge geometry. Both fields are required for J3-6c; without
    // them we refuse to compute rather than guess.
    const edgeDistance = ctx.get(id, "props.edgeDistance");
    const holeDiameter = ctx.get(id, "props.holeDiameter");
    if (edgeDistance == null) {
      return { notComputed: `${id} has no props.edgeDistance (L_e): AISC 360-16 §J3.10c needs the distance from the hole center to the plate edge, parallel to the load. Provide it on the Joint node.`, covers };
    }
    if (holeDiameter == null) {
      return { notComputed: `${id} has no props.holeDiameter (d_h): AISC 360-16 §J3.10c needs the nominal hole diameter (typically d_bolt + 1/16" for standard holes, d_bolt + 1/8" for oversized, per AISC §J3.3).`, covers };
    }
    if (!Number.isFinite(edgeDistance) || edgeDistance <= 0) {
      return { notComputed: `${id}: props.edgeDistance (${edgeDistance} m) must be a positive length`, covers };
    }
    if (!Number.isFinite(holeDiameter) || holeDiameter <= 0) {
      return { notComputed: `${id}: props.holeDiameter (${holeDiameter} m) must be a positive length`, covers };
    }
    const Lc = edgeDistance - holeDiameter / 2;
    if (Lc <= 0) {
      return { notComputed: `${id}: clear distance Lc = L_e − d_h/2 = ${Lc} m is non-positive (L_e ${edgeDistance} m, d_h/2 ${holeDiameter / 2} m). Edge distance must exceed half the hole diameter.`, covers };
    }

    const inputs = {
      [`${id}.edgeDistance`]: { value: edgeDistance, unit: "m" },
      [`${id}.holeDiameter`]: { value: holeDiameter, unit: "m" },
      [`${id}.clearDistance`]: { value: Lc, unit: "m" },
    };

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
        if (!Number.isFinite(d) || d <= 0) return { notComputed: `${b.id} has no valid diameter`, covers };
        inputs[`${b.id}.diameter`] = { value: d, unit: "m" };
        const phiRnJ3_6a = PHI * 2.4 * d * t * mat.ultimatePa; // bearing cap
        const phiRnJ3_6c = PHI * 1.5 * Lc * t * mat.ultimatePa; // tear-out (uncapped)
        const phiRn = Math.min(phiRnJ3_6c, phiRnJ3_6a); // J3-6c is bounded above by J3-6a
        for (const l of shears) {
          margins.push({
            check: `${b.id} tear-out on ${p.id} (${l.loadCase})`,
            demand: l.shear / bolts.length,
            capacity: phiRn,
            bearingCap: phiRnJ3_6a,
            tearoutCapUncapped: phiRnJ3_6c,
            governing: phiRnJ3_6c < phiRnJ3_6a ? "tear-out (J3-6c)" : "bearing (J3-6a)",
            unit: "N",
          });
        }
      }
    }
    for (const l of shears) inputs[`shear.${l.loadCase}`] = { value: l.shear, unit: "N" };

    const governing = margins.reduce((a, m) => (m.demand / m.capacity > a.demand / a.capacity ? m : a));
    return {
      inputs,
      outputs: {
        governingCheck: { value: governing.check },
        governingCapacity: { value: governing.capacity, unit: "N" },
        governingLimit: { value: governing.governing },
        bearingCapacity: { value: governing.bearingCap, unit: "N" },
        tearoutCapacity: { value: governing.tearoutCapUncapped, unit: "N" },
        clearDistance: { value: Lc, unit: "m" },
      },
      margins,
      assumptions: [
        "Edge distance is uniform for every bolt in this joint (no per-bolt L_e). A bolt group with varying L_e requires a bolt-group-distribution solver to be checked first.",
        "Hole diameter is the nominal hole (standard = d_bolt + 1/16\", oversized = d_bolt + 1/8\", slotted = slot width, per AISC §J3.3). The solver does not derive it from the bolt size; provide it explicitly.",
        "Load direction is parallel to the edge distance (the worst case for tear-out). A load at an angle to the edge would split between J3-6c and a different failure path; that is out of scope for this solver.",
        "Design code: AISC 360-16 (LRFD). The 1.5 factor in J3-6c is calibration-specific to AISC and is not interchangeable with Eurocode 3 Part 1-8 or BS 5950 edge-shear formulations.",
        "J3-6c is bounded above by J3-6a (bearing). The solver reports both capacities and names which governs.",
      ],
      covers,
    };
  },
});

// AISC 360-16 §J3.6: bolt tension capacity.
//
// φRn = 0.75 · Fnt · Ab   (LRFD)
//
//   Fnt = 0.75 · Fu   when threads are NOT excluded (the common case)
//   Fnt = 0.60 · Fu   when threads ARE excluded (rare; a fitted bolt)
//
//   Ab = the bolt's tensile stress area (smaller than the nominal shank
//   area because of threads). AISC gives Ab per size in Table J3.2 /
//   Table 7-2 (M16 ≈ 157 mm², M20 ≈ 245 mm², 3/4 in ≈ 0.302 in²).
//   The solver does not invent Ab: it must be supplied on the Bolt
//   node as props.stressArea. The same goes for thread exclusion: the
//   Joint.props.threadsExcluded boolean (already used by shear) also
//   drives the Fnt ratio here.
//
// Required inputs:
//   - bolts (from the Joint's CONTAINS edges)
//   - per-bolt material with ultimatePa (Fu)
//   - per-bolt stress area: Bolt.props.stressArea (length², SI m²)
//   - per-bolt diameter (existing): Bolt.geometry.diameter
//   - tension demand: LoadCase.loads[].tension (existing)
//
// The solver does NOT verify pre-tensioning, prying, or combined
// loading with shear — those are separate limit states (slip-critical,
// prying-action, combined). The verdict aggregator adds them to the
// applicability table when the design declares a tension demand or
// the joint kind is "tension-control" or "preloaded-tension".
export const boltTension = registerSolver({
  id: "joint.bolt-tension",
  version: "1.0.0",
  domain: "structural.tension",
  fidelity: 1,
  method: "AISC 360-16 §J3.6: φRn = 0.75·Fnt·Ab, Fnt = 0.75·Fu (threads N) or 0.60·Fu (threads X). Ab is the bolt's tensile stress area, supplied on Bolt.props.stressArea (not derived from nominal diameter).",
  reference: "AISC Manual 15th ed. Table 7-2 (stress areas by nominal bolt size) and Table J3.2 (tensile strength).",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!bolts.length) return { notComputed: "no bolts in this joint", covers };
    const tensions = ctx.loadsOn(id).filter((l) => Number.isFinite(l.tension) && l.tension > 0);
    if (!tensions.length) return { notComputed: "no tension load on this joint", covers };
    const threadsExcluded = ctx.get(id, "props.threadsExcluded") === true;
    const ratio = threadsExcluded ? 0.60 : 0.75;
    const inputs = {
      [`${id}.threads`]: { value: threadsExcluded ? "excluded (X)" : "included (N)" },
    };
    const margins = [];
    for (const b of bolts) {
      const mat = ctx.material(b.id);
      if (!mat || mat.ultimatePa == null) return { notComputed: `${b.id} has no material ultimate strength`, covers };
      const Ab = ctx.get(b.id, "props.stressArea");
      if (!Number.isFinite(Ab) || Ab <= 0) {
        return {
          notComputed: `${b.id} has no props.stressArea (Ab): AISC 360-16 §J3.6 needs the bolt's tensile stress area (the area through the threads, not the nominal shank). Provide it on the Bolt node — for standard sizes see AISC Manual Table 7-2 (M16 ≈ 157 mm², M20 ≈ 245 mm², 3/4 in ≈ 0.302 in²).`,
          covers,
        };
      }
      const Fnt = ratio * mat.ultimatePa;
      const phiRn = PHI * Fnt * Ab;
      inputs[`${b.id}.stressArea`] = { value: Ab, unit: "m²" };
      inputs[`${b.id}.Fu`] = { value: mat.ultimatePa, unit: "Pa", source: mat.source };
      inputs[`${b.id}.Fnt`] = { value: Fnt, unit: "Pa" };
      for (const l of tensions) {
        margins.push({
          check: `${b.id} tension (${l.loadCase})`,
          demand: l.tension / bolts.length,
          capacity: phiRn,
          unit: "N",
        });
      }
    }
    for (const l of tensions) inputs[`tension.${l.loadCase}`] = { value: l.tension, unit: "N" };
    const governing = margins.reduce((a, m) => (m.demand / m.capacity > a.demand / a.capacity ? m : a));
    return {
      inputs,
      outputs: {
        governingCheck: { value: governing.check },
        governingCapacity: { value: governing.capacity, unit: "N" },
        threads: { value: threadsExcluded ? "excluded (X)" : "included (N)" },
      },
      margins,
      assumptions: [
        "Bolt tensile stress area (Ab) is the user-supplied value on Bolt.props.stressArea. The solver does not derive it from the nominal shank diameter because the thread engagement and thread length are bolt-specific (AISC Manual Table 7-2).",
        "Threads are NOT excluded (the standard case) unless Joint.props.threadsExcluded === true. A fitted bolt (threads excluded) is unusual and requires a different manufacturing check; the 0.60·Fu ratio assumes the threads are physically absent from the tensile stress region.",
        "Prying action (additional bolt tension from flexible plate deformation) is NOT included. A T-stub model is required for that — see joint.prying-action. Without it, this capacity is a screening value, not a connection certification.",
        "Combined shear + tension is NOT included. See joint.bolt-combined for the AISC §J3.7 interaction equation.",
        "Design code: AISC 360-16 (LRFD). The 0.75·Fnt ratio is AISC-specific; Eurocode 3 Part 1-8 and BS 5950 use different k2 factors.",
      ],
      covers,
    };
  },
});

// AISC 360-16 §J3.7: combined shear and tension interaction.
//
// The AISC interaction equation for a bolt subject to both shear and
// tension (bearing-type connection) is:
//
//   Fr / (φRn_shear) + Ft / (φRn_tension) ≤ 1.3
//
// Where Fr and Ft are the required (demand) shear and tension on the
// joint (factored LRFD loads), and φRn_shear, φRn_tension are the
// available capacities from the per-bolt solvers.
//
// This solver does NOT recompute capacities. It consumes the outputs of
// joint.bolt-shear and joint.bolt-tension, just as the user spec requires
// ("It must consume the individual checks' results rather than
// independently inventing capacities"). If either upstream solver is
// notComputed, this solver is also notComputed and reports the upstream
// reason in its own reason string.
//
// The interaction equation is checked for each load case. If multiple
// load cases exist, the worst (governing) ratio wins.
//
// 1.3 calibration note: this is the AISC value for bearing-type
// connections. Slip-critical connections use a different form
// (combined with the slip check, see joint.slip-critical). The 1.3
// is a research calibration and is NOT a universal constant; the
// solver records this in its method field.
export const boltCombined = registerSolver({
  id: "joint.bolt-combined",
  version: "1.0.0",
  domain: "structural.combined",
  fidelity: 1,
  method: "AISC 360-16 §J3.7: Fr/(φRn_shear) + Ft/(φRn_tension) ≤ 1.3. Capacities are consumed from joint.bolt-shear and joint.bolt-tension outputs (the per-bolt solvers), not recomputed. 1.3 is the AISC bearing-type calibration; slip-critical uses a different interaction.",
  reference: "AISC Manual 15th ed. Part 9, Table 7-5 and commentary on §J3.7.",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!bolts.length) return { notComputed: "no bolts in this joint", covers };
    const loads = ctx.loadsOn(id);
    const shears = loads.filter((l) => Number.isFinite(l.shear) && l.shear > 0);
    const tensions = loads.filter((l) => Number.isFinite(l.tension) && l.tension > 0);
    if (!shears.length) return { notComputed: "no shear load on this joint (combined check requires both)", covers };
    if (!tensions.length) return { notComputed: "no tension load on this joint (combined check requires both)", covers };
    // Consume the per-bolt solver outputs. The per-bolt solvers were
    // registered with `targets: jointTargets`, so their envelopes are
    // keyed on the joint id. Read them through ctx.envelopes() (the
    // same convention the joint-governing-check aggregator uses).
    const allEnvs =
      (typeof ctx.envelopes === "function" && ctx.envelopes()) ||
      ctx._envelopes ||
      (Array.isArray(ctx.envelopes) ? ctx.envelopes : []) ||
      [];
    const shearEnv = allEnvs.find((e) => e.runId === `joint.bolt-shear@${id}`);
    const tensionEnv = allEnvs.find((e) => e.runId === `joint.bolt-tension@${id}`);
    if (!shearEnv || shearEnv.status !== "PASS") {
      return { notComputed: `joint.bolt-shear@${id} is ${shearEnv?.status || "missing"}; combined check requires a passing shear capacity (reason: ${shearEnv?.reason || "no upstream envelope"})`, covers };
    }
    if (!tensionEnv || tensionEnv.status !== "PASS") {
      return { notComputed: `joint.bolt-tension@${id} is ${tensionEnv?.status || "missing"}; combined check requires a passing tension capacity (reason: ${tensionEnv?.reason || "no upstream envelope"})`, covers };
    }
    // Per the AISC interaction, the φRn for the joint is the smallest
    // per-bolt capacity (the worst bolt bounds the whole joint). Use
    // the min across the margins of each upstream solver.
    const phiRn_shear = Math.min(...shearEnv.margins.map((m) => m.capacity));
    const phiRn_tension = Math.min(...tensionEnv.margins.map((m) => m.capacity));
    // For each load case that has both shear and tension on the joint,
    // compute the interaction ratio.
    const ratios = [];
    for (const s of shears) {
      const t = tensions.find((x) => x.loadCase === s.loadCase);
      if (!t) continue;
      const Fr = s.shear;     // total joint shear
      const Ft = t.tension;   // total joint tension
      const ratio = (Fr / phiRn_shear) + (Ft / phiRn_tension);
      ratios.push({ loadCase: s.loadCase, Fr, Ft, ratio, limit: 1.3, ok: ratio <= 1.3 });
    }
    if (!ratios.length) return { notComputed: "no load case has both shear and tension on this joint", covers };
    const governing = ratios.reduce((a, r) => (r.ratio > a.ratio ? r : a));
    return {
      inputs: {
        [`${id}.phiRn_shear`]: { value: phiRn_shear, unit: "N", source: "joint.bolt-shear" },
        [`${id}.phiRn_tension`]: { value: phiRn_tension, unit: "N", source: "joint.bolt-tension" },
      },
      outputs: {
        governingRatio: { value: governing.ratio },
        governingLimit: { value: governing.limit, comment: "1.3 for bearing-type per AISC §J3.7" },
        governingLoadCase: { value: governing.loadCase },
        ok: { value: governing.ok },
      },
      assumptions: [
        "AISC 360-16 §J3.7 bearing-type interaction. The 1.3 limit is research-calibrated and AISC-specific; Eurocode 3 Part 1-8 uses a different form (see EN 1993-1-8 §3.6.1 for the √[4 + 3(fv/Fv,Rd)²] form).",
        "Capacities consumed from joint.bolt-shear and joint.bolt-tension — this solver does not recompute them. If either upstream is notComputed, this solver is notComputed too (with the upstream reason in the reason string).",
        "Per-bolt demands are computed as Fr/bolts.length and Ft/bolts.length. The governing φRn for the interaction is the smallest per-bolt capacity from each upstream solver (conservative: the worst bolt bounds the whole joint).",
        "Slip-critical connections are NOT covered by this solver. Use joint.slip-critical when the joint kind is 'slip-critical' or 'friction-grip'.",
      ],
      covers,
    };
  },
});

// AISC 360-16 §D2-1: gross-section yielding of a tension member.
//
// For a flat plate in tension, the gross-section yield capacity is:
//
//   φRn = 0.90 · Fy · Ag   (LRFD)
//
//   Ag = width × thickness   (the full unreduced cross section)
//
// This is a member-level limit state that is reported at the joint
// level because the relevant geometry (the plate that contains the
// bolt holes) is associated with the joint. The solver iterates over
// every Plate in the joint and reports the smallest φRn as the
// governing gross-section capacity.
//
// Required inputs on the Joint's plate children:
//   - geometry.width, geometry.thickness (length, SI m)
//   - material with yieldPa (Fy) and ultimatePa (Fu)
//
// Notes on scope:
//   - For a flat plate, Ag = b·t. For non-rectangular sections
//     (C-shapes, angles, hollow sections) the user must provide an
//     explicit Ag in Plate.props.grossArea instead; the solver
//     falls back to that when the plate is not a simple rectangle.
//   - The 0.90 resistance factor is AISC's LRFD value. ASD uses
//     1.67/Ω with Ω = 1.67, giving the same effective factor.
export const grossSectionYield = registerSolver({
  id: "joint.gross-section",
  version: "1.0.0",
  domain: "structural.gross-section",
  fidelity: 1,
  method: "AISC 360-16 §D2-1: φRn = 0.90·Fy·Ag (LRFD). Ag = width·thickness for a flat plate. Reported at joint level because the plate is the connected member; the solver iterates over each plate in the joint and the governing φRn is the minimum.",
  reference: "AISC 360-16 §D2-1; AISC Manual 15th ed. Part 9, Table 9-1 (tensile yielding).",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!plates.length) return { notComputed: "no plates in this joint", covers };
    const shears = ctx.loadsOn(id).filter((l) => Number.isFinite(l.shear) && l.shear > 0);
    if (!shears.length) return { notComputed: "no tension load on this joint (gross-section is a tension limit state)", covers };
    // Iterate over plates and compute per-plate gross-section φRn.
    const perPlate = [];
    for (const p of plates) {
      const mat = ctx.material(p.id);
      if (!mat || mat.yieldPa == null) return { notComputed: `${p.id} has no material yield strength (Fy)`, covers };
      let Ag;
      // User-supplied gross area takes precedence (needed for non-rectangular sections)
      const userAg = ctx.get(p.id, "props.grossArea");
      if (Number.isFinite(userAg) && userAg > 0) {
        Ag = userAg;
      } else {
        // Rectangle: width × thickness. Note: `thickness` is the
        // thin dimension; the "width" is the section's transverse
        // dimension (perpendicular to the load axis). For a flat
        // plate connected by a single row of bolts, width is the
        // direction across the plate perpendicular to the load.
        const w = ctx.get(p.id, "geometry.width");
        const t = ctx.get(p.id, "geometry.thickness");
        if (!Number.isFinite(w) || !Number.isFinite(t) || w <= 0 || t <= 0) {
          return { notComputed: `${p.id} has no usable width×thickness AND no props.grossArea. Provide Plate.geometry.width and thickness, or set props.grossArea explicitly for non-rectangular sections.`, covers };
        }
        Ag = w * t;
      }
      const phiRn = PHI_GROSS * mat.yieldPa * Ag;  // 0.90·Fy·Ag
      perPlate.push({ plate: p.id, Ag, Fy: mat.yieldPa, phiRn });
    }
    if (!perPlate.length) return { notComputed: "no plates produced a gross-section capacity", covers };
    const governing = perPlate.reduce((a, p) => (p.phiRn < a.phiRn ? p : a));
    const inputs = {};
    for (const p of perPlate) {
      inputs[`${p.plate}.Ag`] = { value: p.Ag, unit: "m²" };
      inputs[`${p.plate}.Fy`] = { value: p.Fy, unit: "Pa" };
      inputs[`${p.plate}.phiRn_gross`] = { value: p.phiRn, unit: "N" };
    }
    for (const l of shears) inputs[`shear.${l.loadCase}`] = { value: l.shear, unit: "N" };
    const margins = perPlate.map((p) => {
      const worstDemand = Math.max(...shears.map((s) => s.shear / bolts.length));
      return {
        check: `${p.plate} gross-section yield`,
        demand: worstDemand,
        capacity: p.phiRn,
        unit: "N",
      };
    });
    return {
      inputs,
      outputs: {
        governingCheck: { value: `gross-section yield (${governing.plate})` },
        governingCapacity: { value: governing.phiRn, unit: "N" },
        Ag: { value: governing.Ag, unit: "m²" },
        Fy: { value: governing.Fy, unit: "Pa" },
        phi: { value: PHI_GROSS, comment: "AISC §D2-1 LRFD resistance factor for tensile yielding" },
      },
      margins,
      assumptions: [
        "AISC 360-16 §D2-1 (LRFD). 0.90 resistance factor. ASD uses 1.67/Ω = 1.67 with Ω = 1.67, giving the same effective factor.",
        "Ag = width × thickness for a flat rectangular plate. For non-rectangular sections (C-shapes, angles, hollow sections), set Plate.props.grossArea explicitly — the solver does not compute Ag for arbitrary cross sections.",
        "Demand is taken from the largest shear load on the joint, divided equally among bolts. This is conservative for the gross-section check (a single fastener failure on one plate doesn't change the gross-section capacity of the other plate).",
        "Gross-section yielding is one of two tension-member checks; net-section rupture (§D2-2) is its companion. Both should be reported — yielding controls when the bolt holes are not the weakest section, rupture controls when they are.",
      ],
      covers,
    };
  },
});

// AISC 360-16 §D2-2: net-section rupture of a tension member.


// AISC 360-16 §D2-2: net-section rupture of a tension member.
//
// For a flat plate with bolt holes, the net-section rupture capacity is:
//
//   φRn = 0.75 · Fu · Ae   (LRFD)
//
//   An = Ag − Σ (d_hole_i · t)   (net area, holes on the failure path)
//   Ae = U · An   (effective net area; U is the shear lag factor)
//
//   U = 1.0 for a single-bolt connection (no shear lag)
//   U < 1.0 for staggered bolts, end connections, etc. — see AISC
//       Table D3.1 Case 2 / 7 / 8 for the table values.
//
// This solver iterates over each Plate in the joint, finds the holes
// on the most critical failure path (the line perpendicular to the
// applied load), and computes φRn for that path. The user supplies
// either the per-hole holePattern (preferred) or a precomputed
// props.netAreaEffective (Ae) for non-rectangular / built-up sections.
//
// Required inputs:
//   - Joint.props.holePattern (preferred) — the solver uses these to
//     compute An from the failure path.
//   - OR Plate.props.netAreaEffective (Ae) for built-up sections.
//   - Material with ultimatePa (Fu)
//
// Notes on scope:
//   - The solver assumes the failure path is a straight line
//     perpendicular to the load through the holes with the largest
//     x-coordinates (i.e. the section with the most material removed).
//     A staggered (zig-zag) failure path requires explicit
//     identification of which holes are on the path; the solver does
//     not enumerate the 2^(n−1) possible paths.
//   - Shear lag U is defaulted to 1.0 (single-bolt connection). The
//     user can supply a different value via Plate.props.shearLagFactor
//     (a unitless ratio in [0, 1]).
//   - Hole diameter is taken from the joint's holePattern geometry
//     context (a single d_h for the joint); for joints with mixed
//     hole sizes, supply a per-hole effective diameter.
export const netSectionRupture = registerSolver({
  id: "joint.net-section",
  version: "1.0.0",
  domain: "structural.net-section",
  fidelity: 1,
  method: "AISC 360-16 §D2-2: φRn = 0.75·Fu·Ae, An = Ag − Σ(d_h·t), Ae = U·An. U = 1.0 for a single-bolt connection (no shear lag). Staggered hole patterns and built-up sections require user-supplied Ae (Plate.props.netAreaEffective) or U (Plate.props.shearLagFactor).",
  reference: "AISC 360-16 §D2-2, Table D3.1 (shear lag factors U).",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!plates.length) return { notComputed: "no plates in this joint", covers };
    const shears = ctx.loadsOn(id).filter((l) => Number.isFinite(l.shear) && l.shear > 0);
    if (!shears.length) return { notComputed: "no tension load on this joint (net-section is a tension limit state)", covers };
    // Read joint-level geometry. The net-section capacity depends on
    // the hole pattern + hole diameter, which are joint-level props.
    const holePattern = ctx.get(id, "props.holePattern");
    const d_h = ctx.get(id, "props.holeDiameter");
    const hasHoleGeometry = Array.isArray(holePattern) && holePattern.length > 0 && Number.isFinite(d_h) && d_h > 0;
    // Per-plate evaluation.
    const perPlate = [];
    for (const p of plates) {
      const mat = ctx.material(p.id);
      if (!mat || mat.ultimatePa == null) return { notComputed: `${p.id} has no material ultimate strength (Fu)`, covers };
      // Get the gross area (use the same logic as gross-section)
      let Ag;
      const userAg = ctx.get(p.id, "props.grossArea");
      if (Number.isFinite(userAg) && userAg > 0) {
        Ag = userAg;
      } else {
        const w = ctx.get(p.id, "geometry.width");
        const t = ctx.get(p.id, "geometry.thickness");
        if (!Number.isFinite(w) || !Number.isFinite(t) || w <= 0 || t <= 0) {
          return { notComputed: `${p.id} has no usable width×thickness AND no props.grossArea`, covers };
        }
        Ag = w * t;
      }
      // Net area: prefer user-supplied Ae, else compute from hole geometry.
      let An, U, n_holes, Ae;
      const userAe = ctx.get(p.id, "props.netAreaEffective");
      const userU = ctx.get(p.id, "props.shearLagFactor");
      if (Number.isFinite(userAe) && userAe > 0) {
        Ae = userAe;
        U = Number.isFinite(userU) && userU > 0 ? userU : 1.0;
        An = Ae / U;
        n_holes = null;
      } else if (hasHoleGeometry) {
        // The most critical failure path is a straight line perpendicular
        // to the load (along x-axis). It crosses the holes with the
        // largest x-coordinates that share approximately the same y.
        // For a single row of bolts, this is just n_holes = (count of
        // holes within the same row). We approximate by taking the
        // maximum number of holes at any single x-coordinate.
        const byX = {};
        for (const h of holePattern) {
          const key = Math.round(h.x * 1e6);
          byX[key] = (byX[key] || 0) + 1;
        }
        n_holes = Math.max(...Object.values(byX));
        const t = ctx.get(p.id, "geometry.thickness");
        if (!Number.isFinite(t) || t <= 0) {
          return { notComputed: `${p.plate} has no usable thickness for net-section`, covers };
        }
        An = Ag - n_holes * d_h * t;
        U = 1.0;  // single-bolt / single-row approximation
        Ae = U * An;
      } else {
        return { notComputed: `${p.id} net-section needs either Joint.props.holePattern+holeDiameter, or Plate.props.netAreaEffective (Ae). For a single-bolt connection, the simple path is to provide holePattern on the Joint.`, covers };
      }
      const phiRn = 0.75 * mat.ultimatePa * Ae;
      perPlate.push({ plate: p.id, Ag, An, Ae, U, n_holes, Fu: mat.ultimatePa, phiRn });
    }
    if (!perPlate.length) return { notComputed: "no plates produced a net-section capacity", covers };
    const governing = perPlate.reduce((a, p) => (p.phiRn < a.phiRn ? p : a));
    const inputs = {};
    for (const p of perPlate) {
      inputs[`${p.plate}.Ag`] = { value: p.Ag, unit: "m²" };
      inputs[`${p.plate}.An`] = { value: p.An, unit: "m²" };
      inputs[`${p.plate}.Ae`] = { value: p.Ae, unit: "m²" };
      inputs[`${p.plate}.U`] = { value: p.U };
      inputs[`${p.plate}.Fu`] = { value: p.Fu, unit: "Pa" };
      inputs[`${p.plate}.phiRn_net`] = { value: p.phiRn, unit: "N" };
    }
    const margins = perPlate.map((p) => {
      const worstDemand = Math.max(...shears.map((s) => s.shear / bolts.length));
      return {
        check: `${p.plate} net-section rupture`,
        demand: worstDemand,
        capacity: p.phiRn,
        unit: "N",
      };
    });
    return {
      inputs,
      outputs: {
        governingCheck: { value: `net-section rupture (${governing.plate})` },
        governingCapacity: { value: governing.phiRn, unit: "N" },
        Ag: { value: governing.Ag, unit: "m²" },
        An: { value: governing.An, unit: "m²" },
        Ae: { value: governing.Ae, unit: "m²" },
        U: { value: governing.U, comment: "Shear lag factor (1.0 for single-bolt)" },
        nHoles: { value: governing.n_holes, comment: "Holes on the critical failure path" },
      },
      margins,
      assumptions: [
        "AISC 360-16 §D2-2 (LRFD). 0.75 resistance factor.",
        "Failure path: straight line perpendicular to the load through the maximum number of holes at any single x-coordinate. A staggered (zig-zag) path is not enumerated — that requires identifying the path manually and supplying Plate.props.netAreaEffective (Ae).",
        "Shear lag U = 1.0 for single-bolt / single-row connections. AISC Table D3.1 lists smaller U values for end connections, gusset plates, and staggered bolts; supply Plate.props.shearLagFactor for non-1.0 cases.",
        "Hole diameter (d_h) is a single value for the joint. Mixed-diameter patterns require user-supplied Ae.",
        "Net-section rupture is the companion to gross-section yielding (§D2-1). The two govern different ranges: yielding controls when the holes are not the weakest section, rupture controls when they are.",
      ],
      covers,
    };
  },
});


// AISC 360-16 §J4-3: block-shear rupture.
//
// Block-shear is a tension-member failure mode where a "block" of
// material tears out from the edge of the plate along a path that
// combines shear (parallel to load) and tension (perpendicular to
// load). It's typically the governing limit state when the bolt
// pattern is at the edge of the plate.
//
// The AISC block-shear equation (Eq. J4-5) is:
//
//   φRn = 0.75 · [0.6·Fu·Anv + Ubs·Fu·Ant]   (LRFD)
//
// subject to an upper limit:
//   φRn ≤ 0.75 · Fu · Agv
//
// Where:
//   Anv = net area subject to shear (parallel to load, in the load
//         direction). Computed as: Agv − Σ(d_hole_i · t) for the
//         holes on the shear planes of the failure path.
//   Ant = net area subject to tension (perpendicular to load).
//         Computed as: Agt − Σ(d_hole_i · t) for the holes on the
//         tension segments of the failure path.
//   Agv = gross area subject to shear (no holes subtracted).
//   Agt = gross area subject to tension (no holes subtracted).
//   Ubs = 1.0 for uniform tension stress (the standard case where
//         the tension line is straight, not staggered); 0.5 for
//         non-uniform tension stress (a more conservative value when
//         the tension line has staggered holes per AISC commentary).
//   Fu  = ultimate strength of the plate material.
//
// Required inputs (already in the IR):
//   - Joint.props.holePattern  (per-bolt coordinates)
//   - Joint.props.holeDiameter  (single value for the joint)
//   - Joint.props.edgeDistance  (L_e parallel to load — for Agv)
//   - Joint.props.edgeDistancePerpendicular  (L_e perp to load — for Agt)
//   - Plate geometry (thickness, width)
//
// Failure path convention: the block-shear path is an L-shape with
//   - the shear leg: from the leading edge of the plate (at x = L_e)
//     along the load direction back to the first row of bolts
//   - the tension leg: from that row of bolts perpendicular to the
//     load back to the next row of bolts (or to the side edge)
//
// For a single row of bolts (the common case), the block-shear
// path is:
//   shear length: L_e (edge distance) − d_h/2 (half hole)
//   tension length: edgeDistancePerpendicular (the side-edge distance)
//
// A more complex multi-row pattern is approximated here. The solver
// does not enumerate every possible block-shear path; the user
// can supply Plate.props.blockShearPath to override.
export const blockShearRupture = registerSolver({
  id: "joint.block-shear",
  version: "1.0.0",
  domain: "structural.block-shear",
  fidelity: 1,
  method: "AISC 360-16 §J4-3 Eq. J4-5: φRn = 0.75·[0.6·Fu·Anv + Ubs·Fu·Ant] ≤ 0.75·Fu·Agv. Anv, Ant from holePattern + edgeDistance + edgeDistancePerpendicular. Ubs = 1.0 for uniform tension (the common case).",
  reference: "AISC 360-16 §J4-3; AISC Manual 15th ed. Part 9, Table 9-3a (block-shear).",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!plates.length) return { notComputed: "no plates in this joint", covers };
    const shears = ctx.loadsOn(id).filter((l) => Number.isFinite(l.shear) && l.shear > 0);
    if (!shears.length) return { notComputed: "no tension load on this joint (block-shear is a tension limit state)", covers };
    // Read joint-level geometry
    const holePattern = ctx.get(id, "props.holePattern");
    const d_h = ctx.get(id, "props.holeDiameter");
    const L_e = ctx.get(id, "props.edgeDistance");
    const L_e_perp = ctx.get(id, "props.edgeDistancePerpendicular");
    // All four joint-level inputs are required for the standard
    // block-shear path. A user-supplied blockShearPath on the plate
    // can override this.
    if (!Array.isArray(holePattern) || holePattern.length === 0) {
      return { notComputed: `${id}.props.holePattern is required for block-shear (the per-bolt coordinates define the shear/tension legs of the failure path)`, covers };
    }
    if (!Number.isFinite(d_h) || d_h <= 0) {
      return { notComputed: `${id}.props.holeDiameter is required for block-shear (AISC §J3.3 standard/oversized/slotted)`, covers };
    }
    if (!Number.isFinite(L_e) || L_e <= 0) {
      return { notComputed: `${id}.props.edgeDistance is required for block-shear (L_e parallel to load defines the shear leg length)`, covers };
    }
    if (!Number.isFinite(L_e_perp) || L_e_perp <= 0) {
      return { notComputed: `${id}.props.edgeDistancePerpendicular is required for block-shear (L_e perpendicular to load defines the tension leg length)`, covers };
    }
    // Per-plate evaluation
    const perPlate = [];
    for (const p of plates) {
      const mat = ctx.material(p.id);
      if (!mat || mat.ultimatePa == null) return { notComputed: `${p.id} has no material ultimate strength (Fu)`, covers };
      // Plate thickness — required to compute areas
      const t = ctx.get(p.id, "geometry.thickness");
      if (!Number.isFinite(t) || t <= 0) {
        return { notComputed: `${p.id} has no usable thickness for block-shear`, covers };
      }
      // User-supplied block-shear path overrides the standard
      // L-shape computation
      const userPath = ctx.get(p.id, "props.blockShearPath");
      let Anv, Ant, Agv, Agt, Ubs, n_shear, n_tension;
      if (userPath) {
        // userPath = { Anv, Ant, Agv, Agt, Ubs } in m²
        if (!Number.isFinite(userPath.Anv) || !Number.isFinite(userPath.Ant) || !Number.isFinite(userPath.Agv) || !Number.isFinite(userPath.Agt)) {
          return { notComputed: `${p.id}.props.blockShearPath needs Anv, Ant, Agv, Agt as areas (m²)`, covers };
        }
        Anv = userPath.Anv;
        Ant = userPath.Ant;
        Agv = userPath.Agv;
        Agt = userPath.Agt;
        Ubs = Number.isFinite(userPath.Ubs) ? userPath.Ubs : 1.0;
        n_shear = userPath.nShearHoles;
        n_tension = userPath.nTensionHoles;
      } else {
        // Standard L-shape failure path:
        // Shear leg: from the leading edge (at x = L_e) to the
        //   first row of bolts. The shear length is L_e − d_h/2
        //   (clear distance from edge of hole to the edge of the
        //   plate). The shear leg has length L_s = L_e − d_h/2.
        // Tension leg: from the first row of bolts perpendicular
        //   to the load to the side edge. The tension length is
        //   L_e_perp − d_h/2.
        //
        // The number of holes on each leg:
        //   n_shear = number of holes on the shear planes (rows
        //     of bolts parallel to the load). For a single column
        //     of bolts, n_shear = 1 (one row).
        //   n_tension = number of holes on the tension segment.
        //     For a single row of bolts, n_tension = 1.
        //
        // Anv, Agv: the shear-plane area. The shear leg has length
        //   L_s = L_e − d_h/2; the area is L_s · t.
        // Ant, Agt: the tension-line area. The tension leg has
        //   length L_t = L_e_perp − d_h/2; the area is L_t · t.
        //
        // We count holes on the shear and tension legs from
        // holePattern. For the standard case (a single row at the
        // edge), n_shear = 1 and n_tension = holePattern.length.
        // The tension leg crosses every hole that lies on the row.
        const L_s = L_e - d_h / 2;     // shear leg length
        const L_t = L_e_perp - d_h / 2;  // tension leg length
        if (L_s <= 0) {
          return { notComputed: `${id}: L_e (${L_e}) must exceed d_h/2 (${d_h / 2}) for block-shear; the shear leg length would be ≤ 0`, covers };
        }
        if (L_t <= 0) {
          return { notComputed: `${id}: L_e_perp (${L_e_perp}) must exceed d_h/2 (${d_h / 2}) for block-shear; the tension leg length would be ≤ 0`, covers };
        }
        Agv = L_s * t;
        Agt = L_t * t;
        // For a single-row bolt pattern, the tension leg crosses
        // every hole in the pattern (n_tension = holePattern.length).
        // The shear leg crosses the holes in the FIRST row (closest
        // to the leading edge). For the standard L-shape, we
        // approximate n_shear = 1 and n_tension = holePattern.length.
        n_shear = 1;
        n_tension = holePattern.length;
        Anv = Agv - n_shear * d_h * t;
        Ant = Agt - n_tension * d_h * t;
        Ubs = 1.0;  // uniform tension stress for a straight tension line
      }
      // The AISC block-shear capacity: φRn = 0.75·[0.6·Fu·Anv + Ubs·Fu·Ant]
      const phiRn_steel = 0.75 * (0.6 * mat.ultimatePa * Anv + Ubs * mat.ultimatePa * Ant);
      // Upper limit: φRn ≤ 0.75·Fu·Agv
      const phiRn_limit = 0.75 * mat.ultimatePa * Agv;
      const phiRn = Math.min(phiRn_steel, phiRn_limit);
      const governing_limit = phiRn_steel > phiRn_limit ? "upper limit (0.75·Fu·Agv)" : "Eq. J4-5";
      perPlate.push({ plate: p.id, Anv, Ant, Agv, Agt, Ubs, n_shear, n_tension, t, Fu: mat.ultimatePa, phiRn, phiRn_steel, phiRn_limit, governing_limit });
    }
    if (!perPlate.length) return { notComputed: "no plates produced a block-shear capacity", covers };
    const governing = perPlate.reduce((a, p) => (p.phiRn < a.phiRn ? p : a));
    const inputs = {};
    for (const p of perPlate) {
      inputs[`${p.plate}.Agv`] = { value: p.Agv, unit: "m²" };
      inputs[`${p.plate}.Agt`] = { value: p.Agt, unit: "m²" };
      inputs[`${p.plate}.Anv`] = { value: p.Anv, unit: "m²" };
      inputs[`${p.plate}.Ant`] = { value: p.Ant, unit: "m²" };
      inputs[`${p.plate}.Ubs`] = { value: p.Ubs };
      inputs[`${p.plate}.Fu`] = { value: p.Fu, unit: "Pa" };
      inputs[`${p.plate}.phiRn_block`] = { value: p.phiRn, unit: "N" };
      inputs[`${p.plate}.governing_limit`] = { value: p.governing_limit, comment: "Either 'Eq. J4-5' or the upper limit 0.75·Fu·Agv" };
    }
    const margins = perPlate.map((p) => {
      const worstDemand = Math.max(...shears.map((s) => s.shear / bolts.length));
      return {
        check: `${p.plate} block-shear`,
        demand: worstDemand,
        capacity: p.phiRn,
        unit: "N",
      };
    });
    return {
      inputs,
      outputs: {
        governingCheck: { value: `block-shear (${governing.plate})` },
        governingCapacity: { value: governing.phiRn, unit: "N" },
        Anv: { value: governing.Anv, unit: "m²" },
        Ant: { value: governing.Ant, unit: "m²" },
        Agv: { value: governing.Agv, unit: "m²" },
        Agt: { value: governing.Agt, unit: "m²" },
        Ubs: { value: governing.Ubs, comment: "Tension uniformity factor (1.0 for straight lines)" },
        nShearHoles: { value: governing.n_shear, comment: "Holes on the shear planes" },
        nTensionHoles: { value: governing.n_tension, comment: "Holes on the tension segment" },
        governingLimit: { value: governing.governing_limit, comment: "Either the J4-5 capacity or the upper-limit cap" },
      },
      margins,
      assumptions: [
        "AISC 360-16 §J4-3 Eq. J4-5 (LRFD). The 0.75 resistance factor applies to both the J4-5 capacity and the upper-limit cap.",
        "Standard L-shape failure path: shear leg = L_e − d_h/2 (parallel to load), tension leg = L_e_perp − d_h/2 (perpendicular to load). The user can supply Plate.props.blockShearPath to override (e.g. for staggered or stepped paths).",
        "Ubs = 1.0 for uniform tension stress (a straight tension line). For non-uniform tension (staggered holes), AISC permits 0.5; the user can supply Plate.props.blockShearPath.Ubs for that case.",
        "Block-shear is typically the governing limit state for connections near the edge of a plate (low L_e). The 0.75·Fu·Agv upper limit caps the capacity to prevent unrealistically high values when Anv + Ant is large relative to the gross shear area.",
        "The 0.6 factor on Anv reflects the observation that shear rupture occurs at a lower stress than tension rupture. The 1.0 on Ant (with Ubs) reflects tension rupture stress. This is research-calibrated and AISC-specific.",
      ],
      covers,
    };
  },
});


// Bolt-group load distribution (instant center / elastic method).
//
// A bolt group with an eccentric load doesn't carry the load equally.
// The classical analysis (Crawford & Kulak) uses the elastic method:
// each bolt's force is the vector sum of:
//   1. The direct shear: F_direct = P / n   (n = number of bolts)
//   2. The torsional shear: F_torsion = T·r / Σ r²
//      where T = P · e (eccentricity) and r is the bolt's distance
//      from the centroid of the group
//   3. The two are added vectorially to get the resultant on each bolt.
//
// This is the same math as a bolt group under moment + shear. The
// AISC Manual 15th ed. Part 9 (and Crawford & Kulak 1971) lay it out.
//
// Required inputs:
//   - Joint.props.holePattern (per-bolt {x, y} coords; the centroid
//     of the pattern is the instant center for concentric loads and
//     the rotation center for eccentric loads)
//   - Joint.props.loadVector = {Fx, Fy, M} (N, N, N·m) — the applied
//     load on the joint. The default for a LoadCase.loads[].shear is
//     a pure +X shear, M = 0. Eccentric loads require either:
//       - Joint.props.eccentricity (length, m) — the perpendicular
//         distance from the load line to the bolt-group centroid, OR
//       - Joint.props.loadVector.M (N·m) — the moment directly
//
// Output: per-bolt force vector. The governing bolt (max resultant)
// is the one that drives the joint.bolt-shear, joint.bolt-bearing,
// joint.bolt-tearout checks (those solvers assume equal distribution
// across bolts.length; this solver can refine that assumption).
//
// Note: this solver does NOT recompute the joint.bolt-shear capacity.
// It only computes the demand distribution. Downstream solvers can
// read per-bolt demands from the envelope if they want to refine
// their own check.
export const boltGroupDistribution = registerSolver({
  id: "joint.bolt-group-distribution",
  version: "1.0.0",
  domain: "structural.bolt-group",
  fidelity: 1,
  method: "Crawford-Kulak elastic method: per-bolt force = (P/n) + T·r/Σr² vector sum. Concentric load → equal distribution. Eccentric load → direct + torsional components added vectorially. Center of rotation = centroid of the bolt group (for the elastic method).",
  reference: "Crawford & Kulak 1971; AISC Manual 15th ed. Part 9, Table 7-7 to 7-10 (bolt-group eccentric shear).",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!bolts.length) return { notComputed: "no bolts in this joint", covers };
    const holePattern = ctx.get(id, "props.holePattern");
    if (!Array.isArray(holePattern) || holePattern.length === 0) {
      return { notComputed: `${id}.props.holePattern is required for bolt-group distribution (per-bolt coordinates)`, covers };
    }
    if (holePattern.length !== bolts.length) {
      return { notComputed: `${id}: holePattern has ${holePattern.length} entries but joint has ${bolts.length} bolts. The per-bolt solver (joint.bolt-shear) can run with equal distribution, but this group-distribution solver needs 1:1 holePattern-to-bolt correspondence.`, covers };
    }
    // Compute the centroid of the bolt group
    const cx = holePattern.reduce((s, h) => s + h.x, 0) / holePattern.length;
    const cy = holePattern.reduce((s, h) => s + h.y, 0) / holePattern.length;
    // Compute the polar moment of inertia of the bolt group: Σ r_i²
    let J = 0;
    const rVectors = holePattern.map((h) => {
      const dx = h.x - cx;
      const dy = h.y - cy;
      const r2 = dx * dx + dy * dy;
      J += r2;
      return { dx, dy, r2 };
    });
    if (J === 0) {
      return { notComputed: `${id}: bolt group has zero polar moment of inertia (all bolts at the same point). Cannot distribute eccentric load.`, covers };
    }
    // Read the load vector. The simplest case: a single shear load
    // in +X. For eccentric loads, the user supplies loadVector.
    const shears = ctx.loadsOn(id).filter((l) => Number.isFinite(l.shear) && l.shear > 0);
    if (!shears.length) return { notComputed: "no shear load on this joint", covers };
    // For each load case, compute per-bolt distribution
    const perLoadCase = [];
    // Eccentricity is read once (not per load case) — it's a
    // geometric property of the joint, not a load property.
    const ecc = ctx.get(id, "props.eccentricity");
    for (const l of shears) {
      const P = l.shear;  // total joint shear
      // Default: pure +X shear, no moment
      const Fx = P;     // load in +X direction
      const Fy = 0;     // no transverse load
      let M = 0;        // no moment
      // User-supplied eccentricity: a 2D vector {x, y} (length, m) of
      // the load application point relative to the bolt-group centroid.
      // The moment about z is M = Fx · ey − Fy · ex. For the default
      // +X shear load, M = P · ey.
      if (ecc && Number.isFinite(ecc.x) && Number.isFinite(ecc.y)) {
        M = Fx * ecc.y - Fy * ecc.x;
      }
      // Direct shear on each bolt (uniform)
      const F_direct_x = Fx / bolts.length;
      const F_direct_y = Fy / bolts.length;
      // Torsional component on each bolt
      // r × F_torsion = M   (about z-axis, out of plane)
      // F_torsion_i = (M · r_i_perp) / J  where r_i_perp = (-dy, dx)
      // i.e. F_tx = -M·dy/J, F_ty = M·dx/J
      const F_t_x = -M / J;  // multiplier on -dy
      const F_t_y = M / J;   // multiplier on dx
      // Per-bolt resultants
      const perBolt = rVectors.map((r, i) => {
        const Fx_total = F_direct_x + F_t_x * (-r.dy);
        const Fy_total = F_direct_y + F_t_y * (r.dx);
        const F_mag = Math.sqrt(Fx_total * Fx_total + Fy_total * Fy_total);
        const angle = Math.atan2(Fy_total, Fx_total) * 180 / Math.PI;
        return {
          bolt: bolts[i].id,
          x: holePattern[i].x,
          y: holePattern[i].y,
          Fx: Fx_total,
          Fy: Fy_total,
          F: F_mag,
          angle: angle,
        };
      });
      const governing = perBolt.reduce((a, b) => (b.F > a.F ? b : a));
      perLoadCase.push({ loadCase: l.loadCase, P, M, Fx_load: Fx, Fy_load: Fy, perBolt, governing });
    }
    if (!perLoadCase.length) return { notComputed: "no shear load case produced a distribution", covers };
    // The worst (governing) load case
    const worst = perLoadCase.reduce((a, r) => (r.governing.F > a.governing.F ? r : a));
    const inputs = {
      [`${id}.nBolts`]: { value: bolts.length },
      [`${id}.centroidX`]: { value: cx, unit: "m" },
      [`${id}.centroidY`]: { value: cy, unit: "m" },
      [`${id}.J`]: { value: J, unit: "m²", comment: "Polar moment of inertia Σr²" },
    };
    if (ecc && Number.isFinite(ecc.x) && Number.isFinite(ecc.y)) {
      inputs[`${id}.eccentricityX`] = { value: ecc.x, unit: "m" };
      inputs[`${id}.eccentricityY`] = { value: ecc.y, unit: "m" };
      inputs[`${id}.moment`] = { value: worst.M, unit: "N·m" };
    }
    return {
      inputs,
      outputs: {
        governingBolt: { value: worst.governing.bolt },
        governingForce: { value: worst.governing.F, unit: "N" },
        governingAngle: { value: worst.governing.angle, unit: "deg" },
        governingLoadCase: { value: worst.loadCase },
        centroidX: { value: cx, unit: "m" },
        centroidY: { value: cy, unit: "m" },
        J: { value: J, unit: "m²" },
        perBolt: {
          value: worst.perBolt.map((b) => ({ bolt: b.bolt, F: b.F, angle: b.angle })),
          comment: "Per-bolt force magnitude and angle in the joint's local frame",
        },
      },
      assumptions: [
        "Elastic method (Crawford & Kulak 1971). The polar moment of inertia Σr² is computed about the centroid of the bolt group. This is the most common design-office method for eccentric bolt groups.",
        "The instant-center method (more accurate for large eccentricities) is a non-linear iteration; this solver uses the linear elastic method which is conservative for the typical in-plane eccentricity range.",
        "Load direction: default is +X (shear). The user can supply Joint.props.loadVector for other directions; the current solver handles eccentric in-plane loads in the +X direction.",
        "Per-bolt demand is reported for inspection. The joint.bolt-shear solver does NOT yet consume this — it still assumes equal distribution (Fr/bolts.length). The group-distribution output is informational until downstream solvers are updated to read it.",
        "Prying action is NOT included in the per-bolt force. Prying adds tension (out of plane) and would require a separate T-stub model — see joint.prying-action.",
      ],
      covers,
    };
  },
});


// AISC 360-16 §J3.8: slip-critical connection strength.
//
// In a slip-critical connection, the bolts are pre-tensioned and the
// friction between the faying surfaces carries the load. Slip is the
// serviceability limit; the connection must not slip under the
// serviceability load combination (1.0·DLC, 0.5·L, etc. — the
// serviceability factor of 1.13 is captured in Du).
//
// The AISC slip-critical equation (Eq. J3-4) is:
//
//   φRn = φ · μ · Du · hf · Tb · ns
//
//   φ   = 1.00 (LRFD), 1.50 (ASD) for slip-critical
//   μ   = mean slip coefficient (Class A: 0.30, Class B: 0.50,
//         Class C: 0.70). Surface class is a user-supplied text
//         enum on Joint.props.fayingSurface.
//   Du  = 1.13 (the multiplier from the AISC research; captures
//         the mean-to-minimum ratio of bolt pretension).
//   hf  = 1.00 for standard/oversized/short-slotted holes;
//         0.85 for long-slotted transverse to load;
//         0.70 for long-slotted parallel to load. The user
//         supplies the hole type on Bolt.props.holeType (or
//         Joint.props.holeType as a default for all bolts).
//   Tb  = minimum specified bolt pretension (per AISC Table J3.1,
//         a function of bolt diameter). The user supplies this
//         on Bolt.props.pretension or Joint.props.pretension as
//         a default. The AISC Table J3.1 values are not
//         computed; the user is expected to look up the
//         standard value for their bolt size and grade.
//   ns  = number of slip planes (the existing
//         Joint.props.shearPlanes).
//
// Required inputs:
//   - Joint.props.fayingSurface (text: "A" | "B" | "C")
//   - Joint.props.shearPlanes (number, existing)
//   - Bolt.props.pretension OR Joint.props.pretension (force, N)
//
// Notes on scope:
//   - This solver checks the slip-critical STRENGTH, not the slip-
//     critical SERVICEABILITY. Serviceability slip (under frequent
//     load combinations) is a different check; see the
//     AISC Specification §J3.8 commentary for that formulation.
//   - The AISC pretension values from Table J3.1 are NOT computed
//     by this solver. The user MUST supply the value, and the
//     solver reports the source requirement in its NOT_COMPUTED
//     reason if the field is missing.
//   - Hole type is one of: "standard", "oversized", "short-slotted-x",
//     "short-slotted-y", "long-slotted-x", "long-slotted-y". The
//     "x" and "y" suffixes are the orientation (parallel or
//     perpendicular to load).
export const slipCritical = registerSolver({
  id: "joint.slip-critical",
  version: "1.0.0",
  domain: "structural.slip-critical",
  fidelity: 1,
  method: "AISC 360-16 §J3.8 Eq. J3-4: φRn = φ·μ·Du·hf·Tb·ns. φ=1.00 LRFD. μ from Joint.props.fayingSurface (A=0.30, B=0.50, C=0.70). Du=1.13. hf from hole type (1.00 standard, 0.85 long-slot ⊥, 0.70 long-slot ∥). Tb is user-supplied (AISC Table J3.1).",
  reference: "AISC 360-16 §J3.8; AISC Manual 15th ed. Part 9, Table 7-3 (slip coefficients); AISC Table J3.1 (minimum bolt pretension).",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!bolts.length) return { notComputed: "no bolts in this joint", covers };
    const shears = ctx.loadsOn(id).filter((l) => Number.isFinite(l.shear) && l.shear > 0);
    if (!shears.length) return { notComputed: "no shear load on this joint (slip-critical is a shear limit state)", covers };
    // Slip coefficient from faying surface class
    const surfaceClass = ctx.get(id, "props.fayingSurface");
    const mu_map = { A: 0.30, B: 0.50, C: 0.70 };
    const mu = mu_map[surfaceClass];
    if (mu == null) {
      return { notComputed: `${id}.props.fayingSurface is required for slip-critical (AISC §J3.8 — slip coefficient). Expected one of: "A" (0.30), "B" (0.50), "C" (0.70). Got: ${JSON.stringify(surfaceClass)}`, covers };
    }
    // Number of slip planes
    const ns = ctx.get(id, "props.shearPlanes");
    if (!Number.isFinite(ns) || ns <= 0) {
      return { notComputed: `${id}.props.shearPlanes is required for slip-critical (the number of slip planes)`, covers };
    }
    // Hole type → hole factor hf. The schema's enum values are
    // "standard", "oversized", "short-slotted", "long-slotted",
    // "parallel-to-load" (long-slot oriented parallel to load),
    // "perpendicular-to-load" (long-slot oriented perpendicular
    // to load). The first four have hf = 1.00; the long-slot
    // orientations have reduced hf per AISC Table J3.8.
    const holeType = ctx.get(id, "props.holeType");
    const hf_map = {
      "standard": 1.00,
      "oversized": 1.00,
      "short-slotted": 1.00,
      "long-slotted": 1.00,
      "perpendicular-to-load": 0.85,  // long-slot ⊥ load
      "parallel-to-load": 0.70,       // long-slot ∥ load
    };
    const hf = hf_map[holeType || "standard"] ?? 1.00;
    // Pretension Tb: per-bolt, or a joint-level default
    const jointTb = ctx.get(id, "props.pretension");
    const margins = [];
    const perBolt = [];
    for (const b of bolts) {
      const Tb = ctx.get(b.id, "props.pretension") ?? jointTb;
      if (!Number.isFinite(Tb) || Tb <= 0) {
        return { notComputed: `${b.id} has no pretension Tb. AISC Table J3.1 gives the minimum specified pretension for each bolt size (M16 ≈ 91 kN, M20 ≈ 142 kN, M22 ≈ 176 kN, M24 ≈ 205 kN for A325; double for A490). Supply it on Bolt.props.pretension or as a joint-level default on Joint.props.pretension.`, covers };
      }
      const Du = 1.13;
      const phi = 1.00;  // LRFD; ASD would use 1.50
      const phiRn = phi * mu * Du * hf * Tb * ns;
      perBolt.push({ bolt: b.id, Tb, phiRn });
      const worstDemand = Math.max(...shears.map((s) => s.shear / bolts.length));
      margins.push({ check: `${b.id} slip-critical`, demand: worstDemand, capacity: phiRn, unit: "N" });
    }
    const governing = perBolt.reduce((a, b) => (a.phiRn < b.phiRn ? a : b));
    const inputs = {
      [`${id}.fayingSurface`]: { value: surfaceClass, comment: "AISC surface class (A, B, C)" },
      [`${id}.mu`]: { value: mu },
      [`${id}.Du`]: { value: 1.13 },
      [`${id}.hf`]: { value: hf, comment: "Hole factor for the joint" },
      [`${id}.ns`]: { value: ns },
      [`${id}.phi`]: { value: 1.00, comment: "LRFD resistance factor for slip-critical" },
    };
    for (const b of perBolt) {
      inputs[`${b.bolt}.Tb`] = { value: b.Tb, unit: "N" };
      inputs[`${b.bolt}.phiRn_slip`] = { value: b.phiRn, unit: "N" };
    }
    return {
      inputs,
      outputs: {
        governingCheck: { value: `slip-critical (${governing.bolt})` },
        governingCapacity: { value: governing.phiRn, unit: "N" },
        mu: { value: mu, comment: "Slip coefficient" },
        hf: { value: hf, comment: "Hole factor" },
        Du: { value: 1.13 },
        phi: { value: 1.00 },
      },
      margins,
      assumptions: [
        "AISC 360-16 §J3.8 Eq. J3-4 (LRFD). Resistance factor φ = 1.00 (LRFD) or 1.50 (ASD).",
        "Slip coefficient μ from AISC SC surface class: A=0.30, B=0.50, C=0.70. The actual measured value depends on surface preparation, coating, and condition; AISC Table 7-3 lists the standard values for the most common treatments.",
        "Mean-to-minimum pretension ratio Du = 1.13 per AISC. This is a research calibration and assumes the bolt pretension is at the AISC Table J3.1 minimum (which the user supplies).",
        "Hole factor hf: 1.00 for standard/oversized/short-slotted, 0.85 for long-slotted perpendicular to load, 0.70 for long-slotted parallel to load. The user supplies Joint.props.holeType.",
        "Bolt pretension Tb is user-supplied (AISC Table J3.1) — the solver does not look it up. For typical A325 bolts: M16≈91 kN, M20≈142 kN, M22≈176 kN, M24≈205 kN. A490 is roughly double these values.",
        "Slip-critical STRENGTH, not serviceability. Serviceability slip under frequent load combinations is a different check; see AISC §J3.8 commentary.",
      ],
      covers,
    };
  },
});


// AISC Steel Design Guide 9 / AISC 360-16 §9: prying action in a T-stub.
//
// Prying action is the additional bolt tension that develops when a
// flexible flange bends away from the stem. It can multiply the
// applied bolt tension by 20-50% (sometimes more) in the elastic
// range, or 10-30% in the inelastic range. It is critical to
// compute prying in:
//   - Extended end-plate connections
//   - Bolted bracket-to-column flange connections
//   - Any T-stub with a thin flange relative to the bolt diameter
//
// The prying analysis uses the T-stub model from AISC Manual
// 14th ed. Part 9 (also in the AISC Steel Design Guide 9 by
// Kulak, Fisher, Struik). The simplified inelastic formula is:
//
//   Q_max = (w · t² / 4) · Fy · (b / a)
//
//   w = tributary flange width (perpendicular to the load direction;
//     for a single bolt, w = the bolt spacing; for the outermost
//     bolt, w = bolt_spacing / 2 on each side)
//   t = flange thickness
//   a = distance from the bolt centerline to the face of the stem
//     (but not more than 1.25·b per AISC limits)
//   b = distance from the bolt centerline to the edge of the flange
//   Fy = flange yield strength
//
// The factor (b / a) is the prying amplification; the resulting
// total bolt tension is B + Q where B is the applied tension.
// When Q > 0, the bolt's effective demand is higher than the
// applied tension alone.
//
// The solver reports:
//   - prying factor (Q / B)
//   - Q (the prying force itself, in N)
//   - effective tension (B + Q)
//   - the limit state that governs (elastic / inelastic / no prying)
//
// Required inputs:
//   - Bolt.props.pretension (optional, for elastic case)
//   - Joint.props.flangeThickness (length, m)
//   - Joint.props.flangeYield (stress, Pa) — or inferred from material
//   - Joint.props.tStubA (length, m) — bolt to stem face
//   - Joint.props.tStubB (length, m) — bolt to edge of flange
//   - Joint.props.tributaryWidth (length, m) — w in the formula
//
// Notes on scope:
//   - The solver implements the SIMPLIFIED INELASTIC formula. The
//     exact AISC formula has three cases (elastic, inelastic,
//     plastic) and the transition is iterative; this solver
//     returns the inelastic value and notes the AISC §9 limits
//     on a / b in its assumptions.
//   - The exact AISC limits:
//       Elastic: 1.0 ≤ a/b ≤ 2.0  AND  β ≤ (1/ϕ) ≈ 1.0
//       Inelastic: a/b > 2.0 OR β > 1
//       Plastic: yield-line mechanism forms
//   - AISC limits a ≤ 1.25·b (otherwise prying is so large that
//     the connection is impractical).
//   - The solver does NOT verify that a ≤ 1.25·b. If the user
//     supplies values that violate this, the prying factor is
//     reported with a warning in the assumptions.
export const pryingAction = registerSolver({
  id: "joint.prying-action",
  version: "1.0.0",
  domain: "structural.prying",
  fidelity: 1,
  method: "AISC Steel Design Guide 9 (Kulak-Fisher-Struik), simplified inelastic T-stub: Q = (w·t²/4)·Fy·(b/a). The exact AISC §9 has three cases (elastic, inelastic, plastic) with iterative transition; this solver returns the inelastic value as a screening check.",
  reference: "AISC Manual 14th ed. Part 9 (T-stub); AISC Steel Design Guide 9 (Kulak, Fisher, Struik); AISC 360-16 §9.",
  targets: jointTargets,
  run(ctx, id) {
    const { bolts, plates } = jointParts(ctx, id);
    const covers = [id, ...plates.map((p) => p.id), ...bolts.map((b) => b.id)];
    if (!bolts.length) return { notComputed: "no bolts in this joint", covers };
    const tensions = ctx.loadsOn(id).filter((l) => Number.isFinite(l.tension) && l.tension > 0);
    if (!tensions.length) return { notComputed: "no tension load on this joint (prying is a tension limit state)", covers };
    // Read T-stub geometry
    const t_flange = ctx.get(id, "props.flangeThickness");
    const a = ctx.get(id, "props.tStubA");
    const b = ctx.get(id, "props.tStubB");
    const w = ctx.get(id, "props.tributaryWidth");
    if (!Number.isFinite(t_flange) || t_flange <= 0) {
      return { notComputed: `${id}.props.flangeThickness is required for prying (AISC §9 T-stub model)`, covers };
    }
    if (!Number.isFinite(a) || a <= 0) {
      return { notComputed: `${id}.props.tStubA is required for prying (distance from bolt centerline to face of stem)`, covers };
    }
    if (!Number.isFinite(b) || b <= 0) {
      return { notComputed: `${id}.props.tStubB is required for prying (distance from bolt centerline to edge of flange)`, covers };
    }
    if (!Number.isFinite(w) || w <= 0) {
      return { notComputed: `${id}.props.tributaryWidth is required for prying (the bolt's tributary flange width, w)`, covers };
    }
    if (a > 1.25 * b) {
      return { notComputed: `${id}: a (${a} m) > 1.25·b (${1.25 * b} m). AISC §9 limits a ≤ 1.25·b. Outside this range, prying is so large that the connection is impractical; redesign with a thicker flange or a smaller bolt-to-edge distance.`, covers };
    }
    // Per-plate: read the material's yield strength (one of the plates
    // is the flange; for a T-stub the stem is the other plate).
    // We use the first plate as the flange. A more sophisticated
    // solver would have a "flange" vs "stem" identifier on the plate.
    const flange = plates[0];
    if (!flange) return { notComputed: "no plates in this joint (T-stub needs a flange and a stem)", covers };
    const mat = ctx.material(flange.id);
    if (!mat || mat.yieldPa == null) {
      return { notComputed: `${flange.id} has no material yield strength (Fy). The T-stub's flange material is needed for the prying analysis.`, covers };
    }
    const Fy = mat.yieldPa;
    // Simplified inelastic T-stub formula: Q = (w·t²/4)·Fy·(b/a)
    const Q_max = (w * t_flange * t_flange / 4) * Fy * (b / a);
    // Per-bolt prying force
    const perBolt = [];
    for (const b_item of bolts) {
      // The applied tension per bolt
      const B_per = tensions[0].tension / bolts.length;
      // Q is shared; the prying force per bolt is Q_max / nBolts
      const Q_per = Q_max / bolts.length;
      const B_eff = B_per + Q_per;
      const pryingFactor = B_per > 0 ? Q_per / B_per : 0;
      perBolt.push({ bolt: b_item.id, B: B_per, Q: Q_per, B_eff, pryingFactor });
    }
    const governing = perBolt.reduce((a, p) => (p.B_eff > a.B_eff ? p : a));
    const inputs = {
      [`${id}.t_flange`]: { value: t_flange, unit: "m" },
      [`${id}.a`]: { value: a, unit: "m" },
      [`${id}.b`]: { value: b, unit: "m" },
      [`${id}.w`]: { value: w, unit: "m" },
      [`${id}.Fy`]: { value: Fy, unit: "Pa" },
      [`${id}.Q_max`]: { value: Q_max, unit: "N", comment: "Total prying force across the joint" },
    };
    return {
      inputs,
      outputs: {
        governingBolt: { value: governing.bolt },
        governingTension: { value: governing.B, unit: "N", comment: "Applied tension per bolt" },
        governingPryingForce: { value: governing.Q, unit: "N" },
        governingEffectiveTension: { value: governing.B_eff, unit: "N", comment: "B + Q (the actual bolt tension with prying)" },
        pryingFactor: { value: governing.pryingFactor, comment: "Q / B (prying amplification; 0 = no prying, 0.3 = 30% amplification, etc.)" },
        Q_max: { value: Q_max, unit: "N" },
      },
      assumptions: [
        "AISC Steel Design Guide 9 (Kulak-Fisher-Struik), simplified INELASTIC T-stub formula: Q = (w·t²/4)·Fy·(b/a). The exact AISC §9 has three cases (elastic, inelastic, plastic); the transition is iterative. The inelastic form is the most common design case and is what the simplified formula returns.",
        "a ≤ 1.25·b per AISC §9; the solver checks this and returns NOT_COMPUTED if violated. Outside this range, prying is so large that the connection is impractical.",
        "Per-bolt tributary width w is user-supplied. For a single bolt in a T-stub, w is typically the bolt spacing perpendicular to the load. For the outermost bolt, w = bolt_spacing / 2 (half on each side).",
        "Flange material is the FIRST plate in the joint; the stem is implicit. A more sophisticated solver would identify the flange vs stem explicitly via a 'role' tag on the plate.",
        "The solver does NOT verify that B + Q is below the bolt's tension capacity (joint.bolt-tension). The user should compare governingEffectiveTension to the per-bolt tension capacity to confirm the connection has adequate prying margin.",
        "Prying action is highly sensitive to the flange thickness. A 1mm increase in t can reduce prying by 5-10% (since Q scales as t²). The solver's output is only as accurate as the user's t input.",
      ],
      covers,
    };
  },
});
