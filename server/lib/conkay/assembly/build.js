// server/lib/conkay/assembly/build.js
//
// Build the vehicle assembly from the design IR (layout, tub openings, tyre
// spec) plus optional solved body extents and required power. Every placement
// is in the design coordinate frame. Envelopes are labelled as envelopes.

import { occupantDims } from "../packaging/occupant.js";
import { getComponent } from "../components/index.js";
import { packageScene } from "../packaging/checks.js";
import { obb, aabb, separation } from "../packaging/geometry.js";
import { j941Envelope, J941_SOURCE } from "./j941.js";
import { loftBody, wheelMesh, crownAt, skinApertureTop, boxInsideEnvelope, resolveSpec } from "./surface.js";
import { ASSEMBLY_SCHEMA, COORDINATE_SYSTEM, validateAssembly } from "./schema.js";

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const mm = (v) => Math.round(v * 1000);
const IN = 0.0254;

const prov = (state, source, note) => ({ state, ...(source ? { source } : {}), ...(note ? { note } : {}) });

function param(id, name, value, unit, provenance) {
  return { id, name, value: typeof value === "number" ? r4(value) : value, unit, provenance };
}

function envelope(label) {
  return { kind: "envelope", label };
}

function part({ id, name, group, role, placement, half, geometry, parameters, relationships, explode, instanceOf, mesh }) {
  return {
    id, name, group, role,
    placement: { x: r4(placement.x), y: r4(placement.y), z: r4(placement.z), pitchDeg: placement.pitchDeg || 0, yawDeg: placement.yawDeg || 0 },
    half: half ? half.map(r4) : null,
    geometry, parameters: parameters || [], relationships: relationships || [],
    explode: explode || { axis: "z", sign: 1, rank: 1 },
    ...(instanceOf ? { instanceOf } : {}),
    ...(mesh ? { mesh } : {}),
  };
}

function boxOf(c) {
  if (!c.half) return null;
  return obb({ id: c.id, center: [c.placement.x, c.placement.y, c.placement.z], half: c.half, pitchDeg: c.placement.pitchDeg || 0 });
}

/**
 * @param {object} input
 * ir: design IR from buildCarFromLibrary (positions already in metres)
 * bodyBBox: optional { min:[x,y,z], max } from cad.body
 * powerW: optional solved required power
 */
