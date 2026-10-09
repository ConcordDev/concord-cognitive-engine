// server/lib/conkay/physics/solvers/packaging.js
//
// Occupant fit and packaging (packaging/checks.js on the layout in
// props.vehicle.packaging, compiler/car-layout.js):
//
// package.occupant-fit: ANSUR II percentile occupants (5th female, 95th
//   female, 95th male by default) in every seat: headroom and shoulder
//   clearance to the body shell, leg reach and seat-track fit (UMTRI seat
//   position model), rear knee clearance (SAE J1100 L48), hip and shoulder
//   room (W3, W4, W5, seat cushion width), steering wheel clearances (torso,
//   knee, air bag distance), pedal/foot clearance and entry height, plus SAE
//   J1100 Class A ranges. Every check carries its value, threshold and the
//   threshold's basis (sourced, geometric 0 mm, estimated with a method, or a
//   design choice). The J1100 dimensions are computed from the geometry.
// package.interference: component-component, component-occupant and
//   occupant-occupant clearances between the envelopes (separating-axis
//   gap; 6.35 mm around the TKX per its installation manual, else 0 mm).
//
// Components without published dimensions are listed as not checked, never
// assumed to fit.

import { registerSolver } from "../registry.js";
import { evaluatePackaging } from "../../packaging/checks.js";

const vehiclesWithPackage = (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle?.packaging).map((n) => n.id);

function evaluate(ctx, id) {
  const pkg = ctx.get(id, "props.vehicle.packaging");
  const shellId = pkg.bodyShell;
  const geom = ctx.get(shellId, "geometry");
  const pos = ctx.get(shellId, "position");
  if (!geom || geom.shape !== "ellipsoid-shell" || !pos) return { notComputed: `the cabin needs an ellipsoid-shell body (${shellId}) with a position` };
  const frontAxleX = ctx.get(id, "props.vehicle.frontAxleX");
  const rearAxleX = ctx.get(id, "props.vehicle.rearAxleX");
  if (!Number.isFinite(frontAxleX) || !Number.isFinite(rearAxleX)) return { notComputed: "needs frontAxleX and rearAxleX" };
  const centers = {};
  for (const n of [...pkg.components.map((c) => c.node), ...pkg.tyres.map((t) => t.node)]) centers[n] = ctx.get(n, "position");
  return evaluatePackaging({ pkg, centers, shell: { center: pos, size: [geom.length, geom.width, geom.height], thickness: geom.thickness }, frontAxleX, rearAxleX });
}

const r1 = (v) => Math.round(v * 10) / 10;
const describe = (c) => `${c.id}: ${c.value}${Array.isArray(c.threshold) ? "" : ` ${c.unit}`} vs ${Array.isArray(c.threshold) ? `${c.threshold[0]}-${c.threshold[1]}` : `${c.comparator} ${c.threshold}`} ${c.unit} (${c.thresholdBasis.state} threshold)`;

export const occupantFit = registerSolver({
  id: "package.occupant-fit",
  version: "1.0.0",
  domain: "package.ergonomics",
  domains: ["package.ergonomics", "package.occupant-fit"],
  fidelity: 1,
  method: "ANSUR II percentile occupants as seated boxes (torso line through the H-point, two-link legs), UMTRI seat-position model, body shell inner ellipsoid; SAE J1100 dimensions by definition",
  reference: "ANSUR II (NATICK/TR-15/007); SAE J1100 (2001); IIHS/UMTRI ATD positioning procedure v VI (2022)",
  targets: vehiclesWithPackage,
  run(ctx, id) {
    const e = evaluate(ctx, id);
    if (e.notComputed) return e;
    const pkg = ctx.get(id, "props.vehicle.packaging");
    const failures = e.failed.map((c) => `${describe(c)}${c.occupant ? ` [${c.occupant}${c.seat ? `, ${c.seat}` : ""}]` : ""}`);
    return {
      inputs: {
        occupants: { value: pkg.occupantKeys, source: "ANSUR II percentiles (server/lib/conkay/packaging/anthropometry.json)" },
        designChoices: { value: Object.fromEntries(Object.entries(pkg.designChoices).map(([k, v]) => [k, v.value])), source: "compiler/car-layout.js LAYOUT_DESIGN_CHOICES (each with its basis)" },
        vehicle: { value: e.vehicle },
      },
      outputs: {
        checks: { value: e.checks },
        j1100: { value: e.j1100 },
        seating: { value: e.seating },
        occupants: { value: e.occupants },
        vehicleDimensions: { value: e.vehicle },
        referenceVehicle: { value: pkg.referenceVehicle },
        notChecked: { value: pkg.notChecked },
        passCount: { value: e.checks.filter((c) => c.pass).length },
        failCount: { value: e.failed.length },
      },
      covers: [id, ...(pkg.seats || [])],
      failures,
      warnings: e.warnings,
      assumptions: [
        "Each percentile is taken dimension by dimension: no real person is 5th or 95th in every dimension at once.",
        "ANSUR II is soldiers measured barefoot in minimal clothing: no shoe, clothing or helmet allowance.",
        "H-point offsets from the Hybrid III 50th male scaled by sitting height (estimated).",
        "Rear occupants sit with a vertical shin, heel on the floor; feet under the front seat are not modelled.",
        ...e.notes,
      ],
    };
  },
});

export const interference = registerSolver({
  id: "package.interference",
  version: "1.0.0",
  domain: "package.interference",
  fidelity: 1,
  method: "oriented-box separating-axis gaps between component, seat and occupant envelopes (a lower bound on the true distance); front tyres swept over the steering lock",
  targets: vehiclesWithPackage,
  run(ctx, id) {
    const e = evaluate(ctx, id);
    if (e.notComputed) return e;
    const pkg = ctx.get(id, "props.vehicle.packaging");
    const failures = e.interferences.map((p) => `${p.a} / ${p.b}${p.scenario ? ` (${p.scenario} occupants)` : ""}: ${p.separationMm < 0 ? `overlap ${r1(-p.separationMm)} mm` : `gap ${p.separationMm} mm`} vs ${p.minClearanceMm} mm minimum (${p.thresholdBasis.state})`);
    return {
      inputs: {
        components: { value: pkg.components.map((c) => ({ id: c.id, componentId: c.component, half: c.half, dims: c.dims, placement: c.placement })) },
        tyres: { value: pkg.tyres },
        steeringLock: { value: pkg.steeringLock },
      },
      outputs: {
        pairsChecked: { value: e.pairs.length },
        interferences: { value: e.interferences },
        closest: { value: [...e.pairs].sort((a, b) => a.separationMm - b.separationMm).slice(0, 15) },
        shellProtrusions: { value: e.protrusions },
        notChecked: { value: pkg.notChecked },
      },
      failures,
      warnings: [...e.warnings, ...(pkg.notChecked.length ? [`Not checked (no dimensions): ${pkg.notChecked.map((n) => n.item).join(", ")}.`] : [])],
      assumptions: ["An overlap reported is a real overlap of the two boxes (the separating-axis test is exact for that); a positive gap is a lower bound on the true distance. Components are boxes around their published overall dimensions (a tyre: its bounding box).", "No suspension travel envelope: S550 wheel travel is not published."],
    };
  },
});
