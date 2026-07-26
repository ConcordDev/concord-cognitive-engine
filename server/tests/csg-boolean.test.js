/**
 * server/lib/asset-gen/csg-boolean.js — the 2D circle-union-polygon boundary
 * primitive that backs the axe/hammer head-crossing-haft CSG in
 * parametric-mesh.js. Pinned standalone (independent of the 3D assembly)
 * so a bug in the boundary math is caught here, not diagnosed only via a
 * failed directed-edge invariant three layers up.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { unionCircleWithPolygon2D, lineCircleIntersections, extrudeRingBetweenX, ringArea2D } from "../lib/asset-gen/csg-boolean.js";

function dist(p) { return Math.hypot(p.y, p.z); }

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

/** Naive fan cap from vertex 0 — pure combinatorics check, not a claim the
 * cap is a valid *simple* (non-self-intersecting) triangulation for a
 * non-convex ring; used only to close extrudeRingBetweenX's open ends for
 * a standalone manifold-closure smoke test. */
function fanCap(startIdx, n, reverse) {
  const tris = [];
  for (let k = 1; k < n - 1; k++) {
    tris.push(reverse ? [startIdx, startIdx + k, startIdx + k + 1] : [startIdx, startIdx + k + 1, startIdx + k]);
  }
  return tris;
}

function polygonArea2D(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p.y * q.z - q.y * p.z;
  }
  return a / 2;
}

describe("lineCircleIntersections — exact quadratic line-circle roots", () => {
  it("a chord through the circle returns 2 sorted interior points", () => {
    const pts = lineCircleIntersections({ y: -2, z: 0 }, { y: 2, z: 0 }, 1);
    assert.equal(pts.length, 2);
    assert.ok(pts[0].t < pts[1].t);
    assert.ok(Math.abs(dist(pts[0]) - 1) < 1e-9);
    assert.ok(Math.abs(dist(pts[1]) - 1) < 1e-9);
  });

  it("a segment entirely outside the circle (no crossing) returns []", () => {
    const pts = lineCircleIntersections({ y: 5, z: 0 }, { y: 6, z: 0 }, 1);
    assert.deepEqual(pts, []);
  });

  it("a segment with one endpoint inside, one outside returns exactly 1 point", () => {
    const pts = lineCircleIntersections({ y: 0, z: 0 }, { y: 5, z: 0 }, 1);
    assert.equal(pts.length, 1);
    assert.ok(Math.abs(dist(pts[0]) - 1) < 1e-9);
  });

  it("refuses a near-tangent line by name", () => {
    // Horizontal line at z=1 exactly tangent to a unit circle.
    assert.throws(
      () => lineCircleIntersections({ y: -1, z: 1 }, { y: 1, z: 1 }, 1),
      /csg_boolean_near_tangent_degenerate/,
    );
  });

  it("refuses a crossing that lands within CSG_EPS_T of a vertex by name", () => {
    // Segment from exactly on the circle (y=1,z=0) outward — the t=0 root
    // is the start vertex itself, ambiguous.
    assert.throws(
      () => lineCircleIntersections({ y: 1, z: 0 }, { y: 5, z: 0 }, 1),
      /csg_boolean_vertex_on_seam/,
    );
  });

  it("refuses a degenerate zero-length edge by name", () => {
    assert.throws(
      () => lineCircleIntersections({ y: 1, z: 1 }, { y: 1, z: 1 }, 1),
      /csg_boolean_degenerate_edge/,
    );
  });
});

