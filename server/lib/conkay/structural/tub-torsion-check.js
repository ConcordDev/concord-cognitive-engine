// server/lib/conkay/structural/tub-torsion-check.js
//
// Cross-checks of the tub's torsional stiffness that do not treat the
// equivalent-diagonal shear panels (structural/shear-panel.js) as the answer.
//
//   Bredt-Batho single cell: J = 4 Am² / ∮(ds/t), twist T L / (G J).
//   Megson, Aircraft Structures for Engineering Students, ch. 18 (the same
//   relation sectionProps already uses for a rect tube). A rectangular tube
//   made of four shear panels reproduces G J / L when a stiff diaphragm at
//   the loaded end keeps the circulatory shear flow. Without that bulkhead
//   the torque is a couple of two web shears and the twist is 2× Bredt.
//   A diaphragm only between already-fixed root nodes does not.
//
//   Saint-Venant path of the tub's own closed extrusions: the cells that
//   actually exist (rails, sills, kicks, tunnel, quarter boxes, roof rails).
//   The floor sheet does not close a further cell — the bay between a sill and
//   the tunnel is open above the floor — and the door apertures are open, so
//   there is no full-height closed cabin cell to integrate. Free warping, no
//   ring bending, no shear panels:
//     K = 1 / ∫ dx / Σ (G J cos²α)
//   over the axle span. A prismatic tube along x reproduces G J / L.
//   cosα = |dx| / L of the member (a tube at an angle to the car axis).
//
//   Section-cut shares: at a plane x = const between the axles, every member
//   and panel diagonal that crosses the plane contributes its internal force
//   and moment (frame-fe local resultants, rotated into global axes). The
//   torque about the car axis is Mx + (y − y0) Fz − (z − z0) Fy. The shares
//   are that model's load path, panels included; they are not the cross-check.
//
// None of this is a physical test of the car.

import { sectionProps, memberAxes } from "./frame-fe.js";

const perDegree = (kRad) => (kRad * Math.PI) / 180;

/** Bredt-Batho torsion constant. Am is the enclosed midline area (m²); walls are { length, t } along the midline. */
export function bredtJ({ Am, walls }) {
  if (!(Am > 0) || !walls?.length) throw new Error("Bredt cell needs Am > 0 and at least one wall");
  let oint = 0;
  for (const w of walls) {
    if (!(w.length > 0 && w.t > 0)) throw new Error("each wall needs length and thickness > 0");
    oint += w.length / w.t;
  }
  return { J: (4 * Am * Am) / oint, oint, Am };
}

/** Rectangular single cell, uniform wall, midline b × h. Same J as sectionProps' rect-tube when b and h are the mid-line sizes. */
export function rectangularCellJ(b, h, t) {
  return bredtJ({ Am: b * h, walls: [{ length: 2 * (b + h), t }] }).J;
}

/**
 * Saint-Venant torsional stiffness (N·m/rad) of closed members between x0 and x1.
 * members: [{ i, j, section, G }] with node coordinates on `nodes` ({ id, x, y, z }).
 * A station with no closed member crossing it is a gap: stiffness is not finite.
 */
export function saintVenantStiffness({ nodes, members, x0, x1, samples = 400 }) {
  if (!(x1 > x0)) throw new Error("saint-venant path needs x1 > x0");
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const tubes = [];
  for (const m of members) {
    if (m.panel || String(m.id).includes("/d")) continue;
    const sec = m.sec || sectionProps(m.section);
    // open sections (a cut cell, a plate, an I-beam) are not a Bredt cell
    if (sec.kind !== "rect-tube" && sec.kind !== "round-tube") continue;
    if (!(sec.J > 0) || !(m.G > 0)) continue;
    const a = byId.get(String(m.i)), b = byId.get(String(m.j));
    if (!a || !b) throw new Error(`saint-venant: member ${m.id} has an unknown node`);
    const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z ?? 0) - (a.z ?? 0);
    const L = Math.hypot(dx, dy, dz);
    if (!(L > 0)) continue;
    const cos = dx / L;
    tubes.push({ id: m.id, x0: a.x, x1: b.x, gj: m.G * sec.J * cos * cos });
  }
  const dx = (x1 - x0) / samples;
  let compliance = 0;
  let gapAt = null;
  for (let i = 0; i < samples; i++) {
    const x = x0 + (i + 0.5) * dx;
    let sum = 0;
    for (const t of tubes) {
      const lo = Math.min(t.x0, t.x1), hi = Math.max(t.x0, t.x1);
      if (lo < x && x <= hi) sum += t.gj;
    }
    if (!(sum > 0)) { gapAt = x; break; }
    compliance += dx / sum;
  }
  if (gapAt != null) {
    return { finite: false, gapAt, note: "a station between the axles has no closed member crossing it: Saint-Venant torsion of the extrusions does not connect the axles" };
  }
  const kRad = 1 / compliance;
  return {
    finite: true,
    value: kRad,
    perDegree: perDegree(kRad),
    note: "Bredt torsion of the closed extrusions only, free warping, integrated between the axles: K = 1 / ∫ dx / Σ(G J cos²α). No shear panels, no ring bending. An angled member contributes J cos²α.",
  };
}

