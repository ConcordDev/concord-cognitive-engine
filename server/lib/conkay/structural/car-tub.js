// server/lib/conkay/structural/car-tub.js
//
// The car's structural tub: a labelled DESIGN CHANGE that replaces the
// ladder-frame screen (two open I-section rails at a screen spacing, and a
// notional 6 m² CFRP "TUB" shell that carried mass but no stiffness) with a
// closed-section structure laid out inside the existing package:
//
//   front rails      closed boxes from the nose to the firewall, inboard of the
//                    front tyres' steering sweep and outboard of the engine;
//   firewall         a ring frame (lower cross box, posts, scuttle box, centre
//                    post) with a 2 mm sheet working in shear;
//   sills            closed boxes outboard of the front seats, below the door
//                    opening, from the firewall to ahead of the rear wheels,
//                    then kicked inboard to meet the rear quarter boxes;
//   tunnel           two closed cells: one around the gearbox (front), one
//                    narrow cell for the driveshaft behind the gearbox; the
//                    gearbox tail sits between the seat cushions, so the cells
//                    cannot be one continuous box (a measured packaging limit);
//   cross members    under the front seats' front edge (seat cross) and behind
//                    the front seats under the rear thighs (heel cross);
//   rear structure   quarter boxes carrying the rear pickups, a rear bulkhead
//                    ahead of the differential, a rear end cross behind it;
//   floor            2 mm sheets in shear between sill, tunnel and crosses.
//
// Material: bonded aluminium extrusions and sheet (aluminum-6061-t6 from the
// library), the construction of the Lotus Elise tub (Lotus 2011 Elise press
// pack: "World's first bonded and extruded Aluminium chassis ... Lightweight
// (68 kg) ... Stiff (10,800 Nm / degree)"). The main solve keeps rigid joints
// (an upper bound). Bond-line springs are computed from sourced adhesive
// moduli; joint-wall distortion is only bounded (EN 1993-1-8, an estimate).
// The stiffness is reported as that range. The hard margin uses the lowest
// computed bond-line value, not the estimate.
//
// Every position and section here is a design choice; the clearance to the
// packaging envelopes (occupants of every checked percentile, seats, engine,
// gearbox, differential, fuel cell, radiator, the tyres with their steering
// sweep) is computed by tubPackagingFit() with the same separating-axis test
// as package.interference, and the clearance to the CAD body's inner skin by
// the OCC check (cad/tub-fit-kernel.js). The FE model is node-based: member
// centrelines meet at rigid nodes at the stated positions, which idealises
// the joint offsets between members of different heights (stated).

import { obb, separation } from "../packaging/geometry.js";
import { openingsLayout, applyServiceCutouts } from "./car-openings.js";
import { tubJointScenarios, ADHESIVES, EN1993_CLASSIFICATION, RIVET_NOTE, JOINT_CHOICES, JOINT_MODEL_VERSION } from "./joint-stiffness.js";

const MATERIAL = "aluminum-6061-t6";
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const m = (v) => `${r4(v)} m`;

/**
 * The design choices of the tub (metres). Each with its basis. The lateral and vertical room was
 * measured on the CAD body (OCC point classification of body b1d9ec56..., 2026-10-09): cabin half
 * width inside the skin ~0.73 m at z 0.13 and ~0.79-0.80 m at z 0.2-0.3 (rounded lower corners),
 * front wheel-well inner walls at |y| 0.455 (x 0.8-1.3), rear wheel-well inner walls at |y| 0.635
 * (x 3.62-4.2), floor 0.105-0.13 m. The fit is re-checked on the live body by the OCC tub-fit run.
 */
