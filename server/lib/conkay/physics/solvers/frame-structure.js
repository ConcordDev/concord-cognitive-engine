// server/lib/conkay/physics/solvers/frame-structure.js
//
// structure.frame: linear-static 3D frame FE with linear buckling
// (structural/frame-fe.js, wrapping the fea-solver element) under the
// registry's PASS / FAIL envelope.
//
// Target: any node with props.frameModel (SI numbers):
//   nodes:    [{ id, x, y, z }]
//   members:  [{ id, i, j, part }]           section + material read from that design-graph
//             [{ id, i, j, section, material }]   part (so a section edit re-runs this), or given
//   supports: [{ node, fix: "fixed" | "pinned" | ["x","y","z","rx","ry","rz"] }]
//   loadCases:[{ id, nodal?: [{ node, F, M? }], udl?: [{ member, w }],
//                weight?: [{ from: { solver, target, output }, factor: { value, state, basis },
//                            dir: [x,y,z], node? (+ lever?: [dx,dy,dz] rigid offset) | members?: [...] }],
//                supports?: [...] (replaces the model's supports for this case),
//                stiffnessOnly?: true (a test load: stresses reported, not checked) }]
//             weight = (mass read from a solver run) × g × factor, as a nodal force at `node`
//             or spread per unit length over `members`.
//   factorOfSafety: { value, basis }   on yield (default 1: none applied, said so)
//   buckling: { cases: [...], requiredFactor: { value, basis } }
//   up: section "height" direction for horizontal members (default [0, 0, 1]: z up)
//   segments: elements per member (default 8)
//   stiffness: [{ id, case, node, dof, force, arm?, kind: "linear" | "torsional" }]  →
//             linear k = force / u; torsional k = force·arm² / u (a couple force·arm over a
//             twist u/arm), from that node displacement in that case
//   assumptions: [text]
//
// Margins: von Mises at the worst station of every member ≤ Fy / FS; buckling
// factor ≥ required. Results outside the solver's validity range (see
// frame-fe.js) are warnings and the run is never PASS while any stand. A load
// read from a run with unknown items (an open mass budget) is a warning too,
// with the total mass at which the frame reaches its governing limit.

import { registerSolver } from "../registry.js";
import { analyzeFrame, frameValidity, FRAME_FE_VERSION } from "../../structural/frame-fe.js";
import { getMaterial } from "../../materials/index.js";

const G0 = 9.80665;

function sectionFromGeometry(g) {
  if (!g) return null;
  if (g.shape === "rect-tube") return { shape: "rect-tube", width: g.width, height: g.height, wall: g.wall };
  if (g.shape === "round-tube") return { shape: "round-tube", od: g.od ?? g.outerDiameter, wall: g.wall };
  if (g.shape === "i-beam") return { shape: "i-beam", height: g.height, flangeWidth: g.flangeWidth, flangeThickness: g.flangeThickness, webThickness: g.webThickness };
  if (g.shape === "rect" || g.shape === "bar") return { shape: "rect", width: g.width, height: g.height };
  return null;
}

function materialProps(mat) {
  if (!mat || !(mat.youngsModulusPa > 0)) return { error: "material needs E" };
  if (!(mat.poisson > 0)) return { error: `material ${mat.id} has no Poisson ratio: G not computed` };
  return { E: mat.youngsModulusPa, G: mat.youngsModulusPa / (2 * (1 + mat.poisson)), fy: mat.yieldPa ?? null, id: mat.id, source: mat.source };
}

