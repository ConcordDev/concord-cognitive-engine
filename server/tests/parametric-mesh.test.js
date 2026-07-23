/**
 * Program C, Stage 2 — parametric mesh generator.
 *
 * Pins: determinism (pure function, no RNG), the closed-2-manifold
 * "watertightness" invariant (every directed edge appears once, its
 * reverse appears once on the neighbor — proven via known-primitive
 * analytic volumes: unit box, cylinder, cone, rhombus-cone), the
 * ring/segment vertex+triangle-count arithmetic, and a round-trip through
 * glb-bridge's packGLB → extractMeshData.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loftClosedTube,
  mergeMeshes,
  generateSwordMesh,
  generateSwordMeshWithNormals,
  HONESTY_NOTES,
} from "../lib/asset-gen/parametric-mesh.js";
import { packGLB, extractMeshData, computeVertexNormals } from "../lib/evo-asset/glb-bridge.js";

// ── Shared geometry helpers (test-local; independent re-derivation of the
// signed-volume formula so this file doesn't just re-check itself against
// its own production code's internal math) ─────────────────────────────────
function signedVolume(positions, indices) {
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const crossX = by * cz - bz * cy, crossY = bz * cx - bx * cz, crossZ = bx * cy - by * cx;
    vol += (ax * crossX + ay * crossY + az * crossZ) / 6;
  }
  return vol;
}

/** A mesh is a consistently-oriented closed 2-manifold iff every directed
 * edge (a,b) appears exactly once and its reverse (b,a) appears exactly
 * once (on the neighboring triangle). */
function directedEdgeInvariant(indices) {
  const dir = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = `${a}_${b}`;
      dir.set(key, (dir.get(key) || 0) + 1);
    }
  }
  let dupDirected = 0, missingReverse = 0;
  for (const [key, count] of dir) {
    if (count > 1) dupDirected++;
    const [a, b] = key.split("_");
    if (!dir.has(`${b}_${a}`)) missingReverse++;
  }
  return { dupDirected, missingReverse, directedEdgeCount: dir.size };
}

