// server/lib/conkay/packaging/occupant.js
//
// A seated occupant built from ANSUR II percentile dimensions (anthropometry
// .json) as deterministic boxes in side view. Coordinates: x rearward, y to
// the right, z up, metres.
//
// - Torso: the J1100 torso line runs through the H-point, reclined rearward
//   by the torso angle (L40). Head top, eye, acromion (shoulder) and
//   suprasternale lie along it at their seated heights above the sitting
//   surface, measured from the H-point: the H-point sits hOff above the
//   sitting surface and hBack ahead of the seat back, both from the Hybrid
//   III 50th male (3.4 in and 5.4 in at a 34.8 in sitting height) scaled by
//   the occupant's sitting height (estimated: the ratio is assumed to hold
//   across sizes).
// - Legs: the hip joint is taken at the H-point. Thigh link and calf link
//   (ANSUR derived dimensions) make a two-link leg; the ankle is the lateral
//   malleolus height above the heel. Front seats: the heel is on the
//   accelerator heel point and the knee is solved (knee up). Rear seats: the
//   shin is vertical (posture assumption) with the heel on the floor. The
//   knee surface is taken 51 mm ahead of the knee pivot, the allowance SAE
//   J1100 L48/L62 subtract.
// - Torso: split at 254 mm above the H-point (the lower edge of the J1100
//   W3 shoulder-room band): bideltoid breadth above, hip breadth below.
// - Breastbone: the suprasternale point moved forward to the chest surface
//   (chest depth minus hBack ahead of the torso line; estimated).
//
// No clothing, shoe or helmet allowance: ANSUR is measured barefoot in
// minimal clothing.

import { readFileSync } from "node:fs";
import { segmentBox, obb } from "./geometry.js";

const DATA = JSON.parse(readFileSync(new URL("./anthropometry.json", import.meta.url), "utf8"));
const REFS = JSON.parse(readFileSync(new URL("./references.json", import.meta.url), "utf8"));
export const ANTHROPOMETRY = DATA.anthropometry;
export const PACKAGING_REFERENCES = REFS;

export const PERCENTILES = ["F5", "F50", "F95", "M5", "M50", "M95"];

/** All dimensions for one percentile key (F5, M95, ...) in metres. */
export function occupantDims(key) {
  const dims = ANTHROPOMETRY.dimensions;
  const out = { key };
  for (const [name, d] of Object.entries(dims)) {
    if (!Number.isFinite(d.mm?.[key])) throw new Error(`no ${name} for ${key}`);
    out[name] = d.mm[key] / 1000;
  }
  return out;
}

const h3 = REFS.hybridIII50.inches;
/** H-point offsets scaled by sitting height (estimated, from the Hybrid III 50th male). */
export function hPointOffsets(sittingHeight) {
  return {
    hOff: (h3.hPointHeight / h3.totalSittingHeight) * sittingHeight,
    hBack: (h3.hPointFromSeatBack / h3.totalSittingHeight) * sittingHeight,
  };
}

export const KNEE_SURFACE_ALLOWANCE_M = REFS.saeJ1100.definitions.L48.subtractMm / 1000;
export const W3_BAND_LOW_M = REFS.saeJ1100.definitions.W3.aboveSgRPMm / 1000;

/** Two-link leg in side view: hip [x,z], ankle [x,z]. Knee above the hip-ankle line. */
export function solveLeg(hip, ankle, thigh, calf) {
  const dx = ankle[0] - hip[0], dz = ankle[1] - hip[1];
  const D = Math.hypot(dx, dz);
  const reach = thigh + calf;
  if (D >= reach) {
    const k = thigh / D;
    return { reachable: false, D, reach, knee: [hip[0] + dx * k, hip[1] + dz * k], kneeAngleDeg: 180 };
  }
  const a = Math.acos((thigh * thigh + D * D - calf * calf) / (2 * thigh * D));
  const base = Math.atan2(dz, dx);
  // Rotate toward up: in x-z with x rearward and the ankle ahead (dx < 0), "up" is
  // the rotation that increases z.
  const c1 = [hip[0] + thigh * Math.cos(base + a), hip[1] + thigh * Math.sin(base + a)];
  const c2 = [hip[0] + thigh * Math.cos(base - a), hip[1] + thigh * Math.sin(base - a)];
  const knee = c1[1] >= c2[1] ? c1 : c2;
  const kneeAngleDeg = (Math.acos((thigh * thigh + calf * calf - D * D) / (2 * thigh * calf)) * 180) / Math.PI;
  return { reachable: true, D, reach, knee, kneeAngleDeg };
}

/**
 * Seat an occupant. seat = { id, hPoint: {x,y,z}, torsoDeg, posture: "front" | "rear",
 * heel: {x,z} (front), floorZ (rear) }. Returns landmarks, boxes and the leg solution.
 */
