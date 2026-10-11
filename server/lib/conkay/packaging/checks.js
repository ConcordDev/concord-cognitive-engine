// server/lib/conkay/packaging/checks.js
//
// Occupant fit and packaging checks for a vehicle layout (compiler/car-layout
// .js). Deterministic: occupants are ANSUR II percentile boxes (occupant.js),
// components are boxes from library dimensions, the cabin is the inner
// surface of the body shell (an ellipsoid). Every check reports its value,
// threshold, unit, pass/fail and the threshold's basis:
//   sourced    a published number (cited)
//   geometric  0 mm, non-interference; no published comfort or clearance margin applied
//   estimated  derived with a stated method
//   design     a design choice of this layout
// SAE J1100 dimensions are computed from this geometry following the J1100
// definitions (references.json), at screening fidelity.

import { obb, aabb, separation, ellipsoid, rayToEllipsoid, widthAt, topAt, boxClearanceToShell, bounds, corners } from "./geometry.js";
import { seatOccupant, occupantDims, hPointOffsets, PACKAGING_REFERENCES as REFS } from "./occupant.js";

const J = REFS.saeJ1100.definitions;
const mm = (m) => Math.round(m * 1000 * 10) / 10;
const SOURCE = {
  j1100: REFS.saeJ1100.source.url,
  ansur: "http://tools.openlab.psu.edu/publicData/ANSURII-TR15-007.pdf",
  umtri: REFS.umtriSeatPosition.source.url,
  airbag: REFS.airbagDistance.source.url,
  tkx: REFS.tkxClearance.source.url,
  h3: REFS.hybridIII50.source.url,
};
export const GEOMETRIC = { state: "geometric", basis: "0 mm: the envelopes must not overlap; no published comfort or clearance margin is applied" };

/** UMTRI fore-aft H-point (m aft of PRP) for stature S, wheel distance W and H-point height above the heel (r = 0). */
export function umtriHPointX(S, W, hz) {
  const k = REFS.umtriSeatPosition.coefficients;
  return (k.intercept + k.stature * S * 1000 + k.wheel * W * 1000 - k.height * hz * 1000) / 1000;
}

/**
 * Seat envelope (RECARO): cushion and back boxes for a seat whose H-point is h.
 * backThickness: the seatback's thickness behind the occupant's back surface (a design allowance; 0 = a plane).
 */
export function seatBoxes(id, seatDims, h, torsoDeg, floorZ, backThickness = 0) {
  // Rear of the seat: the seat back surface (hBack behind the H-point for the 50th male, Hybrid III scaled)
  // reclined at the torso angle, up to the seat's published max height (estimated method).
  const m50 = occupantDims("M50");
  const { hOff, hBack } = hPointOffsets(m50.sittingHeight);
  const th = (torsoDeg * Math.PI) / 180;
  const topZ = floorZ + seatDims.maxHeightM;
  const up = (topZ - h.z) / Math.cos(th);
  const t = Math.max(backThickness, 0);
  const rearX = h.x + hBack * Math.cos(th) + up * Math.sin(th) + t * Math.cos(th);
  const cushionTop = h.z - hOff;
  const backAtCushion = h.x + hBack * Math.cos(th) - (h.z - cushionTop) * Math.tan(th);
  // Cushion depth measured forward from the back surface at cushion height.
  const frontX = backAtCushion - seatDims.maxCushionDepthM;
  const w = seatDims.maxWidthM;
  const backLen = (topZ - cushionTop) / Math.cos(th);
  const n = [Math.cos(th), 0, -Math.sin(th)]; // rearward normal of the reclined back surface
  const bc = [backAtCushion + (backLen / 2) * Math.sin(th) + n[0] * t / 2, h.y, cushionTop + (backLen / 2) * Math.cos(th) + n[2] * t / 2];
  return {
    rearX, frontX,
    boxes: [
      aabb({ id: `${id}:cushion`, part: "seat", min: [frontX, h.y - w / 2, floorZ], max: [backAtCushion, h.y + w / 2, cushionTop] }),
      // The back: on the occupant's back surface, reclined at the torso angle, backThickness deep.
      obb({ id: `${id}:back`, part: "seat", center: bc, half: [t / 2, w / 2, backLen / 2], pitchDeg: torsoDeg }),
    ],
    method: `estimated: the seat's back = the occupant's back surface (the 50th male's H-point-to-back distance, Hybrid III scaled) reclined at the torso angle up to the published ${Math.round(seatDims.maxHeightM * 1000)} mm max height, ${Math.round(t * 1000)} mm thick behind it (${t > 0 ? "a design allowance: the backrest thickness is not published" : "a plane: the backrest thickness is not published, so the seat's rear extent is a lower bound"}); cushion front = the back surface at cushion height minus the published ${Math.round(seatDims.maxCushionDepthM * 1000)} mm max cushion depth; cushion top = the 50th male's sitting surface; width = ${Math.round(w * 1000)} mm (the published maximum); mounting hardware (not in the published dimensions) ignored`,
  };
}