export const TUB_DESIGN_CHOICES = Object.freeze({
  material: { value: MATERIAL, basis: "design choice: bonded 6061-T6 extrusions and sheet (library material); the Lotus Elise construction (bonded extruded aluminium tub)" },
  bottomZ: { value: 0.14, basis: "design choice: underside of the tub's boxes, above the body floor's inner face (0.108-0.133 m)" },
  floorZ: { value: 0.136, basis: "design choice: floor sheet underside (sheet 0.136-0.138 m), below the occupants' feet and seats (z ≥ 0.155)" },
  nodeZ: { value: 0.30, basis: "idealisation: the frame nodes of the rails, sills, kicks, quarter boxes and lower crosses sit on one line at z 0.30 (their centroids are 0.28-0.32)" },
  firewallX: { value: 1.49, basis: "design choice: firewall plane between the engine envelope's rear (x 1.412) and the occupants' feet (x 1.576)" },
  firewallDepth: { value: 0.14, basis: "design choice: the firewall lower cross box's fore-aft depth, x 1.42-1.56 (most of the engine-to-feet gap): it takes the front rails' root moments in torsion" },
  frontRailX0: { value: 0.68, basis: "design choice: front rail front end behind the radiator (x ≤ 0.671)" },
  frontRailY: { value: 0.41, basis: "design choice: front rails between the engine (|y| ≤ 0.356) and the front wheel wells' inner walls (|y| 0.452 inside the skin)" },
  frontRailSection: { value: { width: 0.07, height: 0.32, wall: 0.003 }, basis: "design choice: front rail box 70 wide (the lateral room) × 320 tall (z 0.14-0.46), 3 mm wall" },
  sillY: { value: 0.705, basis: "design choice: sill centreline outboard of the front seat envelopes (|y| ≤ 0.639) and the occupants' egress line (|y| ≤ 0.653), inside the cabin skin" },
  sillSection: { value: { width: 0.09, height: 0.28, wall: 0.004, bottomZ: 0.18 }, basis: "design choice: sill box 90 × 280 mm (y 0.66-0.75, z 0.18-0.46: clear of the skin's rounded lower corner), 4 mm wall" },
  kickStartX: { value: 2.90, basis: "design choice: where the sill turns inboard to the rear quarter box (kick length / depth ≥ 2)" },
  quarterY: { value: 0.585, basis: "design choice: rear quarter boxes between the rear occupants' pelvis (|y| ≤ 0.540) and the rear wheel wells' inner walls (|y| 0.632 inside the skin)" },
  quarterSection: { value: { width: 0.08, height: 0.34, wall: 0.005 }, basis: "design choice: rear quarter box 80 wide × 340 tall (z 0.14-0.48, below the rear occupants' torso at z 0.486), 5 mm wall" },
  kickWall: { value: 0.006, basis: "design choice: 6 mm sill-kick wall (the kick carries the cabin's twist into the quarter box)" },
  kickTopZ: { value: 0.315, basis: "design choice: the kick stays below the rear occupants' H-point (z 0.32): their egress line rises at x 3.481, |y| 0.515-0.595, where only a box under 37 mm wide could pass above it" },
  fwLowerWall: { value: 0.006, basis: "design choice: 6 mm firewall lower cross wall (takes the front rails' root moments in torsion)" },
  tunnelWall: { value: 0.002, basis: "design choice: 2 mm tunnel walls (the cells barely carry the twist: thicker walls measured no stiffness gain)" },
  scuttleZ: { value: [0.64, 0.74], basis: "design choice: scuttle box under the hood line at the firewall (body half width ~0.86 m at z 0.74)" },
  heelX: { value: 3.20, basis: "design choice: heel cross behind the front seat envelopes (x ≤ 3.146) and below the rear thighs (z ≥ 0.266)" },
  rearBulkheadX: { value: 3.765, basis: "design choice: rear bulkhead behind the rear occupants' pelvis (x ≤ 3.726) and ahead of the differential (x ≥ 3.801)" },
  rearCrossX: { value: 4.20, basis: "design choice: rear end cross behind the differential (x ≤ 4.131), below the fuel cell (z ≥ 0.612)" },
  sheet: { value: 0.002, basis: "design choice: 2 mm floor and firewall sheet" },
  roofRing: { value: true, basis: "design choice: a pillar ring closes the cabin's section (A-pillars from the scuttle, roof rails outboard of the heads (|y| ≤ 0.452) and inboard of the egress line (|y| ≥ 0.573), a B-hoop at x 3.30 between the front heads (x ≤ 3.088) and the rear heads (x ≥ 3.585), a windscreen header); measured on the body interior: roof 1.17-1.23 m inside the skin at |y| 0.5-0.55" },
  roofSection: { value: { width: 0.08, height: 0.07, wall: 0.0045 }, basis: "design choice: 80 (across) × 70 mm, 4.5 mm wall A-pillar, roof rail, header and bow boxes (the ring's members bend as portal frames around the door apertures: their section sets the ring's stiffness). Brief 4 item 2 repair, from 70 × 70: the service cut-outs left the tub 0.2 % over the target; the opening-ring study ranked this +560 N·m/deg for +1.75 kg (tests/conkay-tub-openings.test.js)" },
  postSection: { value: { width: 0.10, height: 0.06, wall: 0.0045 }, basis: "design choice: B- and C-posts 100 mm fore-aft × 60 mm across, 4.5 mm wall (fore-aft room between the front seat backs and the rear occupants; little lateral room beside the rear thighs and heads). Brief 4 item 2 repair, from 50 mm across: the door apertures' rear legs; ranked +393 N·m/deg for +0.71 kg" },
  firewallPostWall: { value: 0.005, basis: "design choice: 5 mm wall on the 80 × 80 firewall posts, the front door aperture's hinge pillar (the ring's front leg from the sill to the scuttle). Brief 4 item 2 repair, from 3 mm: ranked +301 N·m/deg for +0.56 kg" },
  roofRailY: { value: 0.52, basis: "design choice: roof rails between the front heads (|y| ≤ 0.452) and the front egress line (|y| ≥ 0.573)" },
  roofRailRear: { value: [0.45, 1.06], basis: "design choice: the rail's rear end (|y|, z) at the C-post, outboard of the rear heads (|y| ≤ 0.394) and inside the fastback" },
  roofLiner: { value: 0.0015, basis: "design choice: a 1.5 mm 6061-T6 roof liner bonded to the skin's inner face between the windscreen header, the roof rails and the B-bow, working in shear (the CFRP skin is not credited: the HexPly 8552 / AS4 plain-weave data sheet publishes no in-plane shear modulus); the roof is skin, not glazing" },
  aPillarBaseY: { value: 0.60, basis: "design choice: A-pillar foot on the scuttle at |y| 0.60, inboard enough that the pillar stays inside the skin along the windscreen base (measured: half width 0.53-0.62 m at z 0.9, x 1.7-1.9)" },
  bHoopX: { value: 3.30, basis: "design choice: B-hoop between the front seat backs / heads (x ≤ 3.146) and the rear torsos (x ≥ 3.448)" },
});

/**
 * The tub's parts, frame nodes, members and panels from the design choices and the axle positions.
 * walls: optional per-group wall overrides (rail, sill, kick, quarter, post, fwLower, scuttle, cpost,
 * tunnel, cross, bulkhead) for studies. Returns { parts, nodes, members, panels, pickups, choices }.
 */