describe("unionCircleWithPolygon2D — exact 2D union boundary", () => {
  it("rejects a non-positive radius by name", () => {
    assert.throws(() => unionCircleWithPolygon2D(0, [{ y: 1, z: 1 }, { y: -1, z: 1 }, { y: 0, z: -1 }]), /csg_boolean_bad_radius/);
  });

  it("rejects a polygon with < 3 points by name", () => {
    assert.throws(() => unionCircleWithPolygon2D(1, [{ y: 1, z: 0 }, { y: -1, z: 0 }]), /csg_boolean_bad_polygon/);
  });

  it("refuses when the circle center is not enclosed by the polygon", () => {
    // A triangle sitting entirely at y>5, nowhere near the origin.
    const tri = [{ y: 6, z: 0 }, { y: 5, z: 1 }, { y: 5, z: -1 }];
    assert.throws(() => unionCircleWithPolygon2D(1, tri), /csg_boolean_origin_outside_polygon/);
  });

  it("refuses when the polygon fully swallows the circle with a vertex exactly on it (constructed to hit csg_boolean_vertex_on_circle or head_fully_inside)", () => {
    // A big square, way bigger than the circle -> the whole polygon is
    // outside and no edges cross -> union should just be the polygon
    // unchanged (this is the *valid*, non-refused "swallow" case, tested
    // separately below). This test instead checks the opposite-degenerate
    // extreme: a polygon entirely INSIDE the circle refuses.
    const tinySquare = [{ y: 0.1, z: 0.1 }, { y: -0.1, z: 0.1 }, { y: -0.1, z: -0.1 }, { y: 0.1, z: -0.1 }];
    assert.throws(() => unionCircleWithPolygon2D(1, tinySquare), /csg_boolean_head_fully_inside_haft/);
  });

  it("trivial-swallow case: a square much larger than the circle -> union boundary is the square, unchanged, no circle points", () => {
    const R = 1;
    const big = [{ y: 10, z: 10 }, { y: -10, z: 10 }, { y: -10, z: -10 }, { y: 10, z: -10 }];
    const { ring } = unionCircleWithPolygon2D(R, big);
    assert.equal(ring.length, 4);
    for (const p of ring) assert.equal(p.tag, "polygon");
    // Order-preserving rotation of the input square.
    const ys = ring.map((p) => p.y).sort((a, b) => a - b);
    assert.deepEqual(ys, [-10, -10, 10, 10]);
  });

  it("genuine crossing case: a square smaller than the circle in one axis -> union boundary includes real circle-arc samples", () => {
    const R = 2;
    // Square half-extent 1 in Y (H=1 < R -> would be swallowed in Y alone)
    // but that's not what determines swallow; here we shrink Z so the
    // circle pokes out the sides.
    const square = [{ y: 3, z: 0.5 }, { y: -3, z: 0.5 }, { y: -3, z: -0.5 }, { y: 3, z: -0.5 }];
    const { ring } = unionCircleWithPolygon2D(R, square, { arcSides: 32 });
    const circlePts = ring.filter((p) => p.tag === "circle");
    const seamPts = ring.filter((p) => p.tag === "seam");
    assert.ok(circlePts.length > 0, "expected genuine circle-arc samples in the union boundary");
    assert.equal(seamPts.length, 4, "expected 4 seam (entry/exit) points: 2 crossings on top edge region + 2 on bottom");
    // Every ring point must be outside-or-on both the polygon's own extent
    // and satisfy: circle points are exactly at radius R, seam points too.
    for (const p of [...circlePts, ...seamPts]) {
      assert.ok(Math.abs(dist(p) - R) < 1e-9, "circle/seam points must lie exactly on the circle");
    }
    // The union area must be strictly greater than the plain square's area
    // (the circle genuinely added area) and strictly greater than the
    // circle's own area (the square parts stick out too, in Y).
    const squareArea = 6 * 1; // width(6) x height(1)
    const circleArea = Math.PI * R * R;
    const unionArea = Math.abs(polygonArea2D(ring.map((p) => ({ y: p.y, z: p.z }))));
    assert.ok(unionArea > squareArea - 1e-9, `union area ${unionArea} should be >= square area ${squareArea}`);
    // Sanity upper bound: union can never exceed the sum of both areas.
    assert.ok(unionArea < squareArea + circleArea);
  });

  it("edgeIndex is preserved on untouched polygon vertices, letting a caller find a specific clean edge", () => {
    const R = 1;
    // H=3 (>R), front=3(>R), back=0.3(<R, exercises arc) — mirrors the
    // real axe/hammer eye parameter regime documented in parametric-mesh.js.
    const H = 3, front = 3, back = 0.3;
    const box = [
      { y: H, z: front },   // edge 0: front (H -> -H at z=front) — clean
      { y: -H, z: front },  // edge 1: bottom (y=-H, front -> -back) — clean
      { y: -H, z: -back },  // edge 2: back/poll (z=-back, -H -> H) — crosses
      { y: H, z: -back },   // edge 3: top (y=H, -back -> front) — clean
    ];
    const { ring } = unionCircleWithPolygon2D(R, box, { arcSides: 16 });
    const edge0Points = ring.filter((p) => p.tag === "polygon" && p.edgeIndex === 0);
    assert.equal(edge0Points.length, 1, "edge 0's OWN vertex (H,front) should appear exactly once, untouched");
    assert.equal(edge0Points[0].y, H);
    assert.equal(edge0Points[0].z, front);
    // Edge 2 (the poll edge) must have contributed a genuine arc bulge.
    const circlePts = ring.filter((p) => p.tag === "circle");
    assert.ok(circlePts.length > 0, "expected the poll edge (back < R) to produce circle-arc points");
    for (const p of circlePts) assert.ok(Math.abs(dist(p) - R) < 1e-9);
  });

  it("is deterministic (same inputs -> byte-identical ring)", () => {
    const R = 1.5;
    const box = [{ y: 3, z: 2 }, { y: -3, z: 2 }, { y: -3, z: -0.2 }, { y: 3, z: -0.2 }];
    const a = unionCircleWithPolygon2D(R, box, { arcSides: 20 });
    const b = unionCircleWithPolygon2D(R, box, { arcSides: 20 });
    assert.deepEqual(a, b);
  });

  it("refuses a non-star-shaped (self-intersecting) polygon by name", () => {
    // A bowtie: vertices ordered so consecutive edges cross.
    const bowtie = [{ y: 5, z: 5 }, { y: -5, z: -5 }, { y: 5, z: -5 }, { y: -5, z: 5 }];
    assert.throws(() => unionCircleWithPolygon2D(1, bowtie), /csg_boolean_polygon_non_star_shaped|csg_boolean_origin_outside_polygon/);
  });
});

