// server/lib/conkay/physics/solvers/tub-fit.js
//
// package.tub-fit: does the structural tub (structural/car-tub.js) fit the
// car? Two checks, both computed:
//   envelopes  every tub part's walls (a hollow box is its four walls) against
//              every packaging envelope: occupant boxes of every checked
//              percentile in every seat, front seat envelopes, components
//              with dimensions, tyres with their steering sweep, the steering
//              wheel, and each occupant's egress line (separating-axis test,
//              package.interference's);
//   skin       every part's outer box inside the CAD body solid, with
//              clearance to the inner face of the skin (OCC: corner
//              classification + BRepExtrema distance to the outer shell, minus
//              the skin thickness; cad/tub_fit_occ.py).
//   openings   (when the tub carries them, structural/car-openings.js) each
//              occupant's egress line through its door aperture, no credited
//              sheet or member across a glazing opening, the service cut-outs
//              inside the firewall sheet and clear of each other; the clear
//              height over the H-point vs the seated head top is a warning
//              (no aperture requirement sourced; real entry involves ducking).
// FAIL on any interference, any part outside the skin, or a failed opening check.

import { registerSolver } from "../registry.js";
import { cadBodyRequest } from "./cad-body.js";
import { tubPackagingFit, tubPartBox } from "../../structural/car-tub.js";
import { bounds } from "../../packaging/geometry.js";
import { runTubFitKernel } from "../../cad/tub-fit-kernel.js";
import { checkOpenings } from "../../structural/car-openings.js";

const mm = (m) => Math.round(m * 1e4) / 10;

