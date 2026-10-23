// server/lib/conkay/physics/solvers/dynamics-full-body-rnea.js
//
// dynamics.full-body-rnea — Whole-body RNEA wrapper for a full humanoid tree
// (pelvis base + torso + head + two arms of three joints each + two legs of
// four joints each). Calls the per-joint solver `rneaSolver` from
// `dynamics.inverse` and adds:
//
//   • per-joint torques grouped by body region (legs / arms / torso / head /
//     other) — case-insensitive substring match on the link id;
//
//   • horizontal gravity moment about the base origin (project onto the x-y
//     plane of the world);
//
//   • total mass and total vertical reaction force (= m·G);
//
//   • best-effort whole-body angular momentum about the base link frame
//     origin via the same forward recursion RNEA uses. If the inner solver
//     reports notComputed, the angular momentum field is reported as
//     { notComputed: true, reason: ... } — never fabricated;
//
//   • optional torque-limit check. Sets status = "fail" (not "not_computed")
//     when |τ| exceeds the supplied limit; lists offending joint ids in
//     overLimitJoints.
//
// This wrapper does NOT modify dynamics.inverse. It only consumes its public
// export `rneaSolver({ tree, gravity, q, qdot, qddot, … })`.
//
// Sign convention matches `dynamics.inverse`: τ > 0 about a revolute axis
// means a positive angular acceleration input about that axis (right-hand
// rule). World frame is z-up.

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";
import { rneaSolver } from "./dynamics-inverse.js";

const G = 9.80665;

/* ----------------------------- vector helpers ----------------------------- */
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vecScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vecAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vecSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vecLen(a) {
  const n = Math.hypot(a[0], a[1], a[2]);
  return Number.isFinite(n) ? n : 0;
}
function finOr(x, fallback = 0) { return Number.isFinite(x) ? x : fallback; }
function guardDiv(num, den, fallback = 0) {
  const n = finOr(num, 0), d = finOr(den, 0);
  if (Math.abs(d) < 1e-30) return fallback;
  return n / d;
}

/* ------------------------- region classification ------------------------- */
// Region by case-insensitive substring on link id. Order matters: we test
// the more specific tokens before broad ones so that e.g. "left_hand" lands
// in "arms" not in some other category.
const REGION_RULES = [
  { name: "legs",  tokens: ["leg", "thigh", "shin", "foot", "knee", "hip", "ankle"] },
  { name: "arms",  tokens: ["arm", "shoulder", "elbow", "forearm", "hand", "wrist"] },
  { name: "torso", tokens: ["torso", "pelvis", "chest", "waist", "abdomen", "trunk"] },
  { name: "head",  tokens: ["head", "neck"] },
];
function classifyRegion(id) {
  const hay = String(id || "").toLowerCase();
  for (const rule of REGION_RULES) {
    if (rule.tokens.some((t) => hay.includes(t))) return rule.name;
  }
  return "other";
}