function check(list, c) {
  const pass = c.comparator === ">=" ? c.value >= c.threshold - 1e-9 : c.comparator === "<=" ? c.value <= c.threshold + 1e-9 : c.comparator === "<" ? c.value < c.threshold : c.comparator === ">" ? c.value > c.threshold : c.comparator === "within" ? c.value >= c.threshold[0] && c.value <= c.threshold[1] : false;
  list.push({ ...c, pass });
  return pass;
}

/**
 * The package scene: seating geometry, component and tyre envelopes, and each
 * percentile's occupants (with front seat envelopes) in every seat. Shared by
 * the checks and the CAD body (cad/body-envelopes.js), so both see the same
 * boxes under the same ids.
 */
export function packageScene({ pkg, centers }) {
  const dc = Object.fromEntries(Object.entries(pkg.designChoices).map(([k, v]) => [k, v.value]));
  const keys = pkg.occupantKeys;
  const notes = [];
  const floorZ = dc.floorZ;
  const ahp = { x: dc.ahpX, z: floorZ };
  const fa = (dc.footAngleDeg * Math.PI) / 180;
  const bof = { x: ahp.x - (J.BOF.valueMm / 1000) * Math.cos(fa), z: ahp.z + (J.BOF.valueMm / 1000) * Math.sin(fa) };
  // PRP: on the pedal 200 mm from the heel rest surface (UMTRI); taken at the ball of foot on the pedal line.
  const prpX = bof.x;
  const sw = { x: prpX + dc.steeringWheelL6, z: ahp.z + dc.steeringWheelH17 };
  const hz = floorZ + dc.h30;
  const hx = (key) => prpX + umtriHPointX(occupantDims(key).stature, dc.steeringWheelL6, dc.h30);
  const trackMid = hx("M50");
  const track = { front: trackMid - dc.seatTrackTravel / 2, rear: trackMid + dc.seatTrackTravel / 2 };
  const sgRPFront = { x: Math.min(hx("M95"), track.rear), z: hz };
  notes.push("SgRP-front is the 95th percentile male's UMTRI-predicted H-point (clamped to the seat track); the rear SgRP is from the layout (derived or a design choice).");
  const sgRPRear = { x: dc.rearSgRPX, z: floorZ + dc.rearH31 };
  const swBox = obb({ id: "STEERING_WHEEL", part: "steering wheel", center: [sw.x, -dc.frontSeatY, sw.z], half: [dc.steeringWheelDepth / 2, dc.steeringWheelDiameter / 2, dc.steeringWheelDiameter / 2], pitchDeg: dc.steeringWheelTiltDeg });
  const seatDims = pkg.seatFront?.dims || null;
  const backT = dc.frontSeatBackThicknessM || 0;

  // Components (centres from the design graph, dims from the library).
  const compBoxes = [];
  for (const c of pkg.components) {
    const p = centers[c.node];
    if (!p) { notes.push(`${c.node}: no position, not placed`); continue; }
    compBoxes.push(obb({ id: c.id, part: "component", center: [p.x, p.y, p.z], half: c.half, pitchDeg: c.pitchDeg || 0, transmission: c.node === "TRANSMISSION" }));
  }
  const lock = pkg.steeringLock;
  const wheels = [];
  for (const t of pkg.tyres) {
    const p = centers[t.node];
    if (!p) continue;
    const r = t.diameterM / 2, hw = t.widthM / 2;
    wheels.push({ id: t.node, center: [p.x, p.y, p.z], radius: r, halfWidth: hw, steerDeg: t.steered && lock ? lock.innerDeg : 0 });
    if (t.steered && lock) {
      // Swept plan envelope over +/- the inner lock angle (conservative: the inner angle both ways).
      const th = (lock.innerDeg * Math.PI) / 180;
      let ext = 0, latExt = 0;
      for (let i = 0; i <= 90; i++) {
        const a = (th * i) / 90;
        ext = Math.max(ext, r * Math.cos(a) + hw * Math.sin(a));
        latExt = Math.max(latExt, r * Math.sin(a) + hw * Math.cos(a));
      }
      compBoxes.push(aabb({ id: `${t.node}:steer-sweep`, part: "tyre", min: [p.x - ext, p.y - latExt, p.z - r], max: [p.x + ext, p.y + latExt, p.z + r] }));
    } else {
      compBoxes.push(obb({ id: t.node, part: "tyre", center: [p.x, p.y, p.z], half: [r, hw, r] }));
    }
  }
  compBoxes.push(swBox);

  // Occupants: each scenario seats one percentile in all four seats.
  const scenarios = {};
  const front = [{ id: "SEAT_1", y: -dc.frontSeatY, driver: true }, { id: "SEAT_2", y: dc.frontSeatY, driver: false }];
  const rear = [{ id: "SEAT_3", y: -dc.rearSeatY }, { id: "SEAT_4", y: dc.rearSeatY }];
  for (const key of keys) {
    const occ = [];
    const hFront = Math.min(Math.max(hx(key), track.front), track.rear);
    for (const s of front) {
      const o = seatOccupant(key, { id: s.id, hPoint: { x: hFront, y: s.y, z: hz }, torsoDeg: dc.torsoDeg, posture: "front", heel: ahp, footAngleDeg: dc.footAngleDeg });
      if (seatDims) {
        const sb = seatBoxes(s.id, seatDims, { x: hFront, y: s.y, z: hz }, dc.torsoDeg, floorZ, backT);
        o.seatBoxes = sb.boxes.map((b) => ({ ...b, id: `${b.id}@${key}` })); o.seatMethod = sb.method; o.seatRearX = sb.rearX;
      }
      o.hFrontX = hFront;
      occ.push(o);
    }
    for (const s of rear) occ.push(seatOccupant(key, { id: s.id, hPoint: { x: sgRPRear.x, y: s.y, z: sgRPRear.z }, torsoDeg: dc.rearTorsoDeg, posture: "rear", floorZ }));
    for (const o of occ) {
      const d = occupantDims(key);
      const isFront = o.seat === "SEAT_1" || o.seat === "SEAT_2";
      o.entry = { yOut: Math.abs(o.landmarks.y) + d.shoulderBreadthBideltoid / 2, need: (d.sittingHeight - o.hOff) * Math.cos(((isFront ? dc.torsoDeg : dc.rearTorsoDeg) * Math.PI) / 180) };
    }
    scenarios[key] = occ;
  }
  return { dc, keys, notes, floorZ, ahp, bof, prpX, sw, hz, hx, track, sgRPFront, sgRPRear, swBox, seatDims, compBoxes, wheels, scenarios, front, rear, lock };
}

