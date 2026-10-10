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
//   stiffness: [{ id, case, node, dof, force, arm?, kind: "linear" | "torsional", target?: { value, label, basis, sources },
//               profile?: [{ id, nodes: [left, right] }] }]  (a target is a margin: stiffness ≥ target)  →
//             linear k = force / u; torsional k = force·arm² / u (a couple force·arm over a
//             twist u/arm), from that node displacement in that case
//   assumptions: [text]
//   shearDeformation: true  Timoshenko members (frame-fe.js); for short, deep vehicle members
//   panels:   [{ id, nodes: [n1, n2, n3, n4], part }]  thin sheets working in shear (part: a plate
//             with thickness and material), modelled as equivalent crossed diagonals
//             (structural/shear-panel.js); checked for shear yield and elastic shear buckling
//   load case forces: [{ from: { solver, target, output }, factor: { value, state, basis }, node, dir }]
//             a force read from a solver run (N) × factor along dir (e.g. an axle load as a twist couple)
//
// Margins: von Mises at the worst station of every member ≤ Fy / FS; buckling
// factor ≥ required. Results outside the solver's validity range (see
// frame-fe.js) are warnings and the run is never PASS while any stand. A load
// read from a run with unknown items (an open mass budget) is a warning too,
// with the total mass at which the frame reaches its governing limit.

import { registerSolver } from "../registry.js";
import { analyzeFrame, frameValidity, sectionProps, FRAME_FE_VERSION } from "../../structural/frame-fe.js";
import { getMaterial } from "../../materials/index.js";
import { scenarioSprings, panelBondFactor, jointSchedule, JOINT_MODEL_VERSION } from "../../structural/joint-stiffness.js";
import { panelDiagonals, plateShearBuckling, panelShear } from "../../structural/shear-panel.js";
import { saintVenantStiffness, sectionCutTorque, crossCheckReading, specificStiffness, eliseSpecific, ELISE_REFERENCE } from "../../structural/tub-torsion-check.js";

const G0 = 9.80665;
const perDeg = (kRad) => (kRad * Math.PI) / 180;

/** Volume of one part from its compiled geometry (m³). A cut member does not change the part. */
function partVolume(g) {
  if (!g) return null;
  if (g.shape === "plate") {
    if (!(g.length > 0 && g.width > 0 && g.thickness > 0)) return null;
    return g.length * g.width * g.thickness;
  }
  if (g.shape === "rect-tube" || g.shape === "round-tube" || g.shape === "u-channel" || g.shape === "i-beam" || g.shape === "rect" || g.shape === "bar") {
    const sec = sectionProps(g);
    if (!(sec.A > 0) || !(g.length > 0)) return null;
    return sec.A * g.length;
  }
  return null;
}

