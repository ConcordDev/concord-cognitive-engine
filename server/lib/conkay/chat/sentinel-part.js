// server/lib/conkay/chat/sentinel-part.js
//
// A Sentinel M1 part from chat (conversational-loop item 7, stretch): the knee actuator bracket at the gait-cycle
// peak torque. The load is computed, never typed:
//   the M1 design (demos/sentinel-m1.js runSentinelM1, the iterate loop) -> its mass budget (mass.budget@sentinel:
//   known mass with its low/high range) -> the quasi-static gait (sentinel/gait.js quasiStaticGait) -> the knee's
//   conservative peak torque over the gait corners.
// The part is the design's own: M1 mounts each actuator between two 6061-T6 side plates (demos/sentinel-m1.js,
// mount-<joint>-<side><a|b>, 100 × 100 × 6 mm, a design choice). The actuator's torque T about its axis reacts
// through the pair, T/2 each, as an in-plane moment on a plate cantilevered from the leg tube:
//   σ = M c / I = 6 (T/2) / (t h²)   (I = t h³ / 12 about the in-plane axis, c = h / 2)
//   δ_tip = (T/2) L² / (2 E I)       (cantilever with an end moment, Roark's Formulas, Table 8.1)
// at M1's own factor of safety (2 on specified-minimum yield, the design's stated rule, not a code check). The
// thickness steps up the ISO 3 R10 series only if the check fails; it is never thinned on bending alone, because the
// checks that would govern a thinner plate (bolt bearing, plate buckling, fatigue) are not done here. A 100 × 100 mm
// plate is a deep beam (L/h = 1): beam theory is not a model of it, so the result is flagged screening-only, as the
// frame FE's validity check says too. The actuator's own peak torque (120 N·m, AK80-64 data sheet) is checked as a
// second case and labelled: a stall can apply it, the gait does not. Armor stays off M1.

import { runSentinelM1, buildSentinelM1IR, TUBE_CATALOG, ACTUATOR } from "../demos/sentinel-m1.js";
import { openDesign } from "../index.js";
import { quasiStaticGait, GAIT_VERSION } from "../sentinel/gait.js";
import { analyzeFrame } from "../structural/frame-fe.js";
import { getMaterial } from "../materials/index.js";
import { r10Between, FE_TOLERANCE } from "./structures.js";
import { sha256 } from "../iterate/receipt.js";

export const SENTINEL_PART_VERSION = "1.0.0";
const JOINTS = ["knee", "hip", "ankle"];
const f = (v, unit = "", sig = 4) => `${Number.isFinite(v) ? +v.toPrecision(sig) : v}${unit ? ` ${unit}` : ""}`;

/** The joint's design torque, computed from the M1 design: its mass budget through the gait solver. */
export function sentinelJointLoad(joint) {
  if (!JOINTS.includes(joint)) return { ok: false, error: `no joint "${joint}" (knee, hip, ankle)` };
  // the loop's accepted design: its final design variables, rebuilt and opened, so the mass budget is that design's
  const m1 = runSentinelM1();
  const fd = m1.report.finalDesign;
  const P = fd.nodes.find((n) => n.id === "battery")?.props?.battery?.parallel;
  const br = fd.nodes.find((n) => n.id === "bracket")?.geometry;
  const tube = TUBE_CATALOG.find((t) => br && Math.abs(t.geometry.width - br.width) < 1e-9 && Math.abs(t.geometry.wall - br.wall) < 1e-9);
  if (!P || !tube) return { ok: false, error: "the M1 loop's final design variables were not found: no load" };
  const opened = openDesign(buildSentinelM1IR({ batteryParallel: P, bracket: tube.id }));
  if (!opened.ok) return { ok: false, error: "the M1 final design did not compile: no load" };
  const mb = opened.session.result("mass.budget@sentinel");
  const o = mb?.outputs || {};
  const massKg = o.knownMass?.value, low = o.massLow?.value, high = o.massHigh?.value;
  if (!(massKg > 0)) return { ok: false, error: "the M1 design's mass budget did not compute: no load" };
  if (o.unknownCount?.value > 0) return { ok: false, error: `the M1 mass budget has ${o.unknownCount.value} unknown item(s): its total is not established` };
  const gait = quasiStaticGait({ massKg, massLowKg: low, massHighKg: high });
  const demand = gait.margins[joint].peak.demandNm;
  return {
    ok: true, joint, torqueNm: demand.high, range: demand,
    receipt: {
      m1: { receipt: m1.report.receipt?.sha256 ?? null, accepted: m1.gate?.accepted ?? null, design: { batteryParallel: P, bracket: tube.id }, massKg, massLowKg: low, massHighKg: high, source: "mass.budget@sentinel of the M1 loop's accepted design (demos/sentinel-m1.js)" },
      gait: { solver: `sentinel/gait.js quasiStaticGait@${GAIT_VERSION}`, output: `margins.${joint}.peak.demandNm.high (the conservative peak over the gait corners)`, inputsHash: sha256({ massKg, low, high }) },
    },
  };
}