export const frameStructure = registerSolver({
  id: "structure.frame",
  version: "1.0.0",
  domain: "structural.frame",
  domains: ["structural.frame", "structural.bending", "structural.deflection", "structural.buckling"],
  fidelity: 2,
  method: "3D Euler-Bernoulli frame FE (fea-solver element, members subdivided), reduced Cholesky solve, consistent member loads, von Mises at the extreme fibre along every element; linear buckling (K + λ Kg) φ = 0 with consistent geometric stiffness (Jacobi eigen-solve)",
  reference: "server/lib/conkay/structural/frame-fe.js; benchmarks in tests/conkay-frame-fe.test.js",
  regime: "linear elastic, small displacement, Euler-Bernoulli members (L/d ≥ 10), flexural elastic buckling only (σ at critical load ≤ 0.44 Fy), tube walls within AISC 360-16 Table B4.1a; outside this the result is flagged",
  units: { inputs: "m, N, Pa, kg", outputs: "Pa, m, rad, N, 1" },
  tolerance: "closed-form benchmarks reproduced to < 0.1 % at 8 elements per member (tests/conkay-frame-fe.test.js)",
  screening: true,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.frameModel).map((n) => n.id),
  run(ctx, id) {
    const fm = ctx.get(id, "props.frameModel");
    const inputs = {};
    const members = [];
    for (const m of fm.members || []) {
      let section, mat;
      if (m.part) {
        section = sectionFromGeometry(ctx.get(m.part, "geometry"));
        if (!section) return { notComputed: `member ${m.id}: part ${m.part} has no frame section (rect-tube, round-tube, i-beam, rect)` };
        mat = ctx.material(m.part);
        if (!mat) return { notComputed: `member ${m.id}: part ${m.part} has no material` };
      } else {
        section = m.section;
        mat = m.material ? getMaterial(m.material) : null;
        if (!mat) return { notComputed: `member ${m.id}: material "${m.material}" not in the library` };
      }
      const mp = materialProps(mat);
      if (mp.error) return { notComputed: `member ${m.id}: ${mp.error}` };
      members.push({ id: m.id, i: m.i, j: m.j, section, E: mp.E, G: mp.G, fy: mp.fy, segments: m.segments });
      inputs[`member.${m.id}`] = { value: { section, material: mp.id, part: m.part || null }, source: mp.source };
    }
    const fs = fm.factorOfSafety?.value ?? 1;
    const reqBuckling = fm.buckling?.requiredFactor?.value ?? 1;
    const warnings = [];
    const scaleable = new Map();
    const loadCases = [];
    for (const lc of fm.loadCases || []) {
      const nodal = [...(lc.nodal || [])], udl = [...(lc.udl || [])];
      const weights = [];
      for (const w of lc.weight || []) {
        const run = ctx.result(w.from.solver, w.from.target);
        const mass = run?.outputs?.[w.from.output]?.value;
        if (!Number.isFinite(mass)) return { notComputed: `load case ${lc.id}: no ${w.from.output} from ${w.from.solver}@${w.from.target} (${run?.status || "missing"}${run?.reason ? `: ${run.reason}` : ""})` };
        const k = w.factor?.value ?? 1;
        const W = mass * G0 * k;
        const d = w.dir;
        const nd = Math.hypot(...d);
        if (w.node) {
          const F = d.map((c) => (c / nd) * W);
          const r = w.lever || [0, 0, 0];
          nodal.push({ node: w.node, F, M: [r[1] * F[2] - r[2] * F[1], r[2] * F[0] - r[0] * F[2], r[0] * F[1] - r[1] * F[0]] });
        }
        else {
          const lens = w.members.map((mid) => { const mm = (fm.members || []).find((x) => x.id === mid); const a = fm.nodes.find((n) => n.id === mm.i), b = fm.nodes.find((n) => n.id === mm.j); return Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)); });
          const q = W / lens.reduce((s, x) => s + x, 0);
          for (const mid of w.members) udl.push({ member: mid, w: d.map((c) => (c / nd) * q) });
        }
        const unknown = run.outputs.unknownCount?.value ?? 0;
        weights.push({ run: run.runId, mass, factor: w.factor || { value: 1, state: "design rule", basis: "no factor stated" }, weightN: W, unknown });
        inputs[`load.${lc.id}.${run.runId}`] = { value: { massKg: mass, factor: k, weightN: W }, source: run.runId, basis: w.factor?.basis };
        if (unknown > 0) warnings.push(`load case ${lc.id}: ${w.from.output} from ${run.runId} has ${unknown} unknown item(s); the load is of the known mass only`);
      }
      scaleable.set(lc.id, weights.length && !(lc.nodal || []).length && !(lc.udl || []).length ? weights : null);
      loadCases.push({ id: lc.id, nodal, udl, supports: lc.supports || null });
    }
    // one solve per distinct support set
    const groups = new Map();
    for (const lc of loadCases) {
      const key = JSON.stringify(lc.supports || fm.supports);
      if (!groups.has(key)) groups.set(key, { supports: lc.supports || fm.supports, cases: [] });
      groups.get(key).cases.push(lc);
    }
    let res = null;
    for (const g of groups.values()) {
      let r;
      try {
        r = analyzeFrame({ nodes: fm.nodes, members, supports: g.supports, loadCases: g.cases, up: fm.up || [0, 0, 1] }, { segments: fm.segments ?? 8, buckling: fm.buckling?.cases || [] });
      } catch (e) {
        return { notComputed: `frame model invalid: ${e.message}` };
      }
      if (!r.ok) return { notComputed: `${r.error} (cases ${g.cases.map((c) => c.id).join(", ")}): ${r.detail}` };
      if (!res) res = r; else res.cases.push(...r.cases);
    }
    if (!res) return { notComputed: "no load cases" };
    // stiffness-only cases carry a test load: their stresses are reported, not checked
    const stiffnessOnly = new Set((fm.loadCases || []).filter((lc) => lc.stiffnessOnly).map((lc) => lc.id));
    const margins = [];
    const outputs = { solverCore: { value: `frame-fe ${FRAME_FE_VERSION}` }, dofs: { value: res.dofs } };
    const validity = {};
    for (const c of res.cases) {
      const v = frameValidity(res, c);
      validity[c.id] = v;
      for (const f of v.flags) warnings.push(`${c.id}: ${f.code}${f.member ? ` (${f.member})` : ""}: ${f.detail}`);
      let gov = null;
      for (const mr of c.members) {
        if (mr.fy && !stiffnessOnly.has(c.id)) margins.push({ check: `${c.id}: ${mr.id} von Mises ≤ Fy / ${fs}`, demand: mr.worst.vonMises, capacity: mr.fy / fs, unit: "Pa" });
        if (mr.fy && (!gov || mr.worst.vonMises / mr.fy > gov.worst.vonMises / gov.fy)) gov = mr;
      }
      if (c.members.some((mr) => !mr.fy)) warnings.push(`${c.id}: members without a yield strength are not stress-checked: ${c.members.filter((mr) => !mr.fy).map((mr) => mr.id).join(", ")}`);
      outputs[`${c.id}.members`] = { value: c.members.map((mr) => ({ id: mr.id, vonMisesPa: mr.worst.vonMises, at: mr.worst.at, N: mr.worst.N, Mz: mr.worst.Mz, My: mr.worst.My, T: mr.worst.T, compressionN: mr.compression, utilization: mr.fy ? (mr.worst.vonMises * fs) / mr.fy : null })) };
      outputs[`${c.id}.maxVonMises`] = { value: gov ? gov.worst.vonMises : null, unit: "Pa", note: gov ? `member ${gov.id}` : "no member with Fy" };
      outputs[`${c.id}.maxTranslation`] = { value: c.maxTranslation, unit: "m" };
      outputs[`${c.id}.maxRotation`] = { value: c.maxRotation, unit: "rad" };
      outputs[`${c.id}.reactionSum`] = { value: ["x", "y", "z"].map((d) => c.reactions.filter((r) => r.dof === d).reduce((s, r) => s + r.value, 0)), unit: "N" };
      let bucklingFactor = null;
      if (c.buckling) {
        if (!c.buckling.ok) warnings.push(`${c.id}: ${c.buckling.error}`);
        else {
          bucklingFactor = c.buckling.factor;
          outputs[`${c.id}.bucklingFactor`] = { value: c.buckling.factor, unit: "1", note: c.buckling.note || `critical load = factor × this load case; mode largest at ${c.buckling.modeMaxDof}` };
          if (Number.isFinite(c.buckling.factor)) margins.push({ check: `${c.id}: buckling factor ≥ ${reqBuckling}`, demand: reqBuckling, capacity: c.buckling.factor, unit: "1" });
        }
      }
      const w = scaleable.get(c.id);
      if (w && w.some((x) => x.unknown > 0) && gov) {
        const lim = Math.min(gov.fy / fs / gov.worst.vonMises, Number.isFinite(bucklingFactor) ? bucklingFactor / reqBuckling : Infinity);
        const known = w.reduce((s, x) => s + x.mass, 0);
        outputs[`${c.id}.loadToLimit`] = { value: { scale: lim, totalMassKg: known * lim, knownMassKg: known, governs: Number.isFinite(bucklingFactor) && bucklingFactor / reqBuckling < gov.fy / fs / gov.worst.vonMises ? "buckling" : `stress in ${gov.id}` }, basis: "computed: linear model, every load of the case proportional to the mass; the total mass at which the governing check reaches 1. A bound for the unknown masses, not a pass" };
      }
    }
    for (const k of fm.stiffness || []) {
      const c = res.cases.find((x) => x.id === k.case);
      if (!c) return { notComputed: `stiffness ${k.id}: no load case ${k.case}` };
      const u = c.nodeDisplacement(k.node)[{ x: 0, y: 1, z: 2 }[k.dof]];
      const kk = k.kind === "torsional" ? (k.force * k.arm ** 2) / u : k.force / u;
      outputs[`stiffness.${k.id}`] = k.kind === "torsional"
        ? { value: kk, unit: "N·m/rad", perDegree: (kk * Math.PI) / 180, note: `couple ${k.force} N × ${k.arm} m over twist u/arm; u = ${u.toExponential(4)} m at ${k.node}.${k.dof}` }
        : { value: kk, unit: "N/m", note: `${k.force} N / u at ${k.node}.${k.dof}` };
    }
    outputs.validity = { value: validity };
    return {
      inputs: { ...inputs, factorOfSafety: { value: fs, basis: fm.factorOfSafety?.basis || "none stated: no factor applied to yield" }, requiredBucklingFactor: { value: reqBuckling, basis: fm.buckling?.requiredFactor?.basis || "none stated: buckling factor ≥ 1" } },
      outputs, margins, warnings,
      covers: [id, ...(fm.members || []).map((m) => m.part).filter(Boolean)],
      assumptions: [
        "Linear elastic, small displacement, Euler-Bernoulli members; transverse shear stress neglected; joints rigid unless a support releases them.",
        "Buckling: elastic flexural (linear eigenvalue) only; lateral-torsional, local and torsional buckling are not modelled.",
        ...(fm.assumptions || []),
      ],
    };
  },
});