describe("loftClosedTube — known-primitive analytic volumes + manifold invariant", () => {
  it("unit box (rect profile, 2 stations) has volume 1 and is a clean manifold", () => {
    const box = loftClosedTube("rect", [
      { x: 0, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    assert.ok(Math.abs(signedVolume(box.positions, box.indices) - 1) < 1e-9);
    const inv = directedEdgeInvariant(box.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
    // 2 rings × 4 verts = 8 verts; 4 side quads (8 tris) + 2 caps (2 tris each) = 12 tris
    assert.equal(box.positions.length / 3, 8);
    assert.equal(box.indices.length / 3, 12);
  });

  it("cylinder (circle profile, high sides) volume converges to π·r²·h", () => {
    const cyl = loftClosedTube(
      "circle",
      [{ x: 0, halfWidth: 0.5, halfThickness: 0.5 }, { x: 2, halfWidth: 0.5, halfThickness: 0.5 }],
      { sides: 128 },
    );
    const expected = Math.PI * 0.25 * 2;
    assert.ok(Math.abs(signedVolume(cyl.positions, cyl.indices) - expected) / expected < 0.001);
    const inv = directedEdgeInvariant(cyl.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
  });

  it("cone (circle profile tapered to a point) volume converges to (1/3)·π·r²·h", () => {
    const cone = loftClosedTube(
      "circle",
      [{ x: 0, halfWidth: 0.5, halfThickness: 0.5 }, { x: 3, halfWidth: 0, halfThickness: 0 }],
      { sides: 128, pointEnd: true, capEnd: false },
    );
    const expected = (1 / 3) * Math.PI * 0.25 * 3;
    assert.ok(Math.abs(signedVolume(cone.positions, cone.indices) - expected) / expected < 0.002);
    const inv = directedEdgeInvariant(cone.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
  });

  it("diamond-profile taper-to-point ('diamond cone') matches the exact rhombus-pyramid volume", () => {
    // Rhombus base area = (2*halfWidth)*(2*halfThickness)/2; pyramid volume = base*h/3 (exact, no discretization error since a diamond is exactly 4 points).
    const halfWidth = 0.5, halfThickness = 0.1, length = 1;
    const diaCone = loftClosedTube(
      "diamond",
      [{ x: 0, halfWidth, halfThickness }, { x: length, halfWidth: 0, halfThickness: 0 }],
      { pointEnd: true, capEnd: false },
    );
    const baseArea = (2 * halfWidth) * (2 * halfThickness) / 2;
    const expected = (baseArea * length) / 3;
    assert.ok(Math.abs(signedVolume(diaCone.positions, diaCone.indices) - expected) < 1e-9);
    const inv = directedEdgeInvariant(diaCone.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
  });

  it("rejects fewer than 2 stations, non-finite/negative station fields, and unknown shapes", () => {
    assert.throws(() => loftClosedTube("rect", [{ x: 0, halfWidth: 1, halfThickness: 1 }]));
    assert.throws(() => loftClosedTube("rect", [
      { x: 0, halfWidth: -1, halfThickness: 1 },
      { x: 1, halfWidth: 1, halfThickness: 1 },
    ]));
    assert.throws(() => loftClosedTube("nonagon", [
      { x: 0, halfWidth: 1, halfThickness: 1 },
      { x: 1, halfWidth: 1, halfThickness: 1 },
    ]));
    assert.throws(() => loftClosedTube("circle", [
      { x: 0, halfWidth: 1, halfThickness: 1 },
      { x: 1, halfWidth: 1, halfThickness: 1 },
    ], { sides: 2 }));
  });
});

describe("mergeMeshes", () => {
  it("offsets indices correctly and preserves vertex/triangle totals", () => {
    const a = loftClosedTube("rect", [
      { x: 0, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const b = loftClosedTube("rect", [
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 2, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const merged = mergeMeshes([a, b]);
    assert.equal(merged.positions.length, a.positions.length + b.positions.length);
    assert.equal(merged.indices.length, a.indices.length + b.indices.length);
    // Every merged index must be in-bounds for the merged vertex count.
    const vertCount = merged.positions.length / 3;
    for (const i of merged.indices) assert.ok(i >= 0 && i < vertCount);
    // Each appended section stays independently a clean manifold (its own
    // indices, offset, form a closed loop — the two sections are not welded
    // to each other, per the module's honesty notes).
    const invA = directedEdgeInvariant(a.indices);
    const invB = directedEdgeInvariant(b.indices);
    assert.equal(invA.dupDirected + invB.dupDirected, 0);
    assert.equal(invA.missingReverse + invB.missingReverse, 0);
  });
});

describe("generateSwordMesh — determinism + ring/segment arithmetic", () => {
  it("same params produce byte-identical positions and indices", () => {
    const m1 = generateSwordMesh({ bladeSegments: 6, hiltSides: 6 });
    const m2 = generateSwordMesh({ bladeSegments: 6, hiltSides: 6 });
    assert.deepEqual(Array.from(m1.positions), Array.from(m2.positions));
    assert.deepEqual(Array.from(m1.indices), Array.from(m2.indices));
    assert.deepEqual(m1.meta, m2.meta);
  });

  it("changing a parameter changes the mesh (not a frozen constant output)", () => {
    const m1 = generateSwordMesh({ bladeLength: 0.5, bladeSegments: 6, hiltSides: 6 });
    const m2 = generateSwordMesh({ bladeLength: 1.5, bladeSegments: 6, hiltSides: 6 });
    assert.notDeepEqual(Array.from(m1.positions), Array.from(m2.positions));
    assert.ok(m2.meta.totalLength > m1.meta.totalLength);
  });

  it("vertex/triangle counts match the ring/segment math per section", () => {
    const hiltSides = 8;
    const bladeSegments = 10;
    const m = generateSwordMesh({ hiltSides, bladeSegments });

    // Hilt: 3 circle-profile rings of `hiltSides` verts each, both ends capped.
    const hiltVerts = 3 * hiltSides;
    const hiltTris = 2 * hiltSides /* 2 quad-strips of hiltSides quads each = 2*hiltSides*2 tris */ * 2
      + 2 * (hiltSides - 2); /* 2 fan caps */
    // Guard: 2 rect-profile rings (4 verts each), both ends capped.
    const guardVerts = 2 * 4;
    const guardTris = 4 * 2 /* 1 quad-strip of 4 quads = 8 tris */ + 2 * (4 - 2) /* 2 caps */;
    // Blade: (bladeSegments) full diamond rings (4 verts) + 1 point-tip vertex; start capped, end is the point (fan, not capped).
    const bladeVerts = bladeSegments * 4 + 1;
    const bladeTris = (bladeSegments - 1) * 4 * 2 /* quad strips between full rings */
      + 4 /* fan from last full ring to the point apex */
      + (4 - 2) /* start cap */;

    assert.equal(m.meta.sectionVertexCounts[0], hiltVerts);
    assert.equal(m.meta.sectionVertexCounts[1], guardVerts);
    assert.equal(m.meta.sectionVertexCounts[2], bladeVerts);
    assert.equal(m.meta.sectionTriangleCounts[0], hiltTris);
    assert.equal(m.meta.sectionTriangleCounts[1], guardTris);
    assert.equal(m.meta.sectionTriangleCounts[2], bladeTris);

    assert.equal(m.positions.length / 3, hiltVerts + guardVerts + bladeVerts);
    assert.equal(m.indices.length / 3, hiltTris + guardTris + bladeTris);
  });

  it("rejects non-positive dimensions and non-integer segment/side counts", () => {
    assert.throws(() => generateSwordMesh({ bladeLength: 0 }));
    assert.throws(() => generateSwordMesh({ bladeLength: -1 }));
    assert.throws(() => generateSwordMesh({ bladeSegments: 1.5 }));
    assert.throws(() => generateSwordMesh({ hiltSides: 2 }));
  });

  it("produces a beam-abstraction co-product with one station per mesh ring, s in [0,1]", () => {
    const m = generateSwordMesh({ hiltSides: 8, bladeSegments: 10 });
    assert.equal(m.beam.stations.length, 3 /* hilt */ + 2 /* guard */ + 11 /* blade: segments+1 */);
    for (const st of m.beam.stations) {
      assert.ok(st.s >= 0 && st.s <= 1 + 1e-9);
      assert.ok(Number.isFinite(st.area) && st.area >= 0);
      assert.ok(Number.isFinite(st.momentOfInertia) && st.momentOfInertia >= 0);
    }
    assert.equal(m.beam.stations[0].s, 0);
    assert.ok(Math.abs(m.beam.stations[m.beam.stations.length - 1].s - 1) < 1e-9);
    // Blade tip station (last) has collapsed to a point → zero area/I.
    const tip = m.beam.stations[m.beam.stations.length - 1];
    assert.equal(tip.area, 0);
    assert.equal(tip.momentOfInertia, 0);
  });

  it("flags the diamond-blade beam stations with the honest rectangle-approximation marker; hilt/guard stations are exact", () => {
    const m = generateSwordMesh({ hiltSides: 8, bladeSegments: 4 });
    const hiltStations = m.beam.stations.slice(0, 3);
    const guardStations = m.beam.stations.slice(3, 5);
    const bladeStations = m.beam.stations.slice(5);
    for (const st of hiltStations) assert.equal(st.approximation, false);
    for (const st of guardStations) assert.equal(st.approximation, false);
    for (const st of bladeStations) assert.equal(st.approximation, true);
    assert.equal(HONESTY_NOTES.diamondMomentOfInertiaIsRectangleApproximation, true);
    assert.equal(HONESTY_NOTES.appendedSeamsNotWelded, true);
  });

  it("moment of inertia for an exact rectangle guard station equals b·h³/12 directly", () => {
    const m = generateSwordMesh({ guardWidth: 0.1, guardThickness: 0.02, hiltSides: 8, bladeSegments: 4 });
    const guardStation = m.beam.stations[3];
    const b = 0.1, h = 0.02;
    const expected = (b * h ** 3) / 12;
    assert.ok(Math.abs(guardStation.momentOfInertia - expected) / expected < 1e-9);
    assert.ok(Math.abs(guardStation.area - b * h) / (b * h) < 1e-9);
  });
});

describe("generateSwordMesh round-trips through glb-bridge packGLB → extractMeshData", () => {
  let tmpDir;
  before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parametric-mesh-")); });
  after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("preserves vertex + triangle counts and approximate geometry after a GLB pack/extract cycle", async () => {
    const mesh = await generateSwordMeshWithNormals({ bladeSegments: 6, hiltSides: 6 });
    assert.equal(mesh.normals.length, mesh.positions.length);

    const out = path.join(tmpDir, "sword.glb");
    await packGLB({ positions: mesh.positions, indices: mesh.indices, normals: mesh.normals }, out);
    const ext = await extractMeshData(out);

    assert.equal(ext.positions.length, mesh.positions.length);
    assert.equal(ext.indices.length, mesh.indices.length);
    for (let i = 0; i < mesh.positions.length; i++) {
      assert.ok(Math.abs(ext.positions[i] - mesh.positions[i]) < 1e-4, `position[${i}] round-trip`);
    }
    assert.deepEqual(Array.from(ext.indices), Array.from(mesh.indices));
    assert.ok(ext.normals);
    assert.equal(ext.normals.length, mesh.normals.length);
  });

  it("computeVertexNormals (imported from glb-bridge, not reimplemented) yields unit-length normals for the sword mesh", () => {
    const mesh = generateSwordMesh({ bladeSegments: 6, hiltSides: 6 });
    const normals = computeVertexNormals(mesh.positions, mesh.indices);
    assert.equal(normals.length, mesh.positions.length);
    for (let v = 0; v < normals.length; v += 3) {
      const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
      assert.ok(Math.abs(len - 1) < 1e-6, `unit-length normal at vertex ${v / 3}`);
    }
  });
});