/* --------------- local forward pass to recover world kinematics ------------ */
// We re-derive world position, orientation, angular velocity, and linear
// velocity for each link using the same formulae `dynamics-inverse.forwardPass`
// uses. This avoids mutating the input tree and works even when the inner
// solver returned `notComputed`.
function localForwardPass(tree, q, qdot, qddot, baseR, basePos) {
  const linkMap = new Map();
  for (const L of tree.links) linkMap.set(L.id, L);

  // Build per-link q index without mutating the original links.
  const qIdx = new Map();
  let qc = 0;
  for (const L of tree.links) {
    if (L.jointType === "revolute") { qIdx.set(L.id, qc); qc += 1; }
    else { qIdx.set(L.id, -1); }
  }

  const out = new Map();
  const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const Z3 = () => [0, 0, 0];

  const rootLink = tree.links.find((L) => L.parent == null);
  if (!rootLink) return { ok: false, reason: "no root link (parent == null)" };
  const R0 = baseR || I3;
  const p0 = basePos ? basePos.slice() : [0, 0, 0];

  out.set(rootLink.id, {
    R: R0.map((row) => row.slice()),
    p: p0.slice(),
    omega: Z3(),
    vel: Z3(),
    accAng: Z3(),
    accLin: Z3(),
  });

  for (const L of tree.links) {
    if (L.parent == null) continue;
    const par = out.get(L.parent);
    if (!par) return { ok: false, reason: `parent ${L.parent} not initialised (order)` };

    // Rodrigues rotation about the local axis (axes are in parent's frame).
    const aLocal = L.axis || [0, 0, 1];
    let R_local = I3;
    if (L.jointType === "revolute") {
      const θ = finOr(q[qIdx.get(L.id)], 0);
      const c = Math.cos(θ), s = Math.sin(θ), t = 1 - c;
      const ax = aLocal[0], ay = aLocal[1], az = aLocal[2];
      R_local = [
        [t * ax * ax + c,        t * ax * ay - s * az,  t * ax * az + s * ay],
        [t * ax * ay + s * az,   t * ay * ay + c,       t * ay * az - s * ax],
        [t * ax * az - s * ay,   t * ay * az + s * ax,  t * az * az + c],
      ];
    }
    const R_w_i = matMul(par.R, R_local);

    // Origin (in parent frame) rotated into world.
    const originWorld = rotApply(par.R, L.origin || [0, 0, 0]);
    const p_w_i = vecAdd(par.p, originWorld);
    const r = originWorld;

    // Axis in world.
    const aWorld = rotApply(par.R, aLocal);
    const qd = (L.jointType === "revolute") ? finOr(qdot[qIdx.get(L.id)], 0) : 0;
    const omega = vecAdd(par.omega, vecScale(aWorld, qd));

    const wpxr = cross(par.omega, r);
    const vel = vecAdd(par.vel, wpxr);

    const qdd = (L.jointType === "revolute") ? finOr(qddot[qIdx.get(L.id)], 0) : 0;
    const w_cross_a = cross(par.omega, aWorld);
    const alpha = vecAdd(
      vecAdd(par.accAng, vecScale(aWorld, qdd)),
      vecScale(w_cross_a, qd),
    );

    const alphaxr = cross(par.accAng, r);
    const wpxwpxr = cross(par.omega, wpxr);
    const accLin = vecAdd(vecAdd(par.accLin, alphaxr), wpxwpxr);

    out.set(L.id, {
      R: R_w_i,
      p: p_w_i,
      omega, vel, accAng: alpha, accLin,
    });
  }

  return { ok: true, perLink: out, qIdx, revoluteCount: qc };
}

function matMul(A, B) {
  return [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0] + A[0][2] * B[2][0],
     A[0][0] * B[0][1] + A[0][1] * B[1][1] + A[0][2] * B[2][1],
     A[0][0] * B[0][2] + A[0][1] * B[1][2] + A[0][2] * B[2][2]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0] + A[1][2] * B[2][0],
     A[1][0] * B[0][1] + A[1][1] * B[1][1] + A[1][2] * B[2][1],
     A[1][0] * B[0][2] + A[1][1] * B[1][2] + A[1][2] * B[2][2]],
    [A[2][0] * B[0][0] + A[2][1] * B[1][0] + A[2][2] * B[2][0],
     A[2][0] * B[0][1] + A[2][1] * B[1][1] + A[2][2] * B[2][1],
     A[2][0] * B[0][2] + A[2][1] * B[1][2] + A[2][2] * B[2][2]],
  ];
}

