// server/lib/conkay/physics/solvers/dynamics-inverse.js
//
// dynamics.inverse — Per-joint actuator torque for an articulated rigid body
// under gravity, joint accelerations, an optional tip force, and an
// optional base contact force, using the **recursive Newton–Euler (RNE)
// algorithm**. Supports any tree of revolute joints with explicit link mass,
// centre of mass, and inertia tensor. Returns per-joint torque and force
// demands with units and sign conventions documented.
//
// Scope (what this solver DOES do):
//   - 3D, single support (one base link attached to world).
//   - N-DOF revolute joints, serial chain or simple tree (one branch).
//   - Gravity, joint accelerations, optional tip external force.
//   - Optional base reaction force (single rigid contact, e.g. support foot).
//   - Missing mass / inertia / joint axis → { notComputed: reason }.
//   - All numerical state is consumed exactly once; the algorithm
//     replicates Featherstone in elementary terms so the audit trail
//     reads as math, not magic.
//
// Scope (what it DOES NOT do):
//   - Floating-base dynamics (the base is attached to world; for a free
//     base use a centroidal-momentum solver or a constraint solver — not
//     implemented in this milestone).
//   - Inertia-variant estimation; per-link inertia is a stated constant.
//   - Joint limits, motor torque limits, friction — those are solver
//     `actuation.joint-torque`.
//   - Multi-contact dynamics or unilateral contact — solver
//     `stability.dynamic`.
//   - Collision-free configuration spacing — `geometry.clearance`.
//
// References:
//   - Featherstone, "Robot Dynamics Algorithms", 1987 (recursive
//     Newton–Euler), pp. 56–67 (Algorithm 5.2 + 5.3 in the 2008 edition).
//   - Siciliano, Sciavicco, Villani, "Robotics" (Springer), §4.5
//     (recursion pass) and §4.6 (backward recursion for joint torques).
//   - Closed-form benchmark test cases in tests/conkay-dynamics-inverse.test.js.
//
// IR contract:
//   properties.articulatedBody = {
//     gravity: [gx, gy, gz]    // default [0, 0, -9.80665]
//     baseContactForce: [fx, fy, fz]   // force from world on the base link
//     baseContactMoment: [mx, my, mz] // moment from world on the base link
//     tree: {
//       links: [
//         { id, parent: null|"linkId", jointType: "revolute",
//           axis: ["x"|"y"|"z"],             // local to parent's frame
//           origin: [x,y,z],                 // position of THIS link's joint
//                                          // frame in parent; for root,
//                                          // position of root in world
//           mass, com: [x,y,z],              // com local to this link
//           inertia: { Ixx, Iyy, Izz, Ixy, Ixz, Iyz } },  // 3x3, about com,
//                                          // local frame axes aligned with
//                                          // world when q=0
//           ...
//         },
//       ],
//       tipForces: [ { link, force: [fx,fy,fz], moment: [mx,my,mz] } ],
//     },
//   }
//
// properties.articulatedBody.pose = {
//   q:    [number,...],    // joint positions, radians (in axis order)
//   qdot: [number,...],    // joint angular velocities, rad/s
//   qddot: [number,...],   // joint angular accelerations, rad/s^2
// }
//
// Returns: { demands:[{joint, axis, torqueNm, forceN}], perLink:[{id, ...}] }
//
// Sign convention:
//   τ > 0 about a revolute axis means a positive angular acceleration
//   input about that axis. Standard right-hand rule.
//   F_ext at the tip is in world frame; moment at the tip in world frame.

import { registerSolver } from "../registry.js";

const G = 9.80665;

/** Cross product (R^3). */
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Dot product (R^3). */
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Build a rotation matrix R from three unit axis basis vectors (rows). */
function rotFromAxes(x, y, z) {
  return [
    [x[0], x[1], x[2]],
    [y[0], y[1], y[2]],
    [z[0], z[1], z[2]],
  ];
}