/** Tub mass from unique part geometry × library density. Missing geometry stays listed, not guessed. */
function tubPartMass(ctx, fm) {
  const seen = new Set();
  let mass = 0;
  const missing = [];
  const ids = [...(fm.members || []).map((m) => m.part), ...(fm.panels || []).map((p) => p.part)].filter(Boolean);
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const vol = partVolume(ctx.get(id, "geometry"));
    const rho = ctx.material(id)?.densityKgM3;
    if (!(vol > 0) || !(rho > 0)) { missing.push(id); continue; }
    mass += vol * rho;
  }
  return { massKg: mass, parts: seen.size, missing, basis: "computed: each tub part's geometry once, times its library density. A member split at a joint is not counted twice. This is the tub, not the CHASSIS assembly." };
}

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
        // a member may override its part's section where the part is cut (an access opening over a length)
        section = m.section || sectionFromGeometry(ctx.get(m.part, "geometry"));
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
      // a part split into several members at joints is checked for beam-theory validity on its own length
      const partLen = m.part ? ctx.get(m.part, "geometry.length") : null;
      members.push({ id: m.id, i: m.i, j: m.j, section, E: mp.E, G: mp.G, fy: mp.fy, segments: m.segments, part: m.part || null, ...(m.endSprings ? { endSprings: m.endSprings } : {}), ...(Number.isFinite(partLen) ? { checkLength: partLen } : {}) });
      inputs[`member.${m.id}`] = { value: { section, material: mp.id, part: m.part || null }, source: mp.source };
    }
    // shear panels → equivalent diagonals (not stress-checked as members; checked as panels below)
    const panelInfo = [];
    const panelWarnings = [];
    const nodesById = new Map((fm.nodes || []).map((n) => [String(n.id), n]));
    for (const p of fm.panels || []) {
      const g = ctx.get(p.part, "geometry");
      const t = g?.thickness;
      if (!(t > 0)) return { notComputed: `panel ${p.id}: part ${p.part} has no thickness` };
      const mat = ctx.material(p.part);
      const mp = materialProps(mat);
      if (mp.error) return { notComputed: `panel ${p.id}: ${mp.error}` };
      // a sheet with cut-outs keeps the fraction of its shear stiffness its factor states (membrane-fe.js)
      const factor = p.shearStiffnessFactor?.value ?? 1;
      if (!(factor > 0 && factor <= 1)) return { notComputed: `panel ${p.id}: shearStiffnessFactor must be in (0, 1]` };
      let pd;
      try { pd = panelDiagonals(nodesById, p, { E: mp.E, G: mp.G * factor, t }); } catch (e) { return { notComputed: e.message }; }
      for (const d of pd.diagonals) members.push({ id: d.id, i: d.i, j: d.j, section: d.section, E: mp.E, G: mp.G, fy: null, segments: 1, geometricStiffness: false, panel: p.id });
      panelInfo.push({ id: p.id, part: p.part, t, mp, nu: mat.poisson, geometry: pd.geometry, diagonals: pd.diagonals, factor });
      if (!mp.fy) panelWarnings.push(`panel ${p.id}: ${mp.id} has no yield or shear strength in the library: its shear strength is not checked (elastic shear buckling is)`);
      inputs[`panel.${p.id}`] = { value: { part: p.part, thicknessM: t, material: mp.id, a: pd.geometry.a, b: pd.geometry.b, rectangular: pd.geometry.rectangular, ...(factor !== 1 ? { shearStiffnessFactor: factor, factorBasis: p.shearStiffnessFactor.basis, cutouts: p.cutouts || [] } : {}) }, source: mp.source };
    }
    const panelMember = new Set(panelInfo.flatMap((p) => p.diagonals.map((d) => d.id)));
    const fs = fm.factorOfSafety?.value ?? 1;
    const reqBuckling = fm.buckling?.requiredFactor?.value ?? 1;
    const warnings = [...panelWarnings];
    const scaleable = new Map();
    const loadCases = [];
    for (const lc of fm.loadCases || []) {
      const nodal = [...(lc.nodal || [])], udl = [...(lc.udl || [])];
      const weights = [];
      for (const f of lc.forces || []) {
        const run = ctx.result(f.from.solver, f.from.target);
        const v = run?.outputs?.[f.from.output]?.value;
        if (!Number.isFinite(v)) return { notComputed: `load case ${lc.id}: no ${f.from.output} from ${f.from.solver}@${f.from.target} (${run?.status || "missing"}${run?.reason ? `: ${run.reason}` : ""})` };
        const k = f.factor?.value ?? 1;
        const nd = Math.hypot(...f.dir);
        nodal.push({ node: f.node, F: f.dir.map((c) => (c / nd) * v * k) });
        inputs[`force.${lc.id}.${f.node}`] = { value: { readN: v, factor: k, forceN: v * k }, source: run.runId, basis: f.factor?.basis };
      }
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
      scaleable.set(lc.id, weights.length && !(lc.nodal || []).length && !(lc.udl || []).length && !(lc.forces || []).length ? weights : null);
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
        r = analyzeFrame({ nodes: fm.nodes, members, supports: g.supports, loadCases: g.cases, up: fm.up || [0, 0, 1], shearDeformation: !!fm.shearDeformation }, { segments: fm.segments ?? 8, buckling: fm.buckling?.cases || [] });
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
      const structural = c.members.filter((mr) => !panelMember.has(mr.id));
      for (const mr of structural) {
        if (mr.fy && !stiffnessOnly.has(c.id)) margins.push({ check: `${c.id}: ${mr.id} von Mises ≤ Fy / ${fs}`, demand: mr.worst.vonMises, capacity: mr.fy / fs, unit: "Pa" });
        if (mr.fy && (!gov || mr.worst.vonMises / mr.fy > gov.worst.vonMises / gov.fy)) gov = mr;
      }
      if (structural.some((mr) => !mr.fy)) warnings.push(`${c.id}: members without a yield strength are not stress-checked: ${structural.filter((mr) => !mr.fy).map((mr) => mr.id).join(", ")}`);
      if (panelInfo.length) {
        const rows = panelInfo.map((p) => {
          const n = (id) => c.members.find((mr) => mr.id === id).worst.N;
          const [d1, d2] = p.diagonals;
          const tau = panelShear({ N1: n(d1.id), N2: n(d2.id), d1: d1.d, d2: d2.d, t: p.t });
          const bk = plateShearBuckling({ a: p.geometry.a, b: p.geometry.b, t: p.t, E: p.mp.E, nu: p.nu });
          return { id: p.id, part: p.part, tauPa: tau, tauCrPa: bk.tauCr, ks: bk.ks, shearYieldPa: p.mp.fy ? p.mp.fy / Math.sqrt(3) : null, rectangular: p.geometry.rectangular };
        });
        outputs[`${c.id}.panels`] = { value: rows, unit: "Pa", note: "tau = (|N1|/d1 + |N2|/d2)/t from the equivalent diagonals; tauCr: elastic shear buckling, plate simply supported on four edges (Timoshenko & Gere sec. 9.7)" };
        if (!stiffnessOnly.has(c.id)) {
          for (const r of rows) {
            if (r.shearYieldPa) margins.push({ check: `${c.id}: panel ${r.id} shear ≤ Fy/√3 / ${fs}`, demand: r.tauPa, capacity: r.shearYieldPa / fs, unit: "Pa" });
            margins.push({ check: `${c.id}: panel ${r.id} shear ≤ elastic shear buckling τcr (k_s ${r.ks.toFixed(2)})`, demand: r.tauPa, capacity: r.tauCrPa, unit: "Pa" });
          }
        }
      }
      outputs[`${c.id}.members`] = { value: structural.map((mr) => ({ id: mr.id, vonMisesPa: mr.worst.vonMises, at: mr.worst.at, N: mr.worst.N, Mz: mr.worst.Mz, My: mr.worst.My, T: mr.worst.T, compressionN: mr.compression, utilization: mr.fy ? (mr.worst.vonMises * fs) / mr.fy : null })) };
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
      if (w && gov) {
        const open = w.some((x) => x.unknown > 0);
        const lim = Math.min(gov.fy / fs / gov.worst.vonMises, Number.isFinite(bucklingFactor) ? bucklingFactor / reqBuckling : Infinity);
        const known = w.reduce((s, x) => s + x.mass, 0);
        outputs[`${c.id}.loadToLimit`] = { value: { scale: lim, totalMassKg: known * lim, knownMassKg: known, governs: Number.isFinite(bucklingFactor) && bucklingFactor / reqBuckling < gov.fy / fs / gov.worst.vonMises ? "buckling" : `stress in ${gov.id}` }, basis: open ? "computed: linear model, every load of the case proportional to the mass; the total mass at which the governing check reaches 1. A bound for the unknown masses, not a pass" : "computed: linear model, every load of the case proportional to the mass; the total mass at which the governing check reaches 1 (the budget is closed: the margin checks above apply to the mass as it stands)" };
      }
    }
    for (const k of fm.stiffness || []) {
      const c = res.cases.find((x) => x.id === k.case);
      if (!c) return { notComputed: `stiffness ${k.id}: no load case ${k.case}` };
      const u = c.nodeDisplacement(k.node)[{ x: 0, y: 1, z: 2 }[k.dof]];
      const kk = k.kind === "torsional" ? (k.force * k.arm ** 2) / u : k.force / u;
      if (k.kind === "torsional" && Array.isArray(k.profile)) {
        // twist angle at stations along the car (node pairs left/right), for this load: where the compliance is
        const rows = k.profile.map((st) => {
          const a = fm.nodes.find((n) => n.id === st.nodes[0]), b = fm.nodes.find((n) => n.id === st.nodes[1]);
          const ua = c.nodeDisplacement(st.nodes[0])[2], ub = c.nodeDisplacement(st.nodes[1])[2];
          return { station: st.id, x: (a.x + b.x) / 2, twistRad: (ua - ub) / (a.y - b.y) };
        });
        const total = (u / k.arm);
        outputs[`stiffness.${k.id}.profile`] = { value: rows.map((r) => ({ ...r, fractionOfTotal: total ? r.twistRad / total : null })), unit: "rad", note: `twist angle (left minus right vertical displacement over their spacing) at each station under the ${k.case} load; the total twist is ${total.toExponential(4)} rad` };
      }
      if (k.target && Number.isFinite(k.target.value)) {
        const unitTxt = k.kind === "torsional" ? "N·m/rad" : "N/m";
        margins.push({ check: `stiffness ${k.id} ≥ target ${k.target.label || k.target.value} (${k.target.basis})`, demand: k.target.value, capacity: kk, unit: unitTxt });
        inputs[`target.${k.id}`] = { value: k.target.value, unit: unitTxt, basis: k.target.basis, sources: k.target.sources || [] };
      }
      outputs[`stiffness.${k.id}`] = k.kind === "torsional"
        ? { value: kk, unit: "N·m/rad", perDegree: (kk * Math.PI) / 180, note: `couple ${k.force} N × ${k.arm} m over twist u/arm; u = ${u.toExponential(4)} m at ${k.node}.${k.dof}` }
        : { value: kk, unit: "N/m", note: `${k.force} N / u at ${k.node}.${k.dof}` };
    }
    // joint scenarios (structural/joint-stiffness.js): the stiffness cases re-solved with the joints'
    // rotational springs, a range from rigid (upper bound) to the scenarios' lowest
    if (Array.isArray(fm.jointScenarios) && fm.jointScenarios.length) {
      const nodeOf = new Map(fm.nodes.map((n) => [String(n.id), n]));
      const lenOf = (m) => { const a = nodeOf.get(String(m.i)), b = nodeOf.get(String(m.j)); return Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)); };
      const frameMembers = members.filter((m) => !m.panel).map((m) => ({ ...m, L: lenOf(m) }));
      for (const k of (fm.stiffness || []).filter((x) => x.jointRange)) {
        const lc = loadCases.find((x) => x.id === k.case);
        const rigid = outputs[`stiffness.${k.id}`].value;
        const rows = [];
        for (const sc of fm.jointScenarios) {
          const { springs, rows: jr } = scenarioSprings(frameMembers, sc);
          const ms = members.map((m) => {
            if (m.panel && sc.bond) {
              const p = panelInfo.find((x) => x.id === m.panel);
              const f = panelBondFactor({ G: p.mp.G * p.factor, t: p.t, a: p.geometry.a, b: p.geometry.b }, sc.bond);
              return { ...m, section: { ...m.section, A: m.section.A * f } };
            }
            return springs[m.id] ? { ...m, endSprings: springs[m.id] } : m;
          });
          let r;
          try {
            r = analyzeFrame({ nodes: fm.nodes, members: ms, supports: lc.supports || fm.supports, loadCases: [lc], up: fm.up || [0, 0, 1], shearDeformation: !!fm.shearDeformation }, { segments: fm.segments ?? 8 });
          } catch (e) {
            return { notComputed: `joint scenario ${sc.id}: ${e.message}` };
          }
          if (!r.ok) return { notComputed: `joint scenario ${sc.id}: ${r.error}: ${r.detail}` };
          const u = r.cases[0].nodeDisplacement(k.node)[{ x: 0, y: 1, z: 2 }[k.dof]];
          const kk = k.kind === "torsional" ? (k.force * k.arm ** 2) / u : k.force / u;
          const relMin = jr.length ? Math.min(...jr.flatMap((x) => x.relative)) : null;
          rows.push({ id: sc.id, label: sc.label, state: sc.state, value: kk, perDegree: (kk * Math.PI) / 180, fractionOfRigid: kk / rigid, joints: jr.length, minRelativeStiffness: relMin });
        }
        const computedRows = rows.filter((x) => x.state === "computed");
        const estimatedRows = rows.filter((x) => x.state !== "computed");
        const lowC = computedRows.length ? Math.min(...computedRows.map((x) => x.value)) : rigid;
        const lowE = estimatedRows.length ? Math.min(...estimatedRows.map((x) => x.value)) : null;
        const low = Math.min(lowC, lowE ?? lowC);
        outputs[`stiffness.${k.id}.jointRange`] = {
          value: {
            rigid, rigidPerDegree: perDeg(rigid),
            lowComputed: lowC, lowComputedPerDegree: perDeg(lowC),
            lowEstimated: lowE, lowEstimatedPerDegree: lowE == null ? null : perDeg(lowE),
            low, lowPerDegree: perDeg(low),
            scenarios: rows,
          },
          unit: k.kind === "torsional" ? "N·m/rad" : "N/m",
          note: `joint model ${JOINT_MODEL_VERSION} (structural/joint-stiffness.js): rigid joints are the upper bound. lowComputed is the lowest scenario whose springs are computed from the adhesive data sheets. lowEstimated is the EN 1993-1-8 joint-wall bound (a steel-building classification used only as a bound). low is the lower of those two and is not itself a capacity. The hard margin uses lowComputed.`,
        };
        if (k.target && Number.isFinite(k.target.value)) {
          const unitTxt = k.kind === "torsional" ? "N·m/rad" : "N/m";
          const mi = margins.findIndex((mm) => mm.check.startsWith(`stiffness ${k.id} ≥ target`));
          if (mi >= 0) margins[mi] = { ...margins[mi], check: `${margins[mi].check} [rigid joints: the upper bound]` };
          const lowCRow = computedRows.find((x) => x.value === lowC) || { label: "rigid joints", state: "computed" };
          margins.push({ check: `stiffness ${k.id} ≥ target ${k.target.label || k.target.value} at the lowest computed joint scenario (${lowCRow.label}; ${lowCRow.state})`, demand: k.target.value, capacity: lowC, unit: unitTxt });
          if (lowE != null && lowE < k.target.value) {
            const lowERow = estimatedRows.find((x) => x.value === lowE);
            warnings.push(`stiffness ${k.id}: estimated joint-wall bound ${perDeg(lowE).toFixed(1)} N·m/deg (${lowERow.label}; ${lowERow.state}) is below the target ${k.target.label || k.target.value}. EN 1993-1-8 k_b classifies steel building joints and is used here only as a bound on joint-wall distortion, which is not computed for this bonded aluminium tub. It is not a capacity and does not fail the check. The joints need a test or shell FE.`);
          }
        }
      }
      const sched = jointSchedule(frameMembers, { panels: panelInfo });
      outputs["stiffness.jointSchedule"] = {
        value: {
          version: JOINT_MODEL_VERSION,
          count: sched.length,
          welded: sched.filter((r) => r.weld).length,
          byClass: [...new Set(sched.map((r) => r.jointClass))].map((c) => ({ jointClass: c, type: sched.find((r) => r.jointClass === c).type, weld: false, count: sched.filter((r) => r.jointClass === c).length })),
          rows: sched,
        },
        note: "One row per extrusion end that meets another part, plus one row per sheet. Bonded and riveted. No welds. Rivet stiffness is not credited.",
      };
      const kT = (fm.stiffness || []).find((x) => x.jointRange && x.kind === "torsional");
      const span = fm.torsionCrossCheck;
      if (kT && span && span.x1 > span.x0) {
        const lc = loadCases.find((x) => x.id === kT.case);
        const bareMembers = members.filter((m) => !m.panel);
        let without = null, bareNote = null;
        try {
          const rBare = analyzeFrame({ nodes: fm.nodes, members: bareMembers, supports: lc.supports || fm.supports, loadCases: [lc], up: fm.up || [0, 0, 1], shearDeformation: !!fm.shearDeformation }, { segments: fm.segments ?? 8 });
          if (!rBare.ok) bareNote = `${rBare.error}: ${rBare.detail}`;
          else {
            const u = rBare.cases[0].nodeDisplacement(kT.node)[{ x: 0, y: 1, z: 2 }[kT.dof]];
            if (!(Math.abs(u) > 0)) bareNote = "panel-free twist displacement is zero";
            else {
              const kk = (kT.force * kT.arm ** 2) / u;
              without = { value: kk, perDegree: perDeg(kk) };
            }
          }
        } catch (e) {
          bareNote = e.message;
        }
        let sv;
        try { sv = saintVenantStiffness({ nodes: fm.nodes, members: bareMembers, x0: span.x0, x1: span.x1 }); }
        catch (e) { sv = { finite: false, note: e.message }; }
        const withP = outputs[`stiffness.${kT.id}`].perDegree;
        const reading = (without && sv.finite)
          ? crossCheckReading({ withPanels: withP, withoutPanels: without.perDegree, saintVenant: sv.perDegree })
          : { panelFraction: null, frameOverSaintVenant: sv.finite && without ? without.perDegree / sv.perDegree : null, reading: bareNote || sv.note || "not compared" };
        outputs[`stiffness.${kT.id}.crossCheck`] = {
          value: {
            withPanelsPerDegree: withP,
            withoutPanelsPerDegree: without?.perDegree ?? null,
            saintVenantPerDegree: sv.finite ? sv.perDegree : null,
            saintVenantFinite: !!sv.finite,
            gapAt: sv.gapAt ?? null,
            panelFraction: reading.panelFraction,
            frameOverSaintVenant: reading.frameOverSaintVenant,
            reading: reading.reading,
            bareNote,
          },
          unit: "N·m/deg",
          note: "Rigid joints. withPanels is the equivalent-diagonal model. withoutPanels removes every diagonal and re-solves the same twist case. saintVenant is Bredt torsion of the closed extrusions only, free warping, no ring bending (structural/tub-torsion-check.js). A mechanism in the panel-free model is reported here and does not fail the solver. This is not a shell-element result and not a physical test.",
        };
        const c = res.cases.find((x) => x.id === kT.case);
        const axis = span.axis || { y: 0, z: 0 };
        const applied = kT.force * kT.arm;
        // Moment about the car axis of the external forces on the high-x side of a cut.
        // The stiffness couple force×arm is that moment only when the opposite pickup reacts with the opposite force.
        const externalHigh = (xCut) => {
          const acc = new Map();
          const bump = (id, dof, value) => {
            if (!acc.has(String(id))) acc.set(String(id), { F: [0, 0, 0], M: [0, 0, 0] });
            const o = acc.get(String(id));
            const fi = { x: 0, y: 1, z: 2 }[dof];
            const mi = { rx: 0, ry: 1, rz: 2 }[dof];
            if (fi != null) o.F[fi] += value;
            if (mi != null) o.M[mi] += value;
          };
          for (const rec of c.reactions) bump(rec.node, rec.dof, rec.value);
          for (const n of lc.nodal || []) {
            (n.F || []).forEach((v, i) => bump(n.node, ["x", "y", "z"][i], v));
            (n.M || []).forEach((v, i) => bump(n.node, ["rx", "ry", "rz"][i], v));
          }
          const pos = new Map(fm.nodes.map((n) => [String(n.id), n]));
          let Mx = 0;
          for (const [id, o] of acc) {
            const p = pos.get(id);
            if (!p || !(p.x > xCut)) continue;
            Mx += (p.y - axis.y) * o.F[2] - ((p.z ?? 0) - axis.z) * o.F[1] + o.M[0];
          }
          return Mx;
        };
        const cuts = [0.2, 0.5, 0.8].map((f) => {
          const xCut = span.x0 + f * (span.x1 - span.x0);
          const cut = sectionCutTorque({ nodes: fm.nodes, members, memberResults: c.members, xCut, up: fm.up || [0, 0, 1], axis });
          const ext = externalHigh(xCut);
          return {
            x: xCut,
            fraction: f,
            totalNm: cut.totalNm,
            appliedCoupleNm: applied,
            externalNm: ext,
            equilibrium: ext ? cut.totalNm / ext : null,
            groups: Object.fromEntries(Object.entries(cut.groups).map(([g, v]) => [g, { share: v.share, torqueNm: v.torqueNm, saintVenantNm: v.saintVenantNm, members: v.members }])),
          };
        });
        outputs[`stiffness.${kT.id}.loadPath`] = {
          value: cuts,
          unit: "N·m",
          note: "Section-cut torque about the car axis on the rigid-joint twist case, panels included, at 20/50/80 % of the axle span. equilibrium is cut torque / the moment of the external forces on the high-x side of that cut. appliedCoupleNm is force×pickup spacing, the couple the stiffness number uses; it equals the cut only when the opposite pickup reacts with the opposite force. Shares are this model's load path.",
        };
        const tubMass = tubPartMass(ctx, fm);
        const vehMass = ctx.result("mass.assembly", "VEH");
        const chMass = ctx.result("mass.assembly", "CHASSIS");
        const vehicleKg = vehMass?.outputs?.mass?.value ?? null;
        const grossKg = vehMass?.outputs?.grossMass?.value ?? null;
        const chassisKg = chMass?.outputs?.mass?.value ?? null;
        const jr = outputs[`stiffness.${kT.id}.jointRange`].value;
        const band = [
          { id: "rigid", perDegree: jr.rigidPerDegree, state: "computed" },
          { id: "computed-low", perDegree: jr.lowComputedPerDegree, state: "computed" },
          ...(jr.lowEstimatedPerDegree != null ? [{ id: "estimated-low", perDegree: jr.lowEstimatedPerDegree, state: "estimated" }] : []),
        ];
        outputs[`stiffness.${kT.id}.specific`] = {
          value: {
            tubMassKg: tubMass,
            vehicleMassKg: vehicleKg,
            grossMassKg: grossKg,
            chassisMassKg: chassisKg,
            ours: band.map((r) => ({
              ...r,
              perKgTub: tubMass.massKg > 0 ? specificStiffness(r.perDegree, tubMass.massKg) : null,
              perKgVehicle: vehicleKg > 0 ? specificStiffness(r.perDegree, vehicleKg) : null,
              perKgGross: grossKg > 0 ? specificStiffness(r.perDegree, grossKg) : null,
            })),
            elise: eliseSpecific(),
            eliseMassKg: { tub: ELISE_REFERENCE.tubMassKg, vehicle: ELISE_REFERENCE.vehicleMassKg },
            eliseNote: ELISE_REFERENCE.note,
          },
          unit: "N·m/deg/kg",
          note: "Tub mass is unique part geometry × library density. Vehicle mass is mass.assembly@VEH with no payload; gross includes payload. CHASSIS mass can include parts that are not the tub. Elise 68 kg includes the door beams. Elise 876 kg does not state fluids or a driver. The two Elise stiffnesses are not averaged.",
        };
      }
    }
    outputs.validity = { value: validity };
    return {
      inputs: { ...inputs, factorOfSafety: { value: fs, basis: fm.factorOfSafety?.basis || "none stated: no factor applied to yield" }, requiredBucklingFactor: { value: reqBuckling, basis: fm.buckling?.requiredFactor?.basis || "none stated: buckling factor ≥ 1" } },
      outputs, margins, warnings,
      covers: [id, ...(fm.members || []).map((m) => m.part).filter(Boolean), ...panelInfo.map((p) => p.part)],
      assumptions: [
        "Linear elastic, small displacement, Euler-Bernoulli members; transverse shear stress neglected; joints rigid unless a support releases them or the model gives end springs.",
        ...(Array.isArray(fm.jointScenarios) && fm.jointScenarios.length ? ["Stresses, buckling and the profile are from the rigid-joint solve. Joint scenarios re-solve the stiffness cases only. The stiffness margin uses the lowest computed bond-line scenario. An EN 1993-1-8 joint-wall bound below the target is a warning: that classification is a steel-building rule used as a bound, not a computed capacity of these joints."] : []),
        "Buckling: elastic flexural (linear eigenvalue) only; lateral-torsional, local and torsional buckling are not modelled.",
        ...(fm.shearDeformation ? ["Members are Timoshenko beams (shear deformation with Cowper shear areas); transverse shear stress V/As is added to the torsional shear (conservative)."] : []),
        ...(panelInfo.length ? [
          "Shear panels are equivalent crossed diagonals with the panel's in-plane shear stiffness (structural/shear-panel.js); their out-of-plane bending is not credited and a panel above its elastic shear-buckling stress fails its check (tension-field stiffness not modelled).",
          ...(panelInfo.some((p) => p.factor !== 1) ? [`Panels with cut-outs (${panelInfo.filter((p) => p.factor !== 1).map((p) => `${p.id} × ${p.factor.toFixed(3)}`).join(", ")}) keep the shear stiffness fraction their membrane FE computed (structural/membrane-fe.js); their shear stress is the gross-section average: the stress concentration at a cut-out's edge is not checked.`] : []),
          ...(panelInfo.some((p) => !p.geometry.rectangular) ? [`Non-rectangular panels (${panelInfo.filter((p) => !p.geometry.rectangular).map((p) => p.id).join(", ")}) use the mean opposite side lengths: approximate.`] : []),
        ] : []),
        ...(fm.assumptions || []),
      ],
    };
  },
});
