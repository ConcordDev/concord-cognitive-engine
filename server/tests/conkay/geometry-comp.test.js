/**
 * SX-NUM-23 math.geometry-comp tests.
 *
 * Reference case (catalogue): the hull of the unit cube's
 * eight vertices — volume 1, surface area 6, all eight
 * vertices on the hull. Delaunay on a square + center: the
 * fan of 4 triangles, empty-circle verified. Point-in-
 * polygon pins the boundary verdict as its own answer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/geometry-comp.js";

const solver = getSolver("math.geometry-comp");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L2 with the cube reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.reference.includes("cube"));
});

test("reference case: hull of the cube vertices has volume 1 and area 6", () => {
  const cube = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) cube.push([x, y, z]);
  const r = run({ points: [...cube, [0.5, 0.5, 0.5]] }, "convex-hull-3d"); // center point must not appear
  assert.equal(r.status, "PASS", r.reason || JSON.stringify(r.outputs));
  assert.ok(Math.abs(r.outputs.volume - 1) < 1e-9, `volume ${r.outputs.volume}`);
  assert.ok(Math.abs(r.outputs.surfaceArea - 6) < 1e-9, `area ${r.outputs.surfaceArea}`);
  assert.equal(r.outputs.hullVertices.length, 8);
  assert.equal(r.outputs.containmentVerified, true);
});

test("2D hull: square plus interior and edge points; collinear set is a labelled segment", () => {
  const r = run({ points: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.5, 0]] }, "convex-hull-2d");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.hull.length, 4);
  assert.ok(Math.abs(r.outputs.area - 1) < 1e-12);
  assert.ok(Math.abs(r.outputs.perimeter - 4) < 1e-12);
  const line = run({ points: [[0, 0], [1, 1], [2, 2], [3, 3]] }, "convex-hull-2d");
  assert.equal(line.status, "WARN");
  assert.equal(line.outputs.degenerate, "segment");
});

test("delaunay: square + center fans into 4 triangles, empty-circle verified", () => {
  const r = run({ points: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]] }, "delaunay");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.triangleCount, 4);
  assert.equal(r.outputs.emptyCircleVerified, true);
});

test("point-in-polygon: boundary is its own verdict; closest pair and segment intersection agree with hand cases", () => {
  const square = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.equal(run({ polygon: square, point: [1, 1] }, "point-in-polygon").outputs.verdict, "inside");
  assert.equal(run({ polygon: square, point: [3, 1] }, "point-in-polygon").outputs.verdict, "outside");
  assert.equal(run({ polygon: square, point: [1, 0] }, "point-in-polygon").outputs.verdict, "boundary");

  const cp = run({ points: [[0, 0], [3, 4], [1, 1], [10, 10]] }, "closest-pair");
  assert.ok(Math.abs(cp.outputs.distance - Math.SQRT2) < 1e-12);

  const x = run({ p1: [0, 0], p2: [2, 2], p3: [0, 2], p4: [2, 0] }, "segment-intersection");
  assert.equal(x.outputs.type, "point");
  assert.deepEqual(x.outputs.point, [1, 1]);
  const none = run({ p1: [0, 0], p2: [1, 0], p3: [0, 1], p4: [1, 1] }, "segment-intersection");
  assert.equal(none.outputs.type, "none");
});

test("polygon booleans name the OCC engine tier", () => {
  const r = run({ points: [[0, 0], [1, 0], [1, 1]] }, "boolean");
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.startsWith("requires_engine_tier:occ"), r.reason);
});
