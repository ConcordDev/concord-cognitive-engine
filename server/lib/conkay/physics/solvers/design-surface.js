// server/lib/conkay/physics/solvers/design-surface.js
//
// cad.design-surface: the roadmap 5 item 1 layers, read off the car
// that is already in the graph, plus the headroom, egress, stiffness
// and drag those other solvers actually return. It does not reshape
// the body and it does not invent a number the other solver withheld.

import { registerSolver } from "../registry.js";
import { getComponent } from "../../components/index.js";
import { packageScene } from "../../packaging/checks.js";
import { checkOpenings } from "../../structural/car-openings.js";
import { TORSION_TARGET } from "../../structural/car-tub.js";
import { designSurface, metres } from "../../cad/design-surface.js";

const vehicles = (g) => [...g.nodes.values()]
  .filter((n) => n.props?.vehicle?.packaging && [...g.nodes.values()].some((c) => c.props?.tubOpenings))
  .map((n) => n.id);

function num(v) {
  const n = metres(v);
  return Number.isFinite(n) ? n : null;
}

function posOf(ctx, id) {
  const p = ctx.get(id, "position");
  if (!p) return null;
  const x = num(p.x), y = num(p.y), z = num(p.z);
  if (x == null || y == null || z == null) return null;
  return { x, y, z };
}

function bodyOf(ctx, veh) {
  const shellId = ctx.get(veh, "props.vehicle.packaging.bodyShell");
  const g = shellId ? ctx.get(shellId, "geometry") : null;
  if (!g || g.shape !== "cad-body") return { shape: g?.shape || null };
  const pick = (k) => num(g[k]);
  return {
    shape: "cad-body",
    noseTipHeightM: pick("noseTipHeight"),
    beltMinM: pick("beltMin"),
    beltMaxM: pick("beltMax"),
    archClearanceM: pick("archClearance"),
    fenderCoverM: pick("fenderCover"),
    noseExtensionM: pick("noseExtension"),
    fastbackDeg: pick("fastbackDeg"),
  };
}

function headroomOf(fit) {
  if (!fit || fit.status === "NOT_COMPUTED" || fit.status === "ERROR") {
    return { state: "not computed", reason: fit?.reason || fit?.error || "package.occupant-fit did not run" };
  }
  const checks = fit.outputs?.checks?.value || [];
  const rows = checks.filter((c) => /^headroom\.SEAT_[1-4]\.M95$/.test(c.id)).map((c) => ({
    id: c.id, value: c.value, unit: c.unit, pass: c.pass, threshold: c.threshold, thresholdBasis: c.thresholdBasis,
  }));
  return {
    state: rows.length ? "computed" : "not computed",
    reason: rows.length ? "package.occupant-fit, occupant M95 (ANSUR II 95th percentile male) in each seat" : "no headroom.SEAT_*.M95 check on the occupant-fit result",
    shell: fit.outputs?.vehicleDimensions?.value?.overallHeight?.source || fit.outputs?.vehicleDimensions?.value?.overallLength?.source || null,
    rows,
    status: fit.status,
  };
}

function dragOf(aero, vehicle) {
  if (!aero) {
    return {
      state: "not computed",
      reason: vehicle?.dragCoefficientSource || "this build has no aero.drag-buildup target",
      labelledCd: vehicle?.dragCoefficient ?? null,
      labelled: "a labelled input, not a computed drag coefficient",
    };
  }
  if (aero.status === "NOT_COMPUTED" || aero.status === "ERROR" || !aero.outputs?.dragCoefficient) {
    return { state: "not computed", reason: aero.reason || aero.error || "aero.drag-buildup returned no coefficient" };
  }
  const cd = aero.outputs.dragCoefficient.value;
  return {
    state: "computed",
    solverVersion: aero.solver?.version || null,
    status: aero.status,
    low: cd.low, centre: cd.centre, high: cd.high,
    note: "aero.drag-buildup on this branch (version on the solver). The calibrated drag build-up is not on this branch. The skin was not reshaped, so this is the package's range. Not CFD.",
  };
}

function stiffnessOf(frame) {
  const k = frame?.outputs?.["stiffness.torsional"];
  if (!frame || frame.status === "NOT_COMPUTED" || frame.status === "ERROR" || !k) {
    return { state: "not computed", reason: frame?.reason || frame?.error || "structure.frame returned no torsional stiffness" };
  }
  return {
    state: "computed",
    status: frame.status,
    perDegree: k.perDegree,
    targetPerDegree: TORSION_TARGET.perDegree,
    targetLabel: TORSION_TARGET.label,
    surfaceCut: false,
    tubRecut: false,
    note: "structure.frame on the tub whose door and glazing openings are brief 4 item 2. This design-surface pass does not cut another hole, so the stiffness is that model's.",
  };
}

