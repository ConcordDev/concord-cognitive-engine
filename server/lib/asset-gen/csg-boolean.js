// server/lib/asset-gen/csg-boolean.js
//
// Program C, Stage 2 — a genuine constructive-solid-geometry boolean, for
// the one class of case parametric-mesh.js's coaxial ring-bridging
// deliberately does NOT cover: two solids that actually INTERPENETRATE
// (a head/blade crossing a haft at an angle, a crossguard passing through a
// blade, a subtractive cavity/fuller). See parametric-mesh.js's
// `bridgeMismatchedRings` doc-comment for why a coaxial *abutting* junction
// is the wrong job for CSG (two abutting end-caps are exactly-coplanar
// faces — the worst case for a general BSP boolean). This module is for the
// opposite case: real volumetric overlap, where a boolean is the *right*
// tool, not the wrong one.
//
// ── Chosen approach: bounded, closed-form primitive intersection — NOT a
// general BSP mesh-mesh boolean — and why ────────────────────────────────
// A general triangle-soup BSP CSG (classify every triangle of mesh A against
// mesh B's splitting planes, keep/flip/discard, re-triangulate at the cut)
// is the textbook approach, and it is genuinely hard to make robust: its
// failure mode is precisely near-coplanar/tangent input, because a BSP
// split's "on which side is this triangle" classification is exactly the
// computation that degenerates under a near-zero (but not exactly zero)
// signed distance. That is a general-purpose tool solving a general
// problem this codebase does not have. The actual shapes this module needs
// to union are simple: a haft is a swept-circle cylinder (or a stack of
// them), and a head/eye is a swept polygon (a box, or a rectangle taper) —
// both PRIMITIVES with known closed-form boundaries, not arbitrary triangle
// soups. For "a straight-line polygon edge crossing a circle," the
// intersection is the roots of a QUADRATIC (line-circle intersection) —
// exact, closed-form, and its only genuinely degenerate case (a tangent
// line, discriminant ≈ 0) is detectable by name and REFUSED outright rather
// than resolved approximately. This sidesteps the entire class of bug a
// general BSP CSG is exposed to, at the cost of only handling the specific
// primitive shapes this module documents (a circle union'd with a
// star-shaped-from-origin polygon, in a single 2D cross-sectional plane,
// swept/extruded into 3D by the caller) — anything outside that shape
// vocabulary is refused by name, not silently approximated. This is the
// "bound the approach and refuse inputs it cannot handle correctly" branch
// the task asked to choose deliberately between, chosen because the real
// inputs here (a cylindrical haft, a boxy/wedge head) are exactly primitive
// shapes with an exact closed-form intersection, and because a general BSP
// solver would be strictly MORE code, MORE surface area for the coplanar
// failure mode this file exists to avoid, and zero extra correctness for
// axe/hammer specifically.
//
// ── What is refused, and how (see each named error below) ────────────────
//   - `csg_boolean_bad_radius` / `csg_boolean_bad_polygon`: malformed input.
//   - `csg_boolean_polygon_non_star_shaped`: the polygon must be
//     star-shaped from the origin (same precondition parametric-mesh.js's
//     `assertStarShapedRing` already requires of every ring in this
//     codebase) — checked, not assumed.
//   - `csg_boolean_origin_outside_polygon`: the circle's center must lie
//     inside the polygon — i.e. the haft must actually pass THROUGH the
//     head's footprint, which is the real-world precondition for "the head
//     crosses the haft" being true at all. If it doesn't, this is not a
//     crossing case and this module refuses to guess what the caller meant.
//   - `csg_boolean_degenerate_edge`: a zero-length polygon edge.
//   - `csg_boolean_near_tangent_degenerate`: a polygon edge whose line
//     comes within `CSG_EPS_LEN` of exactly grazing the circle (tangent,
//     |discriminant| below tolerance) — the one genuinely ill-conditioned
//     case for this algorithm, refused by name rather than resolved with
//     an arbitrary tie-break.
//   - `csg_boolean_vertex_on_seam`: an intersection parameter falls within
//     `CSG_EPS_T` of a polygon vertex (i.e. a polygon vertex sits almost
//     exactly ON the circle) — ambiguous which side it's on, refused.
//   - `csg_boolean_vertex_on_circle`: a polygon vertex's distance from the
//     origin is within `CSG_EPS_LEN` of the radius.
//   - `csg_boolean_head_fully_inside_haft`: every polygon vertex is inside
//     the circle and there are no edge crossings — the "head" doesn't
//     stick out of the haft at all, a meaningless crossing to model.
//   - `csg_boolean_odd_crossing_count`: an internal consistency check — a
//     simple closed curve must cross a circle's boundary an even number of
//     times; odd means the polygon is not simple (self-intersecting) at the
//     scale this algorithm can resolve, so it refuses rather than emit a
//     wrong-but-plausible boundary.
//
// ── Proof obligation ───────────────────────────────────────────────────
// This module only computes the 2D union BOUNDARY CURVE (a robust,
// closed-form computation, unit-tested standalone in
// server/tests/csg-boolean.test.js against known-shape cases). The actual
// 3D manifold-closure proof (the directed-edge invariant) happens where
// this curve is extruded/bridged into a 3D mesh — see
// parametric-mesh.js's `generateAxeMesh` / `generateHammerMesh`, which are
// proven the same way every other archetype in this codebase is proven:
// `directedEdgeInvariant(indices) -> {dupDirected:0, missingReverse:0}` in
// the test suite, never asserted from vertex/triangle counts alone.

