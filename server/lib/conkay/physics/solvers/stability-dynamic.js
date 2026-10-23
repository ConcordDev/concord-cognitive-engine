// server/lib/conkay/physics/solvers/stability-dynamic.js
//
// stability.dynamic — dynamic (ZMP-based) stability with capture-point analysis.
//
// Inputs:
//   - mass: total mass (kg)
//   - gravity: [gx, gy, gz] m/s² (default [0,0,-9.80665])
//   - comTrajectory: array of { p:[x,y,z], v:[vx,vy,vz], a:[ax,ay,az] } (world frame, m, m/s, m/s²)
//   - contacts: array of { aabb: { minX, maxX, minY, maxY, normal:[nx,ny,nz] } } in world frame
//   - frictionCoeff: µ for friction-cone feasibility (default 0.6; null disables check)
//
// Outputs:
//   - frames: array of {
//       zmp: { x, y, z, inContact, contactIndex },
//       capturePoint: { x, y },
//       stabilityMargin: { ... },     // distance to nearest contact boundary (horizontal)
//       feasibility: { frictionOk, normalOk },  // ZMP within friction cone w.r.t. ground normal
//       warnings: []
//     }
//   - aggregate: ok | warn | fail | not_computed
//
// References used:
//   - Vukobratović & Borovac 2004 (ZMP definition)
//   - Pratt et al. 2006 (Capture Point)
//   - Kajita et al. 2001 (ZMP under arbitrary COM motion)

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const G = 9.80665;

/** ZMP = the point on the ground plane where the net ground reaction moment = 0.
 *  Using Kajita's formula for general CoM motion:
 *    zmp = (Σ_i m_i (g × p_i) + Σ_i m_i (a_i × p_i) + d/dt Σ_i m_i (r_i × v_i)) / Σ_i m_i (g·ẑ - a_i·ẑ)
 *  In the common case where the body is one rigid CoM with mass m, gravity g, acceleration a, at height z,
 *  and angular momentum rate L̇, the ZMP in the ground plane (z=0) is:
 *    zmp_x = (m·g·x − m·a_x·z − L̇_y) / (m·(g − a_z))
 *    zmp_y = (m·g·y − m·a_y·z + L̇_x) / (m·(g − a_z))
 *  where L̇ is the rate of change of angular momentum about the CoM.
 *
 *  For a trajectory supplied as discrete samples, we approximate L̇ ≈ 0 (single rigid CoM),
 *  which is the "instantaneous ZMP" used in humanoid walking control.
 */
function zmpFromComTrajectory(frame, gravity) {
  if (!frame.p || !frame.a) return null;
  const gz = gravity[2];
  const denominator = (gz - frame.a[2]);
  if (Math.abs(denominator) < 1e-9) return null;       // gravity-aligned acceleration ⇒ infinite
  const numeratorX = gravity[0] * frame.p[2] - frame.a[0] * frame.p[2];
  // The cleanest form for a single rigid CoM with mass m cancels m:
  //   zmp_x = (g_x·z - a_x·z) / (g_z - a_z)
  // For z=0 (ground plane): zmp_x = 0 / (g_z - a_z) = 0 ... so ZMP is at x = COM·m·g·z / (m·(g - a_z))
  // But that's at the CoM, not on the ground. The correct ground-plane ZMP formula:
  //   zmp_x = (g_x·h - a_x·h) / (g_z - a_z) = (g - a_x_horizontal)·h / (g - a_z) = NOT what I wrote
  // Standard textbook (Kajita 4.31, simplified for single mass, zero angular momentum rate):
  //   zmp_x = (p_x·g_z - a_x·p_z) / (g_z - a_z)
  const x = (frame.p[0] * gz - frame.a[0] * frame.p[2]) / denominator;
  const y = (frame.p[1] * gz - frame.a[1] * frame.p[2]) / denominator;
  return { x, y, z: 0 };
}

/** Instantaneous Capture Point (Pratt 2006): point you must step to in order to come to rest.
 *  For a 3D LIPM with CoM at height z and gravity g, natural frequency ω = sqrt(g / z).
 *  ICP = p_cg + v_cg / ω.
 */