function roofOf(cad) {
  const h = cad?.outputs?.dimensions?.value?.heightM;
  if (!cad || cad.status === "NOT_COMPUTED" || cad.status === "ERROR" || !Number.isFinite(h)) return { heightM: null, fairness: null };
  return { heightM: h, fairness: cad.outputs?.fairness?.value || null };
}

export const designSurfaceSolver = registerSolver({
  id: "cad.design-surface",
  version: "1.0.0",
  domain: "cad.design-surface",
  domains: ["cad.design-surface"],
  fidelity: 1,
  method: "Door and glazing lines from the tub openings; lamp slots bounded by the nose-tip height and the belt line; wheel arches at the tyre radius plus the body's arch clearance; conflicts with the styling reference recorded and not applied",
  reference: "server/lib/conkay/cad/design-surface.js",
  targets: vehicles,
  run(ctx, veh) {
    const chassis = [...ctx.graph.nodes.values()].find((n) => n.props?.tubOpenings);
    const openings = chassis ? ctx.get(chassis.id, "props.tubOpenings") : null;
    if (!openings) return { notComputed: "the chassis has no tub openings" };
    const frameModel = ctx.get(chassis.id, "props.frameModel");
    const pkg = ctx.get(veh, "props.vehicle.packaging");
    const vehicle = ctx.get(veh, "props.vehicle");
    const tyres = (pkg?.tyres || []).map((t) => ({
      id: t.id,
      diameterM: t.diameterM,
      sectionWidthM: t.widthM,
      steered: Boolean(t.steered),
      component: t.component,
      position: posOf(ctx, t.node || t.id),
    }));
    const sample = tyres.find((t) => t.component);
    const tyreRecord = sample ? getComponent(sample.component) : null;
    const body = bodyOf(ctx, veh);

    const fit = ctx.result("package.occupant-fit", veh);
    const frame = ctx.result("structure.frame", chassis.id);
    const aero = vehicle?.dragCoefficientFrom ? ctx.result("aero.drag-buildup", veh) : null;
    const shellId = pkg?.bodyShell;
    const cad = body.shape === "cad-body" && shellId ? ctx.result("cad.body", shellId) : null;
    const roof = roofOf(cad);

    let egress = { state: "not computed", reason: "no packaging scene" };
    try {
      if (pkg && frameModel?.nodes) {
        const centers = {};
        for (const n of [...(pkg.components || []).map((c) => c.node), ...(pkg.tyres || []).map((t) => t.node)]) {
          const p = posOf(ctx, n);
          if (p) centers[n] = p;
        }
        const scene = packageScene({ pkg, centers });
        const checked = checkOpenings(openings, frameModel, scene.scenarios);
        const tall = checked.rows.filter((row) => row.occupant === "M95");
        egress = {
          state: "computed",
          failures: checked.failures,
          warnings: checked.warnings,
          tallMan: tall,
          note: "checkOpenings on the brief 4 item 2 apertures. M95 is the ANSUR II 95th percentile male. A duck warning is a short aperture, not a pass.",
        };
      }
    } catch (e) {
      egress = { state: "not computed", reason: e instanceof Error ? e.message : String(e) };
    }

    const surface = designSurface({
      openings, nodes: frameModel?.nodes || [], tyres, body, tyreRecord,
      recheck: {
        headroom: headroomOf(fit),
        egress,
        stiffness: stiffnessOf(frame),
        drag: dragOf(aero, vehicle),
        roofHeightM: roof.heightM,
        fairness: roof.fairness,
      },
    });

    const warnings = surface.conflicts.map((c) => `${c.id}: the styling reference was not copied. ${c.reference}`);
    if (egress.failures?.length) warnings.push(...egress.failures.map((f) => `egress: ${f}`));
    return {
      inputs: {
        reference: { value: surface.reference.file, note: surface.reference.dimensions },
        tyre: { value: tyreRecord?.id || null, source: tyreRecord?.dimensions?.source || null },
        skinTrimmed: { value: false },
      },
      outputs: {
        layers: { value: surface.layers },
        conflicts: { value: surface.conflicts },
        continuity: { value: surface.continuity },
        recheck: { value: surface.recheck },
      },
      warnings,
      assumptions: surface.assumptions,
      covers: [veh, chassis.id],
    };
  },
});
