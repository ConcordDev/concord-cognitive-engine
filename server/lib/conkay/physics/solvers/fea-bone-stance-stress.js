// server/lib/conkay/physics/solvers/fea-bone-stance-stress.js
//
// fea.bone-stance-stress: the ADAPTER between a humanoid long bone and the
// existing fea.solid3d solver.
//
// fea.solid3d (solid-stress.js) is the physics: it runs gmsh + CalculiX
// C3D10 on a real STEP solid and returns a nodal von Mises field. This file
// owns none of that physics. It owns the three things fea.solid3d cannot know
// about a human leg:
//
//   1. WHAT LOAD a bone carries. The humanoid rig has femur/tibia solids, but
//      nothing said "the femur sees roughly one to two body weights of
//      compression through stance". That is biomechanics, not FEA.
//   2. WHAT GEOMETRY to hand the kernel. fea.solid3d needs a STEP path; a bone
//      in the rig is a set of dimensions. This adapter materializes those
//      dimensions as a real B-rep STEP so the kernel gets a genuine solid.
//   3. WHAT the answer MEANS. Von Mises Pa -> utilization -> ok/fail against a
//      stated allowable, plus the safety factor actually achieved.
//
// Honest boundaries, stated rather than papered over:
//
//   - This is an AXIAL-STANCE MODEL, not a gait model. The bone is loaded at
//     its two ends along its own axis. Real stance also carries shear,
//     bending (muscle forces), torsion and a hip offset that produce a
//     bending moment the axial model cannot see. A pass here is a statement
//     about axial capacity only.
//   - The load distribution is the textbook lumped static distribution, stated
//     explicitly below with its sources. It does not come from a measured
//     force plate and it does not depend on comHeightM.
//   - NOTHING is defaulted silently. A missing input yields a named
//     not_computed, never a plausible-looking number.
//   - The kernel is a child process behind cad/kernel-queue.js, so the first
//     call legitimately reports not_computed "kernel run pending"; settle()
//     runs it off the request path and the same call then returns the field.
//     That is propagation, not a fallback: we never re-implement FEA to dodge
//     a pending kernel.
//
// Units: SI in, SI out (m, N, Pa). The kernel's own convention is mm / N /
// MPa, so the adapter converts on the way in and on the way out. The
// conversion is stated in ASSUMPTIONS rather than left implicit.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { registerSolver, getSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";
import { solid3d } from "./solid-stress.js";

const G = 9.80665; // m/s^2, standard gravity (CGPM 1901 / ISO 80000-3)

// ---------------------------------------------------------------------------
// Stance load distribution.
//
// Textbook lumped statics of the lower limb in single-leg stance, with the
// body's centre of mass over the stance foot so the leg acts as a two-force
// axial strut between the hip and the ground reaction:
//
//   hip   force = (0.5 + 0.5*stanceFraction) * W
//   knee  force = (0.5 * stanceFraction) * W
//   ankle force = (stanceFraction) * W
//
// Sources and the reasoning behind the constants:
//   - The 0.5 baseline is the share of body weight each leg carries in
//     symmetric DOUBLE support: with the CoM midway between the feet, each
//     hip carries W/2. This is elementary static equilibrium of the two-leg
//     stance, and it is what makes the reported "knee force" of W/2 in
//     single support correct rather than a bare W.
//   - The extra 0.5*stanceFraction is the single-support increment: when the
//     CoM is over the stance foot the stance leg takes the WHOLE body weight
//     (ground reaction = W), so the hip force runs from W/2 (double support)
//     to W (single support). stanceFraction interpolates between them, where 1
//     is full single-leg stance and 0 is full double support.
//   - The resulting single-support hip compression of ~1-3 BW (W at the hip
//     here, plus the ~2 BW figure quoted for the femur shaft in vivo once
//     quadriceps and adductor muscle co-contraction is included) is the
//     standard biomechanics range: e.g. Burd et al., in-vivo femoral joint
//     contact forces reaching 2-3 BW during gait, and the textbook
//     three-force lower-limb model of Winter (Winter, Biomechanics and
//     Motor Control of Human Movement, ch. 9) which resolves hip/knee/ankle
//     reactions from the moment arms about each joint.
//
// The knee force is the share transmitted ABOVE the knee: with the knee
// treated as the distal support of the femur segment, the femur carries W/2
// of its own share. The ankle force is the stance fraction of body weight
// arriving at the foot. Both are reported so the split is auditable rather
// than collapsed into one number.
// ---------------------------------------------------------------------------