// Absolute length epsilon (meters) — same scale as parametric-mesh.js's
// WELD_EPSILON_M; asset-gen geometry here is mm-to-tens-of-cm, so this is
// small enough to never misclassify genuinely-distinct features and large
// enough to absorb float round-trip error.
export const CSG_EPS_LEN = 1e-6;
// Parametric (0..1) epsilon along a polygon edge — a crossing whose t falls
// within this of 0 or 1 is treated as "the vertex itself is on the circle"
// (ambiguous), not as a valid interior crossing.
export const CSG_EPS_T = 1e-6;

function dist2D(y, z) {
  return Math.sqrt(y * y + z * z);
}

function ringAngle2D(y, z) {
  let a = Math.atan2(z, y);
  if (a < 0) a += Math.PI * 2;
  return a;
}

/** Same star-shaped-from-origin precondition parametric-mesh.js's
 * `assertStarShapedRing` enforces on every ring in this codebase — reused
 * here as the precondition for a well-defined angular walk. */
function assertStarShapedPolygon2D(points, label) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error(`csg_boolean_bad_polygon: ${label} needs at least 3 points, got ${points?.length}`);
  }
  const thetas = points.map((p) => ringAngle2D(p.y, p.z));
  let wraps = 0;
  for (let i = 1; i < thetas.length; i++) {
    if (thetas[i] <= thetas[i - 1]) wraps++;
  }
  if (wraps > 1) {
    throw new Error(
      `csg_boolean_polygon_non_star_shaped: ${label} vertex angles are not monotonic around the origin (${wraps} non-increasing steps)`,
    );
  }
}

/** Ray-casting point-in-polygon (even-odd rule). Used only to verify the
 * circle center (origin) is actually enclosed by the polygon — a real
 * precondition for "the head crosses the haft", not a formality. */
