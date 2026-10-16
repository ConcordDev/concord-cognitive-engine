// server/lib/conkay/physics/solvers/show-solid.js
//
// cad.show-solid (visual polish c): the design-surface apertures cut into a
// COPY of the analysed body (opt-in: props.vehicle.showSolid = true), with the re-checks that decide whether the cut
// copy is still the car the other solvers analysed. It is a preview: no other
// solver reads it; cad.body stays the physics body.
//
// Re-checks (receipts in the outputs):
//   packaging — every envelope's exact clearance to the outer surface of the
//     reassembled body (show ∪ panes) against the same requirement cad.body
//     used (skin offset, or the skin thickness for structure), the entry
//     points inside it, and the J1100 rays against cad.body's;
//   conservation and validity — V(body) = V(show) + ΣV(panes) + ΣV(grooves)
//     within 1 cm³, both solids valid and closed;
//   stiffness — the tub frame model credits the skin nowhere except the roof
//     liner bonded to its inner face: no glass may sit over that liner;
//     structure.frame's torsional stiffness is reported as it stands;
//   aero — the reassembled frontal area against cad.body's (equal within the
//     slicing method's stated error), aero.drag-buildup's range as it stands,
//     and the door-gap increment NOT computed (gaps are not modelled by the
//     drag build-up and no cited coefficient is used).

import { registerSolver } from "../registry.js";
import { cadBodyRequest } from "./cad-body.js";
import { runShowKernel, showApertures, SHOW_CHOICES } from "../../cad/show-solid.js";
import { readStlFile, cadSkinSolid } from "../../assembly/cad-skin.js";
import { surfaceOverlays } from "../../assembly/surface-overlays.js";
import { TORSION_TARGET } from "../../structural/car-tub.js";

// opt-in (props.vehicle.showSolid === true): the cut is minutes of kernel time and a preview, so it never runs unasked
const vehicles = (g) => [...g.nodes.values()]
  .filter((n) => n.props?.vehicle?.packaging && n.props.vehicle.showSolid === true && [...g.nodes.values()].some((c) => c.props?.tubOpenings))
  .map((n) => n.id);
const mm = (m) => Math.round(m * 1e4) / 10;
export const CONSERVATION_TOL_M3 = 1e-6;
const CLEARANCE_TOL = 1e-5; // the cad.body kernel's own shortfall tolerance (0.01 mm)