export function tubLayout({ frontAxleX, rearAxleX, choices = TUB_DESIGN_CHOICES, walls = {} }) {
  const c = Object.fromEntries(Object.entries({ ...TUB_DESIGN_CHOICES, ...choices }).map(([k, v]) => [k, v.value]));
  const w = (id, d) => walls[id] ?? d;
  const XF = c.firewallX, FD = c.firewallDepth, YR = c.frontRailY, YS = c.sillY, YQ = c.quarterY, KX = c.kickStartX;
  const Z0 = c.bottomZ, ZN = c.nodeZ, [ZU0, ZU1] = c.scuttleZ, ZU = (ZU0 + ZU1) / 2;
  const sill = c.sillSection, rs = c.frontRailSection, qs = c.quarterSection;
  const sillTop = sill.bottomZ + sill.height;
  const parts = [];
  const nodes = [];
  const members = [];
  const panels = [];
  const N = (id, x, y, z) => { nodes.push({ id, x: r4(x), y: r4(y), z: r4(z) }); return id; };
  // part: a rect tube (or a plate) with its packaging box (centre, half extents, yaw; axis = the tube's length axis)
  const tube = (id, name, { width, height, wall }, box, length) => {
    parts.push({ id, name, kind: "Beam", material: c.material, geometry: { shape: "rect-tube", length: m(length), width: m(width), height: m(height), wall: m(wall) }, box });
    return id;
  };
  const plate = (id, name, { length, width, thickness }, box) => {
    parts.push({ id, name, kind: "Plate", material: c.material, geometry: { shape: "plate", length: m(length), width: m(width), thickness: m(thickness) }, box });
    return id;
  };
  const along = (axis, min, max) => ({ center: min.map((v, i) => (v + max[i]) / 2), half: min.map((v, i) => (max[i] - v) / 2), axis });
  const mem = (id, i, j, part) => members.push({ id, i, j, part });
  const sillXs = [XF, 1.98, 2.06, 2.24, KX];
  const sillIn = YS - sill.width / 2; // sill inner face
  const qIn = YQ - qs.width / 2; // quarter box inner face

  for (const [s, sg] of [["L", 1], ["R", -1]]) {
    // front rail: behind the radiator → firewall
    const rail = tube(`TUB_RAIL_F${s}`, `Front rail ${s}`, { ...rs, wall: w("rail", rs.wall) }, along("x", [c.frontRailX0, sg * YR - rs.width / 2, Z0], [XF - FD / 2, sg * YR + rs.width / 2, Z0 + rs.height]), XF - FD / 2 - c.frontRailX0);
    N(`F0.${s}`, c.frontRailX0, sg * YR, ZN); N(`FA.${s}`, frontAxleX, sg * YR, ZN); N(`FWR.${s}`, XF, sg * YR, ZN);
    mem(`rail-f${s}1`, `F0.${s}`, `FA.${s}`, rail); mem(`rail-f${s}2`, `FA.${s}`, `FWR.${s}`, rail);
    // sill: firewall → kick start
    const sl = tube(`TUB_SILL_${s}`, `Sill ${s}`, { ...sill, wall: w("sill", sill.wall) }, along("x", [XF - FD / 2, sg * YS - sill.width / 2, sill.bottomZ], [KX, sg * YS + sill.width / 2, sillTop]), KX - (XF - FD / 2));
    sillXs.forEach((x) => N(`S${x}.${s}`, x, sg * YS, ZN));
    for (let k = 0; k < sillXs.length - 1; k++) mem(`sill-${s}${k + 1}`, `S${sillXs[k]}.${s}`, `S${sillXs[k + 1]}.${s}`, sl);
    // sill kick: inboard to the quarter box (heel cross node on it)
    const k0 = [KX, sg * YS], k1 = [3.62, sg * YQ];
    const kl = Math.hypot(k1[0] - k0[0], k1[1] - k0[1]);
    const yaw = (Math.atan2(k1[1] - k0[1], k1[0] - k0[0]) * 180) / Math.PI;
    // the kick starts at the sill's height (z 0.18: clear of the skin's lower corner) and reaches the quarter box's top
    const kz = [sill.bottomZ, c.kickTopZ];
    const kick = tube(`TUB_KICK_${s}`, `Sill kick ${s}`, { width: qs.width, height: kz[1] - kz[0], wall: w("kick", c.kickWall) }, { center: [(k0[0] + k1[0]) / 2, (k0[1] + k1[1]) / 2, (kz[0] + kz[1]) / 2], half: [kl / 2, qs.width / 2, (kz[1] - kz[0]) / 2], yawDeg: yaw }, kl);
    const tH = (c.heelX - k0[0]) / (k1[0] - k0[0]);
    N(`K.${s}`, c.heelX, k0[1] + (k1[1] - k0[1]) * tH, ZN);
    N(`Q0.${s}`, 3.62, sg * YQ, ZN);
    mem(`kick-${s}1`, `S${KX}.${s}`, `K.${s}`, kick); mem(`kick-${s}2`, `K.${s}`, `Q0.${s}`, kick);
    // rear quarter box: carries the rear pickup
    const q = tube(`TUB_QTR_${s}`, `Rear quarter box ${s}`, { ...qs, wall: w("quarter", qs.wall) }, along("x", [3.58, sg * YQ - qs.width / 2, Z0], [4.30, sg * YQ + qs.width / 2, Z0 + qs.height]), 4.30 - 3.58);
    N(`QB.${s}`, c.rearBulkheadX, sg * YQ, ZN); N(`QA.${s}`, rearAxleX, sg * YQ, ZN); N(`QE.${s}`, c.rearCrossX, sg * YQ, ZN);
    mem(`qtr-${s}1`, `Q0.${s}`, `QB.${s}`, q); mem(`qtr-${s}2`, `QB.${s}`, `QA.${s}`, q); mem(`qtr-${s}3`, `QA.${s}`, `QE.${s}`, q);
    // firewall posts (sill top to scuttle), 80 (x) × 80 (y)
    const post = tube(`TUB_FW_POST_${s}`, `Firewall post ${s}`, { width: 0.08, height: 0.08, wall: w("post", c.firewallPostWall) }, along("z", [XF - 0.04, sg * YS - 0.04, sillTop], [XF + 0.04, sg * YS + 0.04, ZU0]), ZU0 - sillTop);
    N(`FWU.${s}`, XF, sg * YS, ZU);
    mem(`fw-post-${s}`, `S${XF}.${s}`, `FWU.${s}`, post);
  }
  // firewall lower cross (sill to sill)
  const fwl = tube("TUB_FW_LOWER", "Firewall lower cross", { width: FD, height: 0.28, wall: w("fwLower", c.fwLowerWall) }, along("y", [XF - FD / 2, -sillIn, Z0], [XF + FD / 2, sillIn, Z0 + 0.28]), 2 * sillIn);
  N("FWC", XF, 0, ZN);
  mem("fw-lower-L1", `S${XF}.L`, "FWR.L", fwl); mem("fw-lower-L2", "FWR.L", "FWC", fwl);
  mem("fw-lower-R1", `S${XF}.R`, "FWR.R", fwl); mem("fw-lower-R2", "FWR.R", "FWC", fwl);
  // scuttle (top of the firewall)
  const scut = tube("TUB_SCUTTLE", "Scuttle cross", { width: 0.08, height: ZU1 - ZU0, wall: w("scuttle", 0.003) }, along("y", [XF - 0.04, -(YS + 0.04), ZU0], [XF + 0.04, YS + 0.04, ZU1]), 2 * (YS + 0.04));
  N("FWUC", XF, 0, ZU);
  mem("scuttle-L", "FWU.L", "FWUC", scut); mem("scuttle-R", "FWU.R", "FWUC", scut);
  // firewall centre post (the tunnel's front wall line), 80 × 80
  const cpost = tube("TUB_FW_CPOST", "Firewall centre post", { width: 0.08, height: 0.08, wall: w("cpost", 0.003) }, along("z", [XF - 0.04, -0.04, Z0 + 0.28], [XF + 0.04, 0.04, ZU0]), ZU0 - Z0 - 0.28);
  N("FWT", XF, 0, 0.395);
  mem("fw-cpost-1", "FWC", "FWT", cpost); mem("fw-cpost-2", "FWT", "FWUC", cpost);
  // tunnel, front cell around the gearbox: firewall → 2.06, 310 wide, z bottom → 0.65
  const tf = tube("TUB_TUNNEL_F", "Tunnel, gearbox cell", { width: 0.31, height: 0.65 - Z0, wall: w("tunnel", c.tunnelWall) }, along("x", [XF + FD / 2, -0.155, Z0], [2.06, 0.155, 0.65]), 2.06 - XF - FD / 2);
  N("T1.98", 1.98, 0, 0.395); N("T2.06", 2.06, 0, 0.395);
  mem("tunnel-f1", "FWT", "T1.98", tf); mem("tunnel-f2", "T1.98", "T2.06", tf);
  // tunnel, rear cell for the driveshaft: 2.24 → heel cross, 150 wide, z bottom → 0.56
  const tr = tube("TUB_TUNNEL_R", "Tunnel, driveshaft cell", { width: 0.15, height: 0.56 - Z0, wall: w("tunnel", c.tunnelWall) }, along("x", [2.24, -0.075, Z0], [c.heelX - 0.04, 0.075, 0.56]), c.heelX - 0.04 - 2.24);
  N("R2.24", 2.24, 0, 0.35); N(`R${KX}`, KX, 0, 0.35); N("RH", c.heelX, 0, 0.35);
  mem("tunnel-r1", "R2.24", `R${KX}`, tr); mem("tunnel-r2", `R${KX}`, "RH", tr);
  // seat cross (x 1.98, under the seats' front edge, behind the feet), 80 × 110
  const seat = tube("TUB_SEAT_CROSS", "Seat cross", { width: 0.08, height: 0.11, wall: w("cross", 0.003) }, along("y", [1.94, -sillIn, Z0], [2.02, sillIn, Z0 + 0.11]), 2 * sillIn - 0.31);
  mem("seat-cross-L", "S1.98.L", "T1.98", seat); mem("seat-cross-R", "S1.98.R", "T1.98", seat);
  // heel cross (behind the front seats, under the rear thighs), 80 × 120
  const heelHalf = (YS + (YQ - YS) * ((c.heelX - KX) / (3.62 - KX))) - 0.04;
  const heel = tube("TUB_HEEL_CROSS", "Heel cross", { width: 0.08, height: 0.12, wall: w("cross", 0.003) }, along("y", [c.heelX - 0.04, -heelHalf, Z0], [c.heelX + 0.04, heelHalf, Z0 + 0.12]), 2 * heelHalf);
  mem("heel-L", "K.L", "RH", heel); mem("heel-R", "K.R", "RH", heel);
  // rear bulkhead (quarter to quarter, ahead of the differential), 40 (x) deep
  const rb = tube("TUB_REAR_BULKHEAD", "Rear bulkhead", { width: 0.04, height: 0.48 - Z0, wall: w("bulkhead", 0.0025) }, along("y", [c.rearBulkheadX - 0.02, -qIn, Z0], [c.rearBulkheadX + 0.02, qIn, 0.48]), 2 * qIn);
  N("QBC", c.rearBulkheadX, 0, ZN);
  mem("rear-bulkhead-L", "QB.L", "QBC", rb); mem("rear-bulkhead-R", "QB.R", "QBC", rb);
  // rear end cross (behind the differential), 80 × 200
  const re = tube("TUB_REAR_CROSS", "Rear end cross", { width: 0.08, height: 0.20, wall: w("cross", 0.003) }, along("y", [c.rearCrossX - 0.04, -qIn, ZN - 0.10], [c.rearCrossX + 0.04, qIn, ZN + 0.10]), 2 * qIn);
  N("QEC", c.rearCrossX, 0, ZN);
  mem("rear-cross-L", "QE.L", "QEC", re); mem("rear-cross-R", "QE.R", "QEC", re);

  // pillar ring (roof): A-pillars, roof rails, B-hoop posts and bow, windscreen header
  if (c.roofRing) {
    const rsn = c.roofSection, YRR = c.roofRailY, XB = c.bHoopX;
    const A0 = [XF, c.aPillarBaseY, ZU], R0 = [2.35, YRR, 1.06], R1 = [XB, YRR, 1.15];
    const yAtKick = (x) => YS + (YQ - YS) * ((x - KX) / (3.62 - KX));
    const B0 = [XB, yAtKick(XB), ZN];
    const seg = (id, name, a, b, sg, sec = rsn) => {
      const pa = [a[0], sg * a[1], a[2]], pb = [b[0], sg * b[1], b[2]];
      const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      const d = [(pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L, (pb[2] - pa[2]) / L];
      const yawDeg = (Math.atan2(d[1], d[0]) * 180) / Math.PI, pitchDeg = (Math.atan2(-d[2], Math.hypot(d[0], d[1])) * 180) / Math.PI;
      // packaging box axes match the frame's section axes: width along the horizontal normal, height in the vertical plane
      return tube(id, name, { ...sec, wall: w("roof", sec.wall) }, { center: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2], half: [L / 2, sec.width / 2, sec.height / 2], yawDeg, pitchDeg }, L);
    };
    for (const [s, sg] of [["L", 1], ["R", -1]]) {
      N(`FWA.${s}`, XF, sg * c.aPillarBaseY, ZU);
      const sc = members.findIndex((mm) => mm.id === `scuttle-${s}`);
      members.splice(sc, 1, { id: `scuttle-${s}1`, i: `FWU.${s}`, j: `FWA.${s}`, part: members[sc].part }, { id: `scuttle-${s}2`, i: `FWA.${s}`, j: "FWUC", part: members[sc].part });
      N(`RR0.${s}`, R0[0], sg * R0[1], R0[2]); N(`RR1.${s}`, R1[0], sg * R1[1], R1[2]); N(`BK.${s}`, B0[0], sg * B0[1], B0[2]);
      mem(`a-pillar-${s}`, `FWA.${s}`, `RR0.${s}`, seg(`TUB_A_PILLAR_${s}`, `A-pillar ${s}`, A0, R0, sg));
      mem(`roof-rail-${s}`, `RR0.${s}`, `RR1.${s}`, seg(`TUB_ROOF_RAIL_${s}`, `Roof rail ${s}`, R0, R1, sg));
      // the B-post's foot is a node on the sill kick: split the kick there
      const k1 = members.findIndex((mm) => mm.id === `kick-${s}2`);
      const kickPart = members[k1].part;
      members.splice(k1, 1, { id: `kick-${s}2`, i: `K.${s}`, j: `BK.${s}`, part: kickPart }, { id: `kick-${s}3`, i: `BK.${s}`, j: `Q0.${s}`, part: kickPart });
      mem(`b-post-${s}`, `BK.${s}`, `RR1.${s}`, seg(`TUB_B_POST_${s}`, `B-post ${s}`, B0, R1, sg, c.postSection));
      // rear roof rail to the C-post at the rear axle line, C-post down to the quarter box
      const R2 = [rearAxleX, c.roofRailRear[0], c.roofRailRear[1]];
      N(`RR2.${s}`, R2[0], sg * R2[1], R2[2]);
      mem(`roof-rail-r-${s}`, `RR1.${s}`, `RR2.${s}`, seg(`TUB_ROOF_RAIL_R_${s}`, `Rear roof rail ${s}`, R1, R2, sg));
      mem(`c-post-${s}`, `QA.${s}`, `RR2.${s}`, seg(`TUB_C_POST_${s}`, `C-post ${s}`, [rearAxleX, YQ, Z0 + qs.height], R2, sg, c.postSection));
    }
    N("RB", XB, 0, R1[2]); N("RH0", R0[0], 0, R0[2]);
    const bow = tube("TUB_ROOF_BOW", "Roof bow (B-hoop top)", { ...rsn, wall: w("roof", rsn.wall) }, along("y", [XB - rsn.width / 2, -YRR, R1[2] - rsn.height / 2], [XB + rsn.width / 2, YRR, R1[2] + rsn.height / 2]), 2 * YRR);
    mem("roof-bow-L", "RR1.L", "RB", bow); mem("roof-bow-R", "RR1.R", "RB", bow);
    const hdr = tube("TUB_WS_HEADER", "Windscreen header", { ...rsn, wall: w("roof", rsn.wall) }, along("y", [R0[0] - rsn.width / 2, -YRR, R0[2] - rsn.height / 2], [R0[0] + rsn.width / 2, YRR, R0[2] + rsn.height / 2]), 2 * YRR);
    mem("ws-header-L", "RR0.L", "RH0", hdr); mem("ws-header-R", "RR0.R", "RH0", hdr);
    if (c.roofLiner > 0) {
      // conforms to the skin's inner face (domed): no box; its fit is the body's head clearance less skin and liner
      const len = XB - R0[0], wid = 2 * YRR;
      const liner = plate("TUB_ROOF_LINER", "Roof liner (bonded to the skin)", { length: len, width: wid, thickness: c.roofLiner }, { center: [(XB + R0[0]) / 2, 0, (R0[2] + R1[2]) / 2], half: [len / 2, wid / 2, c.roofLiner / 2], conformsToSkin: true });
      panels.push({ id: "roof-L", nodes: ["RR0.L", "RR1.L", "RB", "RH0"], part: liner });
      panels.push({ id: "roof-R", nodes: ["RR0.R", "RR1.R", "RB", "RH0"], part: liner });
    }
  }

  // sheets in shear: floor (each side), rear floor, firewall
  const t = c.sheet;
  const fz = [c.floorZ, c.floorZ + t];
  for (const [s, sg] of [["L", 1], ["R", -1]]) {
    const fl = plate(`TUB_FLOOR_${s}`, `Floor sheet ${s}`, { length: c.heelX - XF, width: sillIn - 0.075, thickness: t }, along("x", [XF, sg > 0 ? 0.075 : -sillIn, fz[0]], [c.heelX, sg > 0 ? sillIn : -0.075, fz[1]]));
    const bays = [[`S${XF}.${s}`, `S1.98.${s}`, "T1.98", "FWT"], [`S1.98.${s}`, `S2.06.${s}`, "T2.06", "T1.98"], [`S2.06.${s}`, `S2.24.${s}`, "R2.24", "T2.06"], [`S2.24.${s}`, `S${KX}.${s}`, `R${KX}`, "R2.24"], [`S${KX}.${s}`, `K.${s}`, "RH", `R${KX}`]];
    bays.forEach((b, k) => panels.push({ id: `floor-${s}${k + 1}`, nodes: b, part: fl }));
    const rf = plate(`TUB_REAR_FLOOR_${s}`, `Rear floor sheet ${s}`, { length: c.rearBulkheadX - c.heelX, width: qIn, thickness: t }, along("x", [c.heelX, sg > 0 ? 0 : -qIn, fz[0]], [c.rearBulkheadX, sg > 0 ? qIn : 0, fz[1]]));
    panels.push({ id: `rear-floor-${s}`, nodes: [`K.${s}`, `QB.${s}`, "QBC", "RH"], part: rf });
    const fw = plate(`TUB_FIREWALL_${s}`, `Firewall sheet ${s}`, { length: YS, width: ZU - ZN, thickness: t }, along("y", [XF + FD / 2, sg > 0 ? 0 : -YS, Z0 + 0.28], [XF + FD / 2 + t, sg > 0 ? YS : 0, ZU0]));
    panels.push({ id: `firewall-${s}`, nodes: [`S${XF}.${s}`, "FWC", "FWUC", `FWU.${s}`], part: fw });
  }
  return { parts, nodes, members, panels, pickups: { front: ["FA.L", "FA.R"], rear: ["QA.L", "QA.R"], frontArm: 2 * YR, rearArm: 2 * YQ }, choices: c };
}