export function seatOccupant(key, seat) {
  const d = occupantDims(key);
  const { hOff, hBack } = hPointOffsets(d.sittingHeight);
  const th = (seat.torsoDeg * Math.PI) / 180;
  const u = [Math.sin(th), Math.cos(th)]; // up the torso line (rearward-up)
  const f = [-Math.cos(th), Math.sin(th)]; // forward, perpendicular to the torso line
  const H = [seat.hPoint.x, seat.hPoint.z];
  const y = seat.hPoint.y;
  const along = (s, fwd = 0) => [H[0] + u[0] * s + f[0] * fwd, H[1] + u[1] * s + f[1] * fwd];
  const headTop = along(d.sittingHeight - hOff);
  const eye = along(d.eyeHeightSitting - hOff);
  const shoulder = along(d.acromialHeightSitting - hOff);
  const breastbone = along(d.suprasternaleHeightSitting - hOff, d.chestDepth - hBack);
  const pre = `${seat.id}:${key}`;
  const boxes = [];
  // Head: from the acromion level to the head top, head length deep centred on the torso line, head breadth wide.
  const headLen = d.sittingHeight - d.acromialHeightSitting;
  boxes.push(obb({ id: `${pre}:head`, part: "head", center: [...along(d.sittingHeight - hOff - headLen / 2)].flatMap((v, i) => (i === 0 ? [v, y] : [v])), half: [d.headLength / 2, d.headBreadth / 2, headLen / 2], pitchDeg: seat.torsoDeg }));
  // Torso, split at 254 mm above the H-point along the torso line (the lower edge of the SAE J1100 W3
  // shoulder-room band): above, the shoulders (bideltoid breadth); below, the hips (hip breadth, sitting).
  // Depth: from the seat back surface (hBack behind the line) forward by the chest depth.
  const split = W3_BAND_LOW_M;
  const tFwdMid = d.chestDepth / 2 - hBack;
  const sLen = d.acromialHeightSitting - hOff - split;
  const sc = along(split + sLen / 2, tFwdMid);
  boxes.push(obb({ id: `${pre}:torso`, part: "torso", center: [sc[0], y, sc[1]], half: [d.chestDepth / 2, d.shoulderBreadthBideltoid / 2, sLen / 2], pitchDeg: seat.torsoDeg }));
  const pLen = split + hOff;
  const pc = along(-hOff + pLen / 2, tFwdMid);
  boxes.push(obb({ id: `${pre}:pelvis`, part: "pelvis", center: [pc[0], y, pc[1]], half: [d.chestDepth / 2, d.hipBreadthSitting / 2, pLen / 2], pitchDeg: seat.torsoDeg }));
  // Legs.
  let ankle, heel, leg;
  if (seat.posture === "front") {
    heel = [seat.heel.x, seat.heel.z];
    ankle = [heel[0], heel[1] + d.lateralMalleolusHeight];
    leg = solveLeg(H, ankle, d.thighLink, d.calfLink);
  } else {
    const kneeZ = seat.floorZ + d.lateralMalleolusHeight + d.calfLink;
    const dz = kneeZ - H[1];
    if (Math.abs(dz) >= d.thighLink) leg = { reachable: false, knee: [H[0], H[1] + Math.sign(dz) * d.thighLink], note: "the vertical-shin posture cannot place the knee" };
    else {
      const knee = [H[0] - Math.sqrt(d.thighLink ** 2 - dz ** 2), kneeZ];
      leg = { reachable: true, knee, kneeAngleDeg: (Math.acos(dz / d.thighLink) * 180) / Math.PI };
    }
    ankle = [leg.knee[0], seat.floorZ + d.lateralMalleolusHeight];
    heel = [leg.knee[0], seat.floorZ];
  }
  const knee = leg.knee;
  const thighDir = [knee[0] - H[0], knee[1] - H[1]];
  const tl = Math.hypot(...thighDir);
  const kneeFront = [knee[0] + (thighDir[0] / tl) * KNEE_SURFACE_ALLOWANCE_M, knee[1] + (thighDir[1] / tl) * KNEE_SURFACE_ALLOWANCE_M];
  const legW = d.hipBreadthSitting / 2;
  for (const side of [-1, 1]) {
    const ly = y + side * (d.hipBreadthSitting / 4);
    // Thigh: hip to knee surface; below the line by hOff (sitting surface), above by thigh clearance - hOff.
    boxes.push(segmentBox({ id: `${pre}:thigh${side < 0 ? "L" : "R"}`, part: "thigh", from: H, to: knee, below: hOff, above: d.thighClearance - hOff, width: legW, y: ly, extendEnd: KNEE_SURFACE_ALLOWANCE_M }));
    if (seat.posture === "front") {
      // Foot: heel to toe along the line from the heel to the ball-of-foot on the pedal plane, foot breadth wide, ankle high.
      const fa = ((seat.footAngleDeg ?? 0) * Math.PI) / 180;
      const toe = [heel[0] - d.footLength * Math.cos(fa), heel[1] + d.footLength * Math.sin(fa)];
      boxes.push(segmentBox({ id: `${pre}:foot${side < 0 ? "L" : "R"}`, part: "foot", from: heel, to: toe, below: 0, above: d.lateralMalleolusHeight, width: d.footBreadthHorizontal, y: ly }));
    }
  }
  return {
    key, seat: seat.id, dims: d, hOff, hBack,
    landmarks: { hPoint: H, headTop, eye, shoulder, breastbone, knee, kneeFront, ankle, heel, y },
    leg, boxes,
  };
}