export const showSolidSolver = registerSolver({
  id: "cad.show-solid",
  version: "1.0.0",
  domain: "cad.show-solid",
  domains: ["cad.show-solid"],
  fidelity: 1,
  method: "OpenCascade booleans on a copy of the cad.body STEP: each glass or lamp aperture is the slab of the body inside the aperture prism between the skin and the skin shifted inward by the pane depth (body ∩ prism − translate(body)); door gaps are grooves of the same construction; then the body kernel's exact clearance, ray and frontal-area measurements on show ∪ panes",
  reference: "server/lib/conkay/cad/conkay_show_occ.py",
  targets: vehicles,
  run(ctx, veh) {
    const pkg = ctx.get(veh, "props.vehicle.packaging");
    const shellId = pkg?.bodyShell;
    if (!shellId || ctx.get(shellId, "geometry")?.shape !== "cad-body") return { notComputed: "the body shell is not a cad.body solid" };
    const body = ctx.result("cad.body", shellId);
    if (!body || !["PASS", "WARN"].includes(body.status)) return { notComputed: `cad.body has no accepted solid (${body?.status || "not run"}${body?.reason ? `: ${body.reason}` : ""})` };
    const files = body.outputs?.files?.value || {};
    if (!files.step?.path || !files.stl?.path) return { notComputed: "cad.body wrote no STEP and STL to cut" };
    const ds = ctx.result("cad.design-surface", veh);
    const layers = ds?.outputs?.layers?.value;
    if (!layers) return { notComputed: `cad.design-surface has no layers (${ds?.status || "not run"})` };
    const q = cadBodyRequest(ctx, shellId);
    if (q.notComputed) return q;

    let solid;
    try {
      solid = cadSkinSolid(readStlFile(files.stl.path));
    } catch (e) {
      return { notComputed: `the body STL could not be read: ${e instanceof Error ? e.message : String(e)}` };
    }
    const { apertures, skipped } = showApertures(layers, solid);
    const request = {
      command: "show",
      step: files.step.path,
      stepSha256: files.step.sha256 || body.outputs?.kernel?.value?.requestHash || null,
      apertures,
      envelopes: q.request.envelopes,
      points: q.request.points,
      rays: q.request.rays,
      params: { meshLinear: q.request.params?.meshLinear, meshAngular: q.request.params?.meshAngular },
      frontalSlices: q.request.params?.frontalSlices,
    };
    const r = runShowKernel(request);
    if (!r.ok) return { notComputed: r.pending ? r.reason : r.unavailable || r.error };

    const failures = [];
    const warnings = [];

    // validity and conservation
    if (!r.show.valid || !r.show.closed) failures.push(`the show solid is not one valid closed solid (valid ${r.show.valid}, ${r.show.solids} solids, ${r.show.freeEdges} free edges)`);
    if (!r.reassembled.valid || !r.reassembled.closed) failures.push("show ∪ panes is not one valid closed solid");
    if (!(Math.abs(r.volumes.conservationM3) <= CONSERVATION_TOL_M3)) failures.push(`volume not conserved: V(body) − V(show) − V(panes) − V(grooves) = ${r.volumes.conservationM3} m³ (tolerance ${CONSERVATION_TOL_M3} m³)`);
    for (const a of r.apertures) {
      if (!(a.volumeM3 > 0)) warnings.push(`${a.id}: the aperture prism removed nothing from the body (it misses the skin)`);
      if (!a.valid) failures.push(`${a.id}: the cut piece is not a valid solid`);
    }

    // packaging: the same requirement cad.body used, on the reassembled body
    const skin = q.geometry.skinOffset;
    const need = Object.fromEntries(q.request.envelopes.map((e) => [e.id, e.offsetM ?? skin]));
    const before = body.outputs?.clearances?.value || {};
    const rows = r.clearances.filter((c) => c.enclose).map((c) => ({ id: c.id, kind: c.kind, needM: need[c.id] ?? skin, beforeM: before[c.id] ?? null, afterM: c.clearanceM, deltaM: before[c.id] != null ? Math.round((c.clearanceM - before[c.id]) * 1e6) / 1e6 : null }));
    const short = rows.filter((x) => x.afterM < x.needM - CLEARANCE_TOL);
    for (const s of short) failures.push(`packaging: ${s.id} is ${mm(s.afterM)} mm from the outer surface of the cut body vs >= ${mm(s.needM)} mm (was ${s.beforeM != null ? mm(s.beforeM) : "?"} mm)`);
    const outside = r.points.filter((p) => !p.inside);
    for (const p of outside) failures.push(`packaging: entry point ${p.id} is no longer inside the body`);
    const raysBefore = body.outputs?.rays?.value || {};
    const rayRows = r.rays.map((x) => ({ id: x.id, beforeM: raysBefore[x.id] ?? null, afterM: x.distanceM, deltaM: raysBefore[x.id] != null && x.distanceM != null ? Math.round((x.distanceM - raysBefore[x.id]) * 1e6) / 1e6 : null, firstGlass: r.rayFirstGlass?.[x.id] || null }));
    const moved = rayRows.filter((x) => x.deltaM != null && Math.abs(x.deltaM) > 1e-4);
    for (const m of moved) warnings.push(`J1100 ray ${m.id}: ${mm(m.beforeM)} → ${mm(m.afterM)} mm on the cut body`);
    const worst = rows.reduce((a, c) => (a == null || c.afterM - c.needM < a.afterM - a.needM ? c : a), null);

    // stiffness: no glass over skin the frame model credits (the bonded roof liner)
    const chassis = [...ctx.graph.nodes.values()].find((n) => n.props?.tubOpenings);
    const bonded = [...ctx.graph.nodes.values()].filter((n) => n.props?.tubBox?.conformsToSkin).map((n) => ({ id: n.id, box: n.props.tubBox }));
    const glassOverlay = surfaceOverlays({ glazing: layers.glazing, panelCuts: [], lamps: { state: "not placed" }, wheelArches: { arches: [] } }, solid);
    const overBonded = [];
    for (const b of bonded) {
      const [cx, cy] = b.box.center, [hx, hy] = b.box.half;
      for (const g of glassOverlay?.glass || []) {
        let n = 0;
        for (let i = 0; i < g.positions.length; i += 3) {
          if (Math.abs(g.positions[i] - cx) <= hx && Math.abs(g.positions[i + 1] - cy) <= hy && g.positions[i + 2] > b.box.center[2] - 0.05) n++;
        }
        if (n) overBonded.push({ part: b.id, glass: g.id, points: n });
      }
    }
    for (const o of overBonded) failures.push(`stiffness: ${o.glass} lies over ${o.part}, which the frame model credits as bonded to the skin (${o.points} glass points over it)`);
    const frame = chassis ? ctx.result("structure.frame", chassis.id) : null;
    const k = frame?.outputs?.["stiffness.torsional"];
    const stiffness = {
      state: k ? "computed" : "not computed",
      perDegree: k?.perDegree ?? null,
      targetPerDegree: TORSION_TARGET.perDegree,
      frameStatus: frame?.status || null,
      bondedToSkin: bonded.map((b) => b.id),
      glassOverBonded: overBonded,
      note: "The tub frame model credits no skin except parts bonded to its inner face (conformsToSkin). The apertures remove skin only, and none over a bonded part, so structure.frame's model is unchanged: its torsional stiffness stands as reported.",
    };

    // aero: outer shape conserved except the door grooves
    const fBody = body.outputs?.frontalArea?.value;
    const fShow = r.metrics.frontalAreaM2;
    const fTol = (r.metrics.frontalMaxUnderestimateM2 || 0) + 1e-4;
    if (Number.isFinite(fBody) && Math.abs(fShow - fBody) > fTol) failures.push(`aero: frontal area ${fShow} m² on the cut body vs ${fBody} m² (beyond the ${fTol} m² slicing error)`);
    const aero = ctx.result("aero.drag-buildup", veh);
    const cd = aero?.outputs?.dragCoefficient?.value;
    warnings.push("aero: the door-gap drag increment is not computed (aero.drag-buildup does not model gaps, and no cited gap coefficient is used)");

    return {
      inputs: {
        body: { value: { step: files.step.path, stl: files.stl.path, kernelRequestHash: body.outputs?.kernel?.value?.requestHash || null }, source: "cad.body" },
        apertures: { value: apertures.map((a) => ({ id: a.id, kind: a.kind, dir: a.dir, depthM: a.depthM, ...(a.gapWidthM ? { gapWidthM: a.gapWidthM } : {}) })), source: "cad.design-surface layers, projected as in assembly/surface-overlays.js" },
        choices: { value: SHOW_CHOICES },
      },
      outputs: {
        role: { value: "preview", note: "A cut copy of the analysed body for presentation. No other solver reads it; cad.body stays the physics body." },
        apertures: { value: r.apertures },
        skipped: { value: skipped },
        volumes: { value: r.volumes, unit: "m3", basis: `GProp volume integration at ${r.volumes.integrationEps} relative tolerance` },
        solid: { value: { show: r.show, reassembled: r.reassembled } },
        packaging: { value: { rows, short: short.map((s) => s.id), entryPointsOutside: outside.map((p) => p.id), worst } },
        rays: { value: rayRows, unit: "m", note: "J1100 rays from cad.body's request, re-measured on show ∪ panes; firstGlass names a pane the ray first meets (geometry only: no vision verdict)" },
        stiffness: { value: stiffness },
        aero: { value: { frontalAreaBodyM2: fBody ?? null, frontalAreaShowM2: fShow, toleranceM2: fTol, dragBuildup: cd ? { low: cd.low, centre: cd.centre, high: cd.high, status: aero.status } : { state: "not computed", reason: aero?.reason || "no aero.drag-buildup result" }, doorGapIncrement: { state: "not computed", reason: "gaps are not modelled by aero.drag-buildup; no cited coefficient is used" } } },
        files: { value: r.files },
        kernel: { value: { ...r.kernel, requestHash: r.requestHash } },
      },
      margins: worst ? [{ check: `closest envelope (${worst.id}) to the cut body's outer surface >= its requirement`, demand: worst.needM, capacity: worst.afterM, unit: "m" }] : [],
      failures,
      warnings,
      covers: [veh, shellId],
      assumptions: [
        "The show solid is a copy of cad.body's solid with apertures cut in; cad.body is not modified and every other solver reads cad.body.",
        "Glass and lamp panes refill their apertures exactly (show ∪ panes = body − door grooves), so the outer shape is unchanged except the grooves.",
        "Pane depth, lamp depth, gap width and gap depth are design choices for the show model, not sourced specifications.",
      ],
    };
  },
});
