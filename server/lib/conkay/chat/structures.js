// server/lib/conkay/chat/structures.js
//
// Class problems from chat (conversational-loop item 6): a cantilever bracket, a beam, a planar truss. Every answer
// is a hand formula with its numbers substituted, so a student can check it by hand, and the same case solved by the
// frame FE (structural/frame-fe.js) or the truss solver (structural/truss2d.js), with their agreement stated
// against a declared tolerance. Inputs come from the chat parser's IR (chat/brief-parser.js): design inputs, cited
// defaults, nothing filled in silently.
//
//   bracket: M = P L at the wall; I = b h³ / 12; c = h / 2; σ = M c / I; δ = P L³ / (3 E I).
//            The depth h is sized up the ISO 3 R10 preferred numbers until σ ≤ F_y / SF.
//   beam (simply supported, point loads P at a and a UDL w): R_A = Σ P (L − a) / L + w L / 2, R_B = Σ P a / L + w L / 2;
//            M(x) from statics (its maximum found at a load point or where the shear crosses zero);
//            midspan point + UDL: δ = P L³ / (48 E I) + 5 w L⁴ / (384 E I) (Gere & Goodno, Mechanics of Materials,
//            beam-deflection tables); otherwise the FE deflection.
//   truss:   joint forces by the direct stiffness method on pin-jointed bars (truss2d.js) = the method of joints for a
//            determinate truss.

import { analyzeFrame, sectionProps } from "../structural/frame-fe.js";
import { solveTruss, trussGeometry } from "../structural/truss2d.js";
import { getMaterial } from "../materials/index.js";

export const STRUCTURES_VERSION = "1.0.0";
export const FE_TOLERANCE = 0.01; // hand formula vs frame FE (Euler-Bernoulli, no shear deformation): 1 %
export const R10 = Object.freeze([1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8]); // ISO 3 (preferred numbers), series R10
const R10_SOURCE = "ISO 3:1973 preferred numbers, series R10 (1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8 × 10ⁿ)";

const f = (v, unit = "", sig = 4) => `${Number.isFinite(v) ? +v.toPrecision(sig) : v}${unit ? ` ${unit}` : ""}`;
const mm = (m) => +(m * 1000).toPrecision(4);

/** R10 sizes in metres from lo to hi. */
export function r10Between(lo, hi) {
  const out = [];
  for (let e = -4; e <= 1; e++) for (const r of R10) { const v = r * 10 ** e; if (v >= lo - 1e-12 && v <= hi + 1e-12) out.push(+v.toPrecision(6)); }
  return out.sort((a, b) => a - b);
}

function material(id) {
  const m = getMaterial(id);
  return m ? { id, label: m.label, E: m.youngsModulusPa, Fy: m.yieldPa, rho: m.densityKgM3, source: m.source } : null;
}

/** A cantilever rectangular bar: hand formulas and the frame FE for the same case. */
export function cantilever({ P, L, b, h, E, G = E / 2.6 }) {
  const I = (b * h ** 3) / 12, c = h / 2, M = P * L;
  const sigma = (M * c) / I, delta = (P * L ** 3) / (3 * E * I);
  const sec = { shape: "rect", width: b, height: h };
  const fe = analyzeFrame({
    nodes: [{ id: "WALL", x: 0, y: 0, z: 0 }, { id: "TIP", x: L, y: 0, z: 0 }],
    members: [{ id: "ARM", i: "WALL", j: "TIP", section: sec, E, G }],
    supports: [{ node: "WALL", fix: "fixed" }],
    loadCases: [{ id: "P", nodal: [{ node: "TIP", F: [0, -P, 0] }] }],
  });
  const cs = fe.ok === false ? null : fe.cases[0];
  const feDelta = cs ? Math.abs(cs.nodeDisplacement("TIP")[1]) : null;
  const feSigma = cs ? Math.max(...cs.members.map((m) => m.worst.sigma)) : null;
  const agree = (a, x) => Number.isFinite(a) && Math.abs(a - x) <= FE_TOLERANCE * Math.abs(x);
  return {
    hand: { M, I, c, sigma, delta },
    fe: cs ? { sigma: feSigma, delta: feDelta, validity: fe.validity ?? null, agrees: { sigma: agree(feSigma, sigma), delta: agree(feDelta, delta) } } : { error: fe.error || "the frame FE did not solve" },
    sectionCheck: sectionProps(sec),
  };
}

