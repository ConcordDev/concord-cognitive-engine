// server/lib/conkay/physics/solvers/cad-body.js
//
// cad.body: the vehicle's exterior as a real CAD solid (OpenCascade, via
// cad/conkay_body_occ.py). Cross-sections are solved around every packaging
// envelope (occupants of every checked percentile in every seat, the front
// seats, the components with dimensions) inflated by the skin offset, plus
// wheel wells sized for the tyres' steering sweep, then lofted into a closed
// B-spline solid. Outputs: surface area, volume, projected frontal area, the
// overall dimensions, every envelope's clearance to the outer surface, the
// J1100 measurement rays, and STEP / STL / GLB files. The parameters are the
// BODY_SHELL node's geometry (cad/body-params.js), editable in the design
// graph. Fails on an invalid or open solid, an envelope closer to the outer
// surface than the skin offset, or a tyre touching the body.

import { registerSolver } from "../registry.js";
import { packageScene, packageEnvelopes, packageRays } from "../../packaging/checks.js";
import { runBodyKernel } from "../../cad/body-kernel.js";
import { CAD_BODY_BASIS, CAD_BODY_OPTIONAL } from "../../cad/body-params.js";

const bodies = (g) => [...g.nodes.values()].filter((n) => n.geometry?.shape === "cad-body").map((n) => n.id);
const mm = (m) => Math.round(m * 1e4) / 10;
const KERNEL_PARAMS = ["skinOffset", "thickness", ...CAD_BODY_OPTIONAL.lengths.filter((k) => k !== "inletAllowance"), ...CAD_BODY_OPTIONAL.numbers];
// Entry header points sit this far inside the outer surface beyond the skin thickness (loft tolerance between sections).
const HEADER_TOLERANCE_M = 0.002;

/** The kernel request for body `id` (or { notComputed }). */
export function cadBodyRequest(ctx, id) {
  const veh = ctx.get(id, "props.body.vehicle");
  if (!veh) return { notComputed: "props.body.vehicle names no vehicle" };
  const pkg = ctx.get(veh, "props.vehicle.packaging");
  if (!pkg) return { notComputed: `${veh} has no packaging layout (props.vehicle.packaging): nothing to wrap the body around` };
  const g = ctx.get(id, "geometry");
  const centers = {};
  for (const n of [...pkg.components.map((c) => c.node), ...pkg.tyres.map((t) => t.node)]) centers[n] = ctx.get(n, "position");
  const scene = packageScene({ pkg, centers });
  const envelopes = packageEnvelopes(scene).map((e) => ({ ...e, center: e.center.map(Number), half: e.half.map(Number) }));
  // air-inlet / duct allowance: a slab of the radiator's face, inletAllowance deep, ahead of it (forward = -x)
  const rad = envelopes.find((e) => e.id === "RADIATOR");
  if (rad && g.inletAllowance > 0) {
    const d = g.inletAllowance / 2;
    envelopes.push({ ...rad, id: "INLET_ALLOWANCE", kind: "allowance", center: [rad.center[0] - rad.half[0] - d, rad.center[1], rad.center[2]], half: [d, rad.half[1], rad.half[2]] });
  }
  const points = [];
  for (const [key, occ] of Object.entries(scene.scenarios)) {
    for (const o of occ) {
      const s = Math.sign(o.landmarks.y) || 1;
      points.push({ id: `entry:${o.seat}:${key}`, p: [o.landmarks.hPoint[0], s * o.entry.yOut, o.landmarks.hPoint[1] + o.entry.need + g.thickness + HEADER_TOLERANCE_M] });
    }
  }
  const params = Object.fromEntries(KERNEL_PARAMS.filter((k) => g[k] != null).map((k) => [k, g[k]]));
  return { request: { command: "body", params, envelopes, points, wheels: scene.wheels, rays: packageRays(scene), exports: ["step", "stl", "glb"] }, scene, vehicle: veh, geometry: g };
}