/** J1100 measurement rays (inside the cabin, toward the body surface), with ids the checks look up. */
export function packageRays(scene) {
  const { dc, sgRPFront, sgRPRear, scenarios } = scene;
  const a = (J.H61.angleDeg * Math.PI) / 180;
  const up8 = [Math.sin(a), 0, Math.cos(a)];
  const rays = [
    { id: "H61", origin: [sgRPFront.x, -dc.frontSeatY, sgRPFront.z], dir: up8 },
    { id: "H63", origin: [sgRPRear.x, -dc.rearSeatY, sgRPRear.z], dir: up8 },
  ];
  const widthRays = (id, x, z) => rays.push({ id: `${id}+`, origin: [x, 0, z], dir: [0, 1, 0] }, { id: `${id}-`, origin: [x, 0, z], dir: [0, -1, 0] });
  widthRays("W3", sgRPFront.x, sgRPFront.z + J.W3.aboveSgRPMm / 1000);
  for (const h of J.W4.aboveSgRPMm) widthRays(`W4@${h}`, sgRPRear.x, sgRPRear.z + h / 1000);
  for (const h of J.W5.bandMm) widthRays(`W5@${h}`, sgRPFront.x, sgRPFront.z + h / 1000);
  for (const [key, occ] of Object.entries(scenarios)) {
    for (const o of occ) {
      const s = Math.sign(o.landmarks.y) || 1;
      rays.push({ id: `entry:${o.seat}:${key}`, origin: [o.landmarks.hPoint[0], s * o.entry.yOut, o.landmarks.hPoint[1]], dir: [0, 0, 1] });
    }
  }
  return rays;
}

/**
 * Envelopes the body must enclose (with its skin offset): every occupant box of every percentile, the front seat
 * envelopes, and the components with dimensions (tyres excepted: they get wheel wells). Each { id, kind, center, half, axes, enclose }.
 */