/** The packaging box of a tub part as an oriented box (its outer envelope). */
export function tubPartBox(part) {
  const b = part.box;
  return obb({ id: part.id, center: b.center, half: b.half, yawDeg: b.yawDeg || 0, pitchDeg: b.pitchDeg || 0 });
}

/**
 * The material of a part as boxes: a plate is its box; a rect tube is its four walls (it is hollow:
 * the gearbox runs inside the tunnel cell). The walls are the two pairs of faces parallel to the
 * part's long axis; the wall thickness is the section's.
 */
export function tubPartWalls(part) {
  const box = tubPartBox(part);
  const g = part.geometry;
  if (g.shape !== "rect-tube") return [box];
  const t = parseFloat(g.wall);
  const h = box.half;
  const long = part.box.axis ? { x: 0, y: 1, z: 2 }[part.box.axis] : 0; // the tube's length axis
  const others = [0, 1, 2].filter((i) => i !== long);
  const out = [];
  for (const i of others) {
    for (const sgn of [-1, 1]) {
      const half = [...h];
      half[i] = t / 2;
      const center = [0, 1, 2].map((k) => box.center[k] + sgn * (h[i] - t / 2) * box.axes[i][k]);
      out.push({ ...box, id: `${part.id}:wall`, center, half });
    }
  }
  return out;
}

