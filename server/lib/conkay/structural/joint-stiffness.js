// server/lib/conkay/structural/joint-stiffness.js
//
// Joint and bond-line stiffness for a bonded aluminium frame (brief 4 item 3):
// the frame model's rigid joints replaced by rotational springs at every
// member end that meets another part, in two parts in series:
//
//   bond line  (computed) the adhesive layer of a bonded sleeve joint: the
//              member's end bonded over an overlap L_o into (or onto) the node,
//              adhesive shear modulus G_a, layer thickness t_a, adherends rigid
//              (their flexibility is the next term). A rotation theta slips the
//              layer by theta × (distance from the axis), shear stress
//              G_a × slip / t_a:
//                torsion          k = G_a L_o b h (b + h) / (2 t_a)
//                bending (depth h) k = (G_a L_o / t_a) (b h² / 2 + h³ / 6)
//              (the two faces across the bending axis in shear at ±h/2, the two
//              side faces with a linear slip; peel stiffness of the layer is not
//              credited, which lowers k).
//   local      (bounded, not computed) the walls of thin boxes distort where
//              they meet: the dominant joint flexibility of thin-walled vehicle
//              frames, which needs shell FE of each joint or a test. Bounded with
//              the EN 1993-1-8 sec. 5.2.2.5 stiffness classification: a joint is
//              rigid when S_j ≥ k_b E I_b / L_b, k_b = 8 (braced frames) or 25
//              (other frames); pinned when ≤ 0.5 E I_b / L_b. The tub is scored
//              with every joint AT the rigid boundary (k_b = 25, then the lower
//              8): what the tub keeps if its joints are only just "rigid" in the
//              Eurocode's sense. A steel-building classification applied to a
//              bonded aluminium tub, and extended to torsion (k × G J / L): an
//              engineering bound, not vehicle data; the low end of the range is
//              therefore an estimate, and the real joints need test or shell FE.
//
// Rivets (self-piercing, with the adhesive) are not credited with stiffness:
// the European Aluminium automotive manual states bonded joints "exhibit
// excellent stiffness" and are combined with rivets "to improve resistance to
// peel" (Aluminium Automotive Manual, Body structures, sec. 1.3.2, p. 10).
//
// Sheet bond lines (the floor, firewall and roof sheets bonded on a flange):
// the layer's shear compliance in series with the sheet's, for a flange of
// width w on the two edges the shear crosses: k_bond = G_a w a / (2 t_a).

import { sectionProps } from "./frame-fe.js";

export const JOINT_MODEL_VERSION = "1.1.0";

/** Sourced adhesive data (moduli from manufacturer data sheets; sha256 of the PDFs as fetched). */
export const ADHESIVES = Object.freeze({
  "henkel-teroson-ep-52xx": {
    name: "Henkel TEROSON EP 52XX (EP 5230 EU), heat-cured 1K epoxy body-shop structural adhesive",
    youngsModulusPa: 1.0e9, layerThicknessTestedM: 0.00015,
    source: { title: "Henkel, TDS TEROSON EP 52XX (September 2026)", url: "https://datasheets.tdx.henkel.com/TEROSON-EP-52XX-en_GL.pdf", retrieved: "2026-10-10", sha256: "31b93c188a347b2d634e99740900f5043e029434f1e9382a2e6e49177b303b1e", quote: "Cured (20 min. at 170 °C) Material data E-modulus 1 GPa Tensile strength 17 MPa Elongation at break 13%" },
  },
  "3m-irsa-07333": {
    name: "3M Impact Resistant Structural Adhesive 07333, 2K epoxy",
    youngsModulusPa: 2.1e9,
    source: { title: "3M, Impact Resistant Structural Adhesive 07333 technical data sheet", url: "https://multimedia.3m.com/mws/media/1809172O/3m-impact-resistant-structural-adhesive-irsa-07333.pdf", retrieved: "2026-10-10", sha256: "89124d0d490a6e46781facb8ec38c716ee0544f913a921e706181fa6367b1da9", quote: "Elastic Modulus (ASTM D638) 2.1 GPa" },
  },
});

export const EN1993_CLASSIFICATION = Object.freeze({
  rigidBraced: 8, rigidUnbraced: 25, pinned: 0.5,
  source: { title: "EN 1993-1-8:2005 sec. 5.2.2.5 (stiffness classification of joints), as stated by IDEA StatiCa's knowledge base", url: "https://www.ideastatica.com/support-center/joint-classification-en", retrieved: "2026-10-10", quote: "Rigid – Sj,ini Lb/(EIb) ≥ kb; Semirigid – 0.5 < Sj,ini Lb/(EIb) < kb; Pinned – Sj,ini Lb/(EIb) ≤ 0.5; kb = 8 for frames where the bracing system reduces the horizontal displacement by at least 80%; kb = 25 for other frames", kind: "secondary (the standard itself is not openly published)" },
});