const toGlobal = (R, v) => [0, 1, 2].map((c) => R[0][c] * v[0] + R[1][c] * v[1] + R[2][c] * v[2]);

/** Resultants at arc position s, interpolated. N, T and the shears are constant between stations when there is no distributed load; the moments are linear. */
function atStation(along, s) {
  if (!along.length) return null;
  if (s <= along[0].at) return along[0];
  const last = along[along.length - 1];
  if (s >= last.at) return last;
  let hi = 1;
  while (hi < along.length && along[hi].at < s) hi++;
  const a = along[hi - 1], b = along[hi];
  const u = b.at === a.at ? 0 : (s - a.at) / (b.at - a.at);
  const lerp = (k) => a[k] + (b[k] - a[k]) * u;
  return { N: lerp("N"), Vy: lerp("Vy"), Vz: lerp("Vz"), T: lerp("T"), My: lerp("My"), Mz: lerp("Mz") };
}

/** Group a tub member for the load-path table. */
export function torsionGroup(id, panel, shape) {
  if (panel || String(id).includes("/d")) return "shear-panel";
  if (shape === "u-channel" || shape === "rect" || shape === "i-beam" || shape === "bar") return "open-section";
  if (/^(rail|sill|kick|qtr|tunnel|roof-rail)/.test(id)) return "closed-tube";
  return "ring-crossmember";
}

/**
 * Torque about the car x-axis carried across the plane x = xCut, from the FE
 * internal forces of one solved case. members: [{ id, i, j, panel? }] matching
 * the case's member results. Returns the rows and their sum.
 *
 * Convention, checked on a prismatic tube and on a two-rail couple: the sum
 * equals the moment about the car axis of the external forces on the high-x
 * side of the cut. Vy and Vz in the frame resultants are the opposite face
 * from T, My and Mz (frame-fe.js recovers N and T with a minus on the element
 * end force, and the shears without one), so the shears are negated here.
 */