export function assemblyFromIr(ir, { bodyBBox = null, powerW = null } = {}) {
  const nodes = new Map(ir.nodes.map((n) => [n.id, n]));
  const veh = nodes.get("VEH");
  const pkg = veh?.props?.vehicle?.packaging;
  if (!pkg) return { error: "the design has no package layout" };
  const num = (v) => (typeof v === "number" ? v : parseFloat(v));
  const frontAxleX = num(veh.props.vehicle.frontAxleX);
  const rearAxleX = num(veh.props.vehicle.rearAxleX);
  const centers = {};
  for (const n of ir.nodes) if (n.position && Number.isFinite(num(n.position.x))) centers[n.id] = { x: num(n.position.x), y: num(n.position.y), z: num(n.position.z) };
  const scene = packageScene({ pkg, centers });
  const dc = scene.dc;
  const chassis = nodes.get("CHASSIS");
  const openings = chassis?.props?.tubOpenings || null;
  const m95 = occupantDims("M95");
  const f5 = occupantDims("F5");
  const driver = scene.scenarios.M95?.find((o) => o.seat === "SEAT_1") || scene.scenarios[pkg.occupantKeys[0]]?.find((o) => o.seat === "SEAT_1");
  const driverF5 = scene.scenarios.F5?.find((o) => o.seat === "SEAT_1");
  const rearM = scene.scenarios.M95?.find((o) => o.seat === "SEAT_3");

  const headTop = (occ) => occ?.landmarks?.headTop?.[1] ?? null;
  const shoulderZ = (occ) => {
    if (!occ) return null;
    return occ.landmarks.shoulder[1];
  };

  const tyre = pkg.tyres?.[0];
  const tyreR = tyre ? tyre.diameterM / 2 : 0.33;
  const tyreW = tyre ? tyre.widthM : 0.25;
  const track = Math.abs((centers.TIRE_FL?.y ?? -0.8) - (centers.TIRE_FR?.y ?? 0.8));

  const skin = 0.04;
  const headZ = headTop(driver);
  const minInnerRoof = headZ == null ? null : headZ;
  const measuredRoof = bodyBBox ? bodyBBox.max[2] : null;
  const roofZ = measuredRoof != null ? measuredRoof : (minInnerRoof != null ? minInnerRoof + skin + 0.02 : 1.25);
  const floorClear = bodyBBox ? bodyBBox.min[2] : Math.max(0.08, dc.floorZ - skin);
  const noseX = bodyBBox ? bodyBBox.min[0] : Math.min(frontAxleX - 0.85, ...(pkg.components || []).filter((c) => c.id === "RADIATOR").map((c) => (centers[c.node]?.x ?? frontAxleX) - (c.half?.[0] ?? 0.1) - 0.15));
  const tailX = bodyBBox ? bodyBBox.max[0] : rearAxleX + 0.85;
  const halfWidth = bodyBBox ? (bodyBBox.max[1] - bodyBBox.min[1]) / 2 : Math.min(1.95 / 2, track / 2 + tyreW / 2 + 0.08);
  const beltZ = shoulderZ(driver) != null ? shoulderZ(driver) : dc.floorZ + dc.h30 + 0.45;
  const frontDoor = openings?.doors?.find((d) => d.id === "door-front-L");
  const rearDoor = openings?.doors?.find((d) => d.id === "door-rear-L");
  const aPillarBaseX = frontDoor ? frontDoor.outline[frontDoor.outline.length - 1][0] : scene.sgRPFront.x;
  const bPillarX = frontDoor ? Math.max(...frontDoor.outline.map((p) => p[0])) : (scene.sgRPFront.x + scene.sgRPRear.x) / 2;
  const cPillarX = rearDoor ? Math.max(...rearDoor.outline.map((p) => p[0])) : scene.sgRPRear.x + 0.35;
  const rad = pkg.components?.find((c) => c.node === "RADIATOR");
  const radP = rad && centers[rad.node];
  const driverHead = driver?.landmarks?.headTop;
  const rearHead = rearM?.landmarks?.headTop;

  const spec = resolveSpec({
    noseX, tailX, frontAxleX, rearAxleX, halfWidth, roofZ,
    floorZ: floorClear, beltZ, bPillarX, cPillarX, aPillarBaseX,
    track, tyreRadius: tyreR, tyreHalfWidth: tyreW / 2,
    tyreCenterZ: centers.TIRE_FL?.z ?? tyreR,
    noseTipZ: Math.max(0.22, floorClear + 0.1),
    kammRatio: 0.45,
    ahpX: scene.ahp.x,
    headX: driverHead?.[0],
    rearHeadX: rearHead?.[0],
    roofHoldX: rearAxleX,
    archGap: 0.032,
    grilleHalfY: rad ? Math.min(rad.half[1], halfWidth * 0.62) : halfWidth * 0.32,
    grilleHalfZ: 0.055,
    grilleZ: Math.max(floorClear + 0.12, (radP?.z ?? 0.32) - (rad?.half?.[2] || 0.2) * 0.45),
  });
  const loft = loftBody(spec);
  const cowlX = spec.cowlX;
  const headerX = spec.headerX;

  const components = [];
  const heightProvenance = measuredRoof != null
    ? prov("calculated", "cad.body extents", "overall height is the kernel solid's max z; the viewer loft is fitted to that box and is not the B-rep")
    : prov("calculated", "M95 head top + skin offset", "no kernel solid yet; the roof is the height the 95th-percentile male head needs, plus the skin offset");

  components.push(part({
    id: "BODY_SHELL", name: "Body loft", group: "exterior", role: "body",
    placement: { x: (noseX + tailX) / 2, y: 0, z: (spec.floorZ + roofZ) / 2 },
    half: [(tailX - noseX) / 2, halfWidth, (roofZ - spec.floorZ) / 2],
    geometry: { ...envelope("parametric loft tessellated from the solved stations. A viewing surface, not a kernel solid and not a manufactured skin. When cad.body has run, the loft's overall size is that solid's bounding box; the meshes are still not the same."), representation: "loft", mesh: "surface" },
    parameters: [
      param("wheelbase", "Wheelbase", rearAxleX - frontAxleX, "m", prov("calculated", "rearAxleX − frontAxleX")),
      param("overallLength", "Overall length", tailX - noseX, "m", heightProvenance.state === "calculated" && measuredRoof ? prov("calculated", "cad.body bbox") : prov("calculated", "nose and tail stations")),
      param("overallWidth", "Overall width", halfWidth * 2, "m", measuredRoof ? prov("calculated", "cad.body bbox") : prov("calculated", "track + tyre + fender, capped at the body maxWidth design choice 1.95 m")),
      param("overallHeight", "Overall height", roofZ, "m", { ...heightProvenance, note: `${heightProvenance.note || ""} The 95th-percentile male head sets this roof (about ${(roofZ).toFixed(2)} m). It stays at that height through the rear head, so the fastback is only the rear overhang.`.trim() }),
      param("windshieldRake", "Windshield rake from vertical", spec.rakeDeg, "deg", prov("calculated", "rise from the low cowl to the header over tan(60°); pulled forward only if the header would pass the driver head")),
      param("groundClearance", "Ground clearance", spec.floorZ, "m", measuredRoof ? prov("calculated", "cad.body min z") : prov("calculated", "floorZ minus the skin offset, floored at 80 mm")),
      param("beltZ", "Beltline", beltZ, "m", prov("calculated", "M95 acromion height (ANSUR II sitting)", "greenhouse base")),
      param("kammRatio", "Kamm area ratio", 0.45, "1", prov("assumed", "CAD_BODY_DEFAULTS kammAreaRatio", "design choice, not Kamm's 50 percent figure")),
    ],
    relationships: [
      { kind: "constrained-by", target: "SEAT_1", note: "roof and beltline clear the driver H-point and the M95 head" },
      { kind: "aligned-to", target: "TIRE_FL", note: "fender flares sit over the tyre centreline" },
    ],
    explode: { axis: "z", sign: 1, rank: 3 },
  }));

  // Glass is a material group of the same loft, listed so it can be selected.
  components.push(part({
    id: "GLAZING", name: "Greenhouse glass", group: "exterior", role: "glass",
    placement: { x: (cowlX + cPillarX) / 2, y: 0, z: (beltZ + roofZ) / 2 },
    half: [(cPillarX - cowlX) / 2, halfWidth * 0.85, (roofZ - beltZ) / 2],
    geometry: { ...envelope("glass patches bounded by the cowl, header, belt and roof-rail splines, offset 4 mm outboard of the skin. Not an optical solid."), representation: "dlo-patch" },
    parameters: [
      param("beltZ", "Beltline", beltZ, "m", prov("calculated", "M95 shoulder height")),
      param("cowlX", "Cowl", cowlX, "m", prov("calculated", "behind the front arch, near the accelerator heel")),
      param("headerX", "Header", headerX, "m", prov("calculated", "cowl plus the run of a 60° windshield, kept ahead of the driver head")),
      param("rake", "Rake from vertical", spec.rakeDeg, "deg", prov("calculated", "atan(run / rise)")),
    ],
    relationships: [
      { kind: "mounted-to", target: "BODY_SHELL", note: "same loft; glass is the greenhouse region" },
      { kind: "constrained-by", target: "EYELLIPSE_DRIVER", note: "windshield starts at the cowl ahead of the eyellipse" },
    ],
    explode: { axis: "z", sign: 1, rank: 4 },
  }));

  // Wheels, one mesh instanced.
  const tyreLib = getComponent(nodes.get("TIRE_FL")?.props?.component || "");
  const rimIn = tyreLib?.dimensions?.rimDiameterIn || null;
  const rimM = rimIn ? rimIn * IN : (tyreR * 2 - tyreW * 0.8);
  const rimRange = tyreLib?.dimensions?.rimWidthRangeIn;
  const rimWidthM = Array.isArray(rimRange) && rimRange.length === 2 ? ((rimRange[0] + rimRange[1]) / 2) * IN : tyreW * 0.7;
  const wheel = wheelMesh({ overallDiameterM: tyreR * 2, sectionWidthM: tyreW, rimDiameterM: rimM, rimWidthM, spokes: 10 });
  for (const t of pkg.tyres || []) {
    const p = centers[t.node];
    if (!p) continue;
    const side = p.y < 0 ? -1 : 1;
    components.push(part({
      id: t.node, name: t.node, group: "wheels", role: "wheel",
      placement: { x: p.x, y: p.y, z: p.z },
      half: [tyreR, tyreW / 2, tyreR],
      geometry: { ...envelope("tyre from the library overall diameter and section width; rim diameter from the published rim; 10 spokes are an assumed visual, not a sourced wheel design"), representation: "instance" },
      parameters: [
        param("diameter", "Overall diameter", tyreR * 2, "m", prov("sourced", t.dims?.source || "component library")),
        param("section", "Section width", tyreW, "m", prov("sourced", t.dims?.source || "component library")),
        param("rim", "Rim diameter", rimM, "m", rimIn ? prov("sourced", "library rimDiameterIn") : prov("estimated", "overall diameter minus an 0.40 aspect sidewall")),
        param("rimWidth", "Rim width", rimWidthM, "m", Array.isArray(rimRange) ? prov("estimated", "midpoint of the published rim-width range; the design does not select a width inside it") : prov("estimated", "0.70 of the section width")),
        param("spokes", "Spoke count", 10, "1", prov("assumed", "no spoke count is published for the wheel")),
      ],
      relationships: [
        { kind: "aligned-to", target: Math.abs(p.x - frontAxleX) <= Math.abs(p.x - rearAxleX) ? "AXLE_FRONT" : "AXLE_REAR", note: "centre on the axle, z = rolling radius" },
      ],
      explode: { axis: "y", sign: side, rank: 2 },
      instanceOf: "WHEEL",
    }));
  }
  components.push(part({
    id: "AXLE_FRONT", name: "Front axle line", group: "wheels", role: "axle",
    placement: { x: frontAxleX, y: 0, z: tyreR }, half: [0.01, track / 2, 0.01],
    geometry: envelope("construction axis, not a part"),
    parameters: [param("x", "Front axle x", frontAxleX, "m", prov("sourced", "design vehicle.frontAxleX"))],
    relationships: [], explode: { axis: "z", sign: 1, rank: 0 },
  }));
  components.push(part({
    id: "AXLE_REAR", name: "Rear axle line", group: "wheels", role: "axle",
    placement: { x: rearAxleX, y: 0, z: tyreR }, half: [0.01, track / 2, 0.01],
    geometry: envelope("construction axis, not a part"),
    parameters: [param("x", "Rear axle x", rearAxleX, "m", prov("sourced", "design vehicle.rearAxleX"))],
    relationships: [], explode: { axis: "z", sign: 1, rank: 0 },
  }));

  // Powertrain envelopes from the layout boxes.
  for (const c of pkg.components || []) {
    const p = centers[c.node];
    if (!p) continue;
    const vol = 8 * (c.half?.[0] || 0) * (c.half?.[1] || 0) * (c.half?.[2] || 0);
    components.push(part({
      id: c.id, name: c.id, group: "powertrain", role: c.node === "RADIATOR" ? "cooling" : "powertrain",
      placement: { x: p.x, y: p.y, z: p.z }, half: c.half,
      geometry: envelope(`bounding box of the library overall dimensions (${c.dims?.state || "unlabelled"}). Not a manufactured solid.`),
      parameters: [
        param("volume", "Envelope volume", vol * 1000, "L", prov("calculated", "8 × half-extents of the library box")),
        ...(c.node === "ENGINE" && Number.isFinite(powerW) ? [param("requiredPower", "Required power at the brief speed", powerW, "W", prov("calculated", "vehicle.required-power", "aero drag plus rolling resistance at the required top speed"))] : []),
      ],
      relationships: c.node === "RADIATOR"
        ? [{ kind: "constrained-by", target: "ENGINE", note: "ahead of the engine by the fan gap; face area is the library core, not resized to a heat-rejection model" }]
        : [{ kind: "mounted-to", target: "BODY_SHELL", note: c.placement || "layout placement" }],
      explode: { axis: "x", sign: -1, rank: c.node === "FUEL_CELL" ? 2 : 1 },
    }));
  }

  // Seats and manikins (M95 and F5 only, so the document stays small).
  const seatKeys = ["M95", "F5"].filter((k) => scene.scenarios[k]);
  for (const key of seatKeys) {
    for (const o of scene.scenarios[key]) {
      if (key === "F5" && o.seat !== "SEAT_1" && o.seat !== "SEAT_3") continue; // driver + one rear for the small occupant; M95 in every seat
      const id = `OCC_${o.seat}_${key}`;
      const h = o.landmarks.hPoint;
      components.push(part({
        id, name: `${key} in ${o.seat}`, group: "interior", role: "occupant",
        placement: { x: h[0], y: o.landmarks.y, z: h[1] },
        half: [0.25, (key === "M95" ? m95 : f5).hipBreadthSitting / 2, 0.45],
        geometry: envelope("ANSUR II percentile as seated boxes (J826 H-point, torso line, two-link leg). Screening manikin, not a human model."),
        parameters: [
          param("hPointX", "H-point x", h[0], "m", prov("calculated", key === "M95" || o.seat.endsWith("1") || o.seat.endsWith("2") ? "UMTRI fore-aft of the PRP, clamped to the seat track" : "rear SgRP")),
          param("hPointZ", "H-point z", h[1], "m", prov("calculated", "floor + H30 (front) or floor + H31 (rear)")),
          param("torsoDeg", "A40 torso angle", o.seat.startsWith("SEAT_3") || o.seat.startsWith("SEAT_4") ? dc.rearTorsoDeg : dc.torsoDeg, "deg", prov("assumed", "layout design choice, inside the J1100 Class A range 5–40 deg")),
        ],
        relationships: [{ kind: "mounted-to", target: o.seat, note: "H-point on the seat" }],
        explode: { axis: "z", sign: 1, rank: 2 },
      }));
    }
  }
  for (const seatId of ["SEAT_1", "SEAT_2", "SEAT_3", "SEAT_4"]) {
    const front = seatId === "SEAT_1" || seatId === "SEAT_2";
    const y = front ? (seatId === "SEAT_1" ? -dc.frontSeatY : dc.frontSeatY) : (seatId === "SEAT_3" ? -dc.rearSeatY : dc.rearSeatY);
    const x = front ? scene.sgRPFront.x : scene.sgRPRear.x;
    const z = front ? scene.sgRPFront.z : scene.sgRPRear.z;
    components.push(part({
      id: seatId, name: seatId, group: "interior", role: "seat",
      placement: { x, y, z: (z + dc.floorZ) / 2 },
      half: [0.28, 0.22, (z - dc.floorZ) / 2],
      geometry: envelope("cushion and back from the seat's published max height, width and cushion depth (seatBoxes). Hardware is not in the published dimensions."),
      parameters: [
        param("h30", front ? "H30" : "H31", front ? dc.h30 : dc.rearH31, "m", prov("assumed", "layout design choice", front ? "J1100 H30, Class A 127–405 mm" : "J1100 H31")),
      ],
      relationships: [{ kind: "mounted-to", target: "BODY_SHELL", note: "cushion on the cabin floor (floorZ); rail travel is the layout seat-track design choice" }],
      explode: { axis: "z", sign: 1, rank: 2 },
    }));
  }

  // Steering wheel and column.
  const sw = scene.sw;
  components.push(part({
    id: "STEERING_WHEEL", name: "Steering wheel", group: "interior", role: "control",
    placement: { x: sw.x, y: -dc.frontSeatY, z: sw.z, pitchDeg: dc.steeringWheelTiltDeg },
    half: [dc.steeringWheelDepth / 2, dc.steeringWheelDiameter / 2, dc.steeringWheelDiameter / 2],
    geometry: envelope("disc of the design-choice diameter (J1100 W9) and tilt. Not a sourced wheel."),
    parameters: [
      param("diameter", "W9 diameter", dc.steeringWheelDiameter, "m", prov("assumed", "layout design choice", "below the J1100 Class A maximum of 450 mm")),
      param("H17", "H17", dc.steeringWheelH17, "m", prov("assumed", "layout design choice", "AHP to wheel centre, vertical")),
      param("L6", "L6", dc.steeringWheelL6, "m", prov("assumed", "layout design choice", "PRP to wheel centre, fore-aft")),
      param("tilt", "Column tilt", dc.steeringWheelTiltDeg, "deg", prov("assumed", "wheel plane from vertical, top toward the driver")),
    ],
    relationships: [{ kind: "constrained-by", target: "OCC_SEAT_1_M95", note: "placed from the driver H-point by L6 and H17" }],
    explode: { axis: "x", sign: -1, rank: 2 },
  }));
  const columnLen = Math.hypot(sw.x - (pkg.firewallX || sw.x - 0.4), sw.z - (dc.floorZ + 0.35));
  components.push(part({
    id: "STEERING_COLUMN", name: "Steering column", group: "interior", role: "control",
    placement: { x: ((pkg.firewallX || sw.x - 0.4) + sw.x) / 2, y: -dc.frontSeatY, z: (sw.z + dc.floorZ + 0.35) / 2 },
    half: [columnLen / 2, 0.02, 0.02],
    geometry: envelope("cylinder from the wheel centre to the firewall pass-through height. Column angle is the line between those points."),
    parameters: [param("length", "Column length", columnLen, "m", prov("calculated", "wheel centre to the firewall station"))],
    relationships: [
      { kind: "mounted-to", target: "STEERING_WHEEL", note: "upper end at the wheel centre" },
      { kind: "constrained-by", target: "OCC_SEAT_1_F5", note: "J1100 locates the wheel; SAE J287 hand reach is not licensed and is not claimed" },
    ],
    explode: { axis: "x", sign: -1, rank: 2 },
  }));

  // Pedals. Pad size is an allowance: no pedal is in the library.
  const pedal = (id, name, y, note) => part({
    id, name, group: "interior", role: "control",
    placement: { x: scene.bof.x, y, z: scene.bof.z },
    half: [0.02, 0.03, 0.04],
    geometry: envelope("pad allowance 40 × 60 × 80 mm. No pedal is selected in the library; the heel and ball-of-foot are J1100 AHP and BOF."),
    parameters: [
      param("bof", "Ball of foot", 0.203, "m", prov("sourced", "SAE J1100 BOF, 203 mm from the accelerator heel point")),
      param("footAngle", "Foot angle", dc.footAngleDeg, "deg", prov("assumed", "layout design choice")),
    ],
    relationships: [{ kind: "constrained-by", target: "OCC_SEAT_1_F5", note }],
    explode: { axis: "x", sign: -1, rank: 1 },
  });
  components.push(pedal("PEDAL_ACCEL", "Accelerator", -dc.frontSeatY + 0.06, "on the AHP / BOF line"));
  components.push(pedal("PEDAL_BRAKE", "Brake", -dc.frontSeatY - 0.02, "inboard of the accelerator; lateral offset is an allowance"));
  components.push(pedal("PEDAL_CLUTCH", "Clutch", -dc.frontSeatY - 0.12, "the gearbox is a manual TKX, so a clutch pedal is placed. Lateral offset is an allowance."));

  // Gear selector from the tub opening when the tub designed one.
  const gear = openings?.service?.find((s) => s.id === "gear-lever");
  const gx = gear ? (gear.x0 + gear.x1) / 2 : scene.sgRPFront.x - 0.15;
  const gz = dc.floorZ + 0.28;
  components.push(part({
    id: "GEAR_SELECTOR", name: "Gear selector", group: "interior", role: "control",
    placement: { x: gx, y: 0, z: gz },
    half: [0.04, 0.04, 0.12],
    geometry: envelope(gear ? "placed on the tub's gear-lever opening (a design choice; the TKX shifter dimension is not sourced)" : "no tub opening; placed ahead of the driver H-point on the tunnel centreline (assumed)"),
    parameters: [param("x", "Selector x", gx, "m", gear ? prov("assumed", "OPENING_CHOICES.gearLeverOpening") : prov("assumed", "150 mm ahead of the front SgRP"))],
    relationships: [{ kind: "mounted-to", target: "BODY_SHELL", note: "through the tunnel top" }],
    explode: { axis: "z", sign: 1, rank: 2 },
  }));

  // Eyellipse.
  const eye = j941Envelope({
    L1mm: scene.prpX * 1000, L6mm: dc.steeringWheelL6 * 1000, H30mm: dc.h30 * 1000,
    H8mm: scene.ahp.z * 1000, W20mm: -dc.frontSeatY * 1000, clutch: true,
  });
  components.push(part({
    id: "EYELLIPSE_DRIVER", name: "Driver eyellipse", group: "interior", role: "vision",
    placement: { x: eye.center[0], y: eye.center[1], z: eye.center[2], pitchDeg: eye.betaDeg },
    half: [eye.semiAxesM.x, eye.semiAxesM.y, eye.semiAxesM.z],
    geometry: envelope("SAE J941 95th-percentile tangent-cutoff eyellipse (one eye axis lengths). Centroid algebra is transcribed from the public PDF and labelled as such."),
    parameters: [
      param("Xc", "Centroid x", eye.center[0], "m", prov("sourced", J941_SOURCE.url, eye.centroid.provenance.transcription)),
      param("Zc", "Centroid z", eye.center[2], "m", prov("sourced", J941_SOURCE.url, "Zc = H8 + H30 + 638 mm")),
      param("beta", "Side-view tilt", 12, "deg", prov("sourced", J941_SOURCE.url, "Eq. 1")),
    ],
    relationships: [{ kind: "constrained-by", target: "OCC_SEAT_1_M95", note: "located from PRP, L6, H30 and AHP, not from the manikin eye point" }],
    explode: { axis: "z", sign: 1, rank: 3 },
  }));

  // Door openings and pillars from the tub, when it designed them.
  if (openings?.doors) {
    for (const d of openings.doors) {
      const xs = d.outline.map((p) => p[0]), zs = d.outline.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const y = d.side === "L" ? -halfWidth : halfWidth;
      components.push(part({
        id: d.id, name: d.name, group: "exterior", role: "opening",
        placement: { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2 },
        half: [(x1 - x0) / 2, 0.01, (z1 - z0) / 2],
        geometry: envelope("door aperture outline from the tub (car-openings.js). The skin is not trimmed; this is the cutline the panels follow."),
        parameters: [
          param("height", "Opening height", d.heightM, "m", prov("calculated", "outline max z − min z")),
          param("length", "Opening length", d.maxLengthM, "m", prov("calculated", "outline max x − min x")),
          param("H11", "Entrance height above SgRP", z1 - (d.id.includes("front") ? scene.sgRPFront.z : scene.sgRPRear.z), "m", prov("calculated", "J1100 H11 is SgRP to the upper trimmed opening; compared here with the aperture top, which is structure not trim")),
        ],
        relationships: [{ kind: "constrained-by", target: d.id.includes("front") ? "SEAT_1" : "SEAT_3", note: "hinge line is the forward edge of the aperture" }],
        explode: { axis: "y", sign: d.side === "L" ? -1 : 1, rank: 3 },
        mesh: { outline: d.outline, side: d.side },
      }));
    }
  }

  // Luggage and spare.
  const rearBack = rearM ? (rearM.landmarks.hPoint[0] + 0.25) : scene.sgRPRear.x + 0.3;
  const trunkLen = Math.max(0, tailX - 0.08 - rearBack);
  const trunkVol = trunkLen * (halfWidth * 1.4) * Math.max(0, roofZ * 0.45 - dc.floorZ);
  components.push(part({
    id: "TRUNK", name: "Trunk volume", group: "storage", role: "volume",
    placement: { x: rearBack + trunkLen / 2, y: 0, z: dc.floorZ + Math.max(0.05, (roofZ * 0.45 - dc.floorZ) / 2) },
    half: [trunkLen / 2, halfWidth * 0.7, Math.max(0.05, (roofZ * 0.45 - dc.floorZ) / 2)],
    geometry: envelope("geometric box behind the rear seat back. Not an SAE J1100 luggage-block volume."),
    parameters: [param("volume", "Volume", trunkVol * 1000, "L", prov("calculated", "length behind the rear back × 1.4 × half-width × height under the fastback"))],
    relationships: [{ kind: "clears", target: "SEAT_3", note: "starts behind the rear seat back" }],
    explode: { axis: "x", sign: 1, rank: 2 },
  }));
  const firewall = pkg.firewallX || cowlX;
  const frunkLen = Math.max(0, firewall - 0.05 - (noseX + 0.25));
  const frunkVol = frunkLen * halfWidth * 0.35;
  components.push(part({
    id: "FRUNK", name: "Frunk volume", group: "storage", role: "volume",
    placement: { x: noseX + 0.25 + frunkLen / 2, y: 0, z: dc.floorZ + 0.2 },
    half: [Math.max(frunkLen, 0.01) / 2, halfWidth * 0.5, 0.12],
    geometry: envelope("space ahead of the firewall and behind the nose structure. Zero when the powertrain fills it."),
    parameters: [param("volume", "Volume", Math.max(0, frunkVol) * 1000, "L", prov("calculated", "firewall − nose structure"))],
    relationships: [{ kind: "clears", target: "ENGINE", note: "does not include the engine bay" }],
    explode: { axis: "x", sign: -1, rank: 2 },
  }));
  components.push(part({
    id: "SPARE", name: "Spare tire", group: "storage", role: "spare",
    placement: { x: rearBack + trunkLen / 2, y: 0, z: dc.floorZ + 0.05 },
    half: [0, 0, 0],
    geometry: envelope("not specified by the design, so not placed"),
    parameters: [param("specified", "Specified", 0, "1", prov("assumed", "the brief does not ask for a spare"))],
    relationships: [],
    explode: { axis: "z", sign: 1, rank: 0 },
  }));

  for (const d of loft.details) {
    const explode = d.role === "mirror" || d.role === "handle"
      ? { axis: "y", sign: d.placement.y < 0 ? -1 : 1, rank: 4 }
      : { axis: "x", sign: d.id.startsWith("TAIL") ? 1 : -1, rank: 4 };
    components.push(part({
      id: d.id, name: d.name, group: "exterior", role: d.role,
      placement: d.placement, half: d.half,
      geometry: envelope(d.note),
      parameters: [
        param("x", "Station", d.placement.x, "m", prov("calculated", "on the skin spline")),
        param("z", "Height", d.placement.z, "m", prov("calculated", "on the skin spline")),
        ...(d.id === "GRILLE" ? [param("width", "Opening width", d.half[1] * 2, "m", rad ? prov("calculated", "radiator face width, clipped to the bumper") : prov("estimated", "no radiator in the layout"))] : []),
      ],
      relationships: d.id === "GRILLE" && rad
        ? [{ kind: "aligned-to", target: "RADIATOR", note: "width follows the radiator face; the slot is recessed in the bumper" }]
        : [{ kind: "mounted-to", target: "BODY_SHELL", note: "on the skin, offset a few millimetres outboard" }],
      explode,
      mesh: d.mesh,
    }));
  }

  // Tub members that carry a box, capped so the document stays usable.
  let tubCount = 0;
  for (const n of ir.nodes) {
    const box = n.props?.tubBox;
    if (!box?.center || !box?.half) continue;
    if (tubCount++ > 40) break;
    components.push(part({
      id: n.id, name: n.name || n.id, group: "chassis", role: "frame",
      placement: { x: box.center[0], y: box.center[1], z: box.center[2] },
      half: box.half,
      geometry: envelope("tub member box from the structural layout. The frame solver uses the same centreline model."),
      parameters: [param("section", "Section", n.geometry?.shape || "box", "1", prov("assumed", "tub design choice"))],
      relationships: [{ kind: "mounted-to", target: "BODY_SHELL", note: "inside the loft; the skin is not structural" }],
      explode: { axis: "z", sign: -1, rank: 1 },
    }));
  }

  const checks = fitChecks({ spec, scene, components, pkg, roofZ, minInnerRoof, measuredRoof, frontAxleX, rearAxleX, tyreR, tyreW, track, driver, driverF5, rearM, openings, powerW });
  const standards = standardsTable({ scene, dc, eye, roofZ, spec });

  const doc = {
    schema: ASSEMBLY_SCHEMA,
    coordinateSystem: { ...COORDINATE_SYSTEM, frontAxleX: r4(frontAxleX) },
    verification: {
      statement: measuredRoof
        ? "Geometric assembly. A shape that looks finished has not been manufactured or tested. Kernel solids are marked solid; every other part is a dimensioned envelope. The loft is fitted to the kernel bounding box and is not that solid. Each check is pass, warn or fail."
        : "Geometric assembly. A shape that looks finished has not been manufactured or tested. The loft's length, width and height are the packaging stations (head clearance, track, overhangs), not a kernel solid. Each check is pass, warn or fail.",
      verified: ["library component boxes", "J1100 dimensions from the H-points", "J941 eyellipse centroid", "fit checks listed here"],
      geometricOnly: ["viewer body loft", "spoke count", "headlamp lenses", "pedal pad size", "caliper envelope", "trunk and frunk boxes"],
    },
    surface: { spec: loft.spec, mesh: (({ details: _d, spec: _s, ...mesh }) => mesh)(loft) },
    wheel,
    components,
    checks,
    standards,
    hierarchy: ["exterior", "wheels", "chassis", "powertrain", "interior", "storage"],
  };
  const valid = validateAssembly(doc);
  if (!valid.ok) doc.validationErrors = valid.errors;
  return doc;
}