export function packageEnvelopes(scene) {
  const out = [];
  const put = (b, kind) => out.push({ id: b.id, kind, center: b.center, half: b.half, axes: b.axes, enclose: true });
  for (const c of scene.compBoxes) if (c.part !== "tyre") put(c, c.part === "steering wheel" ? "steering wheel" : "component");
  for (const occ of Object.values(scene.scenarios)) {
    for (const o of occ) {
      for (const b of o.boxes) put(b, `occupant:${b.part}`);
      for (const b of o.seatBoxes || []) put(b, "seat");
    }
  }
  return out;
}

/**
 * Evaluate the package.
 * input = { pkg, centers: { node: {x,y,z} }, frontAxleX, rearAxleX, and either
 *   body: the CAD body (cad.body outputs: { clearances: {id: m}, rays: {id: m}, thickness, metrics, skinOffset }), or
 *   shell: { center, size, thickness } (the screening ellipsoid) }
 */
export function evaluatePackaging({ pkg, centers, shell, body, frontAxleX, rearAxleX }) {
  const scene = packageScene({ pkg, centers });
  const { dc, keys, notes, floorZ, ahp, bof, prpX, sw, hz, hx, track, sgRPFront, sgRPRear, swBox, seatDims, compBoxes, scenarios, lock } = scene;
  const checks = [];
  const warnings = [];
  const surfaceName = body ? "the CAD body's inner skin surface (outer surface minus the skin thickness)" : "the shell's inner surface";
  let innerClearance, rayIn, roofAbove, widthAtRays;
  if (body) {
    const t = body.thickness;
    innerClearance = (b) => { const c = body.clearances[b.id]; return { clearance: Number.isFinite(c) ? c - t : -Infinity }; };
    rayIn = (id) => { const d = body.rays[id]; return Number.isFinite(d) ? d - t : null; };
    roofAbove = (id) => rayIn(id);
    widthAtRays = (id) => { const a = rayIn(`${id}+`), b = rayIn(`${id}-`); return a == null || b == null ? null : a + b; };
  } else {
    const inner = ellipsoid({ center: [shell.center.x, shell.center.y, shell.center.z], semi: [shell.size[0] / 2 - shell.thickness, shell.size[1] / 2 - shell.thickness, shell.size[2] / 2 - shell.thickness] });
    innerClearance = (b) => boxClearanceToShell(inner, b);
    const rays = Object.fromEntries(packageRays(scene).map((r) => [r.id, r]));
    rayIn = (id) => { const r = rays[id]; return r ? rayToEllipsoid(inner, r.origin, r.dir) : null; };
    roofAbove = (id) => { const r = rays[id]; const top = topAt(inner, r.origin[0], r.origin[1]); return top == null ? 0 : top - r.origin[2]; };
    widthAtRays = (id) => { const r = rays[`${id}+`]; return widthAt(inner, r.origin[0], r.origin[2]); };
  }

  // ---- Vehicle dimensions used (and where they come from).
  const tyreY = pkg.tyres.map((t) => centers[t.node]?.y).filter(Number.isFinite);
  const frontTrack = Math.max(...pkg.tyres.filter((t) => t.steered).map((t) => centers[t.node].y)) - Math.min(...pkg.tyres.filter((t) => t.steered).map((t) => centers[t.node].y));
  const rearTrack = Math.max(...pkg.tyres.filter((t) => !t.steered).map((t) => centers[t.node].y)) - Math.min(...pkg.tyres.filter((t) => !t.steered).map((t) => centers[t.node].y));
  const tyreW = pkg.tyres[0]?.widthM ?? 0, tyreD = pkg.tyres[0]?.diameterM ?? 0;
  const bm = body?.metrics;
  const vehicle = {
    wheelbase: { m: rearAxleX - frontAxleX, source: "VEH props.vehicle frontAxleX / rearAxleX" },
    frontTrack: { m: frontTrack, source: "front tyre centres (design choice in the car build)" },
    rearTrack: { m: rearTrack, source: "rear tyre centres (design choice in the car build)" },
    overallLength: bm ? { m: bm.lengthM, source: "CAD body bounding box (kernel)" } : { m: shell.size[0], source: "BODY_SHELL ellipsoid length (designed geometry)" },
    overallWidth: bm ? { m: Math.max(bm.widthM, Math.max(...tyreY) - Math.min(...tyreY) + tyreW), source: "the wider of the CAD body and the track plus a tyre section width" } : { m: Math.max(shell.size[1], Math.max(...tyreY) - Math.min(...tyreY) + tyreW), source: "the wider of the BODY_SHELL width and the track plus a tyre section width" },
    overallHeight: bm ? { m: bm.heightM, source: "CAD body top (kernel bounding box)" } : { m: shell.center.z + shell.size[2] / 2, source: "BODY_SHELL top (centre z + height/2)" },
    bodyGroundClearance: bm ? { m: bm.groundClearanceM, source: "CAD body bottom (kernel bounding box)" } : { m: shell.center.z - shell.size[2] / 2, source: "BODY_SHELL bottom" },
    tyreDiameter: { m: tyreD, source: pkg.tyres[0]?.dims?.source || null },
  };

  // ---- SgRP-based J1100 dimensions.
  const j1100 = { front: {}, rear: {}, steering: {} };
  const h61 = (id) => { const t = rayIn(id); return t == null ? null : t + J.H61.addMm / 1000; };
  j1100.front.H30 = { mm: mm(dc.h30), def: J.H30.section };
  j1100.front.L53 = { mm: mm(sgRPFront.x - ahp.x), def: J.L53.section };
  j1100.front.L40 = { deg: dc.torsoDeg, def: J.L40.section };
  j1100.front.H61 = { mm: mm(h61("H61")), def: J.H61.section, note: `effective head room: SgRP to ${surfaceName} along 8 deg rear of vertical, plus 102 mm` };
  j1100.rear.H63 = { mm: mm(h61("H63")), def: J.H63.section };
  j1100.rear.H31 = { mm: mm(dc.rearH31), def: J.H31.section };
  j1100.rear.L50 = { mm: mm(sgRPRear.x - sgRPFront.x), def: J.L50.section };
  j1100.front.W3 = { mm: mm(widthAtRays("W3")), def: J.W3.section, note: `${surfaceName} width on the SgRP X plane at 254 mm above the SgRP (no belt line or door trim in the design)` };
  const w4 = Math.min(...J.W4.aboveSgRPMm.map((h) => widthAtRays(`W4@${h}`)));
  j1100.rear.W4 = { mm: mm(w4), def: J.W4.section, note: "minimum inner width between 254 and 406 mm above the rear SgRP" };
  const w5 = Math.min(...J.W5.bandMm.map((h) => widthAtRays(`W5@${h}`)));
  j1100.front.W5 = { mm: mm(w5), def: J.W5.section, note: "minimum inner width 25 mm below to 76 mm above the SgRP" };
  j1100.steering.H17 = { mm: mm(dc.steeringWheelH17), def: J.H17.section };
  j1100.steering.L11 = { mm: mm(sw.x - ahp.x), def: J.L11.section };
  j1100.steering.L6 = { mm: mm(dc.steeringWheelL6), def: "J4004 L6 / UMTRI W (PRP to wheel centre, fore-aft)" };
  j1100.steering.W9 = { mm: mm(dc.steeringWheelDiameter), def: "J1100 W9 steering wheel diameter" };
  j1100.front.L23 = { mm: mm(dc.seatTrackTravel), def: "seat track travel" };
  j1100.front.BOF = { x: bof.x, def: J.BOF.section };

  // Class A conformance (sourced ranges).
  const cA = J.classA;
  check(checks, { id: "classA.H30", group: "SAE J1100 Class A", value: mm(dc.h30), threshold: cA.H30Mm, unit: "mm", comparator: "within", thresholdBasis: { state: "sourced", source: SOURCE.j1100, section: cA.section } });
  check(checks, { id: "classA.L40", group: "SAE J1100 Class A", value: dc.torsoDeg, threshold: cA.L40Deg, unit: "deg", comparator: "within", thresholdBasis: { state: "sourced", source: SOURCE.j1100, section: cA.section } });
  check(checks, { id: "classA.W9", group: "SAE J1100 Class A", value: mm(dc.steeringWheelDiameter), threshold: cA.W9MaxMm, unit: "mm", comparator: "<", thresholdBasis: { state: "sourced", source: SOURCE.j1100, section: cA.section } });
  check(checks, { id: "classA.L23", group: "SAE J1100 Class A", value: mm(dc.seatTrackTravel), threshold: cA.L23MinMm, unit: "mm", comparator: ">", thresholdBasis: { state: "sourced", source: SOURCE.j1100, section: cA.section } });

  const sgSeatRearX = seatDims ? seatBoxes("SgRP", seatDims, { x: sgRPFront.x, y: 0, z: hz }, dc.torsoDeg, floorZ, dc.frontSeatBackThicknessM || 0).rearX : null;
  for (const key of keys) {
    const d = occupantDims(key);
    const occ = scenarios[key];
    const ideal = hx(key);
    // Seat track: the occupant's UMTRI H-point must be within the track.
    check(checks, { id: `seatTrack.${key}`, group: "legroom", occupant: key, seat: "front", value: mm(Math.min(ideal - track.front, track.rear - ideal)), threshold: 0, unit: "mm", comparator: ">=", note: `inside the seat track: the UMTRI-predicted H-point is ${mm(ideal - prpX)} mm aft of the PRP; the track runs ${mm(track.front - prpX)}-${mm(track.rear - prpX)} mm`, thresholdBasis: { state: "design", basis: pkg.designChoices.seatTrackTravel.basis, model: SOURCE.umtri } });

    for (const o of occ) {
      const isFront = o.seat === "SEAT_1" || o.seat === "SEAT_2";
      const head = o.boxes.find((b) => b.part === "head");
      const torso = o.boxes.find((b) => b.part === "torso");
      const hc = innerClearance(head);
      check(checks, { id: `headroom.${o.seat}.${key}`, group: "headroom", occupant: key, seat: o.seat, value: mm(hc.clearance), threshold: 0, unit: "mm", comparator: ">=", note: `head box (head length x head breadth, acromion level to head top, on the torso line) to ${surfaceName}`, thresholdBasis: GEOMETRIC });
      const tc = innerClearance(torso);
      check(checks, { id: `shoulder.${o.seat}.${key}`, group: "shoulder room", occupant: key, seat: o.seat, value: mm(tc.clearance), threshold: 0, unit: "mm", comparator: ">=", note: `shoulder box (bideltoid breadth x chest depth, 254 mm above the H-point to the acromion) to ${surfaceName}`, thresholdBasis: GEOMETRIC });
      const pc = innerClearance(o.boxes.find((b) => b.part === "pelvis"));
      check(checks, { id: `hipShell.${o.seat}.${key}`, group: "hip room", occupant: key, seat: o.seat, value: mm(pc.clearance), threshold: 0, unit: "mm", comparator: ">=", note: `hip box (hip breadth x chest depth, sitting surface to 254 mm above the H-point) to ${surfaceName} (floor included)`, thresholdBasis: GEOMETRIC });
      if (isFront && o.leg) {
        check(checks, { id: `legReach.${o.seat}.${key}`, group: "legroom", occupant: key, seat: o.seat, value: mm(o.leg.D), threshold: mm(o.leg.reach), unit: "mm", comparator: "<=", note: "hip (H-point) to ankle (malleolus height above the AHP) against thigh link + calf link", thresholdBasis: { state: "sourced", source: SOURCE.ansur, basis: "ANSUR II thigh link + calf link of this percentile" } });
      }
      if (!isFront && sgSeatRearX != null) {
        // J1100 L48: knee pivot to the back of the front seatback minus 51 mm, front seat at the SgRP.
        const l48 = o.landmarks.knee[0] - sgSeatRearX - J.L48.subtractMm / 1000;
        check(checks, { id: `rearKnee.${o.seat}.${key}`, group: "legroom", occupant: key, seat: o.seat, value: mm(l48), threshold: 0, unit: "mm", comparator: ">=", note: "SAE J1100 L48: knee pivot to the back of the front seatback (front seat at the SgRP-front, backrest allowance included), minus 51 mm", thresholdBasis: { state: "geometric", basis: "0 mm after the J1100 L48 51 mm knee allowance", source: SOURCE.j1100 } });
        j1100.rear[`L48_${key}`] = { mm: mm(l48), def: J.L48.section };
      }
      // Entry space (estimated): roof height at the occupant's outboard shoulder line on the H-point X plane,
      // above the H-point, against the seated head-top height above the H-point.
      const h11 = roofAbove(`entry:${o.seat}:${key}`) ?? 0;
      check(checks, { id: `entry.${o.seat}.${key}`, group: "entry", occupant: key, seat: o.seat, value: mm(h11), threshold: mm(o.entry.need), unit: "mm", comparator: ">=", note: `H11-style entrance height: ${surfaceName} at the occupant's outboard shoulder line, above the H-point (no door, pillar or sill in the design)`, thresholdBasis: { state: "estimated", method: "the occupant's seated head-top height above the H-point (sitting height minus the H-point height, at the torso angle): the header must pass over the head in the final seated posture. Real entry involves ducking, so this is conservative; the door aperture itself is not designed." } });
    }
    // Front: hips in the seat (cushion width), shoulder room (W3) and hip room (W5) for two occupants.
    if (seatDims) check(checks, { id: `seatWidth.${key}`, group: "hip room", occupant: key, seat: "front", value: mm(d.hipBreadthSitting), threshold: mm(seatDims.maxCushionWidthM), unit: "mm", comparator: "<=", note: "hip breadth, sitting against the seat's max cushion width", thresholdBasis: { state: "sourced", source: pkg.seatFront.source, basis: "RECARO published max seat cushion width" } });
    check(checks, { id: `W3.${key}`, group: "shoulder room", occupant: key, seat: "front", value: j1100.front.W3.mm, threshold: mm(2 * d.shoulderBreadthBideltoid), unit: "mm", comparator: ">=", note: "J1100 W3 against two occupants' bideltoid breadths side by side", thresholdBasis: { state: "estimated", method: "2 x ANSUR II bideltoid breadth (two occupants shoulder to shoulder, no gap)" } });
    check(checks, { id: `W4.${key}`, group: "shoulder room", occupant: key, seat: "rear", value: j1100.rear.W4.mm, threshold: mm(2 * d.shoulderBreadthBideltoid), unit: "mm", comparator: ">=", note: "J1100 W4 against two rear occupants' bideltoid breadths", thresholdBasis: { state: "estimated", method: "2 x ANSUR II bideltoid breadth" } });
    check(checks, { id: `W5.${key}`, group: "hip room", occupant: key, seat: "front", value: j1100.front.W5.mm, threshold: mm(2 * d.hipBreadthSitting), unit: "mm", comparator: ">=", note: "J1100 W5 against two occupants' hip breadths", thresholdBasis: { state: "estimated", method: "2 x ANSUR II hip breadth, sitting" } });

    // Steering and pedals (driver).
    const drv = occ.find((o) => o.seat === "SEAT_1");
    const torso = drv.boxes.find((b) => b.part === "torso");
    const st = separation(torso, swBox).separation;
    check(checks, { id: `steeringTorso.${key}`, group: "steering", occupant: key, seat: "SEAT_1", value: mm(st), threshold: 0, unit: "mm", comparator: ">=", note: "driver torso box to the steering wheel envelope (separating-axis gap, a lower bound on the distance)", thresholdBasis: GEOMETRIC });
    const thighs = drv.boxes.filter((b) => b.part === "thigh");
    const kn = Math.min(...thighs.map((b) => separation(b, swBox).separation));
    check(checks, { id: `steeringKnee.${key}`, group: "steering", occupant: key, seat: "SEAT_1", value: mm(kn), threshold: 0, unit: "mm", comparator: ">=", note: "SAE J1100 L62-style knee clearance: thigh box extended 51 mm past the knee pivot to the steering wheel envelope (dash and column not in the design)", thresholdBasis: { state: "geometric", basis: "0 mm after the J1100 L62 51 mm knee allowance", source: SOURCE.j1100 } });
    const bb = drv.landmarks.breastbone;
    const ab = Math.hypot(bb[0] - sw.x, bb[1] - sw.z);
    check(checks, { id: `airbag.${key}`, group: "steering", occupant: key, seat: "SEAT_1", value: mm(ab), threshold: REFS.airbagDistance.minMm, unit: "mm", comparator: ">=", note: "breastbone (estimated: suprasternale moved to the chest surface) to the steering wheel centre (air bag cover centre)", thresholdBasis: { state: "sourced", source: SOURCE.airbag, basis: REFS.airbagDistance.text } });
    // L7: rearmost edge of the wheel to the torso line, side view.
    const swRear = corners(swBox).reduce((a, c) => (c[0] > a[0] ? c : a));
    const th = (dc.torsoDeg * Math.PI) / 180;
    const H = drv.landmarks.hPoint;
    const l7 = (swRear[0] - H[0]) * -Math.cos(th) + (swRear[2] - H[1]) * Math.sin(th);
    j1100.steering[`L7_${key}`] = { mm: mm(l7), def: J.L7.section };
    if (pkg.firewallX != null) {
      const feet = drv.boxes.filter((b) => b.part === "foot");
      const toeX = Math.min(...feet.map((b) => bounds(b).min[0]));
      check(checks, { id: `pedalFoot.${key}`, group: "pedals", occupant: key, seat: "SEAT_1", value: mm(toeX - pkg.firewallX), threshold: 0, unit: "mm", comparator: ">=", note: `foot (heel on the AHP, foot length along the ${dc.footAngleDeg} deg heel-to-ball line) to the footwell front wall (engine envelope + firewall gap)`, thresholdBasis: GEOMETRIC });
    }
    j1100.front[`L34_${key}`] = { mm: mm(Math.hypot(drv.landmarks.ankle[0] - drv.landmarks.hPoint[0], drv.landmarks.ankle[1] - drv.landmarks.hPoint[1]) + J.L34.addMm / 1000), def: J.L34.section, note: "ankle (malleolus above the AHP) to this occupant's H-point, plus 254 mm" };
  }

  // ---- Interference: component-component, component-occupant, occupant-occupant (different seats).
  const tkxMin = REFS.tkxClearance.minMm / 1000;
  const minFor = (a, b) => (a.transmission || b.transmission ? { m: tkxMin, basis: { state: "sourced", source: SOURCE.tkx, basis: REFS.tkxClearance.text } } : { m: 0, basis: GEOMETRIC });
  const pairs = [];
  const seen = new Set();
  const test = (a, b, kind, scenario) => {
    const k = [a.id, b.id].sort().join("|");
    if (seen.has(k)) return;
    seen.add(k);
    const s = separation(a, b).separation;
    const min = minFor(a, b);
    pairs.push({ a: a.id, b: b.id, kind, scenario, separationMm: mm(s), minClearanceMm: Math.round(min.m * 1e5) / 100, pass: s >= min.m - 1e-9, thresholdBasis: min.basis });
  };
  for (let i = 0; i < compBoxes.length; i++) for (let j = i + 1; j < compBoxes.length; j++) test(compBoxes[i], compBoxes[j], "component-component");
  for (const key of keys) {
    const occ = scenarios[key];
    const seats = occ.flatMap((o) => (o.seatBoxes || []).map((b) => ({ ...b, seatOf: o.seat })));
    for (const sb of seats) for (const c of compBoxes) test(sb, c, "component-component", key);
    for (const o of occ) {
      for (const b of o.boxes) {
        for (const c of compBoxes) {
          if (c.id === "STEERING_WHEEL" && o.seat === "SEAT_1") continue; // the steering checks cover the driver
          test(b, c, "component-occupant", key);
        }
        for (const sb of seats) if (sb.seatOf !== o.seat) test(b, sb, "component-occupant", key);
        for (const o2 of occ) if (o2.seat !== o.seat) for (const b2 of o2.boxes) test(b, b2, "occupant-occupant", key);
      }
    }
  }
  const interferences = pairs.filter((p) => !p.pass);

  // ---- Shell protrusion.
  const protrusions = [];
  if (body) {
    for (const c of compBoxes) {
      const cl = body.clearances[c.id];
      if (Number.isFinite(cl) && cl < 0) protrusions.push({ id: c.id, byMm: mm(-cl) });
    }
    if (protrusions.length) warnings.push(`Outside the CAD body: ${protrusions.map((p) => `${p.id} by ${p.byMm} mm`).join(", ")} (the body solver, cad.body, fails these).`);
  } else {
    const outer = ellipsoid({ center: [shell.center.x, shell.center.y, shell.center.z], semi: [shell.size[0] / 2, shell.size[1] / 2, shell.size[2] / 2] });
    for (const c of compBoxes) {
      const cl = boxClearanceToShell(outer, c).clearance;
      if (cl < 0) protrusions.push({ id: c.id, byMm: mm(-cl) });
    }
    if (protrusions.length) warnings.push(`Outside the body shell (screening ellipsoid): ${protrusions.map((p) => `${p.id} by ${p.byMm} mm`).join(", ")}. The ellipsoid is not a designed body; these are not counted as interference.`);
  }

  const failed = checks.filter((c) => !c.pass);
  return {
    vehicle, seating: { floorZ, ahp, bof, prpX, steeringWheel: sw, sgRPFront, sgRPRear, seatTrack: track, firewallX: pkg.firewallX, steeringLock: lock },
    surface: body ? "cad-body" : "ellipsoid",
    j1100, checks, failed, pairs, interferences, protrusions, warnings, notes,
    occupants: Object.fromEntries(Object.entries(scenarios).map(([k, occ]) => [k, occ.map((o) => ({ seat: o.seat, hPoint: o.landmarks.hPoint.map((v) => Math.round(v * 1e4) / 1e4), headTop: o.landmarks.headTop.map((v) => Math.round(v * 1e4) / 1e4), knee: o.landmarks.knee.map((v) => Math.round(v * 1e4) / 1e4), leg: { reachable: o.leg.reachable, kneeAngleDeg: o.leg.kneeAngleDeg != null ? Math.round(o.leg.kneeAngleDeg * 10) / 10 : null } }))])),
  };
}