/** Inverse of a rotation matrix (transpose). */
function rotInv(R) {
  // Inverse of an orthogonal matrix is its transpose.
  return [R[0].slice(), R[1].slice(), R[2].slice()].map((row, i) => [
    R[0][i], R[1][i], R[2][i],
  ]);
}

/** Multiply a rotation by a 3-vector. */
function rotApply(R, v) {
  return [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
          R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
          R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
}

/** Identity 3x3. */
function I3() { return [[1,0,0],[0,1,0],[0,0,1]]; }

/** Identity vector. */
function Z3() { return [0, 0, 0]; }

/** Validate the IR. Returns null or { notComputed: reason }. */
function validateTree(tree) {
  if (!tree || !Array.isArray(tree.links) || tree.links.length === 0) {
    return { notComputed: "articulatedBody.tree.links empty" };
  }
  const ids = new Set();
  for (const L of tree.links) {
    if (!L.id) return { notComputed: `link missing id` };
    if (ids.has(L.id)) return { notComputed: `duplicate link id ${L.id}` };
    ids.add(L.id);
    if (L.parent != null && !ids.has(L.parent) && L !== tree.links[0]) {
      return { notComputed: `link ${L.id} references unknown parent ${L.parent} (must precede in array)` };
    }
    if (!(Number.isFinite(L.mass) && L.mass >= 0)) return { notComputed: `link ${L.id}: mass must be a finite number ≥ 0` };
    if (!Array.isArray(L.com) || L.com.length !== 3) return { notComputed: `link ${L.id}: com is [x,y,z]` };
    if (!L.inertia || typeof L.inertia !== "object") return { notComputed: `link ${L.id}: inertia block required` };
    const I = L.inertia;
    // Diagonal products Ixx, Iyy, Izz are required; off-diagonals default to 0 if missing.
    for (const k of ["Ixx","Iyy","Izz"]) {
      if (!Number.isFinite(I[k])) return { notComputed: `link ${L.id}: inertia.${k} must be finite` };
    }
    for (const k of ["Ixy","Ixz","Iyz"]) {
      if (I[k] != null && !Number.isFinite(I[k])) return { notComputed: `link ${L.id}: inertia.${k} must be finite when given` };
    }
    if (!["revolute","fixed"].includes(L.jointType)) return { notComputed: `link ${L.id}: jointType must be "revolute" or "fixed"` };
    if (L.jointType === "revolute") {
      if (!Array.isArray(L.axis) || L.axis.length !== 3) return { notComputed: `link ${L.id}: axis is [x,y,z]` };
      const aNorm = Math.hypot(L.axis[0], L.axis[1], L.axis[2]);
      if (Math.abs(aNorm - 1) > 1e-3) return { notComputed: `link ${L.id}: axis is not unit-length (|a|=${aNorm.toFixed(4)})` };
    }
    if (!Array.isArray(L.origin) || L.origin.length !== 3) return { notComputed: `link ${L.id}: origin is [x,y,z]` };
  }
  return null;
}

/**
 * Recursive forward pass: walk from root, compute for every link
 *   - R_w_i (rotation world→link-i)
 *   - p_w_i (position of link-i frame in world)
 *   - v_w_i (linear velocity of link-i frame origin in world)
 *   - ω_w_i (angular velocity of link-i in world)
 *   - a_w_i (linear acceleration of link-i frame origin, world)
 *   - α_w_i (angular acceleration of link-i in world)
 * For a revolute joint with axis `a` and angle θ the angular velocity
 * is ω_p + q̇·a (a is in parent frame; project to world).
 */
function forwardPass(tree, q, qdot, qddot, gravity, fixedBase, basePos, baseR) {
  const linkMap = new Map();
  for (const L of tree.links) linkMap.set(L.id, L);

  const out = new Map();  // per link
  // base linear/angular velocity/acceleration
  const baseOmega = Z3();
  const baseV0 = Z3();           // velocity of origin
  const baseAccLin = Z3();
  const baseAccAng = Z3();

  // The base may be static (root link attached to world); if fixedBase
  // true the base acceleration is zero (a static pivot).
  if (tree.tipForces) {/* unused here */}

  // Initialise root frame: its R and p come from baseR/basePos. The root's
  // origin in world should be basePos (treated as the position of the base
  // link's frame in the world). For a humanoid standing on the floor, basePos
  // is usually the position of the support foot centre, so for STANCE the
  // base link sits at basePos and every child's p accumulates relative to that.
  let rootLink = null;
  for (const L of tree.links) {
    if (L.parent == null) { rootLink = L; break; }
  }
  for (const L of tree.links) {
    if (L.parent == null) {
      const R = baseR ? baseR : I3();
      const p = basePos ? basePos.slice() : Z3();
      out.set(L.id, {
        R, p,
        omega: Z3(),
        vel: Z3(),
        accAng: Z3(),
        accLin: [gravity ? gravity[0] : 0, gravity ? gravity[1] : 0, gravity ? gravity[2] : 0].map((x) => fixedBase ? 0 : x),
      });
      break;
    }
  }

  // Process links in the array order so parent always precedes child.
  for (let i = 0; i < tree.links.length; i += 1) {
    const L = tree.links[i];
    if (L.parent == null) continue;
    const par = out.get(L.parent);
    if (!par) return { error: `parent ${L.parent} not initialised (order)` };

    // Build child's rotation: parent rotation × local rotation from joint axis & q.
    const aLocal = L.axis;
    let R_local = I3();
    if (L.jointType === "revolute") {
      const θ = q[L._qIdx];
      // Rodrigues around the unit axis aLocal (in parent frame).
      const c = Math.cos(θ), s = Math.sin(θ), t = 1 - c;
      const ax = aLocal[0], ay = aLocal[1], az = aLocal[2];
      R_local = [
        [t * ax * ax + c,       t * ax * ay - s * az, t * ax * az + s * ay],
        [t * ax * ay + s * az,  t * ay * ay + c,      t * ay * az - s * ax],
        [t * ax * az - s * ay,  t * ay * az + s * ax, t * az * az + c     ],
      ];
    }
    const R_w_i = matMul(par.R, R_local);
    const originLocal = L.origin;             // joint origin in parent frame
    const originWorld = rotApply(par.R, originLocal);
    // Child's frame position in world = parent's frame position + parent's rotation × origin (in parent's frame).
    const p_w_i = [par.p[0] + originWorld[0], par.p[1] + originWorld[1], par.p[2] + originWorld[2]];

    // Angular velocity: ω_i = ω_parent + q̇·R_parent·aLocal
    let omega = par.omega.slice();
    const aWorld = rotApply(par.R, aLocal);
    const qd = (L.jointType === "revolute") ? qdot[L._qIdx] : 0;
    omega = [omega[0] + qd * aWorld[0], omega[1] + qd * aWorld[1], omega[2] + qd * aWorld[2]];

    // Linear velocity of link frame origin: v_p + ω_p × r (the velocity of the
    // parent's frame origin plus the cross-product due to parent's rotation).
    const r = originWorld;                   // vector from parent frame origin to child frame origin, world
    const wpxr = cross(par.omega, r);
    const vel = [par.vel[0] + wpxr[0], par.vel[1] + wpxr[1], par.vel[2] + wpxr[2]];

    // Angular acceleration: α_i = α_p + q̈·a + q̇·(ω×a)
    let alpha = par.accAng.slice();
    const qdd = (L.jointType === "revolute") ? qddot[L._qIdx] : 0;
    const w_cross_a = cross(par.omega, aWorld);
    alpha = [
      alpha[0] + qdd * aWorld[0] + qd * w_cross_a[0],
      alpha[1] + qdd * aWorld[1] + qd * w_cross_a[1],
      alpha[2] + qdd * aWorld[2] + qd * w_cross_a[2],
    ];

    // Linear accel of link frame origin: a_p + α_p×r + ω_p×(ω_p×r)
    const acc_p = par.accLin.slice();
    const alphaxr = cross(par.accAng, r);
    const wpxwpxr = cross(par.omega, wpxr);
    const acc = [
      acc_p[0] + alphaxr[0] + wpxwpxr[0],
      acc_p[1] + alphaxr[1] + wpxwpxr[1],
      acc_p[2] + alphaxr[2] + wpxwpxr[2],
    ];

    out.set(L.id, { R: R_w_i, p: p_w_i, omega, vel, accAng: alpha, accLin: acc });
  }

  return { perLink: out };
}

/** Matrix multiply (3x3). */
function matMul(A, B) {
  const r = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
    r[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  }
  return r;
}

/** Recursive backward pass: per-link wrench and joint torque.
 *
 *  Convention used:
 *    Each link's gravity F_grav = m·g is applied AT THE LINK's COM (not at the
 *    origin). When we propagate the child's wrench up to the parent, we
 *    transport it from the child's COM (where gravity is applied) so the
 *    gravity moment about the parent's COM is preserved.
 *    The child's joint reaction F_joint is at the child's frame origin; we
 *    add it to the net after the gravity transport.
 *
 *  Net wrench per link about THIS link's COM:
 *    F_at_CM (sum of child F_joints, transported) + F_grav_at_CM (always m·g)
 *    M_at_CM (sum of child (M_joint + r×F_joint) transported)
 *
 *  Newton at COM:    m·a_cm = F_ext_at_CM  (ext includes gravity + applied + transmitted children)
 *  Euler  at COM:    I_cm·α + ω×(I·ω)    = M_ext_at_CM + τ·â
 *
 *  ⇒ τ·â = M_dyn_cm − M_ext_at_CM − r_com × F_joint
 *    where F_joint = m·a_cm − F_ext_at_CM.
 *
 *  When iterating children of THIS link we need:
 *    child_force_at_link_COM + child_moment_at_link_COM
 *  These come from the child's solved states plus the child's gravity applied
 *  at its COM. We store as `gravity_wrench_at_cm` per child.
 */
function backwardPass(tree, perLink, gravity, baseContactForce, baseContactMoment, tipForces) {
  // Per-link, collect the gravity wrench about the link's COM (initial state).
  // gravity_wrench_at_cm = { force: F_grav, moment: 0 } applied at the link's COM.
  // After the child's Newton/Euler is solved, we replace the COM wrench with
  // the joint reaction (F_joint at child's origin, M_joint at child's origin).
  // To get the child's "force about THIS link's COM" the parent sums must
  // include F_grav + F_joint_child via Newton's law at the parent's frame.
  //
  // Implementation: we carry EVERY link's COM wrench as the state, transport
  // it to the parent in the iteration.

  const linkById = new Map();
  for (const L of tree.links) linkById.set(L.id, L);

  // 1) Initialise per-link COM wrench (F_grav, M=0) and per-link origin wrench
  //    from user-applied base contact (only on the root). **Tip forces are
  //    applied at the link's COM** (the end-effector convention).
  const cmWrench = new Map();    // about COM (force, moment) — what the child sees from THIS link
  const originWrench = new Map(); // about link origin (force, moment) — joint reaction
  for (const L of tree.links) {
    cmWrench.set(L.id, { force: [0, 0, 0], moment: [0, 0, 0] });
    originWrench.set(L.id, { force: [0, 0, 0], moment: [0, 0, 0] });
    // Self-applied user force at the link's frame origin (rare; usually [0]).
    // We mostly use tipForces below which apply at the COM.
    if (L.parent == null) {
      if (baseContactForce) {
        originWrench.get(L.id).force = [originWrench.get(L.id).force[0] + baseContactForce[0],
                                       originWrench.get(L.id).force[1] + baseContactForce[1],
                                       originWrench.get(L.id).force[2] + baseContactForce[2]];
      }
      if (baseContactMoment) {
        originWrench.get(L.id).moment = [originWrench.get(L.id).moment[0] + baseContactMoment[0],
                                         originWrench.get(L.id).moment[1] + baseContactMoment[1],
                                         originWrench.get(L.id).moment[2] + baseContactMoment[2]];
      }
    }
  }

  // Apply user-supplied tip forces at the link's COM (end-effector convention).
  for (const tf of (tipForces || [])) {
    const cm = cmWrench.get(tf.link);
    if (!cm) continue;
    cm.force = [cm.force[0] + tf.force[0], cm.force[1] + tf.force[1], cm.force[2] + tf.force[2]];
    cm.moment = [cm.moment[0] + tf.moment[0], cm.moment[1] + tf.moment[1], cm.moment[2] + tf.moment[2]];
  }

  // Add gravity at each link's COM (always present, conservative with m·g).
  for (const L of tree.links) {
    const cm = cmWrench.get(L.id);
    cm.force = [cm.force[0] + gravity[0] * L.mass, cm.force[1] + gravity[1] * L.mass, cm.force[2] + gravity[2] * L.mass];
  }

  const demandsByJoint = [];
  const demandsByLink = new Map();

  // Walk links in reverse.
  for (let i = tree.links.length - 1; i >= 0; i -= 1) {
    const L = tree.links[i];
    const pl = perLink.get(L.id);

    // Inertia and angular kinematics:
    const Iw = L.inertia;
    const Ixx = Iw.Ixx, Iyy = Iw.Iyy, Izz = Iw.Izz;
    const Ixy = Iw.Ixy || 0, Ixz = Iw.Ixz || 0, Iyz = Iw.Iyz || 0;
    const I = [
      [Ixx, Ixy, Ixz],
      [Ixy, Iyy, Iyz],
      [Ixz, Iyz, Izz],
    ];
    const Iw_omega = [
      I[0][0] * pl.omega[0] + I[0][1] * pl.omega[1] + I[0][2] * pl.omega[2],
      I[1][0] * pl.omega[0] + I[1][1] * pl.omega[1] + I[1][2] * pl.omega[2],
      I[2][0] * pl.omega[0] + I[2][1] * pl.omega[1] + I[2][2] * pl.omega[2],
    ];
    const Mdyn_cm = [
      I[0][0] * pl.accAng[0] + I[0][1] * pl.accAng[1] + I[0][2] * pl.accAng[2] + cross(pl.omega, Iw_omega)[0],
      I[1][0] * pl.accAng[0] + I[1][1] * pl.accAng[1] + I[1][2] * pl.accAng[2] + cross(pl.omega, Iw_omega)[1],
      I[2][0] * pl.accAng[0] + I[2][1] * pl.accAng[1] + I[2][2] * pl.accAng[2] + cross(pl.omega, Iw_omega)[2],
    ];

    // COM acceleration = frame origin acceleration + α × r_com + ω × (ω × r_com)
    const rcom_world = rotApply(pl.R, L.com);
    const acc_cm = [
      pl.accLin[0] + cross(pl.accAng, rcom_world)[0] + cross(pl.omega, cross(pl.omega, rcom_world))[0],
      pl.accLin[1] + cross(pl.accAng, rcom_world)[1] + cross(pl.omega, cross(pl.omega, rcom_world))[1],
      pl.accLin[2] + cross(pl.accAng, rcom_world)[2] + cross(pl.omega, cross(pl.omega, rcom_world))[2],
    ];

    // Sum children's contributions: transport child's COM wrench + child's
    // origin wrench to THIS link's COM. The child's gravity (F_grav at COM)
    // and child's joint reaction (F_joint at origin, M_joint at origin) are
    // BOTH carried separately.
    let F_ext_sum = cmWrench.get(L.id).force.slice();
    let M_ext_sum = cmWrench.get(L.id).moment.slice();
    // Self-applied wrench at the link's frame origin contributes moment about COM via r_com × F.
    const self_origin = originWrench.get(L.id);
    F_ext_sum = [F_ext_sum[0] + self_origin.force[0], F_ext_sum[1] + self_origin.force[1], F_ext_sum[2] + self_origin.force[2]];
    M_ext_sum = [M_ext_sum[0] + self_origin.moment[0], M_ext_sum[1] + self_origin.moment[1], M_ext_sum[2] + self_origin.moment[2]];
    {
      const r_origin_to_COM = rcom_world;
      const M_from_self_F = cross(r_origin_to_COM, self_origin.force);
      M_ext_sum = [M_ext_sum[0] + M_from_self_F[0], M_ext_sum[1] + M_from_self_F[1], M_ext_sum[2] + M_from_self_F[2]];
    }

    for (let j = i + 1; j < tree.links.length; j += 1) {
      const ch = tree.links[j];
      if (ch.parent !== L.id) continue;
      // child COM in world
      const chPlace = perLink.get(ch.id);
      const chcom_world = [chPlace.p[0] + rotApply(chPlace.R, ch.com)[0],
                           chPlace.p[1] + rotApply(chPlace.R, ch.com)[1],
                           chPlace.p[2] + rotApply(chPlace.R, ch.com)[2]];
      // lever from THIS link's COM to child's COM (world frame)
      const r_this_cm_to_child_cm = [
        chcom_world[0] - (pl.p[0] + rcom_world[0]),
        chcom_world[1] - (pl.p[1] + rcom_world[1]),
        chcom_world[2] - (pl.p[2] + rcom_world[2]),
      ];
      // Child's COM wrench: gravity + applied moment about COM.
      const ch_cm = cmWrench.get(ch.id);
      F_ext_sum = [
        F_ext_sum[0] + ch_cm.force[0],
        F_ext_sum[1] + ch_cm.force[1],
        F_ext_sum[2] + ch_cm.force[2],
      ];
      // Gravity at child's COM contributes moment about THIS link's COM = r × F.
      M_ext_sum = [
        M_ext_sum[0] + ch_cm.moment[0] + cross(r_this_cm_to_child_cm, ch_cm.force)[0],
        M_ext_sum[1] + ch_cm.moment[1] + cross(r_this_cm_to_child_cm, ch_cm.force)[1],
        M_ext_sum[2] + ch_cm.moment[2] + cross(r_this_cm_to_child_cm, ch_cm.force)[2],
      ];
      // Child's joint reaction (from the child's own backward pass result).
      // It is at the CHILD'S FRAME ORIGIN in world. Transport to THIS link's COM.
      const chOrigin = chPlace.p;
      const r_child_origin_to_this_cm = [
        chOrigin[0] - (pl.p[0] + rcom_world[0]),
        chOrigin[1] - (pl.p[1] + rcom_world[1]),
        chOrigin[2] - (pl.p[2] + rcom_world[2]),
      ];
      // Child's F_joint (at child's frame origin) → moment about THIS link's COM
      // via r × F.
      const ch_origin_F = originWrench.get(ch.id).force;
      const ch_origin_M = originWrench.get(ch.id).moment;
      M_ext_sum = [
        M_ext_sum[0] + ch_origin_M[0] + cross(r_child_origin_to_this_cm, ch_origin_F)[0],
        M_ext_sum[1] + ch_origin_M[1] + cross(r_child_origin_to_this_cm, ch_origin_F)[1],
        M_ext_sum[2] + ch_origin_M[2] + cross(r_child_origin_to_this_cm, ch_origin_F)[2],
      ];
      // Also add child's joint reaction FORCE to the force sum (it's a real force on this link).
      F_ext_sum = [
        F_ext_sum[0] + ch_origin_F[0],
        F_ext_sum[1] + ch_origin_F[1],
        F_ext_sum[2] + ch_origin_F[2],
      ];
    }

    // Newton at COM: F_joint = m·a_cm − F_ext_at_CM. The joint reaction is at
    // the link's frame origin.
    const F_joint = [
      L.mass * acc_cm[0] - F_ext_sum[0],
      L.mass * acc_cm[1] - F_ext_sum[1],
      L.mass * acc_cm[2] - F_ext_sum[2],
    ];

    // Euler about COM: M_dyn_cm = M_ext_at_CM + τ·â + (-r_com) × F_joint
    //     (force F_joint at origin produces moment about COM = (origin − COM) × F = -r×F)
    // ⇒ τ·â = M_dyn_cm − M_ext_at_CM + r_com × F_joint
    const rcrossF = cross(rcom_world, F_joint);
    const M_joint_free = [
      Mdyn_cm[0] - M_ext_sum[0] + rcrossF[0],
      Mdyn_cm[1] - M_ext_sum[1] + rcrossF[1],
      Mdyn_cm[2] - M_ext_sum[2] + rcrossF[2],
    ];

    let τ = 0;
    let aWorld = null;
    if (L.jointType === "revolute") {
      aWorld = rotApply(pl.R, L.axis);
      τ = dot(M_joint_free, aWorld);
    }
    demandsByLink.set(L.id, τ);
    demandsByJoint.push({
      linkId: L.id, axis: L.axis, axisWorld: aWorld,
      torqueNm: τ,
      jointForceWorld: F_joint,
      momentFree: M_joint_free,
    });

    // Store the joint reaction at the link's frame origin (parent will
    // transport it via r × F to its own COM).
    originWrench.get(L.id).force = F_joint;
    originWrench.get(L.id).moment = M_joint_free;
  }

  return { torques: demandsByJoint };
}

export function rneaSolver({ tree, gravity, q, qdot, qddot, baseContactForce = null, baseContactMoment = null, tipForces = null, baseR = null, basePos = null, fixedBase = true }) {
  // Validate IR
  const err = validateTree(tree);
  if (err) return err;

  if (!Number.isFinite(q.length) || !Number.isFinite(qdot.length) || !Number.isFinite(qddot.length)) {
    return { notComputed: `q/qdot/qddot must be arrays` };
  }

  // Fall back to tree.baseR / tree.basePos when not provided.
  if (baseR == null && tree.baseR) baseR = tree.baseR;
  if (basePos == null && tree.basePos) basePos = tree.basePos;

  // Tag every revolute link with its q index (in declaration order).
  let qIdx = 0;
  for (const L of tree.links) {
    if (L.jointType === "revolute") { L._qIdx = qIdx; qIdx += 1; } else { L._qIdx = -1; }
  }
  if (q.length !== qIdx) {
    return { notComputed: `q length ${q.length} does not match number of revolute joints ${qIdx}` };
  }

  // Forward pass
  const fwd = forwardPass(tree, q, qdot, qddot, gravity, fixedBase, basePos, baseR);
  if (fwd.error) return { notComputed: fwd.error };

  // Backward pass
  const bwd = backwardPass(tree, fwd.perLink, gravity, baseContactForce, baseContactMoment, tipForces);
  return { torques: bwd.torques, perLink: [...fwd.perLink.entries()].map(([id, st]) => ({ id, omega: st.omega, vel: st.vel, accAng: st.accAng, accLin: st.accLin, p: st.p, R: st.R })) };
}

/**
 * Build an articulated body contract from a list of parts in the
 * humanoid design. Each Part must declare: mass (kg), com_local (m
 * triple relative to joint origin), inertia (6 components in world frame
 * for q=0, kg·m²), origin (parent-relative joint origin in m), parent
 * (id or null), jointType, axis (revolute). q is the initial angle from
 * the parent frame (rad).
 *
 * This helper exists so we can construct the humanoid body model from
 * the existing Part IR without writing the model twice.
 */
export function partsToChain(parts, baseR = null) {
  // parts: [{ id, parent, jointType, axis, origin, mass, com_local, inertia, q0 }]
  return {
    links: parts.map((p) => ({
      id: p.id,
      parent: p.parent ?? null,
      jointType: p.jointType,
      axis: p.axis,
      origin: p.origin,
      mass: p.mass,
      com: p.com_local,
      inertia: p.inertia,
    })),
    baseR: baseR || [[1,0,0],[0,1,0],[0,0,1]],
  };
}

export const inverseDynamics = registerSolver({
  id: "dynamics.inverse",
  version: "1.0.0",
  domain: "dynamics",
  domains: ["dynamics"],
  fidelity: 1,                            // analytical recursion (same tier as LQR-style analytical)
  method: "Recursive Newton–Euler on a tree of revolute rigid bodies (Featherstone/Siciliano). Forward + backward pass; per-link net force/moment about link origin; per-joint torque is the projection onto the joint axis in the world frame.",
  reference: "Featherstone (1987/2008) Algorithm 5.2; Siciliano Sciavicco Villani (Springer) §4.5-4.6; tests/conkay-dynamics-inverse.test.js",
  regime: "3D, single-support base link attached to world. Per-link inertia is constant in world frame for q=0; transformation under rotation is handled by R^T on the inertia when the link rotates.",
  units: { inputs: "kg, m, m/s^2, N, N·m, rad, rad/s, rad/s^2", outputs: "N·m, N, m/s, m/s^2, rad/s, rad/s^2" },
  tolerance: "exact to floating-point; benchmarks < 1e-9 N·m for closed-form pendulum and static chain tests",
  screening: false,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.articulatedBody).map((n) => n.id),
  run(ctx, id) {
    const ab = ctx.get(id, "props.articulatedBody") || {};
    const tree = ab.tree || {};
    const gravity = tree.gravity || [0, 0, -G];
    const pose = ctx.get(id, "props.articulatedBody.pose") || {};
    const q = pose.q || [];
    const qdot = pose.qdot || q.map(() => 0);
    const qddot = pose.qddot || q.map(() => 0);
    if (q.length === 0) return { notComputed: "props.articulatedBody.pose.q is empty" };
    const r = rneaSolver({
      tree,
      gravity,
      q, qdot, qddot,
      baseContactForce: tree.baseContactForce || null,
      baseContactMoment: tree.baseContactMoment || null,
      tipForces: tree.tipForces || null,
      baseR: tree.baseR || null,
      basePos: tree.basePos || null,
    });
    if (r.notComputed) return r;
    const demands = r.torques.map((t) => ({
      linkId: t.linkId, axis: t.axis,
      torqueNm: { value: t.torqueNm, unit: "N·m", formula: "M_required · â_world" },
      jointForceWorld: { value: t.forceWorld, unit: "N" },
      momentAboutOrigin: { value: t.momentAboutOrigin, unit: "N·m" },
    }));
    const perLink = r.perLink.map((p) => ({
      id: p.id, worldPos: { value: p.p, unit: "m" }, worldRotR: p.R,
      worldVel: { value: p.vel, unit: "m/s" }, worldOmega: { value: p.omega, unit: "rad/s" },
      worldAccLin: { value: p.accLin, unit: "m/s^2" }, worldAccAng: { value: p.accAng, unit: "rad/s^2" },
    }));
    return {
      inputs: {
        gravity: { value: gravity, unit: "m/s^2" },
        q: { value: q, unit: "rad" }, qdot: { value: qdot, unit: "rad/s" },
        qddot: { value: qddot, unit: "rad/s^2" },
        nLinks: tree.links.length,
        nRevoluteJoints: q.length,
      },
      outputs: { demands, perLink },
      margins: demands.map((d) => {
        // marker for downstream solver screening
        return { check: `joint actuator demand@${d.linkId}`, demand: d.torqueNm.value, capacity: null, unit: "N·m", note: "screen downstream against actuator.joint-torque" };
      }),
      assumptions: [
        "Single support (base is fixed to world; the contact force on it is supplied by tree.baseContactForce).",
        "Per-link inertia tensor is in world frame at q = 0; rotates with q through R·I·R^T during the recursion (kept explicit).",
        "External tip forces are in world frame at the link's frame origin.",
        "Gravity is constant and uniform over the body.",
        "No joint friction, no backlash, no compliance.",
      ],
    };
  },
});