function standardsTable({ scene, dc, eye, roofZ, spec }) {
  const J = "SAE J1100 (2001)";
  return [
    { id: "H30", valueMm: mm(dc.h30), unit: "mm", standard: J, section: "6.1.5", state: "assumed", note: "layout design choice, Class A 127–405" },
    { id: "L53", valueMm: mm(scene.sgRPFront.x - scene.ahp.x), unit: "mm", standard: J, section: "6.1.29", state: "calculated", note: "SgRP-front x − AHP x" },
    { id: "L40", valueMm: dc.torsoDeg, unit: "deg", standard: J, section: "6.1.25", state: "assumed", note: "torso angle, Class A 5–40 deg" },
    { id: "H61-roof", valueMm: mm(roofZ - scene.sgRPFront.z), unit: "mm", standard: J, section: "6.1.12", state: "calculated", note: "vertical roof above SgRP; effective H61 adds 102 mm along 8 deg and needs the trimmed headlining, so this is the structural clearance not the J1100 effective number" },
    { id: "BOF", valueMm: 203, unit: "mm", standard: J, section: "3.16.2", state: "sourced", note: "ball of foot from AHP" },
    { id: "W9", valueMm: mm(dc.steeringWheelDiameter), unit: "mm", standard: J, section: "W9", state: "assumed", note: "steering wheel diameter" },
    { id: "H17", valueMm: mm(dc.steeringWheelH17), unit: "mm", standard: J, section: "6.6.4", state: "assumed", note: "AHP to wheel centre, vertical" },
    { id: "eyellipse-X", valueMm: J941_AXES_SAFE.x, unit: "mm", standard: "SAE J941 (2010) Table 2", section: "95th, track > 133 mm", state: "sourced", note: "axis length" },
    { id: "eyellipse-centroid-z", valueMm: mm(eye.center[2]), unit: "mm", standard: "SAE J941 (2010) Eq. 4", section: "4.3", state: "sourced", note: "transcribed centroid" },
    { id: "belt", valueMm: mm(spec.beltZ), unit: "mm", standard: "ANSUR II acromion, sitting", section: "M95", state: "calculated", note: "beltline" },
  ];
}
const J941_AXES_SAFE = { x: 206.4 };

