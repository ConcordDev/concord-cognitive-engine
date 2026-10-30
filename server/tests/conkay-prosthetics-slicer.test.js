// server/tests/conkay-prosthetics-slicer.test.js
// Q50/A#30/B#26 — emitBioprintToolpath used to ignore the mesh and
// draw fixed concentric circles (radius shrinking a flat 25% over the
// print) with self-declared "stub" telemetry. These tests pin the real
// slicer: layer contours are the mesh's actual cross-sections.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildParametricSocket,
  sliceMeshAtY,
  chainSegments,
  emitBioprintToolpath,
} from "../lib/conkay/verticals/prosthetics.js";

function contourAt(mesh, y) {
  const contours = chainSegments(sliceMeshAtY(mesh.positions, mesh.indices, y));
  assert.equal(contours.length, 1, `expected exactly 1 contour at y=${y}`);
  return contours[0];
}
function meanRadius(contour) {
  const rs = contour.points.map(([x, z]) => Math.hypot(x, z));
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}
function perimeter(contour) {
  const pts = contour.points;
  const seq = contour.closed ? [...pts, pts[0]] : pts;
  let p = 0;
  for (let i = 1; i < seq.length; i++) p += Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][1] - seq[i - 1][1]);
  return p;
}

describe("prosthetics mesh slicer", () => {
  it("slices the parametric socket at its true interpolated radius", () => {
    const { mesh } = buildParametricSocket({}); // r: 30 (y=0) → 45 (y=120), rings every 12mm
    // Slice at y=66, a mid-ring plane (ring planes are degenerate by
    // construction — every vertex sits on the plane there).
    const mid = contourAt(mesh, 66);
    assert.equal(mid.closed, true);
    // Linear taper → r(66) = 30 + 15 × (66/120) = 38.25.
    assert.ok(Math.abs(meanRadius(mid) - 38.25) < 0.6, `mean radius ${meanRadius(mid)}`);
    const per = perimeter(mid);
    assert.ok(Math.abs(per - 2 * Math.PI * 38.25) / (2 * Math.PI * 38.25) < 0.02, `perimeter ${per}`);
    // And the taper direction is the mesh's: wider at the top.
    assert.ok(meanRadius(contourAt(mesh, 114)) > meanRadius(contourAt(mesh, 6)));
  });

  it("slices an oval socket as an oval — not the old fixed circles", () => {
    const { mesh } = buildParametricSocket({ ovalFactor: 0.35 });
    const c = contourAt(mesh, 60);
    const xs = c.points.map((p) => Math.abs(p[0]));
    const zs = c.points.map((p) => Math.abs(p[1]));
    const extentX = Math.max(...xs);
    const extentZ = Math.max(...zs);
    assert.ok(Math.abs(extentX - extentZ) > 1.5, `extents X ${extentX} vs Z ${extentZ} should differ for an oval`);
  });

  it("slices a box mesh into its square cross-section", () => {
    // 20×40×20 box (x,y,z), 12 triangles, side faces only + caps.
    const v = [
      [-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10],
      [-10, 40, -10], [10, 40, -10], [10, 40, 10], [-10, 40, 10],
    ];
    const quads = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]];
    const positions = v.flat();
    const indices = [];
    for (const [a, b, c, d] of quads) indices.push(a, b, c, a, c, d);
    const mesh = { positions, indices };
    const c = contourAt(mesh, 20);
    assert.equal(c.closed, true);
    // 8 points: each face contributes two half-segments meeting at its
    // diagonal midpoint — collinear, so the perimeter is exact.
    assert.equal(c.points.length, 8);
    assert.ok(Math.abs(perimeter(c) - 80) < 1e-6, `perimeter ${perimeter(c)}`);
  });

  it("emits a toolpath whose per-layer perimeters follow the mesh taper", () => {
    const { mesh } = buildParametricSocket({});
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-"));
    const tool = emitBioprintToolpath(mesh, { outDir, layerHeight: 12 });
    assert.equal(tool.ok, true);
    assert.equal(tool.slicedLayers, 10);
    assert.equal(tool.skippedLayers, 0);
    const telemetry = JSON.parse(fs.readFileSync(tool.telemetryPath, "utf8"));
    assert.equal(telemetry.honesty.stub, false);
    assert.equal(telemetry.honesty.source, "sliced_mesh_toolpath");
    const per = telemetry.layers.map((l) => l.perimeterMm);
    // Real taper widens toward the top — the old synthetic circles shrank.
    assert.ok(per[per.length - 1] > per[0], `perimeters ${per[0]} → ${per[per.length - 1]}`);
    // First layer slices near y=6 → r ≈ 30.75 → perimeter ≈ 2πr.
    assert.ok(Math.abs(per[0] - 2 * Math.PI * 30.75) / (2 * Math.PI * 30.75) < 0.03, `first perimeter ${per[0]}`);
    // Extrusion accumulates monotonically and the G-code carries travel moves.
    const es = telemetry.layers.map((l) => l.extrusionE);
    assert.ok(es.every((v, i) => i === 0 || v > es[i - 1]));
    const gcode = fs.readFileSync(tool.gcodePath, "utf8");
    assert.ok(gcode.includes("; travel"));
    assert.ok(gcode.includes("sliced from the supplied mesh"));
  });

  it("refuses an empty mesh instead of emitting an empty toolpath as ok", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-"));
    const tool = emitBioprintToolpath({ positions: [], indices: [] }, { outDir });
    assert.equal(tool.ok, false);
    assert.equal(tool.code, "NO_MESH");
  });
});