export const RIVET_NOTE = Object.freeze({
  source: { title: "European Aluminium, Aluminium Automotive Manual: Applications – Car body – Body structures (2013), sec. 1.3.2, p. 10", url: "https://european-aluminium.eu/wp-content/uploads/2022/11/1_aam_body-structures.pdf", retrieved: "2026-10-10", sha256: "98fa86006b4203c72c29babbfeb31792ca1dd624f59b74cdae9ae07d5d3e8b3f", quote: "Normally adhesive bonds are applied in a linear form. Such joints exhibit excellent stiffness and fatigue characteristics, but should normally be used in conjunction with spot-welding, riveting or other mechanical fastening methods in order to improve resistance to peel in large deformation (i.e. during crash)." },
});

/** The joint design choices and estimates, each with its basis. */
export const JOINT_CHOICES = Object.freeze({
  overlap: { value: 0.05, state: "design choice", basis: "design choice: every member end bonded over a 50 mm sleeve / socket overlap into its node" },
  bondline: { value: [0.0002, 0.0005], state: "estimated", basis: "estimated: adhesive layer 0.2–0.5 mm (the TEROSON data sheet tests 0.15 mm; a production bond line is thicker and varies): the thin end is the stiff case" },
  adhesiveNu: { value: [0.35, 0.40], state: "estimated", basis: "estimated: Poisson ratio of a cured structural epoxy, 0.35–0.40 (neither data sheet states it); G_a = E / (2 (1 + nu))" },
  flange: { value: 0.025, state: "design choice", basis: "design choice: sheets bonded to the frame on 25 mm flanges" },
});

export const G_RANGE = (() => {
  const Es = Object.values(ADHESIVES).map((a) => a.youngsModulusPa);
  const [n0, n1] = JOINT_CHOICES.adhesiveNu.value;
  return { low: Math.min(...Es) / (2 * (1 + n1)), high: Math.max(...Es) / (2 * (1 + n0)) };
})();

/**
 * Bond-line springs [torsion, about local y, about local z] (N·m/rad) of a bonded sleeve.
 * `width` is the section width (local z; bending about local y uses it as the depth) and
 * `height` is the section height (local y; bending about local z), matching frame-fe's
 * section axes. Peel stiffness of the layer is not credited.
 */
export function bondSleeveSprings({ width: b, height: h }, { Ga, ta, overlap }) {
  if (!(b > 0 && h > 0 && Ga > 0 && ta > 0 && overlap > 0)) throw new Error("bond sleeve needs width, height, G_a, t_a and overlap > 0");
  const c = (Ga * overlap) / ta;
  return [
    c * (b * h * (b + h)) / 2,
    c * ((h * b * b) / 2 + (b ** 3) / 6), // bending about local y: depth b
    c * ((b * h * h) / 2 + (h ** 3) / 6), // bending about local z: depth h
  ];
}

/** Joint springs at the EN 1993-1-8 boundary: kappa × (G J / L, E Iy / L, E Iz / L). */
export function distortionSprings({ E, G, sec, L }, kappa) {
  return [kappa * (G * sec.J) / L, kappa * (E * sec.Iy) / L, kappa * (E * sec.Iz) / L];
}

export const series = (a, b) => a.map((x, i) => (Number.isFinite(b[i]) ? 1 / (1 / x + 1 / b[i]) : x));

/**
 * The member ends that are joints: an end whose node another member of a different part reaches
 * (a part continuing through a node is not a joint; a free or supported end is not either).
 * members: [{ id, i, j, part, panel? }]. Returns [{ member, end, node }].
 */
export function jointEnds(members) {
  const frame = members.filter((m) => !m.panel);
  const at = new Map();
  for (const m of frame) for (const n of [m.i, m.j]) { if (!at.has(n)) at.set(n, []); at.get(n).push(m); }
  const out = [];
  for (const m of frame) {
    for (const [end, n] of [["i", m.i], ["j", m.j]]) {
      const others = at.get(n).filter((o) => o !== m);
      if (others.some((o) => (o.part || o.id) !== (m.part || m.id))) out.push({ member: m.id, end, node: n });
    }
  }
  return out;
}

/**
 * End springs for one scenario { bond: { Ga, ta, overlap } | null, kappa: number | null }.
 * members: [{ id, i, j, part, section, E, G, checkLength?, L }]. Returns { springs: { [id]: { i?, j? } }, rows }.
 */