function originInsidePolygon2D(points) {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = points[i].y, zi = points[i].z;
    const yj = points[j].y, zj = points[j].z;
    const intersects = (zi > 0) !== (zj > 0) && ((yj - yi) * (0 - zi)) / (zj - zi) + yi > 0;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Exact (closed-form quadratic) intersections of a line SEGMENT p0->p1 with
 * a circle of radius R centered at the origin, restricted to the open
 * interval t in (CSG_EPS_T, 1-CSG_EPS_T). Refuses (throws) on a
 * near-tangent line (the one genuinely ill-conditioned case) and on a
 * crossing that falls within CSG_EPS_T of an endpoint (ambiguous — the
 * vertex is effectively ON the circle).
 *
 * @returns {Array<{t:number, y:number, z:number}>} 0, 1, or 2 points, sorted by t
 */
export function lineCircleIntersections(p0, p1, R, edgeLabel = "edge") {
  const dy = p1.y - p0.y, dz = p1.z - p0.z;
  const a = dy * dy + dz * dz;
  if (a <= CSG_EPS_LEN * CSG_EPS_LEN) {
    throw new Error(`csg_boolean_degenerate_edge: ${edgeLabel} has (near-)zero length`);
  }
  const b = 2 * (p0.y * dy + p0.z * dz);
  const c = p0.y * p0.y + p0.z * p0.z - R * R;
  const disc = b * b - 4 * a * c;
  // Scale-normalize the discriminant tolerance: disc has units of length^4
  // (a is length^2, c is length^2), so compare against (a * R * CSG_EPS_LEN)-scaled
  // floor rather than a bare absolute constant.
  const discEps = Math.max(1e-18, a * R * R * 1e-9);
  if (disc < -discEps) return [];
  if (Math.abs(disc) <= discEps) {
    throw new Error(
      `csg_boolean_near_tangent_degenerate: ${edgeLabel} is tangent to the circle (R=${R}) within tolerance — refusing rather than resolving an ill-conditioned tie`,
    );
  }
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  const out = [];
  for (const t of [t1, t2]) {
    if (t > -CSG_EPS_T && t < CSG_EPS_T) {
      throw new Error(`csg_boolean_vertex_on_seam: ${edgeLabel} crosses the circle within CSG_EPS_T of its start vertex — ambiguous`);
    }
    if (t > 1 - CSG_EPS_T && t < 1 + CSG_EPS_T) {
      throw new Error(`csg_boolean_vertex_on_seam: ${edgeLabel} crosses the circle within CSG_EPS_T of its end vertex — ambiguous`);
    }
    if (t > CSG_EPS_T && t < 1 - CSG_EPS_T) {
      out.push({ t, y: p0.y + t * dy, z: p0.z + t * dz });
    }
  }
  out.sort((p, q) => p.t - q.t);
  return out;
}

/**
 * Sample points strictly BETWEEN theta0 and theta1, walking counterclockwise
 * (increasing angle, wrapping at 2*pi) — the interior samples of a circular
 * arc of radius R. Endpoints are NOT included (the caller already has the
 * exact seam points from lineCircleIntersections).
 */
function sampleArcCCW(theta0, theta1, R, sides) {
  let sweep = theta1 - theta0;
  if (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(0, Math.ceil((sides * sweep) / (Math.PI * 2)) - 1);
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const theta = theta0 + (sweep * i) / (steps + 1);
    pts.push({ y: R * Math.cos(theta), z: R * Math.sin(theta) });
  }
  return pts;
}

/**
 * Compute the 2D outer-boundary union of a circle (radius R, centered at
 * the origin) and a simple, star-shaped-from-origin polygon that encloses
 * the origin. Exact/closed-form (see module doc-comment for why this is the
 * right scope for "exact" rather than general robust predicates), refuses
 * by name on every degenerate configuration it cannot resolve correctly.
 *
 * @param {number} R circle radius, must be > 0
 * @param {Array<{y:number,z:number}>} polygon CCW, star-shaped from origin,
 *   must enclose the origin. Each input vertex is implicitly "edge i" for
 *   the edge FROM that vertex TO the next (mod length) — output points
 *   carry `edgeIndex` when they originated from that polygon edge, so a
 *   caller can identify (e.g.) "the segment that is exactly polygon edge 0,
 *   untouched by any crossing" to leave it open for a further attachment
 *   (see parametric-mesh.js's generateAxeMesh/generateHammerMesh).
 * @returns {{ ring: Array<{y:number,z:number,tag:'polygon'|'seam'|'circle',edgeIndex?:number}> }}
 */
export function unionCircleWithPolygon2D(R, polygon, opts = {}) {
  const { arcSides = 24 } = opts;
  if (!Number.isFinite(R) || R <= 0) {
    throw new Error(`csg_boolean_bad_radius: R must be a positive finite number, got ${R}`);
  }
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error(`csg_boolean_bad_polygon: polygon needs at least 3 points, got ${polygon?.length}`);
  }
  assertStarShapedPolygon2D(polygon, "polygon");
  if (!originInsidePolygon2D(polygon)) {
    throw new Error("csg_boolean_origin_outside_polygon: the circle center does not lie inside the polygon — this is not a genuine crossing configuration");
  }

  const n = polygon.length;
  const vertexOutside = polygon.map((p) => {
    const d = dist2D(p.y, p.z);
    if (Math.abs(d - R) <= CSG_EPS_LEN) {
      throw new Error(`csg_boolean_vertex_on_circle: polygon vertex at (${p.y},${p.z}) lies within CSG_EPS_LEN of the circle boundary`);
    }
    return d > R;
  });

  // Flat, ordered event list around the polygon boundary: each vertex
  // followed by any crossings found on the edge leaving it.
  const events = [];
  for (let i = 0; i < n; i++) {
    events.push({ kind: "vertex", y: polygon[i].y, z: polygon[i].z, outside: vertexOutside[i], edgeIndex: i });
    const crossings = lineCircleIntersections(polygon[i], polygon[(i + 1) % n], R, `polygon edge ${i}`);
    for (const c of crossings) events.push({ kind: "crossing", y: c.y, z: c.z, edgeIndex: i });
  }

  const firstOutside = events.findIndex((e) => e.kind === "vertex" && e.outside);
  if (firstOutside === -1) {
    throw new Error("csg_boolean_head_fully_inside_haft: every polygon vertex lies inside the circle and no edge exits it — the head does not stick out past the haft");
  }
  const rotated = events.slice(firstOutside).concat(events.slice(0, firstOutside));

  const ring = [];
  let state = false; // outside
  let entryAngle = null;
  let crossingCount = 0;
  for (const e of rotated) {
    if (e.kind === "vertex") {
      if (!state) ring.push({ y: e.y, z: e.z, tag: "polygon", edgeIndex: e.edgeIndex });
      // else: inside the circle — excluded from the union boundary.
    } else {
      crossingCount++;
      const theta = ringAngle2D(e.y, e.z);
      if (!state) {
        // entering inside
        ring.push({ y: e.y, z: e.z, tag: "seam", edgeIndex: e.edgeIndex });
        entryAngle = theta;
        state = true;
      } else {
        // exiting back outside — fill the excluded span with circle-arc samples
        for (const p of sampleArcCCW(entryAngle, theta, R, arcSides)) {
          ring.push({ y: p.y, z: p.z, tag: "circle" });
        }
        ring.push({ y: e.y, z: e.z, tag: "seam", edgeIndex: e.edgeIndex });
        state = false;
        entryAngle = null;
      }
    }
  }
  if (state !== false) {
    throw new Error("csg_boolean_odd_crossing_count: the polygon boundary crosses the circle an odd number of times — not a simple closed curve at this precision");
  }
  if (crossingCount % 2 !== 0) {
    throw new Error("csg_boolean_odd_crossing_count: internal crossing tally is odd");
  }
  if (ring.length < 3) {
    throw new Error("csg_boolean_degenerate_union: resulting union boundary has fewer than 3 points");
  }

  // Defense-in-depth: the output ring must itself be star-shaped from the
  // origin (it is, by construction — this re-verifies rather than assumes).
  assertStarShapedPolygon2D(ring, "union ring");

  return { ring };
}