/** Size a cantilever bracket's depth up the R10 series until σ ≤ F_y / SF. */
export function solveBracket(ir) {
  const missing = ["lengthM", "loadN", "widthM", "material", "safetyFactor"].filter((k) => ir[k] == null);
  if (missing.length) return { ok: false, missing };
  const mat = material(ir.material);
  if (!mat) return { ok: false, error: `no material data for ${ir.material}` };
  const P = Math.abs(ir.loadN), L = ir.lengthM, b = ir.widthM;
  const allowable = mat.Fy / ir.safetyFactor;
  const sizes = ir.thicknessM ? [ir.thicknessM] : r10Between(0.001, 0.2);
  let pick = null;
  for (const h of sizes) { const r = cantilever({ P, L, b, h, E: mat.E }); if (r.hand.sigma <= allowable) { pick = { h, r }; break; } }
  if (!pick) {
    const r = cantilever({ P, L, b, h: sizes.at(-1), E: mat.E });
    return { ok: true, sized: false, note: ir.thicknessM ? `the given depth ${mm(ir.thicknessM)} mm is over its allowable stress` : `no R10 depth up to ${mm(sizes.at(-1))} mm holds: widen the bar or shorten the arm`, utilization: r.hand.sigma / allowable, ...describeBracket({ P, L, b, h: sizes.at(-1), mat, sf: ir.safetyFactor, r }) };
  }
  return { ok: true, sized: !ir.thicknessM, depthM: pick.h, depthSource: ir.thicknessM ? "given" : R10_SOURCE, utilization: pick.r.hand.sigma / allowable, ...describeBracket({ P, L, b, h: pick.h, mat, sf: ir.safetyFactor, r: pick.r }) };
}

function describeBracket({ P, L, b, h, mat, sf, r }) {
  const { M, I, c, sigma, delta } = r.hand;
  const allowable = mat.Fy / sf;
  const steps = [
    `M = P L = ${f(P, "N")} × ${f(L, "m")} = ${f(M, "N·m")}`,
    `I = b h³ / 12 = ${f(b, "m")} × (${f(h, "m")})³ / 12 = ${f(I, "m⁴")}`,
    `c = h / 2 = ${f(c, "m")}`,
    `σ = M c / I = ${f(M, "N·m")} × ${f(c, "m")} / ${f(I, "m⁴")} = ${f(sigma / 1e6, "MPa")}`,
    `allowable = F_y / SF = ${f(mat.Fy / 1e6, "MPa")} / ${sf} = ${f(allowable / 1e6, "MPa")} → utilization ${f(sigma / allowable, "", 3)}`,
    `δ = P L³ / (3 E I) = ${f(P, "N")} × (${f(L, "m")})³ / (3 × ${f(mat.E / 1e9, "GPa")} × ${f(I, "m⁴")}) = ${f(delta * 1000, "mm")}`,
  ];
  return {
    section: { widthM: b, depthM: h }, material: { id: mat.id, E: mat.E, Fy: mat.Fy, source: mat.source },
    hand: { M, I, c, sigmaPa: sigma, deltaM: delta, allowablePa: allowable }, steps,
    fe: r.fe, tolerance: FE_TOLERANCE,
    agreement: r.fe.agrees ? `frame FE: σ ${f(r.fe.sigma / 1e6, "MPa")}, δ ${f(r.fe.delta * 1000, "mm")} — ${r.fe.agrees.sigma && r.fe.agrees.delta ? `within ${FE_TOLERANCE * 100} % of the hand calculation` : "NOT within the tolerance of the hand calculation"}` : `frame FE: ${r.fe.error}`,
  };
}