function capturePoint(frame, gravity) {
  if (!frame.p || !frame.v) return null;
  const gz = -gravity[2];        // positive scalar (gravity is -9.81)
  const h = frame.p[2];
  if (h <= 0) return null;
  const omega = Math.sqrt(gz / h);
  if (!Number.isFinite(omega) || omega < 1e-6) return null;
  return {
    x: frame.p[0] + frame.v[0] / omega,
    y: frame.p[1] + frame.v[1] / omega,
    omega,
    height_h: h,
  };
}

/** Distance from a 2-D point (px,py) to the nearest contact boundary, in contact plane.
 *  Returns negative if the point is OUTSIDE the polygon (deepest distance = 0 if on edge).
 *  Inputs: contact = { aabb: { minX, maxX, minY, maxY } }; px, py = world XY.
 */
function distanceToContactAABB(px, py, contact) {
  const a = contact.aabb;
  // Project point into contact plane (assumes contact normal is +z; rotation not handled here).
  const dx = Math.max(a.minX - px, 0, px - a.maxX);
  const dy = Math.max(a.minY - py, 0, py - a.maxY);
  if (dx === 0 && dy === 0) {
    // Inside. The smallest distance to an edge:
    const edgeX = Math.min(a.maxX - px, px - a.minX);
    const edgeY = Math.min(a.maxY - py, py - a.minY);
    return Math.min(edgeX, edgeY);
  }
  return -Math.sqrt(dx * dx + dy * dy);
}

/** Friction-cone check: |tangential force| ≤ µ·normal force.
 *  We approximate normal force as m·(g_z - a_z). Tangential force vector is (m·a_x, m·a_y).
 *  Returns ok if sqrt(ax² + ay²) ≤ µ·(g_z - a_z).
 */
function frictionConeFeasible(frame, gravity, mu) {
  if (mu == null) return { ok: null, reason: "friction-coefficient missing" };
  const ax = frame.a[0], ay = frame.a[1];
  const gz = gravity[2];
  const denom = (gz - frame.a[2]);
  if (Math.abs(denom) < 1e-9) return { ok: null, reason: "denominator zero" };
  const tang = Math.sqrt(ax * ax + ay * ay);
  const normal = -denom;       // positive when frame is on ground
  if (normal <= 0) return { ok: false, reason: "lifted" };
  const ratio = tang / (mu * normal);
  return { ok: ratio <= 1.0, ratio, mu };
}

/** Project ZMP (x, y) onto contacts. Returns the contact index (if any) where the ZMP is inside.
 *  For multiple contacts, we treat the union of AABBs as the support region. A point is
 *  "in contact" if it's inside ANY one AABB. (A more advanced solver would use the convex
 *  hull of multiple foot pads; for the milestone this is sufficient — the humanoid
 *  always chooses foot placements that overlap or that leave room for the CG to fall
 *  within one pad during SS.)
 */
function contactContainingPoint(x, y, contacts) {
  for (let i = 0; i < contacts.length; i += 1) {
    const a = contacts[i].aabb;
    if (x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY) return i;
  }
  return -1;
}

/** Convex-hull support polygon (Andrew's monotone chain) over the contact AABB corners.
 *  Returns { vertices: [{x,y}], area, perimeter } for diagnostics. The polygon
 *  is used to compute the distance from the ZMP to the closest edge of the merged
 *  support region when the ZMP falls between two foot pads.
 */
function convexHullSupport(contacts) {
  const pts = [];
  for (const c of contacts) {
    const a = c.aabb;
    pts.push({ x: a.minX, y: a.minY });
    pts.push({ x: a.maxX, y: a.minY });
    pts.push({ x: a.maxX, y: a.maxY });
    pts.push({ x: a.minX, y: a.maxY });
  }
  if (pts.length === 0) return { vertices: [], area: 0, perimeter: 0 };
  pts.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  const vertices = lower.concat(upper);
  // Area:
  let area = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) / 2;
  let perimeter = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return { vertices, area, perimeter };
}