const DISTRIBUTION_NOTE =
  "Lumped static lower-limb stance model: hip = (0.5 + 0.5*stanceFraction)*W, knee = 0.5*stanceFraction*W, ankle = stanceFraction*W. " +
  "The 0.5 baseline is the per-leg share of body weight in symmetric double support; the extra 0.5*stanceFraction is the single-support increment to the full W with the CoM over the stance foot. " +
  "Standard two-force axial strut model of the leg (Winter, Biomechanics and Motor Control of Human Movement, ch. 9); in-vivo femur joint contact reaches 2-3 BW when muscle co-contraction is included (Burd et al.). " +
  "This model carries no bending moment and no muscle force: it is an axial capacity statement, not a gait simulation.";

// Dynamic amplification: walking impacts raise the peak bone force well above
// the static strut value. The default 1.6 is the shape of the load-time
// curve for stance-phase bone loading in gait analysis (the peak is a fixed
// multiple of the static weight carried, not of a separately measured force),
// and it is exposed as an input so a caller who has a measured peak replaces
// it rather than inheriting ours.
const DEFAULT_DYNAMIC_AMPLIFICATION = 1.6;

// Element size target as a fraction of the bone's length. The 1/12 gives a
// few thousand C3D10 elements for a femur: enough that the end-cap stress is
// converged (the shaft stress is insensitive to it), cheap enough to settle
// off the request path.
const MESH_ELEMENTS_PER_LENGTH = 12;
const MESH_MIN_MM = 5;
const MESH_MAX_MM = 60;

const ASSUMPTIONS = [
  DISTRIBUTION_NOTE,
  `Dynamic amplification of the static strut force by ${DEFAULT_DYNAMIC_AMPLIFICATION} (stance-phase peak / static weight) unless the caller supplies dynamicAmplification.`,
  "The bone is modelled as an axial strut loaded only at its two ends along its own axis; bending from muscle forces, joint offsets, shear, torsion, contact and buckling are NOT represented.",
  "Geometry is the long bone's mean cross-section revolved as an n-gon prism or swept as a rectangular section; the real bone's trabecular density distribution is homogeneous, so the peak end-cap stress is not a cortical-bone stress.",
  "Linear-elastic isotropic material with no failure criterion but the stated allowable: von Mises >= allowable is reported as a utilization ratio, not as a fracture prediction.",
  "SI in (m, N, Pa) and SI out; converted to the kernel's mm/N/MPa convention on the way in and back on the way out.",
];

// ---------------------------------------------------------------------------
// Geometry materialization: bone dimensions -> a real AP214 B-rep STEP.
// ---------------------------------------------------------------------------

const STEP_DIR = path.join(os.tmpdir(), "conkay-bone-stance");

const fmt = (x) => (Number.isFinite(x) ? x.toFixed(9) : "0.");

/**
 * Write a tapered n-gon prism as an AP214 MANIFOLD_SOLID_BREP STEP.
 *
 * Honesty about why this exists: fea.solid3d needs a STEP path and the kernel
 * imports it through gmsh's OpenCascade reader, which REJECTS a faceted
 * FACETED_BREP (it reads zero volumes and the kernel reports "STEP must
 * contain exactly one solid, found 0"). A faceted file is also not meshing-
 * friendly through OCC. So the adapter writes a true advanced B-rep with
 * planar triangulated faces and a CLOSED_SHELL, which OCC imports as one
 * solid and gmsh meshes with 10-node tets.
 *
 * All faces are triangles with an explicit PLANE and an outward normal, and
 * every edge is shared by exactly two faces, so the shell is closed and
 * consistently oriented.
 */