export function sectionCutTorque({ nodes, members, memberResults, xCut, up = [0, 0, 1], axis = { y: 0, z: 0 } }) {
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const resBy = new Map(memberResults.map((m) => [m.id, m]));
  const rows = [];
  for (const m of members) {
    const a = byId.get(String(m.i)), b = byId.get(String(m.j));
    if (!a || !b) continue;
    if (!((a.x - xCut) * (b.x - xCut) < 0)) continue;
    const mr = resBy.get(m.id);
    if (!mr?.along?.length) continue;
    const t = (xCut - a.x) / (b.x - a.x);
    const y = a.y + (b.y - a.y) * t;
    const z = (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t;
    const f = atStation(mr.along, t * mr.length);
    if (!f) continue;
    const R = memberAxes(a, b, up);
    const Fg = toGlobal(R, [f.N, -f.Vy, -f.Vz]);
    const Mg = toGlobal(R, [f.T, f.My, f.Mz]);
    const Mt = toGlobal(R, [f.T, 0, 0]);
    // Resultants are the i-side acting on the j-side. The cut sum matches the
    // high-x external moment when i is the low-x end. A member drawn the other
    // way is flipped onto that same face.
    const sense = Math.sign(b.x - a.x) || 1;
    const torque = sense * (Mg[0] + (y - axis.y) * Fg[2] - (z - axis.z) * Fg[1]);
    const saintVenant = sense * Mt[0];
    rows.push({
      id: m.id,
      group: torsionGroup(m.id, m.panel, m.section?.shape || m.section?.kind),
      torqueNm: torque,
      saintVenantNm: saintVenant,
    });
  }
  const total = rows.reduce((s, r) => s + r.torqueNm, 0);
  const groups = {};
  for (const r of rows) {
    if (!groups[r.group]) groups[r.group] = { torqueNm: 0, saintVenantNm: 0, members: 0 };
    groups[r.group].torqueNm += r.torqueNm;
    groups[r.group].saintVenantNm += r.saintVenantNm;
    groups[r.group].members += 1;
  }
  for (const g of Object.values(groups)) g.share = total ? g.torqueNm / total : null;
  return { xCut, totalNm: total, groups, rows };
}

/**
 * What the three numbers say about the panel model. Fractions are computed;
 * the sentences only restate them. `withPanels` and `withoutPanels` are the
 * rigid-joint FE stiffnesses (N·m/deg); `saintVenant` is the extrusion-only
 * Bredt path (N·m/deg).
 */
export function crossCheckReading({ withPanels, withoutPanels, saintVenant }) {
  const panelFraction = (withPanels - withoutPanels) / withPanels;
  const frameOverSv = saintVenant > 0 ? withoutPanels / saintVenant : null;
  let reading;
  if (!(panelFraction >= 0) || frameOverSv == null) {
    reading = "not compared: a stiffness was missing or the panel-free model was stiffer than the model with panels";
  } else if (panelFraction < 0.25) {
    reading = "not an artifact of the equivalent-diagonal panels: removing them leaves most of the rigid-joint stiffness, so the number is the frame (closed-tube torsion and ring bending)";
  } else if (panelFraction > 0.5 && frameOverSv < 1.5) {
    reading = "mostly the equivalent-diagonal panels: the Bredt torsion of the closed extrusions, plus the ring bending that remains with the panels removed, does not reach this stiffness";
  } else {
    reading = "mixed: the shear panels and the frame (tube torsion plus ring bending) each carry a substantial share. The panel share is the equivalent-diagonal model, valid while the sheets are unbuckled; it is not a shell-element result";
  }
  return { panelFraction, frameOverSaintVenant: frameOverSv, reading };
}

/**
 * Published Lotus Elise figures used as the comparison, not as this car's
 * result. Two manufacturer documents disagree on the stiffness (10,800 and
 * 9,800) and agree on 68 kg and 876 kg. They are not averaged.
 */
export const ELISE_REFERENCE = Object.freeze({
  tubMassKg: 68,
  vehicleMassKg: 876,
  stiffnessPerDegree: Object.freeze([
    {
      value: 10800,
      source: {
        title: "Lotus Cars, 2011 Lotus Elise press pack (PDF)",
        url: "https://billswebspace.com/2011LotusElisePressPack.pdf",
        retrieved: "2026-10-10",
        sha256: "e0d4c909251aa8fd4e9787f5512fd83c22a2f16ce4e51216e16169f1ae584875",
        quote: "Weight: 876 kg. Lightweight (68 kg) and strong. Aluminium tub and door beams create safety cell. Stiff (10,800 Nm / degree).",
        kind: "manufacturer (hosted by a third party)",
      },
    },
    {
      value: 9800,
      source: {
        title: "Lotus Elise 2011 brochure (hazelnet.org copy)",
        url: "http://hazelnet.org/brochures/2011_Lotus_Elise4.pdf",
        retrieved: "2026-10-10",
        sha256: "5e95d508e4aa9af68cb1804ce667b50e6e516f1f6fe56c734371c7f4590c9192",
        quote: "The chassis weighs 68 kg (150 lbs) and has a stiffness of 9,800 Nm per degree. The entry level Lotus Elise weighs 876 kg.",
        kind: "manufacturer brochure (third-party host); conflicts with the press pack's 10,800",
      },
    },
  ]),
  note: "68 kg is the aluminium tub and door beams, not a bare tub. 876 kg is the published vehicle weight; the press pack says \"Weight\" and the brochure says the car \"weighs\" 876 kg. Whether that includes fluids or a driver is not stated in those lines. The two stiffness figures are both manufacturer copy and disagree; the screening target stays 10,800.",
});

/** N·m/deg per kg. massKg must be the mass the caller means; this function does not choose one. */
export function specificStiffness(perDegreeK, massKg) {
  if (!(perDegreeK > 0) || !(massKg > 0)) throw new Error("specific stiffness needs stiffness and mass > 0");
  return perDegreeK / massKg;
}

export function eliseSpecific() {
  return ELISE_REFERENCE.stiffnessPerDegree.map((s) => ({
    stiffnessPerDegree: s.value,
    perKgTub: specificStiffness(s.value, ELISE_REFERENCE.tubMassKg),
    perKgVehicle: specificStiffness(s.value, ELISE_REFERENCE.vehicleMassKg),
    source: s.source,
  }));
}