/** A beam: statics from chat; stress and deflection when a section is given (or its depth sized from a width). */
export function solveBeam(ir) {
  const missing = ["spanM", "support"].filter((k) => ir[k] == null);
  if (!ir.loads?.length) missing.push("loads");
  if (missing.length) return { ok: false, missing };
  if (ir.support !== "simply-supported") return { ok: false, error: `this solver does the simply supported beam; ${ir.support} is not wired here yet` };
  const L = ir.spanM;
  const pts = ir.loads.filter((l) => l.type === "point").map((l) => ({ P: Math.abs(l.N), a: l.at === "midspan" || l.at == null ? L / 2 : typeof l.at === "object" ? (l.at.from === "right" ? L - l.at.xM : l.at.xM) : NaN, at: l.at }));
  if (pts.some((p) => !Number.isFinite(p.a) || p.a < 0 || p.a > L)) return { ok: false, error: "a point load's position is not on the span" };
  const w = ir.loads.filter((l) => l.type === "udl").reduce((s, l) => s + Math.abs(l.Npm), 0);
  const RA = pts.reduce((s, p) => s + (p.P * (L - p.a)) / L, 0) + (w * L) / 2;
  const RB = pts.reduce((s, p) => s + (p.P * p.a) / L, 0) + (w * L) / 2;
  const M = (x) => RA * x - (w * x * x) / 2 - pts.reduce((s, p) => s + (x > p.a ? p.P * (x - p.a) : 0), 0);
  // the maximum moment is at a point load or where the shear is zero: check those exactly
  const cands = [0, L, ...pts.map((p) => p.a)];
  if (w > 0) {
    const sorted = [...pts].sort((a, b) => a.a - b.a);
    let V0 = RA, x0 = 0;
    for (const p of [...sorted, { a: L, P: 0 }]) { const xz = x0 + V0 / w; if (xz > x0 && xz < p.a) cands.push(xz); V0 -= w * (p.a - x0) + p.P; x0 = p.a; }
  }
  const at = cands.reduce((best, x) => (M(x) > M(best) ? x : best), 0);
  const Mmax = M(at);
  const steps = [
    `R_A = Σ P (L − a) / L + w L / 2 = ${pts.map((p) => `${f(p.P, "N")} × (${f(L, "m")} − ${f(p.a, "m")}) / ${f(L, "m")}`).join(" + ") || "0"}${w ? ` + ${f(w, "N/m")} × ${f(L, "m")} / 2` : ""} = ${f(RA, "N")}`,
    `R_B = Σ P a / L + w L / 2 = ${f(RB, "N")}  (check: R_A + R_B = ${f(RA + RB, "N")} = the total load ${f(pts.reduce((s, p) => s + p.P, 0) + w * L, "N")})`,
    `M_max = M(${f(at, "m")}) = ${f(Mmax, "N·m")}${w && pts.length === 1 && Math.abs(pts[0].a - L / 2) < 1e-9 ? ` = P L / 4 + w L² / 8 = ${f(pts[0].P, "N")} × ${f(L, "m")} / 4 + ${f(w, "N/m")} × (${f(L, "m")})² / 8` : ""}`,
  ];
  const out = { ok: true, reactions: { RA, RB }, maxMoment: { value: Mmax, atM: at }, steps };
  const mat = ir.material ? material(ir.material) : null;
  let b = ir.widthM, h = ir.depthM;
  if (!mat || !b) return { ...out, needs: [...(mat ? [] : ["material"]), ...(b ? [] : ["section width (and depth, or ask for it to be sized)"])], note: "stress and deflection need a material and a section" };
  const allowable = ir.safetyFactor ? mat.Fy / ir.safetyFactor : null;
  const sigmaOf = (hh) => (Mmax * (hh / 2)) / ((b * hh ** 3) / 12);
  if (!h) {
    if (!allowable) return { ...out, needs: ["safety factor"], note: "sizing the depth needs a safety factor (none cited for this material)" };
    h = r10Between(0.005, 2).find((hh) => sigmaOf(hh) <= allowable);
    if (!h) return { ...out, note: "no R10 depth up to 2 m holds this load at this width" };
    out.depthSource = R10_SOURCE;
  }
  const I = (b * h ** 3) / 12, sigma = sigmaOf(h);
  const E = mat.E;
  const sym = pts.length <= 1 && pts.every((p) => Math.abs(p.a - L / 2) < 1e-9);
  const deltaHand = sym ? (pts[0] ? (pts[0].P * L ** 3) / (48 * E * I) : 0) + (5 * w * L ** 4) / (384 * E * I) : null;
  // the frame FE for the same beam: nodes at the supports and each point load
  const xs = [...new Set([0, L, ...pts.map((p) => p.a), L / 2])].sort((a, c) => a - c);
  const nodes = xs.map((x, i) => ({ id: `N${i}`, x, y: 0, z: 0 }));
  const sec = { shape: "rect", width: b, height: h };
  const members = nodes.slice(1).map((n, i) => ({ id: `B${i}`, i: nodes[i].id, j: n.id, section: sec, E, G: E / 2.6 }));
  const fe = analyzeFrame({
    nodes, members,
    supports: [{ node: "N0", fix: ["x", "y", "z", "rx"] }, { node: nodes.at(-1).id, fix: ["y", "z"] }],
    loadCases: [{ id: "L", nodal: pts.map((p) => ({ node: nodes[xs.indexOf(p.a)].id, F: [0, -p.P, 0] })), udl: w ? members.map((m) => ({ member: m.id, w: [0, -w, 0] })) : [] }],
  });
  const cs = fe.ok === false ? null : fe.cases[0];
  const feDelta = cs ? Math.max(...nodes.map((n) => Math.abs(cs.nodeDisplacement(n.id)[1]))) : null;
  const feSigma = cs ? Math.max(...cs.members.map((m) => m.worst.sigma)) : null;
  out.section = { widthM: b, depthM: h, I };
  out.material = { id: mat.id, E, Fy: mat.Fy, source: mat.source };
  out.steps.push(`I = b h³ / 12 = ${f(b, "m")} × (${f(h, "m")})³ / 12 = ${f(I, "m⁴")}`);
  out.steps.push(`σ = M c / I = ${f(Mmax, "N·m")} × ${f(h / 2, "m")} / ${f(I, "m⁴")} = ${f(sigma / 1e6, "MPa")}${allowable ? ` (allowable F_y / SF = ${f(allowable / 1e6, "MPa")}, utilization ${f(sigma / allowable, "", 3)})` : ""}`);
  if (deltaHand != null) out.steps.push(`δ_mid = P L³ / (48 E I) + 5 w L⁴ / (384 E I) = ${f(deltaHand * 1000, "mm")}`);
  out.hand = { sigmaPa: sigma, deltaM: deltaHand, allowablePa: allowable };
  out.fe = cs ? { sigma: feSigma, delta: feDelta, agrees: { sigma: Math.abs(feSigma - sigma) <= FE_TOLERANCE * sigma, delta: deltaHand == null ? null : Math.abs(feDelta - deltaHand) <= FE_TOLERANCE * deltaHand } } : { error: fe.error };
  out.tolerance = FE_TOLERANCE;
  return out;
}