export const tubFit = registerSolver({
  id: "package.tub-fit",
  version: "1.1.0",
  domain: "packaging.structure",
  domains: ["packaging.structure"],
  fidelity: 2,
  method: "separating-axis test of each tub part's walls against the packaging envelopes and egress lines; OpenCascade classification + BRepExtrema distance of each part's box to the CAD body's outer shell, minus the skin thickness",
  reference: "server/lib/conkay/structural/car-tub.js (tubPackagingFit), server/lib/conkay/cad/tub_fit_occ.py",
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.vehicle?.packaging?.bodyShell && [...g.nodes.values()].some((p) => p.props?.role === "tub")).map((n) => n.id),
  run(ctx, veh) {
    const bodyId = ctx.get(veh, "props.vehicle.packaging.bodyShell");
    const q = cadBodyRequest(ctx, bodyId);
    if (q.notComputed) return { notComputed: q.notComputed };
    const all = [...ctx.graph.nodes.values()].filter((n) => n.props?.role === "tub").map((n) => ({ id: n.id, geometry: n.geometry, box: ctx.get(n.id, "props.tubBox") }));
    // a sheet that conforms to the skin's inner face has no box: it is checked against the body's own clearances below
    const conform = all.filter((p) => p.box?.conformsToSkin);
    const parts = all.filter((p) => !p.box?.conformsToSkin);
    const rows = tubPackagingFit(q.scene, parts.map((p) => ({ ...p, geometry: { ...p.geometry, wall: String(ctx.get(p.id, "geometry.wall") ?? "") } })));
    const body = ctx.result("cad.body", bodyId);
    if (!body || body.status === "NOT_COMPUTED" || body.status === "ERROR") return { notComputed: `the skin check needs the CAD body: cad.body@${bodyId} ${body?.status ?? "missing"}${body?.reason ? ` (${body.reason})` : ""}` };
    const step = body.outputs.files?.value?.step?.path;
    if (!step) return { notComputed: "the CAD body has no STEP file" };
    const skinThickness = ctx.get(bodyId, "geometry.thickness");
    const k = runTubFitKernel({ step, stepSha256: body.outputs.files.value.step.sha256 || null, skinThickness, boxes: parts.map(tubPartBox) });
    if (!k.ok) return { notComputed: k.pending ? k.reason : k.error };
    const failures = [];
    const margins = [];
    const conformRows = conform.map((p) => {
      const t = ctx.get(p.id, "geometry.thickness");
      const x0 = p.box.center[0] - p.box.half[0], x1 = p.box.center[0] + p.box.half[0];
      const heads = q.request.envelopes.filter((e) => /:head$/.test(e.id)).filter((e) => { const b = bounds(e); return b.max[0] > x0 && b.min[0] < x1; });
      const cl = body.outputs.clearances?.value || {};
      const worst = heads.reduce((w, e) => (Number.isFinite(cl[e.id]) && (!w || cl[e.id] < w.c) ? { id: e.id, c: cl[e.id] } : w), null);
      return { part: p.id, thicknessM: t, x: [x0, x1], against: worst?.id || null, bodyClearanceM: worst?.c ?? null, clearanceM: worst ? worst.c - skinThickness - t : null };
    });
    for (const r of conformRows) {
      if (r.clearanceM == null) { failures.push(`${r.part}: no head envelope clearance from cad.body under it`); continue; }
      margins.push({ check: `${r.part} (on the skin's inner face): head ${r.against} clearance to the outer surface - skin - sheet ≥ 0`, demand: 0, capacity: r.clearanceM, unit: "m" });
      if (r.clearanceM < 0) failures.push(`${r.part} would touch ${r.against}: ${mm(-r.clearanceM)} mm short`);
    }
    for (const r of rows) {
      margins.push({ check: `${r.part}: clearance to packaging envelopes (closest ${r.against}) ≥ 0`, demand: 0, capacity: r.minClearanceM, unit: "m" });
      if (r.minClearanceM < 0) failures.push(`${r.part} interferes with ${r.against} by ${mm(-r.minClearanceM)} mm`);
    }
    const chassis = [...ctx.graph.nodes.values()].find((n) => n.props?.tubOpenings);
    const openings = chassis ? ctx.get(chassis.id, "props.tubOpenings") : null;
    let openingRows = null;
    const warnings = [];
    if (openings) {
      const oc = checkOpenings(openings, ctx.get(chassis.id, "props.frameModel"), q.scene.scenarios);
      openingRows = oc.rows;
      failures.push(...oc.failures);
      warnings.push(...oc.warnings);
      margins.push(...oc.margins);
    }
    for (const r of k.rows) {
      if (!r.inside) failures.push(`${r.id} is outside the CAD body (${r.cornersOutside} corners outside, distance ${r.distanceM} m)`);
      else {
        margins.push({ check: `${r.id}: clearance to the skin's inner face ≥ 0`, demand: 0, capacity: r.clearanceM, unit: "m" });
        if (r.clearanceM < 0) failures.push(`${r.id} cuts into the skin by ${mm(-r.clearanceM)} mm`);
      }
    }
    return {
      inputs: { body: { value: { id: bodyId, step, skinThickness }, source: body.runId }, parts: { value: parts.length } },
      outputs: {
        envelopes: { value: rows, unit: "m", note: "minimum separation of each part's walls to any envelope (negative = interference)" },
        skin: { value: k.rows, unit: "m", note: "clearance = distance to the outer surface - skin thickness" },
        conforming: { value: conformRows, unit: "m", note: "sheets bonded to the skin's inner face: clearance = the body's clearance from the head envelopes under them to the outer surface (cad.body) - skin - sheet thickness" },
        kernel: { value: k.kernel },
        minEnvelopeClearanceM: { value: Math.min(...rows.map((r) => r.minClearanceM)), unit: "m" },
        minSkinClearanceM: { value: Math.min(...k.rows.map((r) => (r.inside ? r.clearanceM : -Infinity))), unit: "m" },
        ...(openings ? {
          openings: { value: { doors: openings.doors, glazing: openings.glazing, service: openings.service, cutouts: openings.cutouts }, note: "designed openings (structural/car-openings.js): door apertures as side-view outlines (x, z) in m, glazing openings by their corner nodes, service cut-outs" },
          openingChecks: { value: openingRows, note: "egress through each door aperture (clearances to the pillars, clear height over the H-point vs the seated head top), glazing kept clear of credited structure, service cut-outs' edge distances" },
        } : {}),
      },
      margins, failures, warnings,
      covers: [veh, ...parts.map((p) => p.id)],
      assumptions: [
        "Envelopes are the packaging model's boxes (occupant percentiles F5/F95/M95 in every seat, seat envelopes, components, tyre sweep) and each occupant's vertical egress line; the driveshaft (no envelope in the library) is not checked.",
        openings ? "Openings are checked against the structure and the egress lines; the skin is not trimmed at them, and door hinges, latches, seals and the doors themselves are not designed." : "Door apertures, glazing openings and service access are not designed: not checked.",
        "The skin is a uniform thickness inward of the CAD body's outer surface.",
      ],
    };
  },
});