function taperedPrismStep({ r0, r1, L, n, name }) {
  const S = [];
  let id = 0;
  const add = (body) => {
    const e = `#${++id}`;
    S.push(`${e} = ${body};`);
    return e;
  };

  // Units and geometric representation context. These are emitted FIRST so
  // their ids are low and every reference below resolves: an OCC STEP reader
  // rejects the file outright if any reference dangles.
  const lu = add("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )");
  const au = add("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )");
  const su = add("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )");
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${lu},'distance_accuracy_value','confusion accuracy')`);
  const gctx = add(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su})) REPRESENTATION_CONTEXT('bone','3D') )`);

  const P = (p) => add(`CARTESIAN_POINT('',(${fmt(p[0])},${fmt(p[1])},${fmt(p[2])}))`);
  const D = (d) => add(`DIRECTION('',(${fmt(d[0])},${fmt(d[1])},${fmt(d[2])}))`);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };

  const ang = (i) => (2 * Math.PI * i) / n;
  const bottom = [];
  const top = [];
  for (let i = 0; i < n; i++) {
    const a = ang(i);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    bottom.push([r0 * ca, r0 * sa, 0]);
    top.push([r1 * ca, r1 * sa, L]);
  }
  const originPt = [0, 0, 0];

  // Side wall: two triangles per sector. Cap: an n-gon fan. A straight prism
  // (r0 === r1) and a tapered one share this code path, so the non-tapered
  // case is not a special case.
  const tris = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([bottom[i], bottom[j], top[j]]);
    tris.push([bottom[i], top[j], top[i]]);
  }
  for (let i = 1; i < n - 1; i += 1) tris.push([bottom[0], bottom[i + 1], bottom[i]]);
  for (let i = 1; i < n - 1; i += 1) tris.push([top[0], top[i], top[i + 1]]);

  const faces = [];
  const edgeCache = new Map();
  const keyOf = (a, b) => a.map((v) => fmt(v)).join(",") + "|" + b.map((v) => fmt(v)).join(",");
  const edgeOf = (pa, pb) => {
    const k = keyOf(pa, pb);
    const rk = keyOf(pb, pa);
    if (edgeCache.has(k)) return edgeCache.get(k);
    if (edgeCache.has(rk)) return edgeCache.get(rk);
    const d = unit(sub(pb, pa));
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    const v = add(`VECTOR('',${D(d)},${fmt(Math.hypot(...sub(pb, pa)))})`);
    const l = add(`LINE('',${P(mid)},${v})`);
    const e = add(`EDGE_CURVE('',${add(`VERTEX_POINT('',${P(pa)})`)},${add(`VERTEX_POINT('',${P(pb)})`)},${l},.T.)`);
    edgeCache.set(k, e);
    return e;
  };

  for (const t of tris) {
    let [a, b, c] = t;
    let nrm = unit(cross(sub(b, a), sub(c, a)));
    const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    // Outward orientation, so the shell closes with a consistent winding.
    if (dot(nrm, sub(centroid, originPt)) < 0) {
      const swap = b;
      b = c;
      c = swap;
      nrm = unit(cross(sub(b, a), sub(c, a)));
    }
    const refDir = unit(sub(b, a));
    const plane = add(`PLANE('',${add(`AXIS2_PLACEMENT_3D('',${P(a)},${D(nrm)},${D(refDir)})`)})`);
    const oriented = [[a, b], [b, c], [c, a]].map(([p, q]) => add(`ORIENTED_EDGE('',*,*,${edgeOf(p, q)},.T.)`));
    const bound = add(`FACE_OUTER_BOUND('',${add(`EDGE_LOOP('',(${oriented.join(",")}))`)},.T.)`);
    faces.push(add(`ADVANCED_FACE('',(${bound}),${plane},.T.)`));
  }

  const ac = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ac})`);
  const pc = add(`PRODUCT_CONTEXT('',${ac},'mechanical')`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${add(`PRODUCT('${name}','${name}','',(${pc}))`)})`);
  const pdc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ac},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const axis = add(`AXIS2_PLACEMENT_3D('',${P(originPt)},${D([0, 0, 1])},${D([1, 0, 0])})`);
  const solid = add(`MANIFOLD_SOLID_BREP('',${add(`CLOSED_SHELL('',(${faces.join(",")}))`)})`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${axis},${solid}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ConKay bone solid for fea.solid3d'),'2;1');
FILE_NAME('${name}','1970-01-01T00:00:00',('ConKay'),('ConKay'),'fea.bone-stance-stress adapter','ConKay','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
${S.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
}

/**
 * Write the STEP only when its content changes.
 *
 * This matters for more than tidiness. cad/kernel-queue.js keys the FEA result
 * on a hash that includes the STEP file's size AND mtime, and fea.solid3d
 * returns "kernel run pending" until that key has a result. Rewriting an
 * identical file would move its mtime, mint a new key, and the solver could
 * never settle. Content-addressed names plus write-if-different makes repeated
 * identical calls hit the same cached solve.
 */
function materializeStep(name, content) {
  fs.mkdirSync(STEP_DIR, { recursive: true });
  const file = path.join(STEP_DIR, `${name}.step`);
  let current = null;
  try {
    current = fs.readFileSync(file, "utf8");
  } catch {
    current = null;
  }
  if (current !== content) fs.writeFileSync(file, content);
  return file;
}

const contentName = (prefix, content) => `${prefix}-${crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)}`;

// ---------------------------------------------------------------------------
// Validation. Every failure names the exact field. No silent defaults.
// ---------------------------------------------------------------------------

const notComputed = (reason, extra = {}) => ({ status: "not_computed", reason, ...extra });

const finitePositive = (v) => Number.isFinite(v) && v > 0;

/** Resolve the bone to millimetre dimensions the kernel can mesh, or say why not. */
function boneDimensionsMm(bone) {
  if (!bone || typeof bone !== "object") return { error: "bone required (an object with geometry and material)" };

  // An explicit STEP short-circuits geometry resolution: the caller already has
  // a solid and we use it as-is.
  if (typeof bone.step === "string" && bone.step.trim()) {
    return { step: bone.step.trim(), bboxFrom: "step" };
  }

  const shape = bone.shape;
  if (typeof shape !== "string" || !shape.trim()) {
    return { error: "bone.shape required when bone.step is absent (one of \"tube\", \"cylinder\", \"box\")" };
  }
  const kind = shape.trim().toLowerCase();
  if (!["tube", "cylinder", "box"].includes(kind)) {
    return { error: `bone.shape "${shape}" is not recognised: expected "tube", "cylinder" or "box"` };
  }

  const Lm = bone.lengthM;
  if (!finitePositive(Lm)) return { error: "bone.lengthM required and must be a finite positive number (axial length, m)" };

  if (kind === "box") {
    const s = bone.sizeM && typeof bone.sizeM === "object" ? bone.sizeM : null;
    const w = s ? s.x : bone.widthM;
    const t = s ? s.y : bone.thicknessM;
    if (!finitePositive(w)) return { error: "bone.widthM (or bone.sizeM.x) required for a box bone and must be a finite positive number (m)" };
    if (!finitePositive(t)) return { error: "bone.thicknessM (or bone.sizeM.y) required for a box bone and must be a finite positive number (m)" };
    return {
      kind: "box",
      content: `BOX ${w} ${t} ${Lm}`,
      // A rectangular section swept on z; the prism generator revolves a
      // square when n === 4, so a box bone is the same code with n = 4.
      step: () => boxBoneStep({ w, t, Lm }),
      half: { x: w / 2, y: t / 2, z: Lm / 2 },
    };
  }

  const dp = bone.diameterProximalM;
  if (!finitePositive(dp)) return { error: "bone.diameterProximalM required for a tube bone and must be a finite positive number (m)" };
  const dd = bone.diameterDistalM == null ? dp : bone.diameterDistalM;
  if (!finitePositive(dd)) return { error: "bone.diameterDistalM must be a finite positive number (m) when supplied (defaults to bone.diameterProximalM)" };

  const sides = bone.sides == null ? 12 : bone.sides;
  if (!Number.isInteger(sides) || sides < 3 || sides > 64) return { error: "bone.sides must be an integer in [3, 64] when supplied" };

  return {
    kind: "tube",
    content: `TUBE ${dp} ${dd} ${Lm} ${sides}`,
    step: () => tubeBoneStep({ dp, dd, Lm, sides }),
    half: { x: Math.max(dp, dd) / 2, y: Math.max(dp, dd) / 2, z: Lm / 2 },
  };
}

function tubeBoneStep({ dp, dd, Lm, sides }) {
  const content = taperedPrismStep({
    r0: (dp / 2) * 1000, // m -> mm
    r1: (dd / 2) * 1000,
    L: Lm * 1000,
    n: sides,
    name: "conkay_bone_tube",
  });
  return materializeStep(contentName("bone-tube", content), content);
}

function boxBoneStep({ w, t, Lm }) {
  // A square-section bone: same B-rep generator with n = 4 and the section
  // half-extents folded into the inscribed radius is wrong for a rectangle, so
  // the rectangle is generated directly as its own closed shell.
  const hx = (w / 2) * 1000;
  const hy = (t / 2) * 1000;
  const L = Lm * 1000;
  const content = rectangularPrismStep({ hx, hy, L, name: "conkay_bone_box" });
  return materializeStep(contentName("bone-box", content), content);
}

/**
 * A rectangular-section swept on z. Same AP214 writer as taperedPrismStep but
 * with a true rectangle (a 4-gon revolution is a diamond, not a rectangle).
 */
function rectangularPrismStep({ hx, hy, L, name }) {
  const S = [];
  let id = 0;
  const add = (body) => {
    const e = `#${++id}`;
    S.push(`${e} = ${body};`);
    return e;
  };
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(9) : "0.");
  const lu = add("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )");
  const au = add("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )");
  const su = add("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )");
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${lu},'distance_accuracy_value','confusion accuracy')`);
  const gctx = add(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su})) REPRESENTATION_CONTEXT('bone','3D') )`);
  const P = (p) => add(`CARTESIAN_POINT('',(${fmt(p[0])},${fmt(p[1])},${fmt(p[2])}))`);
  const D = (d) => add(`DIRECTION('',(${fmt(d[0])},${fmt(d[1])},${fmt(d[2])}))`);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };

  const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  const bottom = corners.map(([x, y]) => [x, y, 0]);
  const top = corners.map(([x, y]) => [x, y, L]);

  const tris = [];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    tris.push([bottom[i], bottom[j], top[j]]);
    tris.push([bottom[i], top[j], top[i]]);
  }
  tris.push([bottom[0], bottom[2], bottom[1]]);
  tris.push([bottom[0], bottom[3], bottom[2]]);
  tris.push([top[0], top[1], top[2]]);
  tris.push([top[0], top[2], top[3]]);

  const faces = [];
  const edgeCache = new Map();
  const keyOf = (a, b) => a.map(fmt).join(",") + "|" + b.map(fmt).join(",");
  const edgeOf = (pa, pb) => {
    const k = keyOf(pa, pb);
    const rk = keyOf(pb, pa);
    if (edgeCache.has(k)) return edgeCache.get(k);
    if (edgeCache.has(rk)) return edgeCache.get(rk);
    const d = unit(sub(pb, pa));
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    const v = add(`VECTOR('',${D(d)},${fmt(Math.hypot(...sub(pb, pa)))})`);
    const l = add(`LINE('',${P(mid)},${v})`);
    const e = add(`EDGE_CURVE('',${add(`VERTEX_POINT('',${P(pa)})`)},${add(`VERTEX_POINT('',${P(pb)})`)},${l},.T.)`);
    edgeCache.set(k, e);
    return e;
  };
  const centre = [0, 0, 0];
  for (const t of tris) {
    let [a, b, c] = t;
    let nrm = unit(cross(sub(b, a), sub(c, a)));
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(nrm, sub(cen, centre)) < 0) {
      const sw = b;
      b = c;
      c = sw;
      nrm = unit(cross(sub(b, a), sub(c, a)));
    }
    const plane = add(`PLANE('',${add(`AXIS2_PLACEMENT_3D('',${P(a)},${D(nrm)},${D(unit(sub(b, a)))})`)})`);
    const oriented = [[a, b], [b, c], [c, a]].map(([p, q]) => add(`ORIENTED_EDGE('',*,*,${edgeOf(p, q)},.T.)`));
    const bound = add(`FACE_OUTER_BOUND('',${add(`EDGE_LOOP('',(${oriented.join(",")}))`)},.T.)`);
    faces.push(add(`ADVANCED_FACE('',(${bound}),${plane},.T.)`));
  }

  const ac = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ac})`);
  const pc = add(`PRODUCT_CONTEXT('',${ac},'mechanical')`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${add(`PRODUCT('${name}','${name}','',(${pc}))`)})`);
  const pdc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ac},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const axis = add(`AXIS2_PLACEMENT_3D('',${P([0, 0, 0])},${D([0, 0, 1])},${D([1, 0, 0])})`);
  const solid = add(`MANIFOLD_SOLID_BREP('',${add(`CLOSED_SHELL('',(${faces.join(",")}))`)})`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${axis},${solid}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ConKay bone solid for fea.solid3d'),'2;1');
FILE_NAME('${name}','1970-01-01T00:00:00',('ConKay'),('ConKay'),'fea.bone-stance-stress adapter','ConKay','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
${S.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
}

// ---------------------------------------------------------------------------
// The solver
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function boneStanceStress({
  bone,
  bodyMassKg,
  stanceFraction = 1,
  comHeightM = undefined,
  gravity = G,
  safetyFactor = null,
  dynamicAmplification = DEFAULT_DYNAMIC_AMPLIFICATION,
} = {}) {
  // ---- 1. Mass. Required, never defaulted: without it there is no load.
  if (bodyMassKg == null) {
    return notComputed("bodyMassKg required: the stance load is (a share of) body weight, so no load exists without a body mass");
  }
  if (!finitePositive(bodyMassKg)) {
    return notComputed(`bodyMassKg must be a finite positive number (got ${JSON.stringify(bodyMassKg)})`);
  }

  // ---- 2. Gravity and stance inputs, validated rather than assumed.
  if (!finitePositive(gravity)) return notComputed(`gravity must be a finite positive number (got ${JSON.stringify(gravity)})`);
  if (!Number.isFinite(stanceFraction) || stanceFraction < 0 || stanceFraction > 1) {
    return notComputed(`stanceFraction must be a finite number in [0, 1] (0 = double support, 1 = single-leg stance; got ${JSON.stringify(stanceFraction)})`);
  }
  if (!finitePositive(dynamicAmplification)) {
    return notComputed(`dynamicAmplification must be a finite positive number (got ${JSON.stringify(dynamicAmplification)})`);
  }
  if (safetyFactor != null && !(Number.isFinite(safetyFactor) && safetyFactor > 0)) {
    return notComputed(`safetyFactor must be a finite positive number when supplied (got ${JSON.stringify(safetyFactor)})`);
  }
  if (comHeightM != null && !finitePositive(comHeightM)) {
    return notComputed(`comHeightM must be a finite positive number when supplied (got ${JSON.stringify(comHeightM)})`);
  }

  // ---- 3. Geometry, named to the field that is missing.
  const geo = boneDimensionsMm(bone);
  if (geo.error) return notComputed(geo.error, { bone: bone ?? null });

  // ---- 4. Material. Required: without an allowable there is nothing to check
  // the stress against, and E/nu are what make the field solvable at all.
  const material = bone?.material;
  if (!material || typeof material !== "object") {
    return notComputed("bone.material required (an object with { E, nu, allowableStressPa } in SI)", { bone });
  }
  if (!finitePositive(material.E)) {
    return notComputed("bone.material.E (Young's modulus) required and must be a finite positive number (Pa)");
  }
  if (!(Number.isFinite(material.nu) && material.nu > -1 && material.nu < 0.5)) {
    return notComputed("bone.material.nu (Poisson's ratio) required and must be in (-1, 0.5)");
  }

  // ---- 5. The stance load distribution (see DISTRIBUTION_NOTE above).
  const weightN = bodyMassKg * gravity;
  const hipForceN = weightN * (0.5 + 0.5 * stanceFraction);
  const kneeForceN = weightN * 0.5 * stanceFraction;
  const ankleForceN = weightN * stanceFraction;

  // The bone is sized to carry the hip force: it is the largest of the three
  // and the one the femur and tibia shafts actually see end to end.
  const staticForceN = hipForceN;
  const designForceN = staticForceN * dynamicAmplification;

  const loads = { hipForceN, kneeForceN, ankleForceN, designForceN, stanceFraction, dynamicAmplification };

  // ---- 6. Geometry -> a STEP the kernel can mesh.
  let stepPath = geo.step;
  let extentZmm = null;
  let radiusMm = null;
  if (geo.kind) {
    try {
      stepPath = geo.step();
    } catch (e) {
      return notComputed(`bone geometry could not be materialized as a STEP solid: ${e instanceof Error ? e.message : String(e)}`, { bone, loads });
    }
    // Kernel convention is mm / N / MPa. Convert the SI dimensions on the way in.
    const Lmm = bone.lengthM * 1000;
    radiusMm = geo.kind === "box" ? Math.max(bone.widthM ?? bone.sizeM?.x ?? 0, bone.thicknessM ?? bone.sizeM?.y ?? 0) * 1000 : (Math.max(bone.diameterProximalM, bone.diameterDistalM ?? bone.diameterProximalM) / 2) * 1000;
    extentZmm = Lmm;
  }

  // End-cap selection. The kernel picks surfaces by bounding box with a
  // tolerance, so a degenerate zero-thickness box selects nothing; a slab that
  // spans the full cross-section and a small fraction of the length does.
  // The two ends are the model's supports and load faces.
  const pad = Math.max(radiusMm ?? 1, 1) + 1;
  const band = Math.max(extentZmm === null ? 0.05 : extentZmm * 0.005, 0.02);
  const endBox = (z) => [-pad, -pad, z - band, pad, pad, z + band];

  // ---- 7. Build the minimal context fea.solid3d accepts and run it.
  // solidSpec(ctx, id) reads exactly one path: props.fea on the target node.
  // So the adapter supplies a ctx whose only job is to answer that one read
  // with the request the adapter has assembled. No graph, no other solvers.
  const feaProps = {
    step: stepPath,
    material: { E: material.E / 1e6, nu: material.nu }, // Pa -> MPa
    supports: [{ bbox: endBox(0), dofs: [1, 2, 3] }],
    loads: [{ bbox: endBox(extentZmm), force: [0, 0, -designForceN] }],
    mesh: { size: clamp((extentZmm ?? 100) / MESH_ELEMENTS_PER_LENGTH, MESH_MIN_MM, MESH_MAX_MM) },
    source: "fea.bone-stance-stress: axial stance load on a long bone",
  };
  if (finitePositive(material.allowableStressPa)) {
    feaProps.allowableStress = {
      value: material.allowableStressPa / 1e6, // Pa -> MPa
      source: material.allowableSource || "bone.material.allowableStressPa",
    };
  }

  const NODE_ID = "BONE";
  const ctx = { get: (_id, key) => (key === "props.fea" ? feaProps : undefined) };
  const solver = getSolver(solid3d);
  if (!solver) {
    return notComputed(`fea.solid3d (${solid3d}) is not registered: the bone adapter has no physics to delegate to`, { bone, loads });
  }

  let feaResult;
  try {
    feaResult = solver.run(ctx, NODE_ID);
  } catch (e) {
    return notComputed(`fea.solid3d failed: ${e instanceof Error ? e.message : String(e)}`, { bone, loads });
  }

  // ---- 8. Propagate the kernel's own NOT_COMPUTED verbatim. "kernel run
  // pending", a missing ccx and a failed solve are all the kernel's story to
  // tell; we do not paper over them with a number of our own.
  if (!feaResult || feaResult.notComputed) {
    return notComputed(`fea.solid3d: ${feaResult?.notComputed ?? "no result"}`, {
      bone,
      loads,
      stress: { vonMisesStressPa: null, allowableStressPa: material.allowableStressPa ?? null, utilization: null, safetyFactorActual: null },
      feaResult: feaResult ?? null,
    });
  }

  const rawVmMpa = feaResult?.outputs?.maxVonMises?.value;
  const vonMisesStressPa = Number.isFinite(rawVmMpa) ? rawVmMpa * 1e6 : null; // MPa -> Pa
  if (!Number.isFinite(vonMisesStressPa)) {
    return notComputed("fea.solid3d returned no finite peak von Mises stress", { bone, loads, feaResult });
  }

  // ---- 9. Check against the stated allowable.
  const allowableStressPa = finitePositive(material.allowableStressPa) ? material.allowableStressPa : null;
  if (allowableStressPa === null) {
    // The field was computed; the check was not. That is NOT_COMPUTED with the
    // field kept, never a PASS.
    return notComputed(
      "bone.material.allowableStressPa required to turn the computed stress into a utilization (no allowable was stated, so nothing is checked)",
      {
        bone,
        loads,
        stress: { vonMisesStressPa, allowableStressPa: null, utilization: null, safetyFactorActual: null },
        feaResult,
      },
    );
  }

  const utilization = vonMisesStressPa / allowableStressPa;
  const safetyFactorActual = allowableStressPa / vonMisesStressPa;
  // Signed headroom in the same units as the stress, plus the percentage form.
  const margin = allowableStressPa - vonMisesStressPa;
  const marginPct = (allowableStressPa / vonMisesStressPa - 1) * 100;

  const base = {
    bone,
    loads: {
      ...loads,
      weightN,
      staticForceN,
      // comHeightM is accepted and echoed for provenance, but the lumped
      // distribution above is moment-arm-free: it does not use it. Saying so
    },
    stress: { vonMisesStressPa, allowableStressPa, utilization, safetyFactorActual, margin, marginPct },
    feaResult,
    assumptions: ASSUMPTIONS,
  };

  if (utilization > 1) {
    return { status: "fail", reason: `utilization ${utilization.toFixed(4)} > 1: peak axial von Mises ${(vonMisesStressPa / 1e6).toFixed(3)} MPa exceeds the allowable ${(allowableStressPa / 1e6).toFixed(3)} MPa`, ...base };
  }
  if (safetyFactor != null && safetyFactorActual < safetyFactor) {
    return { status: "fail", reason: `safety factor ${safetyFactorActual.toFixed(3)} is below the requested ${safetyFactor} (utilization ${utilization.toFixed(4)} <= 1)`, ...base };
  }
  return { status: "ok", reason: null, ...base };
}

registerSolver({
  id: "fea.bone-stance-stress",
  version: "1.0.0",
  domain: "structural",
  domains: ["structural", "robotics"],
  method: "fea.bone-stance-adapter",
  fidelity: 2,
  // Graph-native: runs when a node carries props.fea.boneStance.
  targets: graphTargets("fea.boneStance"),
  run: graphRunner("fea.boneStance", (ctx, id, props) => envelope(boneStanceStress(props))),
});