/** A planar truss from chat: geometry, joint loads, pin + roller, member forces with tension / compression. */
export function solveTrussProblem(ir) {
  const missing = ["type", "panels", "spanM", "heightM"].filter((k) => ir[k] == null);
  if (!ir.loads?.length) missing.push("loads");
  if (missing.length) return { ok: false, missing };
  const g = trussGeometry({ type: ir.type, panels: ir.panels, span: ir.spanM, height: ir.heightM });
  if (!g.ok) return { ok: false, error: g.errors.join("; ") };
  const loads = [];
  for (const l of ir.loads) {
    const where = l.at === "each bottom joint" ? g.bottom.slice(1, -1) : l.at === "each joint" ? [...g.top, ...g.bottom.slice(1, -1)] : g.top; // "each top joint" or unplaced: the top (loaded) chord
    for (const j of where) loads.push({ joint: j, Fx: 0, Fy: -Math.abs(l.N) });
  }
  // EA only sets the displacements: a determinate truss's bar forces do not depend on it (stated)
  const EA = 200e9 * 1e-3;
  const r = solveTruss({ joints: g.joints, bars: g.bars.map((b) => ({ ...b, EA })), supports: g.supports, loads });
  if (!r.ok) return { ok: false, error: r.errors.join("; ") };
  return { ok: true, geometry: g, loads, ...r, note: r.determinacy.staticallyDeterminate ? "statically determinate (m + r = 2j): the bar forces are the method-of-joints answers and do not depend on the bars' E or A" : `statically indeterminate to degree ${r.determinacy.degree}: the forces depend on the bars' stiffness (EA = ${EA} N assumed for every bar)` };
}