export function scenarioSprings(members, scenario) {
  const springs = {};
  const rows = [];
  for (const je of jointEnds(members)) {
    const m = members.find((x) => x.id === je.member);
    const sec = sectionProps(m.section);
    const L = m.checkLength > 0 ? m.checkLength : m.L;
    let k = [Infinity, Infinity, Infinity];
    if (scenario.bond) k = series(k, bondSleeveSprings({ width: m.section.width, height: m.section.height }, scenario.bond));
    if (scenario.kappa) k = series(k, distortionSprings({ E: m.E, G: m.G, sec, L }, scenario.kappa));
    if (!k.every(Number.isFinite)) continue;
    springs[m.id] = { ...(springs[m.id] || {}), [je.end]: k };
    rows.push({ member: m.id, end: je.end, node: je.node, k, relative: [k[0] * L / (m.G * sec.J), k[1] * L / (m.E * sec.Iy), k[2] * L / (m.E * sec.Iz)] });
  }
  return { springs, rows };
}

/** The bond line's share of a sheet's shear stiffness: k_panel in series with k_bond = G_a w a / (2 t_a). */
export function panelBondFactor({ G, t, a, b }, { Ga, ta, flange }) {
  const kPanel = (G * t * a) / b, kBond = (Ga * flange * a) / (2 * ta);
  return 1 / (1 + kPanel / kBond);
}

/**
 * Joint type for this tub. There are no welds: 6061-T6 in the library is the unwelded
 * temper (a weld's heat-affected zone is not covered), and the Elise construction this
 * tub follows is bonded extrusions. Self-piercing rivets are the peel fasteners the
 * European Aluminium manual requires beside the adhesive; they are not given a
 * stiffness (RIVET_NOTE).
 */
export const JOINT_TYPES = Object.freeze({
  "extrusion-sleeve": {
    type: "bonded+riveted",
    weld: false,
    state: "design choice",
    basis: "design choice: every extrusion end is a bonded sleeve (overlap in JOINT_CHOICES) plus self-piercing rivets for peel. Not welded.",
    sources: ["lotus-press-pack", "european-aluminium-body-structures", "en-1993-1-8-classification"],
  },
  "sheet-flange": {
    type: "bonded+riveted",
    weld: false,
    state: "design choice",
    basis: "design choice: floor, firewall and roof sheets bonded on a flange (JOINT_CHOICES.flange) plus self-piercing rivets for peel. Not welded. Rivet stiffness is not credited.",
    sources: ["european-aluminium-body-structures"],
  },
});

/** One row per joint end: extrusion ends from jointEnds, plus one row per sheet panel (its flange bond). */
export function jointSchedule(members, { panels = [] } = {}) {
  const frame = members.filter((m) => !m.panel);
  const rows = jointEnds(frame).map((je) => {
    const m = frame.find((x) => x.id === je.member);
    return {
      ...je,
      part: m?.part || null,
      jointClass: "extrusion-sleeve",
      ...JOINT_TYPES["extrusion-sleeve"],
    };
  });
  for (const p of panels) {
    rows.push({
      member: p.id, end: "flange", node: null, part: p.part || null,
      jointClass: "sheet-flange",
      ...JOINT_TYPES["sheet-flange"],
    });
  }
  return rows;
}

/** The joint scenarios that bound the tub's stiffness (rigid → bond only → bond + EN 1993-1-8 boundary). */
export function tubJointScenarios() {
  const ov = JOINT_CHOICES.overlap.value, [t0, t1] = JOINT_CHOICES.bondline.value, fl = JOINT_CHOICES.flange.value;
  const stiff = { Ga: G_RANGE.high, ta: t0, overlap: ov, flange: fl }, soft = { Ga: G_RANGE.low, ta: t1, overlap: ov, flange: fl };
  return [
    { id: "bond-stiff", label: "bond line, stiff end (E 2.1 GPa, nu 0.35, 0.2 mm)", bond: stiff, kappa: null, state: "computed" },
    { id: "bond-soft", label: "bond line, soft end (E 1.0 GPa, nu 0.40, 0.5 mm)", bond: soft, kappa: null, state: "computed" },
    { id: "bond-soft+en25", label: "soft bond line + every joint at the EN 1993-1-8 rigid boundary k_b = 25", bond: soft, kappa: EN1993_CLASSIFICATION.rigidUnbraced, state: "estimated" },
    { id: "bond-soft+en8", label: "soft bond line + every joint at the EN 1993-1-8 rigid boundary k_b = 8 (the low bound)", bond: soft, kappa: EN1993_CLASSIFICATION.rigidBraced, state: "estimated" },
  ];
}