/** The plate with an end moment T: hand formulas and the frame FE. */
export function endMomentPlate({ T, L, b, h, E }) {
  const I = (b * h ** 3) / 12, c = h / 2;
  const sigma = (T * c) / I, theta = (T * L) / (E * I), delta = (T * L * L) / (2 * E * I);
  const fe = analyzeFrame({
    nodes: [{ id: "TUBE", x: 0, y: 0, z: 0 }, { id: "ACT", x: L, y: 0, z: 0 }],
    members: [{ id: "PLATE", i: "TUBE", j: "ACT", section: { shape: "rect", width: b, height: h }, E, G: E / 2.6 }],
    supports: [{ node: "TUBE", fix: "fixed" }],
    loadCases: [{ id: "T", nodal: [{ node: "ACT", M: [0, 0, T] }] }],
  });
  const cs = fe.ok === false ? null : fe.cases[0];
  const feDelta = cs ? Math.abs(cs.nodeDisplacement("ACT")[1]) : null;
  const feSigma = cs ? Math.max(...cs.members.map((m) => m.worst.sigma)) : null;
  const ok = (a, x) => Number.isFinite(a) && Math.abs(a - x) <= FE_TOLERANCE * Math.abs(x);
  return { hand: { I, c, sigma, theta, delta }, fe: cs ? { sigma: feSigma, delta: feDelta, agrees: { sigma: ok(feSigma, sigma), delta: ok(feDelta, delta) } } : { error: fe.error } };
}

/** The design's actuator side plates for a joint, read from the M1 IR. */
export function sentinelMountPlates(joint) {
  const ir = buildSentinelM1IR();
  const plates = ir.nodes.filter((n) => new RegExp(`^mount-${joint}-l[ab]$`).test(n.id));
  if (!plates.length) return null;
  const g = plates[0].geometry; // box: length (x, along the arm), width (y, the thickness), height (z, the in-plane depth)
  const num = (q) => parseFloat(q);
  return { ids: plates.map((n) => n.id), perJoint: 2, lengthM: num(g.length), thicknessM: num(g.width), depthM: num(g.height), material: plates[0].material, choice: plates[0].props?.designChoice ?? null };
}