export const cadBody = registerSolver({
  id: "cad.body",
  version: "1.1.0",
  domain: "cad.body",
  domains: ["cad.body", "package.body"],
  fidelity: 2,
  method: "OpenCascade (OCP) B-spline loft through superellipse cross-sections solved around the packaging envelopes inflated by the skin offset (each section the smooth union of a lower body, a greenhouse with tumblehome and one fender pod per wheel; per-station minimum-area belt line, then rolling-disc and Gaussian smoothing of belt, plan, roof and floor lines, a fastback limit on the roof, a pointed nose and a Kamm tail), then faired: each section's radius field smoothed along and around the car between the solved section (inside bound), the floor and the width bound, the nose and tail blended with C1 scale laws, and the surface fitted along the car by a least-squares cubic B-spline on fewer control points (control points clamped to the floor); wheel wells cut for the tyres' steering sweep; fairness measured as the normal-curvature inflections and RMS dk/ds of the surface; area/volume by GProp, frontal area by slicing the kernel's tessellation, clearances by BRepExtrema + solid classification",
  reference: "server/lib/conkay/cad/conkay_body_occ.py",
  targets: bodies,
  run(ctx, id) {
    const q = cadBodyRequest(ctx, id);
    if (q.notComputed) return q;
    const r = runBodyKernel(q.request);
    if (!r.ok) return { notComputed: r.pending ? r.reason : r.unavailable || r.error };
    const g = q.geometry;
    const skin = g.skinOffset;
    const failures = [];
    const warnings = [];
    if (!r.solid.valid) failures.push("the body solid is not valid (BRepCheck_Analyzer)");
    if (!r.solid.closed) failures.push(`the body is not one closed solid (${r.solid.solids} solids, ${r.solid.freeEdges} free edges)`);
    if (g.maxWidth != null && r.metrics.widthM > g.maxWidth + 1e-6) failures.push(`overall width ${mm(r.metrics.widthM)} mm exceeds the ${mm(g.maxWidth)} mm bound (design choice): the tyres and envelopes need it at this track${r.fairing?.adjustments?.length ? " (the fairing's width cap was tightened as far as the requirements allow)" : ""}`);
    const enc = r.clearances.filter((c) => c.enclose);
    const short = enc.filter((c) => c.clearanceM < skin - 1e-5);
    for (const c of short) failures.push(`${c.id}: ${mm(c.clearanceM)} mm to the outer surface vs >= ${mm(skin)} mm skin offset (design choice)${c.inside ? "" : " — outside the body"}`);
    for (const w of r.wheels) {
      if (w.minClearanceM < 0) failures.push(`${w.id}: the tyre${w.steerDeg ? ` (over +/-${w.steerDeg} deg of steer)` : ""} intersects the body (${mm(w.minClearanceM)} mm)`);
      else if (w.minClearanceM < g.archClearance - 5e-4) warnings.push(`${w.id}: ${mm(w.minClearanceM)} mm from the tyre to the body, under the ${mm(g.archClearance)} mm arch clearance`);
    }
    const worst = enc.reduce((a, c) => (a == null || c.clearanceM < a.clearanceM ? c : a), null);
    const m = r.metrics;
    const rays = Object.fromEntries(r.rays.map((x) => [x.id, x.distanceM]));
    return {
      inputs: {
        parameters: { value: Object.fromEntries(KERNEL_PARAMS.filter((k) => g[k] != null).map((k) => [k, g[k]])), basis: CAD_BODY_BASIS, source: `${id}.geometry (design graph)` },
        envelopes: { value: q.request.envelopes.length, note: "occupant boxes (every checked percentile, every seat), front seat envelopes, components with dimensions, steering wheel" },
        headerPoints: { value: q.request.points.length, note: "entry: the roof at each occupant's outboard shoulder line must clear the seated head-top height above the H-point (estimated threshold) plus the skin thickness" },
        wheels: { value: q.request.wheels },
      },
      outputs: {
        surfaceArea: { value: m.surfaceAreaM2, unit: "m2", basis: "computed (kernel GProp, outer skin incl. wheel-well surfaces)" },
        volume: { value: m.volumeM3, unit: "m3", basis: "computed (kernel GProp, enclosed volume)" },
        frontalArea: { value: m.frontalAreaM2, unit: "m2", basis: `computed: projection onto the y-z plane, ${m.frontalSlices} horizontal slices of the kernel tessellation (chordal deviation ${m.frontalMeshLinearM != null ? `${mm(m.frontalMeshLinearM)} mm` : "n/a"}: inscribed, so low by at most ${m.frontalMaxUnderestimateM2 ?? "n/a"} m2 plus the slicing error; body only: tyres, mirrors and underbody parts outside it are not in it)` },
        surfaceCentroid: { value: m.surfaceCentroid, unit: "m" },
        dimensions: { value: { lengthM: m.lengthM, widthM: m.widthM, heightM: m.heightM, groundClearanceM: m.groundClearanceM, bbox: m.bbox, extentBrackets: m.extentBrackets ?? null }, basis: "computed: bracketed extents of the solid (cad/extents_occ.py): each a point on the surface, with an outer bound; BRepBndLib's box alone can sit outside the surface" },
        solid: { value: r.solid },
        sections: { value: r.sections, note: "per station x: floor zb, belt (greenhouse base) deck, lower-body half width W and top lowerTop, greenhouse half width Wg and roof zt, and each fender pod's blend t, crown height and outer half width uOut (m); nose and tail sections carry their scale factors" },
        clearances: { value: Object.fromEntries(r.clearances.map((c) => [c.id, c.clearanceM])), unit: "m" },
        minClearance: { value: worst ? { id: worst.id, m: worst.clearanceM } : null },
        wheels: { value: r.wheels },
        rays: { value: rays, unit: "m", note: "distance from each J1100 ray origin to the outer surface" },
        thickness: { value: g.thickness, unit: "m" },
        skinOffset: { value: skin, unit: "m" },
        iterations: { value: r.iterations },
        fairness: r.fairness ? { value: r.fairness, unit: "1/m (curvature), 1/m2 (dk/ds)", basis: "computed: normal curvature of the kernel's B-spline side surface on a parameter grid (nose / body / tail regions split at the first and last packaging stations); surface quality only, says nothing about aerodynamics" } : undefined,
        fairing: r.fairing ? { value: r.fairing, note: "fairing receipt: passes, residual (m) of the inside bound, width cap, control points along the car, floor clamp of the fitted control points (m), width-cap adjustments" } : undefined,
        localInflation: { value: r.localInflationM },
        files: { value: r.files },
        kernel: { value: { ...r.kernel, requestHash: r.requestHash } },
      },
      margins: worst && worst.clearanceM > 0 ? [{ check: `closest envelope (${worst.id}) to the outer surface >= skin offset`, demand: skin, capacity: worst.clearanceM, unit: "m" }] : [],
      failures,
      warnings,
      covers: [id, q.vehicle],
      assumptions: [
        "The body is an outer skin only: no doors, glazing openings, pillars, sills or closures are designed; the cabin side of the skin is the outer surface minus the skin thickness.",
        "Wheel wells are cylinders around each axle: steered wells take the tyre's full swept radius; suspension travel is not published, so jounce is not in the wells.",
        "Envelopes are boxes (packaging/checks.js); the skin offset is a design choice.",
      ],
    };
  },
});