function rotApply(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

/* --------------------------- gravity moment -------------------------------- */
// World-frame gravity moment about the base origin, projected onto the
// horizontal axes (x and y). For every non-fixed link we add
//   r_com_world × (m·g_world)
// and read out the x and y components.
function gravityMomentAboutBase(perLink, tree, gravity) {
  let mx = 0, my = 0;
  for (const L of tree.links) {
    if (L.jointType === "fixed") continue;
    const m = finOr(L.mass, 0);
    if (m === 0) continue;
    const st = perLink.get(L.id);
    if (!st) continue;
    const comWorld = vecAdd(st.p, rotApply(st.R, L.com || [0, 0, 0]));
    const F = vecScale(gravity, m);                 // F_grav = m·g
    const M = cross(comWorld, F);                  // moment about world origin
    mx += M[0];
    my += M[1];
  }
  return {
    x: finOr(mx, 0),
    y: finOr(my, 0),
    magnitude: vecLen([mx, my, 0]),
  };
}

/* ----------------------- angular momentum about base ----------------------- */
// H_base = Σ_k [ r_com^k × (m_k · v_com^k) + R_k · I_k · R_kᵀ · ω_k ].
// ω_k we already have from the local forward pass; we need the linear
// velocity of each link's COM. The local forward pass gives us the velocity
// of the link's frame origin (v_o). The velocity of the COM is
//   v_com = v_o + ω × r_com
// where r_com is the link's COM offset in world coords.
function angularMomentumAboutBase(perLink, tree) {
  let Hx = 0, Hy = 0, Hz = 0;
  for (const L of tree.links) {
    const m = finOr(L.mass, 0);
    const st = perLink.get(L.id);
    if (!st) continue;
    if (m === 0 && L.inertia == null) continue;

    const r_com_world = rotApply(st.R, L.com || [0, 0, 0]);
    const v_com = vecAdd(st.vel, cross(st.omega, r_com_world));

    // translational part (only nonzero for links with mass)
    const lin = cross(r_com_world, vecScale(v_com, m));
    Hx += lin[0];
    Hy += lin[1];
    Hz += lin[2];

    // rotational part: R · I · Rᵀ · ω  (rotation expressed in world frame).
    // Use the full 3x3 inertia including cross terms if present.
    if (L.inertia) {
      const Iw = L.inertia;
      const Ixx = finOr(Iw.Ixx, 0), Iyy = finOr(Iw.Iyy, 0), Izz = finOr(Iw.Izz, 0);
      const Ixy = finOr(Iw.Ixy, 0), Ixz = finOr(Iw.Ixz, 0), Iyz = finOr(Iw.Iyz, 0);
      // I_world = R · I_body · Rᵀ. We compose using R*I first, then *Rᵀ.
      const I_body = [
        [Ixx, Ixy, Ixz],
        [Ixy, Iyy, Iyz],
        [Ixz, Iyz, Izz],
      ];
      const RI = [
        [
          st.R[0][0] * I_body[0][0] + st.R[0][1] * I_body[1][0] + st.R[0][2] * I_body[2][0],
          st.R[0][0] * I_body[0][1] + st.R[0][1] * I_body[1][1] + st.R[0][2] * I_body[2][1],
          st.R[0][0] * I_body[0][2] + st.R[0][1] * I_body[1][2] + st.R[0][2] * I_body[2][2],
        ],
        [
          st.R[1][0] * I_body[0][0] + st.R[1][1] * I_body[1][0] + st.R[1][2] * I_body[2][0],
          st.R[1][0] * I_body[0][1] + st.R[1][1] * I_body[1][1] + st.R[1][2] * I_body[2][1],
          st.R[1][0] * I_body[0][2] + st.R[1][1] * I_body[1][2] + st.R[1][2] * I_body[2][2],
        ],
        [
          st.R[2][0] * I_body[0][0] + st.R[2][1] * I_body[1][0] + st.R[2][2] * I_body[2][0],
          st.R[2][0] * I_body[0][1] + st.R[2][1] * I_body[1][1] + st.R[2][2] * I_body[2][1],
          st.R[2][0] * I_body[0][2] + st.R[2][1] * I_body[1][2] + st.R[2][2] * I_body[2][2],
        ],
      ];
      const Rt = [
        [st.R[0][0], st.R[1][0], st.R[2][0]],
        [st.R[0][1], st.R[1][1], st.R[2][1]],
        [st.R[0][2], st.R[1][2], st.R[2][2]],
      ];
      const I_world = [
        [RI[0][0] * Rt[0][0] + RI[0][1] * Rt[1][0] + RI[0][2] * Rt[2][0],
         RI[0][0] * Rt[0][1] + RI[0][1] * Rt[1][1] + RI[0][2] * Rt[2][1],
         RI[0][0] * Rt[0][2] + RI[0][1] * Rt[1][2] + RI[0][2] * Rt[2][2]],
        [RI[1][0] * Rt[0][0] + RI[1][1] * Rt[1][0] + RI[1][2] * Rt[2][0],
         RI[1][0] * Rt[0][1] + RI[1][1] * Rt[1][1] + RI[1][2] * Rt[2][1],
         RI[1][0] * Rt[0][2] + RI[1][1] * Rt[1][2] + RI[1][2] * Rt[2][2]],
        [RI[2][0] * Rt[0][0] + RI[2][1] * Rt[1][0] + RI[2][2] * Rt[2][0],
         RI[2][0] * Rt[0][1] + RI[2][1] * Rt[1][1] + RI[2][2] * Rt[2][1],
         RI[2][0] * Rt[0][2] + RI[2][1] * Rt[1][2] + RI[2][2] * Rt[2][2]],
      ];
      const Iw_omega = [
        I_world[0][0] * st.omega[0] + I_world[0][1] * st.omega[1] + I_world[0][2] * st.omega[2],
        I_world[1][0] * st.omega[0] + I_world[1][1] * st.omega[1] + I_world[1][2] * st.omega[2],
        I_world[2][0] * st.omega[0] + I_world[2][1] * st.omega[1] + I_world[2][2] * st.omega[2],
      ];
      Hx += Iw_omega[0];
      Hy += Iw_omega[1];
      Hz += Iw_omega[2];
    }
  }
  return {
    x: finOr(Hx, 0),
    y: finOr(Hy, 0),
    z: finOr(Hz, 0),
    magnitude: vecLen([Hx, Hy, Hz]),
  };
}

/* ------------------------------ main entry -------------------------------- */
function countRevolute(tree) {
  let c = 0;
  for (const L of tree.links) if (L.jointType === "revolute") c += 1;
  return c;
}

function notComputedBase(reason, revoluteCount, qLength, q = null) {
  return {
    status: "not_computed",
    reason,
    revoluteCount,
    qLength,
    ...(q != null ? { qReceived: q.slice() } : {}),
    regions: { legs: { sumNm: 0, count: 0, joints: [] }, arms: { sumNm: 0, count: 0, joints: [] }, torso: { sumNm: 0, count: 0, joints: [] }, head: { sumNm: 0, count: 0, joints: [] }, other: { sumNm: 0, count: 0, joints: [] } },
    perJoint: [],
    gravityMomentNm: { x: 0, y: 0 },
    gravityMomentMagnitudeNm: 0,
    totalVerticalForceN: 0,
    totalMassKg: 0,
    angularMomentum: { notComputed: true, reason },
    torqueLimitNm: null,
    overLimitJoints: [],
  };
}

export function fullBodyRnea({
  tree, gravity = [0, 0, -G], q, qdot, qddot, torqueLimitNm = null,
}) {
  // 1. Validate inputs ---------------------------------------------------
  if (tree == null) {
    return notComputedBase("missing field: tree", 0, 0);
  }
  if (q == null) {
    return notComputedBase(`missing field: q (revoluteCount=${countRevolute(tree || { links: [] })} qLength=0)`, 0, 0);
  }
  if (!Array.isArray(tree.links) || tree.links.length === 0) {
    return notComputedBase("tree.links missing or empty", countRevolute({ links: [] }), q.length);
  }
  const revoluteCount = countRevolute(tree);
  const qLength = q.length;
  if (!Array.isArray(qdot) || !Array.isArray(qddot)) {
    return notComputedBase(
      `qdot/qddot must be arrays (revoluteCount=${revoluteCount} qLength=${qLength})`,
      revoluteCount, qLength,
    );
  }
  if (qLength !== revoluteCount || qdot.length !== revoluteCount || qddot.length !== revoluteCount) {
    return notComputedBase(
      `q/qdot/qddot length ${qLength}/${qdot.length}/${qddot.length} does not match number of revolute joints ${revoluteCount}`,
      revoluteCount, qLength,
    );
  }

  // 2. Call the inner RNEA solver ---------------------------------------
  // We pass baseR/basePos straight through; the inner solver falls back to
  // tree.baseR / tree.basePos when not given.
  const baseR = (tree && Array.isArray(tree.baseR)) ? tree.baseR : null;
  const basePos = (tree && Array.isArray(tree.basePos)) ? tree.basePos : [0, 0, 0];
  const inner = rneaSolver({ tree, gravity, q, qdot, qddot, baseR, basePos });
  if (inner && inner.notComputed) {
    // Propagate the inner reason verbatim. We can still emit the revoluteCount
    // and qLength we already have — they were valid in our wrapper.
    return {
      status: "not_computed",
      reason: String(inner.notComputed),
      revoluteCount, qLength,
      regions: { legs: { sumNm: 0, count: 0, joints: [] }, arms: { sumNm: 0, count: 0, joints: [] }, torso: { sumNm: 0, count: 0, joints: [] }, head: { sumNm: 0, count: 0, joints: [] }, other: { sumNm: 0, count: 0, joints: [] } },
      perJoint: [],
      gravityMomentNm: { x: 0, y: 0 },
      gravityMomentMagnitudeNm: 0,
      totalVerticalForceN: 0,
      totalMassKg: 0,
      angularMomentum: { notComputed: true, reason: String(inner.notComputed) },
      torqueLimitNm: Number.isFinite(torqueLimitNm) ? torqueLimitNm : null,
      overLimitJoints: [],
    };
  }

  // 3. Local forward pass (independent of inner solver) ---------------
  const fwd = localForwardPass(tree, q, qdot, qddot, baseR, basePos);
  const perLink = fwd.ok ? fwd.perLink : new Map();

  // 4. Walk the inner torques and group by region ----------------------
  const regionMap = {
    legs:  { sumNm: 0, count: 0, joints: [] },
    arms:  { sumNm: 0, count: 0, joints: [] },
    torso: { sumNm: 0, count: 0, joints: [] },
    head:  { sumNm: 0, count: 0, joints: [] },
    other: { sumNm: 0, count: 0, joints: [] },
  };
  const perJoint = [];
  const overLimitJoints = [];
  const linkByAxis = new Map();                // link.id → world rotation, for component on link's own axis
  for (const st of perLink.values()) {
    // store the rotation so we can recover the world axis for the joint
    // (we compute that below per-link from the link's own R and axis).
  }

  // Build a map of linkId → world axis for each revolute joint, computed
  // from the local forward pass. Rotates the link's local axis by R.
  const worldAxisByLink = new Map();
  for (const L of tree.links) {
    if (L.jointType === "revolute" && perLink.has(L.id)) {
      const st = perLink.get(L.id);
      worldAxisByLink.set(L.id, rotApply(st.R, L.axis));
    } else if (L.jointType === "revolute") {
      worldAxisByLink.set(L.id, L.axis ? L.axis.slice() : [0, 0, 1]);
    }
  }

  for (const t of (inner.torques || [])) {
    const region = classifyRegion(t.linkId);
    const magnitudeNm = Math.abs(finOr(t.torqueNm, 0));
    perJoint.push({ linkId: t.linkId, region, torqueNm: finOr(t.torqueNm, 0), magnitudeNm });

    const bucket = regionMap[region] || regionMap.other;
    bucket.count += 1;
    bucket.joints.push({ linkId: t.linkId, torqueNm: finOr(t.torqueNm, 0), magnitudeNm });
    // Signed torque about the joint's own axis. RNEA already projects onto
    // â_world when computing τ, so torqueNm IS the scalar along the joint
    // axis (right-hand rule). SumNm is the signed scalar — viewers can
    // decide what to plot. Magnitudes are exposed separately.
    bucket.sumNm = finOr(bucket.sumNm, 0) + finOr(t.torqueNm, 0);

    if (Number.isFinite(torqueLimitNm) && magnitudeNm > Math.abs(torqueLimitNm)) {
      overLimitJoints.push(t.linkId);
    }
  }

  // 5. Whole-body gravity moment about the base origin ---------------
  const gMoment = perLink.size
    ? gravityMomentAboutBase(perLink, tree, gravity)
    : { x: 0, y: 0, magnitude: 0 };

  // 6. Total mass + total vertical reaction --------------------------
  let totalMassKg = 0;
  for (const L of tree.links) totalMassKg = finOr(totalMassKg, 0) + finOr(L.mass, 0);
  const totalVerticalForceN = totalMassKg * G;

  // 7. Whole-body angular momentum (best-effort) ----------------------
  // If anything in the local forward pass failed we keep the inner solver's
  // torques but mark angular momentum as notComputed with the reason.
  let angularMomentum;
  if (!fwd.ok) {
    angularMomentum = { notComputed: true, reason: fwd.reason || "local forward pass failed" };
  } else {
    angularMomentum = angularMomentumAboutBase(perLink, tree);
  }

  // 8. Final status ---------------------------------------------------
  const limitGiven = Number.isFinite(torqueLimitNm);
  let status = "ok";
  let reason = null;
  if (limitGiven && overLimitJoints.length > 0) {
    status = "fail";
    reason = `${overLimitJoints.length} joint(s) exceeded torqueLimitNm=${torqueLimitNm}: ${overLimitJoints.join(", ")}`;
  }

  return {
    status,
    reason,
    revoluteCount,
    qLength,
    regions: regionMap,
    perJoint,
    gravityMomentNm: { x: finOr(gMoment.x, 0), y: finOr(gMoment.y, 0) },
    gravityMomentMagnitudeNm: finOr(gMoment.magnitude, 0),
    totalVerticalForceN: finOr(totalVerticalForceN, 0),
    totalMassKg: finOr(totalMassKg, 0),
    angularMomentum,
    torqueLimitNm: limitGiven ? torqueLimitNm : null,
    overLimitJoints: overLimitJoints.slice(),
  };
}

registerSolver({
  id: "dynamics.full-body-rnea",
  version: "1.0.0",
  domain: "robotics",
  domains: ["robotics"],
  method: "dynamics.full-body-rnea",
  fidelity: 2,
    // Graph-native: runs when any node carries props.dynamics.fullBody.
  // The props subtree is passed straight through to fullBodyRnea.
  targets: graphTargets("dynamics.fullBody"),
  run: graphRunner("dynamics.fullBody", (ctx, id, props) => envelope(fullBodyRnea(props))),});
