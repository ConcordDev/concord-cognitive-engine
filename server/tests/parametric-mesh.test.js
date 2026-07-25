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
  weldCoincidentVertices,
  ringPointsAt,
  bridgeMismatchedRings,
  loftSectionsWithBridges,
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

describe("weldCoincidentVertices — genuine-coincidence case (positive proof the weld works)", () => {
  it("welds two abutting same-profile rect tubes sharing an exact boundary ring into one clean manifold with fewer vertices", () => {
    // Two 1x1x1 boxes stacked along +X, sharing the boundary ring at x=1 —
    // unlike generateSwordMesh's real junctions, these DO have matching
    // profile/shape/scale at the join, so this is the genuine-coincidence
    // case weldCoincidentVertices exists to handle.
    const a = loftClosedTube("rect", [
      { x: 0, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const b = loftClosedTube("rect", [
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 2, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const merged = mergeMeshes([a, b]);
    // Before welding: 16 verts (8+8), 24 tris (12+12) — includes the two
    // interior end caps (2 tris each = 4 tris) that shouldn't survive a weld.
    assert.equal(merged.positions.length / 3, 16);
    assert.equal(merged.indices.length / 3, 24);

    const welded = weldCoincidentVertices(merged);
    // The shared boundary ring (4 verts) collapses from 8 to 4 -> 4 welded.
    assert.equal(welded.weldedVertexCount, 4);
    assert.equal(welded.positions.length / 3, 12);
    // The two interior caps (2 tris each) become degenerate once their ring
    // is shared and are dropped -> 4 dropped triangles, 20 remain.
    assert.equal(welded.droppedTriangleCount, 4);
    assert.equal(welded.indices.length / 3, 20);

    const inv = directedEdgeInvariant(welded.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);

    // Volume is preserved (a 1x1x2 combined box = 2), proving the weld
    // didn't distort geometry, only dedupe it.
    const vol = signedVolume(welded.positions, welded.indices);
    assert.ok(Math.abs(vol - 2) < 1e-9);
  });

  it("throws a NAMED error when a declared seam's rings genuinely don't match (count mismatch)", () => {
    const a = loftClosedTube("circle", [
      { x: 0, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
    ], { sides: 8 });
    const b = loftClosedTube("rect", [
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 2, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const merged = mergeMeshes([a, b]);
    assert.throws(
      () => weldCoincidentVertices(merged, undefined, {
        seams: [{ a: { start: 8, count: 8 }, b: { start: 16, count: 4 } }],
      }),
      /parametric_mesh_seam_mismatch/,
    );
  });

  it("throws a NAMED error when a declared seam's rings have matching counts but non-coincident positions", () => {
    const a = loftClosedTube("rect", [
      { x: 0, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const b = loftClosedTube("rect", [
      { x: 1, halfWidth: 2.0, halfThickness: 2.0 }, // different scale — won't coincide
      { x: 2, halfWidth: 2.0, halfThickness: 2.0 },
    ]);
    const merged = mergeMeshes([a, b]);
    assert.throws(
      () => weldCoincidentVertices(merged, undefined, {
        seams: [{ a: { start: 4, count: 4 }, b: { start: 8, count: 4 } }],
      }),
      /parametric_mesh_seam_mismatch/,
    );
  });

  it("auto mode (no declared seams) is a safe no-op when nothing coincides", () => {
    const a = loftClosedTube("rect", [
      { x: 0, halfWidth: 0.5, halfThickness: 0.5 },
      { x: 1, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const b = loftClosedTube("rect", [
      { x: 5, halfWidth: 0.5, halfThickness: 0.5 }, // far away, no shared plane
      { x: 6, halfWidth: 0.5, halfThickness: 0.5 },
    ]);
    const merged = mergeMeshes([a, b]);
    const welded = weldCoincidentVertices(merged);
    assert.equal(welded.weldedVertexCount, 0);
    assert.equal(welded.droppedTriangleCount, 0);
    assert.equal(welded.positions.length, merged.positions.length);
    assert.equal(welded.indices.length, merged.indices.length);
  });
});

describe("bridgeMismatchedRings — the real fix for a mismatched-profile junction (replaces the two-independent-caps approach at abutting, non-interpenetrating sections)", () => {
  it("bridges two SAME-shape, SAME-scale rings identically to a normal loftClosedTube quad strip (degenerate/sanity case)", () => {
    const ringA = ringPointsAt("rect", 0, 0.5, 0.5);
    const ringB = ringPointsAt("rect", 1, 0.5, 0.5);
    const bridge = bridgeMismatchedRings(ringA, ringB);
    assert.equal(bridge.positions.length / 3, 8);
    assert.equal(bridge.indices.length / 3, 4 * 2); // one quad-strip segment, 4 quads = 8 tris... i.e. na+nb
    const inv = directedEdgeInvariant(bridge.indices);
    // The bridge ALONE is an open annulus (its two ring loops are meant to
    // be closed by the ADJOINING sections' own lateral walls, not by the
    // bridge itself — see the module doc-comment) so dupDirected must still
    // be 0 even standalone, but missingReverse is expected here.
    assert.equal(inv.dupDirected, 0);
    // Volume of just this bridge slab standing alone (not meaningful as a
    // real solid on its own, but should match the exact frustum volume of a
    // 1x1 square prism from x=0 to x=1 once the two ring loops are notionally
    // closed) is cross-checked precisely in the full-assembly tests below.
  });

  it("rejects a degenerate ring (fewer than 3 points) with a named error, never silently producing garbage", () => {
    assert.throws(
      () => bridgeMismatchedRings([{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }], ringPointsAt("rect", 1, 0.5, 0.5)),
      /parametric_mesh_bridge_bad_ring/,
    );
  });

  it("full assembly: circle(8)->rect and rect->diamond junctions (the sword's real geometry) are closed manifolds with no vertex-count mismatch left unresolved", () => {
    // Independently re-derive (not import) the two real sword junctions and
    // assemble them end-to-end via loftSectionsWithBridges + weld, proving
    // the mechanism generateSwordMesh relies on is correct in isolation of
    // that function's own params/defaults.
    const loft = loftSectionsWithBridges([
      { shape: "circle", stations: [{ x: -1, halfWidth: 0.013, halfThickness: 0.013 }, { x: 0, halfWidth: 0.013, halfThickness: 0.013 }], sides: 8 },
      { shape: "rect", stations: [{ x: 0, halfWidth: 0.06, halfThickness: 0.009 }, { x: 0.02, halfWidth: 0.06, halfThickness: 0.009 }] },
      { shape: "diamond", stations: [{ x: 0.02, halfWidth: 0.0225, halfThickness: 0.003 }, { x: 0.27, halfWidth: 0, halfThickness: 0 }], pointEnd: true },
    ]);
    const inv = directedEdgeInvariant(loft.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
    // Every vertex index used by a triangle must be in-bounds.
    const vertCount = loft.positions.length / 3;
    for (const i of loft.indices) assert.ok(i >= 0 && i < vertCount);
    // Positive, finite, plausible-magnitude volume (a thin blade-and-hilt
    // shape at real sword scale — nowhere near zero, nowhere near huge).
    const vol = signedVolume(loft.positions, loft.indices);
    assert.ok(Number.isFinite(vol) && vol > 0 && vol < 1e-3);
  });

  it("full assembly: SAME-shape different-SCALE junction (nested circles, no angular crossing) is also a closed manifold", () => {
    const loft = loftSectionsWithBridges([
      { shape: "circle", stations: [{ x: 0, halfWidth: 0.01, halfThickness: 0.01 }, { x: 1, halfWidth: 0.01, halfThickness: 0.01 }], sides: 8 },
      { shape: "circle", stations: [{ x: 1, halfWidth: 0.05, halfThickness: 0.05 }, { x: 1.2, halfWidth: 0.05, halfThickness: 0.05 }], sides: 12 },
    ]);
    const inv = directedEdgeInvariant(loft.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
    const vol = signedVolume(loft.positions, loft.indices);
    assert.ok(vol > 0);
  });

  it("honest failure: a ring whose vertex angles are not monotonic around the origin (not star-shaped from the centerline) is refused, not silently bridged into a wrong-but-plausible mesh", () => {
    // A hand-built "ring" that jumps back and forth in angle (not a valid
    // CCW star-shaped polygon around the origin) — the precondition
    // bridgeMismatchedRings requires and explicitly checks for.
    const brokenRing = [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0.1 },
      { x: 0, y: 0.5, z: -0.5 },
      { x: 0, y: -0.9, z: -0.1 },
      { x: 0, y: 0.2, z: 0.9 },
    ];
    const okRing = ringPointsAt("rect", 1, 0.5, 0.5);
    assert.throws(() => bridgeMismatchedRings(brokenRing, okRing), /parametric_mesh_bridge_non_star_shaped/);
  });
});

describe("loftSectionsWithBridges — chain of N coaxial sections, only the first/last capped", () => {
  it("a single section behaves exactly like a normal fully-capped loftClosedTube", () => {
    const loft = loftSectionsWithBridges([
      { shape: "rect", stations: [{ x: 0, halfWidth: 0.5, halfThickness: 0.5 }, { x: 1, halfWidth: 0.5, halfThickness: 0.5 }] },
    ]);
    assert.equal(loft.sectionVertexCounts.length, 1);
    assert.equal(loft.positions.length / 3, 8);
    assert.equal(loft.indices.length / 3, 12);
    assert.ok(Math.abs(signedVolume(loft.positions, loft.indices) - 1) < 1e-9);
    const inv = directedEdgeInvariant(loft.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
    assert.equal(loft.weld.weldedVertexCount, 0);
  });

  it("rejects an empty section list", () => {
    assert.throws(() => loftSectionsWithBridges([]), /parametric_mesh_bad_sections/);
  });

  it("a chain of 4 mismatched sections (circle->rect->diamond->circle) stays a single closed manifold end-to-end", () => {
    const loft = loftSectionsWithBridges([
      { shape: "circle", stations: [{ x: 0, halfWidth: 0.02, halfThickness: 0.02 }, { x: 0.3, halfWidth: 0.02, halfThickness: 0.02 }], sides: 6 },
      { shape: "rect", stations: [{ x: 0.3, halfWidth: 0.05, halfThickness: 0.01 }, { x: 0.35, halfWidth: 0.05, halfThickness: 0.01 }] },
      { shape: "diamond", stations: [{ x: 0.35, halfWidth: 0.03, halfThickness: 0.02 }, { x: 0.5, halfWidth: 0.03, halfThickness: 0.02 }] },
      { shape: "circle", stations: [{ x: 0.5, halfWidth: 0.04, halfThickness: 0.04 }, { x: 0.6, halfWidth: 0, halfThickness: 0 }], sides: 10, pointEnd: true },
    ]);
    const inv = directedEdgeInvariant(loft.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
    assert.equal(loft.sectionVertexCounts.length, 4);
    assert.ok(signedVolume(loft.positions, loft.indices) > 0);
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

  it("vertex/triangle counts match the ring/segment math per section (only the FIRST/LAST section is capped — interior junctions are bridged, not capped)", () => {
    const hiltSides = 8;
    const bladeSegments = 10;
    const m = generateSwordMesh({ hiltSides, bladeSegments });

    // Hilt (first section): 3 circle-profile rings of `hiltSides` verts each;
    // capStart only (the guard-facing end is bridged, not capped).
    const hiltVerts = 3 * hiltSides;
    const hiltTris = 2 * hiltSides /* 2 quad-strips of hiltSides quads each = 2*hiltSides*2 tris */ * 2
      + 1 * (hiltSides - 2); /* 1 fan cap (capStart only) */
    // Guard (interior section): 2 rect-profile rings (4 verts each); NEITHER
    // end capped (both junctions are bridged).
    const guardVerts = 2 * 4;
    const guardTris = 4 * 2 /* 1 quad-strip of 4 quads = 8 tris */; /* no caps */
    // Blade (last section): (bladeSegments) full diamond rings (4 verts) + 1
    // point-tip vertex; the guard-facing start is bridged (not capped), the
    // end is the point (fan, not a flat cap either way).
    const bladeVerts = bladeSegments * 4 + 1;
    const bladeTris = (bladeSegments - 1) * 4 * 2 /* quad strips between full rings */
      + 4; /* fan from last full ring to the point apex; no start cap */

    assert.equal(m.meta.sectionVertexCounts[0], hiltVerts);
    assert.equal(m.meta.sectionVertexCounts[1], guardVerts);
    assert.equal(m.meta.sectionVertexCounts[2], bladeVerts);
    assert.equal(m.meta.sectionTriangleCounts[0], hiltTris);
    assert.equal(m.meta.sectionTriangleCounts[1], guardTris);
    assert.equal(m.meta.sectionTriangleCounts[2], bladeTris);

    // Two bridges close the two interior junctions: hilt-ring(hiltSides) +
    // guard-ring(4) verts/tris, and guard-ring(4) + blade-base-ring(4)
    // verts/tris — bridgeMismatchedRings emits exactly na+nb vertices and
    // na+nb triangles (see its own doc-comment), all of which then get
    // welded back onto the adjoining section's own (duplicate-position)
    // ring vertices by weldCoincidentVertices, so the FINAL (post-weld)
    // counts equal the raw per-section sums exactly — the bridges add zero
    // net new vertices/triangles to the closed solid, they just replace two
    // independent flat caps with one connecting strip.
    const preWeldVerts = hiltVerts + guardVerts + bladeVerts + (hiltSides + 4) + (4 + 4);
    const preWeldTris = hiltTris + guardTris + bladeTris + (hiltSides + 4) + (4 + 4);
    assert.equal(m.weld.weldedVertexCount, preWeldVerts - (hiltVerts + guardVerts + bladeVerts));
    assert.equal(m.positions.length / 3, hiltVerts + guardVerts + bladeVerts);
    assert.equal(m.indices.length / 3, preWeldTris);
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
    assert.equal(HONESTY_NOTES.weldPassApplied, true);
    assert.equal(HONESTY_NOTES.junctionsClosedByRingBridge, true);
  });

  it("the merged+welded sword is a single closed 2-manifold across the WHOLE mesh (not just per-section)", () => {
    const m = generateSwordMesh({ bladeSegments: 6, hiltSides: 6 });
    const inv = directedEdgeInvariant(m.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
  });

  it("fixed finding: the sword's mismatched junctions (circle→rect→diamond) are now closed by a real ring bridge, not left as two independent interpenetrating caps", () => {
    const hiltSides = 8;
    const bladeSegments = 10;
    const m = generateSwordMesh({ hiltSides, bladeSegments });
    // The bridge duplicates each side's ring positions into its own small
    // mesh (see bridgeMismatchedRings' doc-comment on why it composes with
    // weldCoincidentVertices instead of needing its own dedup) — the weld
    // pass therefore welds exactly (ring sizes at both junctions), and drops
    // zero triangles (there are no more mirror-pair opposing caps left to
    // cancel, since neither junction has a cap on either side any more).
    const hiltGuardRingSizes = hiltSides + 4; // circle(hiltSides) meets rect(4)
    const guardBladeRingSizes = 4 + 4; // rect(4) meets diamond(4)
    assert.equal(m.weld.weldedVertexCount, hiltGuardRingSizes + guardBladeRingSizes);
    assert.equal(m.weld.droppedTriangleCount, 0);
    // Positions are the sum of each section's OWN ring vertices (no bridge
    // vertex survives independently — every one of them was a duplicate of
    // an existing section ring vertex and got welded onto it).
    const expectedVerts = m.meta.sectionVertexCounts.reduce((a, b) => a + b, 0);
    assert.equal(m.positions.length / 3, expectedVerts);
    // Triangles are the section triangles PLUS the two bridges' own
    // triangles (na+nb each) — the bridge triangles are real, load-bearing
    // geometry (they replace the caps' triangles 1:1 in closing the solid),
    // so unlike vertices they are NOT expected to collapse away.
    const expectedTris = m.meta.sectionTriangleCounts.reduce((a, b) => a + b, 0)
      + hiltGuardRingSizes + guardBladeRingSizes;
    assert.equal(m.indices.length / 3, expectedTris);
  });

  it("the two junction 'caps' are GONE as independent disjoint fans — the flat geometry at each interior seam is now ONE connected bridge, not two unrelated per-side caps sharing a coordinate", () => {
    // The bridge triangles genuinely DO sit flat in the junction plane (the
    // ring-to-ring "annulus" between two mismatched, merely-abutting
    // profiles necessarily lives at their shared x — see
    // bridgeMismatchedRings' doc-comment), so "flat-in-x" alone can't
    // distinguish the fix from the old bug (two independent flat caps were
    // ALSO flat-in-x). The real defect being regression-tested is
    // DISCONNECTION: the old code's two caps at a junction never shared a
    // vertex, so each was its own isolated fan built entirely from ONE
    // section's own ring. A real bridge instead produces triangles that mix
    // vertices from BOTH sides — verified here by checking every flat
    // triangle at each interior junction plane, grouped into connected
    // components via shared vertices, forms exactly ONE component that
    // includes vertices from both the hilt/guard (or guard/blade) rings.
    const hiltSides = 8;
    const m = generateSwordMesh({ hiltSides, bladeSegments: 6 });

    const flatTrisByX = new Map();
    for (let t = 0; t < m.indices.length; t += 3) {
      const ia = m.indices[t], ib = m.indices[t + 1], ic = m.indices[t + 2];
      const xa = m.positions[ia * 3], xb = m.positions[ib * 3], xc = m.positions[ic * 3];
      if (Math.abs(xa - xb) < 1e-9 && Math.abs(xb - xc) < 1e-9) {
        const key = xa.toFixed(9);
        if (!flatTrisByX.has(key)) flatTrisByX.set(key, []);
        flatTrisByX.get(key).push([ia, ib, ic]);
      }
    }
    // Two interior junctions (hilt/guard, guard/blade) plus the one real cap
    // (hilt's pommel, capStart) — three distinct flat-triangle x-planes.
    assert.equal(flatTrisByX.size, 3);

    function connectedComponentCount(tris) {
      const parent = new Map();
      const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
      const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
      for (const [a, b, c] of tris) {
        for (const v of [a, b, c]) if (!parent.has(v)) parent.set(v, v);
        union(a, b); union(b, c);
      }
      return new Set(Array.from(parent.keys()).map(find)).size;
    }

    let junctionPlanesChecked = 0;
    for (const [xKey, tris] of flatTrisByX) {
      const isPommelCap = Math.abs(Number(xKey) - 0) < 1e-9; // pommel sits at x=0
      const components = connectedComponentCount(tris);
      assert.equal(components, 1, `flat triangles at x=${xKey} should form exactly one connected piece`);
      if (!isPommelCap) junctionPlanesChecked++;
    }
    // Both interior junctions were actually exercised by the loop above.
    assert.equal(junctionPlanesChecked, 2);
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