/**
 * Clearance of every tub part to every packaging envelope of the scene (packageScene in
 * packaging/checks.js): occupant boxes of every percentile in every seat, front seat envelopes,
 * components with dimensions, the tyres (front ones with their steering sweep) and the steering
 * wheel. Separating-axis test (package.interference's). Returns rows { part, minClearanceM, against }.
 */
export function tubPackagingFit(scene, parts) {
  const env = [...scene.compBoxes, ...Object.values(scene.scenarios).flatMap((occ) => occ.flatMap((o) => [...o.boxes.map((x) => ({ ...x, id: `${o.seat}:${x.id}` })), ...(o.seatBoxes || [])]))];
  // egress: the vertical line each occupant's shoulder rises along to the header (packageScene's entry points)
  for (const [key, occ] of Object.entries(scene.scenarios)) {
    for (const o of occ) {
      const sgn = Math.sign(o.landmarks.y) || 1;
      const [hx, hz] = o.landmarks.hPoint, top = hz + o.entry.need;
      env.push(obb({ id: `egress:${o.seat}:${key}`, center: [hx, sgn * o.entry.yOut, (hz + top) / 2], half: [0.0005, 0.0005, (top - hz) / 2] }));
    }
  }
  return parts.filter((p) => !p.box?.conformsToSkin).map((p) => {
    let worst = { s: Infinity, id: null };
    for (const box of tubPartWalls(p)) {
      for (const e of env) {
        const s = separation(box, e).separation;
        if (s < worst.s) worst = { s, id: e.id };
      }
    }
    return { part: p.id, minClearanceM: r4(worst.s), against: worst.id };
  });
}