/**
 * Extrude a 2D ring (as produced by `unionCircleWithPolygon2D`) into a 3D
 * "crossing collar": two copies of the ring placed at x=xLo and x=xHi,
 * connected by a lateral triangle-strip wall — i.e. a uniform-thickness
 * prism of the union cross-section, spanning the X-slab where a head
 * (swept along the crossing axis) genuinely interpenetrates the haft
 * (swept along X). This is a CLOSED prism wall (every ring segment
 * connected, no partial openings) — the two ends (ringLo, ringHi) are left
 * un-capped by design, exactly like `loftClosedTube`'s own un-capped
 * interior ends: the caller bridges each one to the adjoining haft tube's
 * own terminal ring via `bridgeMismatchedRings` (parametric-mesh.js),
 * reusing the SAME already-proven ring-bridging machinery every other
 * junction in this codebase uses — no new bridging logic is introduced
 * here. See parametric-mesh.js's `generateAxeMesh` / `generateHammerMesh`
 * for the full assembly.
 *
 * Quad winding is byte-for-byte the SAME formula `loftClosedTube` uses for
 * its own ring-to-ring quads (a0,b1,b0 / a0,a1,b1 with a=earlier/smaller-x
 * ring, b=later/larger-x ring) — proven outward-facing there, reused here
 * unchanged since the geometric situation (two same-shape rings at
 * different x) is identical.
 *
 * @param {Array<{y:number,z:number}>} ring closed loop (e.g. `unionCircleWithPolygon2D`'s `.ring`)
 * @param {number} xLo
 * @param {number} xHi
 * @returns {{positions:Float32Array, indices:Uint32Array, ringLo:Array<{x,y,z}>, ringHi:Array<{x,y,z}>}}
 */
export function extrudeRingBetweenX(ring, xLo, xHi) {
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new Error(`csg_boolean_bad_polygon: extrudeRingBetweenX needs a ring with >= 3 points, got ${ring?.length}`);
  }
  if (!Number.isFinite(xLo) || !Number.isFinite(xHi) || xHi <= xLo) {
    throw new Error(`csg_boolean_bad_extrude_range: xLo (${xLo}) must be finite and < xHi (${xHi})`);
  }
  const n = ring.length;
  const ringLo = ring.map((p) => ({ x: xLo, y: p.y, z: p.z }));
  const ringHi = ring.map((p) => ({ x: xHi, y: p.y, z: p.z }));

  const positions = [];
  for (const p of ringLo) positions.push(p.x, p.y, p.z);
  for (const p of ringHi) positions.push(p.x, p.y, p.z);
  const hiOffset = n;

  const indices = [];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const a0 = k, a1 = k2, b0 = hiOffset + k, b1 = hiOffset + k2;
    indices.push(a0, b1, b0, a0, a1, b1);
  }

  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    ringLo,
    ringHi,
  };
}

/**
 * Exact area enclosed by a simple closed 2D ring (the shoelace formula) —
 * used to give the beam co-product a REAL cross-sectional area for the
 * crossing collar station (rather than a bounding-shape approximation like
 * the diamond/rectangle momentOfInertia convention elsewhere in this
 * codebase) since axial-load stress (sigma = F/A, the governing check for
 * the "mace-impact"-style use case an axe/hammer haft is checked under)
 * depends on area directly and there is no reason to approximate it when
 * the exact polygon is already in hand.
 *
 * @param {Array<{y:number,z:number}>} ring
 * @returns {number} positive area (absolute value — winding-direction independent)
 */
export function ringArea2D(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.y * q.z - q.y * p.z;
  }
  return Math.abs(a) / 2;
}