/** Distance from point (px, py) to polygon defined by vertices (closed, no repeat).
 *  Negative if inside, positive if outside. Standard ray-casting test for inside/outside.
 */
function distanceToPolygon(px, py, verts) {
  if (verts.length === 0) return -Infinity;
  let inside = false;
  let minDist = Infinity;
  const n = verts.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    // Distance to edge i-j:
    const dx = xj - xi, dy = yj - yi;
    const t = ((px - xi) * dx + (py - yi) * dy) / (dx * dx + dy * dy);
    const tc = Math.max(0, Math.min(1, t));
    const cx = xi + tc * dx, cy = yi + tc * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < minDist) minDist = d;
  }
  return inside ? minDist : -minDist;
}

export function stabilityDynamic({ mass = 1, gravity = [0, 0, -G], comTrajectory, contacts = [], frictionCoeff = 0.6 }) {
  if (!Array.isArray(comTrajectory) || comTrajectory.length === 0) {
    return { notComputed: "comTrajectory must be a non-empty array" };
  }
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return { notComputed: "contacts array required (at least one contact patch)" };
  }

  const frames = [];
  let aggregate = "ok";
  const supportPolygon = convexHullSupport(contacts);    // computed once for the set
  for (let i = 0; i < comTrajectory.length; i += 1) {
    const fr = comTrajectory[i];
    const zmp = zmpFromComTrajectory(fr, gravity);
    const cp = capturePoint(fr, gravity);
    const friction = frictionConeFeasible(fr, gravity, frictionCoeff);

    let contactIndex = -1;
    let distance = -Infinity;
    let inContact = false;
    if (zmp) {
      contactIndex = contactContainingPoint(zmp.x, zmp.y, contacts);
      if (contactIndex >= 0) {
        inContact = true;
        distance = distanceToContactAABB(zmp.x, zmp.y, contacts[contactIndex]);
      } else {
        // Use the convex hull of all contact AABBs (merged support polygon).
        distance = distanceToPolygon(zmp.x, zmp.y, supportPolygon.vertices);
        inContact = distance >= 0;
      }
    }

    const warnings = [];
    if (!zmp) warnings.push("zmp_undefined (g·z − a·z ≈ 0)");
    else if (!inContact) warnings.push("zmp outside support polygon");
    if (friction.ok === false) warnings.push("friction cone violated");

    let status = "ok";
    if (!inContact || friction.ok === false) status = "fail";
    else if (distance < 0.005) status = "warn";          // within 5 mm of edge

    if (status === "fail" && aggregate !== "fail") aggregate = "fail";
    else if (status === "warn" && aggregate === "ok") aggregate = "warn";

    frames.push({
      i,
      com: fr.p,
      zmp,
      capturePoint: cp,
      stabilityMargin: { meters: distance, inContact },
      supportPolygon: { vertices: supportPolygon.vertices, area: supportPolygon.area },
      friction,
      status,
      warnings,
    });
  }
  return { status: aggregate, frames };
}

/** Single-pose screening (no trajectory). */
export function stabilityDynamicSingle({ mass = 1, gravity = [0, 0, -G], com, vel = [0, 0, 0], acc = [0, 0, 0], contacts = [], frictionCoeff = 0.6 }) {
  const r = stabilityDynamic({
    mass, gravity,
    comTrajectory: [{ p: com, v: vel, a: acc }],
    contacts,
    frictionCoeff,
  });
  if (r.notComputed) return r;
  return r.frames[0];
}

registerSolver({
  id: "stability.dynamic",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "stability.zmp-capture-point",
  fidelity: 1,
    // Graph-native: runs when any node carries props.stability.dynamic.
  // The props subtree is passed straight through to stabilityDynamic.
  targets: graphTargets("stability.dynamic"),
  run: graphRunner("stability.dynamic", (ctx, id, props) => envelope(stabilityDynamic(props))),
});

export default { stabilityDynamic, stabilityDynamicSingle };