const num = (v) => (typeof v === "number" ? v : parseFloat(v));

/** Load-case choices of the tub frame model, each with its basis. */
export const TUB_LOAD_CHOICES = Object.freeze({
  loadFactor: { value: 2, state: "estimated", basis: "2 g vertical, the same assumption as the ladder screen (vehicle.chassis-screen); no load spectrum measured" },
  twistForceN: { value: 10, state: "design choice", basis: "test force for the stiffness case: linear, so the stiffness does not depend on it" },
  kerbTwist: { state: "estimated", basis: "static kerb/ditch twist: one front wheel lifted until the other carries none, a couple of (front axle load) × track / 2 about the car's axis; applied as a force at the right front pickup with the left front held (the stiffness case's supports), so force = front axle load × track / (2 × front pickup spacing). No dynamic factor is applied (none sourced)" },
});

/**
 * The torsional-stiffness target: the low end of the published range of sports-car chassis, the
 * Lotus Elise's bonded extruded aluminium tub (the same construction as this tub, open-topped like
 * it). The range's high end is a carbon monocoque supercar. Published figures do not state their
 * test method (supports, load points, whether subframes are included), so the comparison with this
 * model (twist between the axle-line pickups, rigid joints) is approximate: a screening target.
 */
export const TORSION_TARGET = Object.freeze({
  perDegree: 10800,
  value: (10800 * 180) / Math.PI,
  label: "10,800 N·m/deg",
  basis: "low end of the cited sports-car range: Lotus Elise bonded extruded aluminium tub, 10,800 N·m/deg (Lotus 2011 press pack); high end Lamborghini Aventador CFRP monocoque, 35,000 N·m/deg; test methods not published, so a screening target",
  sources: [
    { title: "Lotus Cars, 2011 Lotus Elise press pack (PDF)", url: "https://billswebspace.com/2011LotusElisePressPack.pdf", retrieved: "2026-10-09", sha256: "e0d4c909251aa8fd4e9787f5512fd83c22a2f16ce4e51216e16169f1ae584875", quote: "World’s first bonded and extruded Aluminium chassis / Lightweight (68 kg) and strong / Aluminium tub and door beams create safety cell / Stiff (10,800 Nm / degree)", kind: "manufacturer (hosted by a third party)" },
    { title: "Web Magazine OPENERS, Lamborghini Aventador monocoque (2015-02-16)", url: "https://openers.jp/en/car/car_news/11071", retrieved: "2026-10-09", quote: "Its torsional rigidity is exceptionally high for a production car, requiring 35,000 Nm of force to twist it by just one degree. ... The monocoque alone weighs just 147.5 kg", kind: "secondary (press report)" },
  ],
});