function fitChecks(ctx) {
  const checks = [];
  const add = (id, status, detail, extra = {}) => checks.push({ id, status, detail, ...extra });

  // Head vs roof.
  for (const [label, occ] of [["M95", ctx.driver], ["F5", ctx.driverF5]]) {
    if (!occ) { add(`head-${label}`, "warn", `${label} was not seated, so head clearance is not checked`); continue; }
    const top = occ.landmarks.headTop[1];
    const hx = occ.landmarks.headTop[0];
    const local = ctx.spec ? crownAt(ctx.spec, hx) : ctx.roofZ;
    const gap = local - 0.004 - top;
    const minRoof = r4(top + 0.004);
    add(`head-${label}`, gap >= 0 ? "pass" : "fail",
      `${label} head top at ${mm(top)} mm (x ${mm(hx)} mm), roof at that station ${mm(local)} mm, inner gap ${mm(gap)} mm`,
      { valueM: r4(gap), minimumOverallHeightM: minRoof, occupant: label });
  }
  if (ctx.rearM?.landmarks?.headTop) {
    const top = ctx.rearM.landmarks.headTop[1];
    const hx = ctx.rearM.landmarks.headTop[0];
    const local = ctx.spec ? crownAt(ctx.spec, hx) : ctx.roofZ;
    const gap = local - 0.004 - top;
    add("head-M95-rear", gap >= 0 ? "pass" : "fail",
      `rear M95 head top at ${mm(top)} mm (x ${mm(hx)} mm), roof at that station ${mm(local)} mm, inner gap ${mm(gap)} mm`,
      { valueM: r4(gap), minimumOverallHeightM: r4(top + 0.004) });
  }
  if (ctx.measuredRoof != null && ctx.minInnerRoof != null && ctx.measuredRoof < ctx.minInnerRoof) {
    add("roof-vs-solved-height", "fail",
      `the kernel body's overall height ${mm(ctx.measuredRoof)} mm is below the M95 head top ${mm(ctx.minInnerRoof)} mm. Minimum overall height ${mm(ctx.minInnerRoof + 0.004)} mm.`,
      { minimumOverallHeightM: r4(ctx.minInnerRoof + 0.004) });
  }

  // Floor: heel on the floor.
  if (ctx.driver) {
    const heel = ctx.driver.landmarks.heel[1];
    const gap = heel - ctx.scene.floorZ;
    add("heel-floor", gap >= -1e-4 ? "pass" : "fail", `driver heel z ${mm(heel)} mm, floor ${mm(ctx.scene.floorZ)} mm`, { valueM: r4(gap) });
  }

  // Rear leg reach: if the shin posture cannot place the knee, the wheelbase is short.
  if (ctx.rearM && ctx.rearM.leg && ctx.rearM.leg.reachable === false) {
    const need = (ctx.rearM.dims?.thighLink || 0.45) - Math.abs((ctx.scene.floorZ + (ctx.rearM.dims?.calfLink || 0.4) + (ctx.rearM.dims?.lateralMalleolusHeight || 0.07)) - ctx.rearM.landmarks.hPoint[1]);
    const minWb = ctx.rearAxleX - ctx.frontAxleX + Math.max(0, need);
    add("rear-leg", "fail", `M95 rear leg does not reach in the vertical-shin posture. Minimum wheelbase about ${mm(minWb)} mm.`, { minimumWheelbaseM: r4(minWb) });
  } else if (ctx.rearM) {
    add("rear-leg", "pass", "M95 rear occupant reaches the floor in the vertical-shin posture", { wheelbaseM: r4(ctx.rearAxleX - ctx.frontAxleX) });
  }

  // Four seats: both rows present.
  const seats = ["SEAT_1", "SEAT_2", "SEAT_3", "SEAT_4"].filter((id) => ctx.components.some((c) => c.id === id));
  add("four-seats", seats.length === 4 ? "pass" : "fail", `${seats.length} seat positions placed`, { seats });

  // Powertrain vs cabin: engine rear face vs firewall / AHP.
  const engine = ctx.components.find((c) => c.id === "ENGINE");
  if (engine?.half) {
    const engineRear = engine.placement.x + engine.half[0];
    const wall = ctx.pkg.firewallX ?? ctx.scene.ahp.x;
    const gap = wall - engineRear;
    add("powertrain-cabin", gap >= 0 ? "pass" : "fail", `engine rear face ${mm(engineRear)} mm, firewall ${mm(wall)} mm, gap ${mm(gap)} mm`, { valueM: r4(gap) });
  } else add("powertrain-cabin", "warn", "no engine envelope, powertrain-to-cabin not checked");

  // Wheels vs footwell at full steer.
  const lock = ctx.pkg.steeringLock?.innerDeg;
  const foot = ctx.driverF5 || ctx.driver;
  if (lock && foot && ctx.scene) {
    const footBox = foot.boxes?.find((b) => b.part === "foot");
    const tyre = ctx.pkg.tyres?.find((t) => t.id === "TIRE_FL");
    const p = tyre && ctx.components.find((c) => c.id === "TIRE_FL")?.placement;
    if (footBox && p) {
      const th = (lock * Math.PI) / 180;
      let ext = 0, lat = 0;
      const r = ctx.tyreR, hw = ctx.tyreW / 2;
      for (let i = 0; i <= 16; i++) {
        const a = th * (i / 16);
        ext = Math.max(ext, r * Math.abs(Math.cos(a)) + hw * Math.abs(Math.sin(a)));
        lat = Math.max(lat, r * Math.abs(Math.sin(a)) + hw * Math.abs(Math.cos(a)));
      }
      const sweep = aabb({ id: "steer", min: [p.x - ext, p.y - lat, p.z - r], max: [p.x + ext, p.y + lat, p.z + r] });
      const gap = separation(sweep, footBox).separation;
      add("wheel-footwell", gap >= 0 ? "pass" : "fail",
        `front tyre swept ±${lock.toFixed(1)} deg vs the driver foot, gap ${mm(gap)} mm (separating-axis lower bound)`,
        { valueM: r4(gap), steerDeg: lock });
    } else add("wheel-footwell", "warn", "foot or front tyre missing, steer sweep not checked");
  } else add("wheel-footwell", "warn", "no steering lock, steer sweep not checked");

  // Door ingress uses the skin cut, which is the roof rail solved with the roof.
  if (!ctx.spec) add("ingress", "warn", "no body spec, door aperture not checked");
  else if (!ctx.driver) add("ingress", "warn", "driver head missing");
  else {
    const front = ctx.openings?.doors?.find((d) => d.id === "door-front-L");
    const x0 = front ? Math.min(...front.outline.map((q) => q[0])) : ctx.spec.cowlX;
    const x1 = front ? Math.max(...front.outline.map((q) => q[0])) : ctx.spec.bPillarX;
    const top = skinApertureTop(ctx.spec, x0, x1);
    const need = ctx.driver.landmarks.headTop[1];
    const gap = top - need;
    const tub = front ? Math.max(...front.outline.map((q) => q[1])) : null;
    const tubNote = tub == null ? "" : ` Tub outline top is ${mm(tub)} mm; the skin cut is the roof rail, not that outline.`;
    const conflict = gap < 0 ? " The roof rail is below the head, so this is a packaging conflict at this height." : "";
    add("ingress", gap >= 0 ? "pass" : "fail",
      `skin door aperture (roof rail) ${mm(top)} mm, M95 head top ${mm(need)} mm, gap ${mm(gap)} mm.${tubNote}${conflict} J1100 H11 is this class of dimension; no minimum entrance height is published, so the threshold is the head itself.`,
      { valueM: r4(gap), minimumApertureTopM: r4(need) });
  }

  const EXTERIOR = new Set(["body", "glass", "wheel", "lamp", "intake", "opening", "axle", "mirror", "handle"]);
  const outside = [];
  for (const c of ctx.components) {
    if (EXTERIOR.has(c.role) || c.id === "SPARE") continue;
    if (!c.half || c.half.every((h) => h === 0)) continue;
    if (!boxInsideEnvelope(ctx.spec, c.placement, c.half, 0.05)) outside.push(c.id);
  }
  if (!ctx.spec) add("containment", "warn", "no body spec, containment not checked");
  else if (outside.length) add("containment", "fail",
    `${outside.length} non-exterior part${outside.length === 1 ? "" : "s"} sit outside the body envelope: ${outside.slice(0, 12).join(", ")}${outside.length > 12 ? "…" : ""}. They are a packaging failure and are not drawn in Studio.`,
    { outside });
  else add("containment", "pass", "every non-exterior bounding box is inside the body envelope");

  // Pillar vs occupant: B-pillar x should sit between the rows.
  if (ctx.spec) {
    const bx = ctx.spec.bPillarX;
    const frontH = ctx.scene.sgRPFront.x, rearH = ctx.scene.sgRPRear.x;
    const between = bx > frontH && bx < rearH;
    add("b-pillar", between ? "pass" : "warn", `B-pillar station ${mm(bx)} mm, front H ${mm(frontH)} mm, rear H ${mm(rearH)} mm`, { valueM: r4(bx) });
  }

  if (!Number.isFinite(ctx.powerW)) add("cooling-power", "warn", "required power was not passed in, so the radiator is the library part and is not resized");
  else add("cooling-power", "pass", `radiator stays the library core; required power at the brief speed is ${Math.round(ctx.powerW)} W (coolant-loop is a separate solver)`, { powerW: Math.round(ctx.powerW) });

  add("spare", "warn", "no spare tire is specified, so none is placed");
  return checks;
}