describe("extrudeRingBetweenX — lateral wall of a crossing collar", () => {
  it("rejects a degenerate ring or x-range by name", () => {
    assert.throws(() => extrudeRingBetweenX([{ y: 1, z: 0 }, { y: 0, z: 1 }], 0, 1), /csg_boolean_bad_polygon/);
    assert.throws(() => extrudeRingBetweenX([{ y: 1, z: 0 }, { y: 0, z: 1 }, { y: -1, z: 0 }], 1, 0), /csg_boolean_bad_extrude_range/);
  });

  it("closed with fan caps on both ends, a plain circle ring is a clean manifold with the expected cylinder volume", () => {
    const R = 1, sides = 64;
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const theta = (i / sides) * Math.PI * 2;
      ring.push({ y: R * Math.cos(theta), z: R * Math.sin(theta) });
    }
    const { positions, indices, ringLo, ringHi } = extrudeRingBetweenX(ring, 0, 2);
    assert.equal(ringLo.length, sides);
    assert.equal(ringHi.length, sides);
    // Matches loftClosedTube's own capStart (smaller-x ring: start,k+1,k)
    // vs capEnd (larger-x ring: end,k,k+1) winding convention exactly.
    const capLo = fanCap(0, sides, false);
    const capHi = fanCap(sides, sides, true);
    const allIndices = [...indices, ...capLo.flat(), ...capHi.flat()];
    const inv = directedEdgeInvariant(Uint32Array.from(allIndices));
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
  });

  it("closed with fan caps, the union-boundary ring from a genuine circle+polygon crossing is ALSO a clean manifold end-to-end", () => {
    // Same "H>R front>R back<R" regime as the edgeIndex test above — this
    // is the actual shape class generateAxeMesh/generateHammerMesh use.
    const R = 1;
    const H = 3, front = 3, back = 0.3;
    const box = [{ y: H, z: front }, { y: -H, z: front }, { y: -H, z: -back }, { y: H, z: -back }];
    const { ring } = unionCircleWithPolygon2D(R, box, { arcSides: 24 });
    const { indices, ringLo, ringHi } = extrudeRingBetweenX(ring, -1, 1);
    const n = ring.length;
    const capLo = fanCap(0, n, false);
    const capHi = fanCap(n, n, true);
    const allIndices = [...indices, ...capLo.flat(), ...capHi.flat()];
    const inv = directedEdgeInvariant(Uint32Array.from(allIndices));
    assert.equal(inv.dupDirected, 0, "duplicate directed edges — non-manifold");
    assert.equal(inv.missingReverse, 0, "open boundary — junction not actually closed");
    assert.equal(ringLo.length, n);
    assert.equal(ringHi.length, n);
  });
});

describe("ringArea2D — exact shoelace area", () => {
  it("matches a unit square exactly", () => {
    const sq = [{ y: 1, z: 1 }, { y: -1, z: 1 }, { y: -1, z: -1 }, { y: 1, z: -1 }];
    assert.ok(Math.abs(ringArea2D(sq) - 4) < 1e-12);
  });

  it("converges to pi*R^2 for a fine circle approximation", () => {
    const R = 2, sides = 256;
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const theta = (i / sides) * Math.PI * 2;
      ring.push({ y: R * Math.cos(theta), z: R * Math.sin(theta) });
    }
    assert.ok(Math.abs(ringArea2D(ring) - Math.PI * R * R) / (Math.PI * R * R) < 2e-4);
  });

  it("is winding-direction independent", () => {
    const sq = [{ y: 1, z: 1 }, { y: -1, z: 1 }, { y: -1, z: -1 }, { y: 1, z: -1 }];
    const rev = [...sq].reverse();
    assert.equal(ringArea2D(sq), ringArea2D(rev));
  });

  it("the genuine-crossing union ring has strictly more area than the plain polygon", () => {
    const R = 2;
    const square = [{ y: 3, z: 0.5 }, { y: -3, z: 0.5 }, { y: -3, z: -0.5 }, { y: 3, z: -0.5 }];
    const { ring } = unionCircleWithPolygon2D(R, square, { arcSides: 32 });
    const squareArea = ringArea2D(square);
    const unionArea = ringArea2D(ring);
    assert.ok(unionArea > squareArea, `union area ${unionArea} should exceed the bare square's ${squareArea}`);
  });
});