/** Removed by the tub design change (they stay in the change record). */
export const TUB_REPLACES = Object.freeze(["RAIL_L", "RAIL_R", "TUB"]);

/**
 * Apply the structural-tub design change to a car IR (from buildCarFromLibrary). Returns
 * { ir, layout, change }. The IR keeps every other node; the tub's parts go in CHASSIS with
 * positions (so mass.cg places them) and CHASSIS carries the frame model (structure.frame).
 */
export function withStructuralTub(ir, { choices, walls, openings: withOpenings = true, openingChoices } = {}) {
  const out = JSON.parse(JSON.stringify(ir));
  const veh = out.nodes.find((n) => n.id === "VEH");
  const chassis = out.nodes.find((n) => n.id === "CHASSIS");
  if (!veh || !chassis) throw new Error("car IR needs VEH and CHASSIS");
  const fx = num(veh.props.vehicle.frontAxleX), rx = num(veh.props.vehicle.rearAxleX);
  const layout = tubLayout({ frontAxleX: fx, rearAxleX: rx, choices, walls });
  // the openings (car-openings.js): door / glazing apertures laid out from the tub, service cut-outs cut into it
  let openings = null, cutoutNotes = [];
  if (withOpenings) {
    const rt = veh.props.vehicle.packaging?.tyres?.find((t) => t.id === "TIRE_RL");
    const rtNode = out.nodes.find((n) => n.id === "TIRE_RL");
    const D = rt?.diameterM, rtx = num(rtNode?.position?.x), rtz = num(rtNode?.position?.z);
    if (!(D > 0 && Number.isFinite(rtx) && Number.isFinite(rtz))) throw new Error("openings need the rear tyre's diameter and position (TIRE_RL)");
    openings = openingsLayout(layout, { rearTyreMinX: rtx - D / 2, rearTyreTopZ: rtz + D / 2, choices: openingChoices });
    cutoutNotes = applyServiceCutouts(layout, openings);
  }
  const removed = out.nodes.filter((n) => TUB_REPLACES.includes(n.id)).map((n) => ({ id: n.id, material: n.material, geometry: n.geometry }));
  out.nodes = out.nodes.filter((n) => !TUB_REPLACES.includes(n.id));
  out.edges = out.edges.filter((e) => !TUB_REPLACES.includes(e.to) && !TUB_REPLACES.includes(e.from));
  for (const p of layout.parts) {
    const [x, y, z] = p.box.center;
    out.nodes.push({ id: p.id, kind: p.kind, name: p.name, material: p.material, geometry: p.geometry, position: { x: m(x), y: m(y), z: m(z) }, props: { role: "tub", tubBox: p.box } });
    out.edges.push({ type: "CONTAINS", from: "CHASSIS", to: p.id });
  }
  const { front, rear, frontArm } = layout.pickups;
  const [FL, FR] = front, [RL, RR] = rear;
  const vertical = (n) => ({ node: n, fix: ["z"] });
  const supports = [{ node: FL, fix: ["x", "y", "z"] }, { node: FR, fix: ["x", "z"] }, vertical(RL), vertical(RR)];
  const twistSupports = [{ node: RL, fix: ["x", "y", "z"] }, { node: RR, fix: ["x", "z"] }, vertical(FL)];
  const track = Math.abs(num(out.nodes.find((n) => n.id === "TIRE_FL")?.position?.y ?? NaN) - num(out.nodes.find((n) => n.id === "TIRE_FR")?.position?.y ?? NaN));
  const weightMembers = layout.members.filter((mm) => /^(rail|sill|kick|qtr)-/.test(mm.id)).map((mm) => mm.id);
  const lc = TUB_LOAD_CHOICES;
  chassis.props = {
    ...(chassis.props || {}),
    ...(openings ? { tubOpenings: { ...openings, cutouts: cutoutNotes } } : {}),
    frameModel: {
      shearDeformation: true,
      segments: 4,
      nodes: layout.nodes, members: layout.members, panels: layout.panels, supports,
      loadCases: [
        { id: "bending", weight: [{ from: { solver: "mass.assembly", target: "VEH", output: "grossMass" }, factor: lc.loadFactor, dir: [0, 0, -1], members: weightMembers }] },
        { id: "twist", stiffnessOnly: true, nodal: [{ node: FR, F: [0, 0, lc.twistForceN.value] }], supports: twistSupports },
        ...(Number.isFinite(track) ? [{ id: "kerb-twist", forces: [{ from: { solver: "vehicle.axle-loads", target: "VEH", output: "frontAxleLoad" }, factor: { value: track / (2 * frontArm), state: lc.kerbTwist.state, basis: `${lc.kerbTwist.basis}; track ${r4(track)} m, front pickup spacing ${r4(frontArm)} m` }, node: FR, dir: [0, 0, 1] }], supports: twistSupports }] : []),
      ],
      // joint and bond-line stiffness (structural/joint-stiffness.js): the twist re-solved with joint springs
      jointScenarios: tubJointScenarios(),
      jointModel: { version: JOINT_MODEL_VERSION, choices: JOINT_CHOICES, adhesives: ADHESIVES, classification: EN1993_CLASSIFICATION, rivets: RIVET_NOTE },
      torsionCrossCheck: { x0: fx, x1: rx, axis: { y: 0, z: layout.choices.nodeZ } },
      stiffness: [{
        id: "torsional", case: "twist", node: FR, dof: "z", force: lc.twistForceN.value, arm: frontArm, kind: "torsional", jointRange: true,
        target: { value: TORSION_TARGET.value, label: TORSION_TARGET.label, basis: TORSION_TARGET.basis, sources: TORSION_TARGET.sources },
        profile: [["front-axle", "FA"], ["firewall-rails", "FWR"], ["firewall-sills", `S${layout.choices.firewallX}`], ["sill-2.24", "S2.24"], ["kick-start", `S${layout.choices.kickStartX}`], ["heel", "K"], ["quarter-start", "Q0"], ["rear-bulkhead", "QB"], ["rear-axle", "QA"]]
          .map(([sid, n]) => ({ id: sid, nodes: [`${n}.L`, `${n}.R`] })),
      }],
      assumptions: [
        "Structural tub (design change, structural/car-tub.js): every position and section is a design choice; packaging clearances are computed separately (tubPackagingFit, OCC body check).",
        "Suspension pickups are rigid supports on the front rails (axle line) and the rear quarter boxes (axle line); springs, bushings and the S550 subframes are not modelled or credited.",
        "Joints are rigid in the main solve (the stiffness's upper bound). The torsional stiffness is also a range (structural/joint-stiffness.js): bond-line springs from the sourced adhesive moduli are computed; joint-wall distortion is bounded by placing every joint at the EN 1993-1-8 rigid boundary (k_b 25, then 8), an estimate because that rule classifies steel building frames. The stiffness margin uses the lowest computed bond-line value. An estimated bound below the target is a warning, not a failed capacity. Self-piercing rivets are not credited with stiffness. Member centrelines meet at nodes (joint offsets idealised).",
        "The CFRP body skin and the glazing are not structural here: not credited (a bonded windscreen would add stiffness that is not counted).",
        ...(openings ? [`Openings (structural/car-openings.js): door apertures, windscreen, backlight and side glass are open (no sheet credited in them); service cut-outs are cut in: ${cutoutNotes.map((n) => (n.panel ? `${n.panel} × ${n.factor.toFixed(4)} (${n.holes.join(", ")})` : `${n.member} → ${n.to}`)).join("; ")}.`] : ["Openings not designed (openings: false): the firewall sheets and the tunnel cell are uncut."]),
        "Gross mass spread uniformly along the rails, sills, kicks and quarter boxes (bending case), times the stated load factor.",
      ],
    },
  };
  const pk = veh.props.vehicle.packaging;
  if (Array.isArray(pk?.notChecked)) {
    pk.notChecked = pk.notChecked.map((r) => r.item === "RAIL_L, RAIL_R, TUB"
      ? { item: "structural tub", reason: openings ? "checked by package.tub-fit (envelopes, egress lines, the CAD body skin, and the door / glazing / service openings); the skin is not trimmed at the openings (not structural)" : "checked by package.tub-fit (envelopes, egress lines and the CAD body skin); door apertures, glazing openings and service access are not designed, so not checked" }
      : r.item === "pedal box, dash, steering column, driveshaft, door and sill" ? { item: "pedal box, dash, steering column, driveshaft, doors", reason: "not in the design (the sills are tub parts)" } : r);
  }
  const change = {
    parameter: "chassis structure",
    old: "ladder-frame screen: RAIL_L / RAIL_R (6061-T6 I-beams 120 × 80 mm, 3.6 m, placed at y = 0; screened at a 1.1 m spacing with four cross-members) and TUB (notional 6 m² × 5 mm CFRP shell: mass only)",
    new: `structural tub: ${layout.parts.length} bonded 6061-T6 parts (closed boxes and 2 mm shear sheets), structural/car-tub.js`,
    reason: "the ladder screen's torsional stiffness (open sections, Saint-Venant torsion only) was about 8 N·m/deg; closed sections and shear sheets carry torsion by shear flow (Bredt)",
    basis: "design",
    removed,
  };
  return { ir: out, layout, change, openings };
}