/** Check the design's actuator side plates for a joint at the gait peak (and the stall case). */
export function solveSentinelBracket(ir) {
  if (ir.armor) return { ok: false, error: "armor stays off Sentinel M1 (owner rule): not designed" };
  if (!ir.joint) return { ok: false, missing: ["joint"] };
  const plates = sentinelMountPlates(ir.joint);
  if (!plates) return { ok: false, error: `the M1 design has no actuator side plates at the ${ir.joint}` };
  const matId = ir.material || plates.material;
  const mat = getMaterial(matId) || getMaterial(String(matId).replace(/-b221$/, ""));
  if (!mat) return { ok: false, error: `no material data for ${matId}` };
  const sf = ir.safetyFactor ?? 2; // M1's stated rule (demos/sentinel-m1.js bracket.factorOfSafety): 2 on yield, a design rule
  const load = sentinelJointLoad(ir.joint);
  if (!load.ok) return load;
  const T = load.torqueNm, Tp = T / plates.perJoint, L = plates.lengthM, h = plates.depthM, E = mat.youngsModulusPa;
  const allowable = mat.yieldPa / sf;
  // the thickness steps up R10 from the design's only if it fails; never thinned on bending alone
  const sizes = [plates.thicknessM, ...r10Between(plates.thicknessM + 1e-9, 0.05)];
  const iterations = [];
  let pick = null;
  for (const t of sizes) {
    const r = endMomentPlate({ T: Tp, L, b: t, h, E });
    iterations.push({ thicknessM: t, sigmaPa: r.hand.sigma, utilization: r.hand.sigma / allowable, result: r.hand.sigma <= allowable ? "holds" : "over the allowable" });
    if (r.hand.sigma <= allowable) { pick = { t, r }; break; }
  }
  if (!pick) return { ok: true, changed: false, load, iterations, note: "no R10 thickness up to 50 mm holds: the mount needs a different shape" };
  const { I, c, sigma, delta } = pick.r.hand;
  const stall = endMomentPlate({ T: ACTUATOR.peakTorqueNm / plates.perJoint, L, b: pick.t, h, E });
  const LoverH = L / h;
  const steps = [
    `design torque T = the ${ir.joint}'s conservative gait peak = ${f(T, "N·m")} (range ${f(load.range.low, "N·m")}–${f(load.range.high, "N·m")}; the M1 design's mass ${f(load.receipt.m1.massKg, "kg")}); per plate T/2 = ${f(Tp, "N·m")}`,
    `plate (the design's, ${plates.choice || "side plate"}): L = ${f(L, "m")}, depth h = ${f(h, "m")}, thickness t = ${f(pick.t, "m")}`,
    `I = t h³ / 12 = ${f(pick.t, "m")} × (${f(h, "m")})³ / 12 = ${f(I, "m⁴")}`,
    `σ = M c / I = ${f(Tp, "N·m")} × ${f(c, "m")} / ${f(I, "m⁴")} = ${f(sigma / 1e6, "MPa")}; allowable F_y / SF = ${f(mat.yieldPa / 1e6, "MPa")} / ${sf} = ${f(allowable / 1e6, "MPa")} → utilization ${f(sigma / allowable, "", 3)}`,
    `δ_tip = M L² / (2 E I) = ${f(delta * 1e6, "µm")}`,
    `stall case (not the asked load case): the actuator's ${ACTUATOR.peakTorqueNm} N·m peak, ${ACTUATOR.peakTorqueNm / 2} N·m per plate, gives σ = ${f(stall.hand.sigma / 1e6, "MPa")}, utilization ${f(stall.hand.sigma / allowable, "", 3)}`,
  ];
  return {
    ok: true, changed: pick.t !== plates.thicknessM, thicknessM: pick.t, design: plates, utilization: sigma / allowable, load, iterations, steps,
    hand: { sigmaPa: sigma, deltaM: delta, allowablePa: allowable, safetyFactor: sf, safetyFactorSource: ir.safetyFactor != null ? "the user" : "M1's stated rule: 2 on yield, a design rule, not a code check" },
    fe: pick.r.fe, tolerance: FE_TOLERANCE,
    validity: { lengthOverDepth: LoverH, valid: LoverH >= 2, note: LoverH < 2 ? `L/h = ${f(LoverH, "", 3)} (< 2): a deep plate; beam theory is not a model of it, so these stresses are screening only (a plate FE is needed)` : null },
    stall: { torqueNm: ACTUATOR.peakTorqueNm, perPlateNm: ACTUATOR.peakTorqueNm / 2, source: ACTUATOR.source, sigmaPa: stall.hand.sigma, utilization: stall.hand.sigma / allowable },
    notChecked: ["bolt bearing and tear-out at the actuator and tube bolts", "plate buckling", "fatigue over the gait cycles", "the leg tube and its joint to the plate"],
    armor: "off (not part of Sentinel M1)",
  };
}
