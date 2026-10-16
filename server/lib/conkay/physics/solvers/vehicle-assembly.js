// server/lib/conkay/physics/solvers/vehicle-assembly.js
//
// assembly.vehicle: the parametric assembly for one vehicle. Reads the package
// layout, the tub openings and (when the kernel has finished) the body extents
// and the required power. Does not read drawing.ga.

import { registerSolver } from "../registry.js";
import { assemblyFromIr, fitStatus, fitText } from "../../assembly/build.js";
import { readStlFile, cadSkinMesh, cadSkinSolid } from "../../assembly/cad-skin.js";
import { buildPackagingSheet } from "../../drawings/ga-drawing.js";
import { toSvg } from "../../drawings/sheet.js";
import { keepContent } from "./ga-drawing.js";

const vehicles = (g) => [...g.nodes.values()].filter((n) => n.props?.vehicle?.packaging).map((n) => n.id);

export const vehicleAssembly = registerSolver({
  id: "assembly.vehicle",
  version: "1.0.0",
  domain: "assembly.vehicle",
  domains: ["assembly.vehicle"],
  fidelity: 1,
  method: "Parametric assembly in the design frame (x rearward, y right, z up): library envelopes, J826/J1100 occupants, J941 eyellipse, tub openings, a lofted viewing surface fitted to the solved size. Fit checks report pass, warn or fail.",
  reference: "server/lib/conkay/assembly/build.js",
  targets: vehicles,
  run(ctx, veh) {
    const pkg = ctx.get(veh, "props.vehicle.packaging");
    const bodyId = pkg?.bodyShell;
    const body = bodyId ? ctx.result("cad.body", bodyId) : null;
    const bbox = body?.status === "PASS" || body?.status === "WARN" ? body.outputs?.dimensions?.value?.bbox : null;
    const power = ctx.result("vehicle.required-power", veh);
    const powerW = Number.isFinite(power?.outputs?.requiredPower?.value) ? power.outputs.requiredPower.value : null;
    const ir = {
      nodes: [...ctx.graph.nodes.values()].map((n) => ({
        id: n.id, kind: n.kind, name: n.name, material: n.material, geometry: n.geometry, position: n.position, props: n.props,
      })),
      edges: [],
    };
    // Touch the positions and the chassis openings so an edit invalidates this run.
    for (const id of ["TIRE_FL", "TIRE_FR", "TIRE_RL", "TIRE_RR", "ENGINE", "RADIATOR", "SEAT_1", "CHASSIS", "BODY_SHELL", veh]) {
      ctx.get(id, "position");
      ctx.get(id, "props");
    }
    // tub parts package.tub-fit found inside the analysed CAD solid by at least the skin's thickness: Studio's styled
    // surface is a preview, so missing it is a display gap for these, not a packaging failure
    const tf = bbox ? ctx.result("package.tub-fit", veh) : null;
    const verifiedInside = new Set((tf?.outputs?.skin?.value || []).filter((r) => r.inside && r.clearanceM >= 0).map((r) => r.id));
    // One body: when the kernel wrote its solid, Studio draws that solid (assembly/cad-skin.js)
    let cadSkin = null;
    const stl = bbox ? body.outputs?.files?.value?.stl : null;
    if (stl?.path) {
      try {
        const tris = readStlFile(stl.path);
        cadSkin = { mesh: cadSkinMesh(tris), solid: cadSkinSolid(tris), sha256: stl.sha256 || null, clearances: body.outputs?.clearances?.value || {}, skinOffset: ctx.get(bodyId, "geometry.skinOffset") };
      } catch (e) {
        cadSkin = null; // unreadable STL: the styled loft is drawn and labelled as such (surface.source "styling")
      }
    }
    const doc = assemblyFromIr(ir, { bodyBBox: bbox || null, powerW, verifiedInside, cadSkin });
    if (doc.error) return { notComputed: doc.error };
    const sheet = buildPackagingSheet(doc, {
      scale: 25,
      number: `CK-GA-${veh}`,
      revision: "assembly",
      modelHash: "0".repeat(64),
      status: "SCREENING - NOT FOR MANUFACTURE",
      generated: "Generated from assembly.vehicle",
      model: veh,
      title: "Packaging and occupant layout",
    });
    const svg = keepContent(`CK-PKG-${veh}-sheet3.svg`, toSvg(sheet, { drawing: `CK-PKG-${veh}`, sheet: 3 }));
    const status = fitStatus(doc.checks);
    return {
      inputs: {
        coordinateSystem: { value: doc.coordinateSystem },
        standards: { value: doc.standards, source: "J1100 / J941 / ANSUR II, see each row" },
        powerW: { value: powerW, source: "vehicle.required-power" },
      },
      outputs: {
        assembly: { value: doc },
        fit: { value: { status, text: fitText(doc.checks), checks: doc.checks } },
        sheet3: { value: svg, note: "A3 packaging sheet projected from the assembly" },
        wheelbaseMm: { value: sheet.projected.wheelbaseMm, unit: "mm", basis: "rear axle placement x minus front axle placement x" },
      },
      failures: status === "fail" ? doc.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.detail}`) : [],
      warnings: doc.checks.filter((c) => c.status === "warn").map((c) => `${c.id}: ${c.detail}`),
      covers: [veh],
      assumptions: [
        doc.verification.statement,
        doc.surface.source === "cad.body" ? "The drawn body is the OpenCascade solid (cad.body). Spoke count, lamp lenses, pedal pads and the caliper are geometric." : "The viewing loft is not the OpenCascade solid. Spoke count, lamp lenses, pedal pads and the caliper are geometric.",
        "SAE J287 hand-reach envelopes are not licensed and are not claimed.",
      ],
    };
  },
});