export function fitStatus(checks) {
  if (!checks?.length) return "warn";
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

export function fitText(checks) {
  const status = fitStatus(checks);
  const bits = (checks || []).map((c) => `${c.id} ${c.status}`);
  return `Packaging fit: ${status}. ${bits.join("; ")}.`;
}

/** Drop generated triangles. The spec is enough to rebuild the meshes. */
export function compactAssembly(doc) {
  if (!doc?.surface?.spec) return doc;
  const mesh = doc.surface.mesh || {};
  const components = (doc.components || []).map((c) => {
    if (!c.mesh) return c;
    if (c.mesh.outline) return { ...c, mesh: { outline: c.mesh.outline, side: c.mesh.side } };
    const { mesh, ...rest } = c;
    void mesh;
    return rest;
  });
  return {
    ...doc,
    surface: {
      spec: doc.surface.spec,
      mesh: {
        bounds: mesh.bounds, stations: mesh.stations, capped: mesh.capped,
        arches: mesh.arches, windshield: mesh.windshield, generated: "runtime",
      },
    },
    wheel: doc.wheel?.spec ? { spec: doc.wheel.spec } : doc.wheel,
    components,
  };
}

/** Rebuild meshes from surface.spec. Does not mutate the snapshot object. */
export function hydrateAssembly(doc) {
  if (!doc?.surface?.spec || doc.surface.mesh?.positions?.length) return doc;
  const built = loftBody(doc.surface.spec);
  const { details, spec, ...mesh } = built;
  const byId = new Map((details || []).map((d) => [d.id, d]));
  const wheel = doc.wheel?.spec ? wheelMesh({
    overallDiameterM: doc.wheel.spec.overallDiameterM,
    sectionWidthM: doc.wheel.spec.sectionWidthM,
    rimDiameterM: doc.wheel.spec.rimDiameterM,
    rimWidthM: doc.wheel.spec.rimWidthM,
    spokes: doc.wheel.spec.spokes,
  }) : doc.wheel;
  return {
    ...doc,
    surface: { spec, mesh },
    wheel,
    components: (doc.components || []).map((c) => {
      const d = byId.get(c.id);
      return d ? { ...c, mesh: d.mesh } : c;
    }),
  };
}

/** Side-view projection of a component's placement box. Metres, [x, z]. */
export function projectSideBox(c) {
  if (!c.half) return null;
  const b = boxOf(c);
  if (!b) return null;
  const xs = [], zs = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = [0, 1, 2].map((i) => b.center[i] + sx * b.half[0] * b.axes[0][i] + sy * b.half[1] * b.axes[1][i] + sz * b.half[2] * b.axes[2][i]);
    xs.push(p[0]); zs.push(p[2]);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

