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
import { loftBody, wheelMesh, crownAt, skinApertureTop, boxInsideEnvelope, partInsideEnvelope, sectionHalfWidth, resolveSpec } from "./surface.js";
import { chooseLayout, styleControls, pushControls, powertrainForLayout, designQualityCheck } from "./style.js";
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

function part({ id, name, group, role, placement, half, geometry, parameters, relationships, explode, instanceOf, mesh, spine, section }) {
  return {
    id, name, group, role,
    placement: { x: r4(placement.x), y: r4(placement.y), z: r4(placement.z), pitchDeg: placement.pitchDeg || 0, yawDeg: placement.yawDeg || 0 },
    half: half ? half.map(r4) : null,
    geometry, parameters: parameters || [], relationships: relationships || [],
    explode: explode || { axis: "z", sign: 1, rank: 1 },
    ...(instanceOf ? { instanceOf } : {}),
    ...(mesh ? { mesh } : {}),
    ...(spine ? { spine, section } : {}),
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
export function assemblyFromIr(ir, { bodyBBox = null, powerW = null, layout = null, brief = null } = {}) {
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
  let roofZ = measuredRoof != null ? measuredRoof : (minInnerRoof != null ? minInnerRoof + skin + 0.02 : 1.25);
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
  const eng = pkg.components?.find((c) => c.node === "ENGINE");
  const engP = eng && centers[eng.node];
  const driverHead = driver?.landmarks?.headTop;
  const rearHead = rearM?.landmarks?.headTop;
  const layoutChoice = chooseLayout({
    layout,
    brief: brief || veh.props?.vehicle?.brief || ir.brief || "",
  });
  const archTop = (centers.TIRE_FL?.z ?? tyreR) + tyreR + 0.032;
  // roofZ above is the head-clearance floor (or the kernel box). The styled
  // peak may sit higher so the greenhouse is about half the body. A kernel
  // bbox still caps it, which is what makes a short body fail the head check.
  const roofCap = measuredRoof != null ? measuredRoof : Math.max(roofZ, beltZ * 1.5 + 0.02);
  const glassH = Math.max(0.28, beltZ * 0.5);
  const peakTarget = Math.min(roofCap, beltZ + glassH);
  const hoodTarget = Math.min(peakTarget - 0.2, archTop + 0.02);
  const cowlTarget = Math.min(beltZ - 0.03, hoodTarget + 0.05);
  const headerTarget = Math.min(peakTarget - 0.04, cowlTarget + 0.46);
  const kammTarget = Math.min(0.64, peakTarget - 0.18);

  const draft = resolveSpec({
    noseX, tailX, frontAxleX, rearAxleX, halfWidth,
    roofZ: peakTarget,
    floorZ: floorClear, beltZ, bPillarX, cPillarX, aPillarBaseX,
    track, tyreRadius: tyreR, tyreHalfWidth: tyreW / 2,
    tyreCenterZ: centers.TIRE_FL?.z ?? tyreR,
    noseTipZ: 0.32,
    kammRatio: 0.45,
    kammZ: kammTarget,
    ahpX: scene.ahp.x,
    headX: driverHead?.[0],
    rearHeadX: rearHead?.[0],
    archGap: 0.032,
    tumblehomeDeg: 14,
    beltRiseM: 0.032,
    cowlZ: cowlTarget,
    headerZ: headerTarget,
    grilleHalfY: halfWidth * 0.22,
    grilleHalfZ: 0.036,
    grilleZ: floorClear + 0.09,
    layout: layoutChoice.id,
  });

  const rearSeatBackX = rearM ? rearM.landmarks.hPoint[0] + 0.28 : scene.sgRPRear.x + 0.3;
  const conflicts = [];
  if (driverHead) conflicts.push({ x: driverHead[0], hx: 0.09, zTop: driverHead[1], zClear: 0.02, reason: "95th-percentile driver head", curve: "roof" });
  if (rearHead) conflicts.push({ x: rearHead[0], hx: 0.09, zTop: rearHead[1], zClear: 0.02, reason: "95th-percentile rear head", curve: "roof" });
  let evPack = null;
  if (layoutChoice.id === "front_engine") {
    for (const c of pkg.components || []) {
      const p = centers[c.node];
      if (!p || !c.half) continue;
      const ahead = p.x < (draft.cowlX + 0.15);
      conflicts.push({
        x: p.x, hx: c.half[0], zTop: p.z + c.half[2], yHalf: c.half[1],
        liftShoulder: true,
        curve: ahead ? "hood" : "deck",
        reason: `the library ${c.id.toLowerCase().replaceAll("_", " ")}`,
      });
    }
  } else {
    evPack = powertrainForLayout(layoutChoice.id, {
      frontAxleX, rearAxleX, noseX, tailX, floorZ: floorClear, heelZ: dc.floorZ,
      firewallX: pkg.firewallX, track, halfWidth, powerW, rearSeatBackX, tyreR,
    });
    for (const p of evPack.parts) {
      conflicts.push({
        x: p.placement.x, hx: p.half[0], zTop: p.placement.z + p.half[2],
        yHalf: p.id === "BATTERY" ? null : p.half[1],
        liftShoulder: p.id !== "BATTERY" && p.placement.z + p.half[2] > archTop,
        curve: p.placement.x < draft.cowlX ? "hood" : "deck",
        reason: p.name,
      });
    }
  }
  const skeleton = styleControls(draft, {
    frontHeadX: driverHead?.[0],
    frontHeadZ: driverHead?.[1],
    rearHeadX: rearHead?.[0],
    rearHeadZ: rearHead?.[1],
  });
  const pushed = pushControls(skeleton, conflicts, roofCap);
  const peak = Math.max(...pushed.crown.map((c) => c.v), draft.floorZ + 0.2);
  roofZ = Math.min(roofCap, peak);
  const spec = resolveSpec({
    ...draft,
    roofZ,
    crownKeys: pushed.crown,
    planKeys: pushed.plan,
    shoulderKeys: pushed.shoulder,
    kammX: skeleton.kammX,
    pushes: pushed.pushes,
    layout: layoutChoice.id,
    layoutReason: layoutChoice.reason,
    roofHoldX: skeleton.crown.find((c) => c.id === "roof-peak")?.x ?? draft.headerX,
    backlightX: (rearHead?.[0] ?? scene.sgRPRear.x) + 0.16,
    openings: undefined,
    packageConflicts: conflicts,
  });
  const loft = loftBody(spec);
  const cowlX = spec.cowlX;
  const headerX = spec.headerX;

  const components = [];
  const heightProvenance = measuredRoof != null
    ? prov("calculated", "cad.body extents", "overall height is capped by the kernel solid's max z; the loft is still the styling skeleton, not that B-rep")
    : prov("calculated", "styling skeleton", "the roof peaks over the front occupants and falls as a fastback. Each head is cleared at its own station.");

  components.push(part({
    id: "BODY_SHELL", name: "Body loft", group: "exterior", role: "body",
    placement: { x: (noseX + tailX) / 2, y: 0, z: (spec.floorZ + roofZ) / 2 },
    half: [(tailX - noseX) / 2, halfWidth, (roofZ - spec.floorZ) / 2],
    geometry: { ...envelope("one closed subdivision cage of the styling skeleton, mirrored and seam-welded on the centreline, then Catmull–Clark subdivided. Arches, the cooling mouth and the glass are openings in the cage. Not an OpenCascade solid and not a manufactured Class-A skin. When cad.body has run, the body's overall size is that solid's bounding box; the meshes are still not the same."), representation: "loft", mesh: "surface" },
    parameters: [
      param("wheelbase", "Wheelbase", rearAxleX - frontAxleX, "m", prov("calculated", "rearAxleX − frontAxleX")),
      param("overallLength", "Overall length", tailX - noseX, "m", heightProvenance.state === "calculated" && measuredRoof ? prov("calculated", "cad.body bbox") : prov("calculated", "nose and tail stations")),
      param("overallWidth", "Overall width", halfWidth * 2, "m", measuredRoof ? prov("calculated", "cad.body bbox") : prov("calculated", "track + tyre + fender, capped at the body maxWidth design choice 1.95 m")),
      param("overallHeight", "Overall height", roofZ, "m", heightProvenance),
      param("layout", "Powertrain layout", layoutChoice.id, "1", prov(layoutChoice.chosenBy === "caller" ? "assumed" : "calculated", "style.js chooseLayout", layoutChoice.reason)),
      param("windshieldRake", "Windshield rake from vertical", spec.rakeDeg, "deg", prov("calculated", "rise from the cowl to the header over tan(60°); pulled forward only if the header would pass the driver head")),
      param("groundClearance", "Ground clearance", spec.floorZ, "m", measuredRoof ? prov("calculated", "cad.body min z") : prov("calculated", "floorZ minus the skin offset, floored at 80 mm")),
      param("beltZ", "Beltline", beltZ, "m", prov("calculated", "M95 acromion height (ANSUR II sitting)", "greenhouse base")),
      param("kammRatio", "Kamm area ratio", 0.45, "1", prov("assumed", "CAD_BODY_DEFAULTS kammAreaRatio", "design choice, not Kamm's 50 percent figure")),
    ],
    relationships: [
      { kind: "constrained-by", target: "SEAT_1", note: "roof and beltline clear the driver H-point and the M95 head" },
      { kind: "aligned-to", target: "TIRE_FL", note: "fender flares sit over the tyre centreline" },
    ],
    explode: { axis: "z", sign: 1, rank: 0 },
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
    explode: { axis: "z", sign: 1, rank: 1 },
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
    relationships: [], explode: { axis: "z", sign: -1, rank: 2 },
  }));
  components.push(part({
    id: "AXLE_REAR", name: "Rear axle line", group: "wheels", role: "axle",
    placement: { x: rearAxleX, y: 0, z: tyreR }, half: [0.01, track / 2, 0.01],
    geometry: envelope("construction axis, not a part"),
    parameters: [param("x", "Rear axle x", rearAxleX, "m", prov("sourced", "design vehicle.rearAxleX"))],
    relationships: [], explode: { axis: "z", sign: -1, rank: 2 },
  }));

  // Powertrain. front_engine keeps the library boxes and lets them push the hood.
  // Every other layout shows the sized motors, inverter, battery and cooler.
  // The library mass tree is still the gasoline car either way.
  if (layoutChoice.id === "front_engine") {
    for (const c of pkg.components || []) {
      const p = centers[c.node];
      if (!p) continue;
      const vol = 8 * (c.half?.[0] || 0) * (c.half?.[1] || 0) * (c.half?.[2] || 0);
      components.push(part({
        id: c.id, name: c.id, group: "powertrain", role: c.node === "RADIATOR" ? "cooling" : "powertrain",
        placement: { x: p.x, y: p.y, z: p.z }, half: c.half,
        geometry: envelope(`bounding box of the library overall dimensions (${c.dims?.state || "unlabelled"}). Not a manufactured solid. The hood and deck move only where this box clears the styling skeleton.`),
        parameters: [
          param("volume", "Envelope volume", vol * 1000, "L", prov("calculated", "8 × half-extents of the library box")),
          ...(c.node === "ENGINE" && Number.isFinite(powerW) ? [param("requiredPower", "Required power at the brief speed", powerW, "W", prov("calculated", "vehicle.required-power", "aero drag plus rolling resistance at the required top speed"))] : []),
        ],
        relationships: c.node === "RADIATOR"
          ? [{ kind: "constrained-by", target: "ENGINE", note: "ahead of the engine by the fan gap; face area is the library core, not resized to a heat-rejection model" }]
          : [{ kind: "mounted-to", target: "BODY_SHELL", note: c.placement || "layout placement" }],
        explode: { axis: "x", sign: -1, rank: 2 },
      }));
    }
  } else if (evPack) {
    for (const p of evPack.parts) {
      const stateOf = (s) => (s === "sourced" ? "sourced" : s === "calculated" ? "calculated" : s === "estimated" ? "estimated" : "assumed");
      components.push(part({
        id: p.id, name: p.name, group: "powertrain", role: p.role,
        placement: p.placement, half: p.half,
        geometry: envelope(p.note),
        parameters: (p.parameters || []).filter((row) => row[2] != null).map(([id, name, value, unit, state, source]) => param(id, name, value, unit, prov(stateOf(state), source))),
        relationships: p.relationships,
        explode: { axis: p.id === "BATTERY" ? "z" : "x", sign: p.id === "BATTERY" ? -1 : -1, rank: 2 },
      }));
    }
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
        explode: { axis: "z", sign: 1, rank: 3 },
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
      explode: { axis: "z", sign: 1, rank: 3 },
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
    explode: { axis: "x", sign: -1, rank: 3 },
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
    explode: { axis: "x", sign: -1, rank: 3 },
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
    explode: { axis: "x", sign: -1, rank: 3 },
  });
  components.push(pedal("PEDAL_ACCEL", "Accelerator", -dc.frontSeatY + 0.06, "on the AHP / BOF line"));
  components.push(pedal("PEDAL_BRAKE", "Brake", -dc.frontSeatY - 0.02, "inboard of the accelerator; lateral offset is an allowance"));
  if (layoutChoice.id === "front_engine") {
    components.push(pedal("PEDAL_CLUTCH", "Clutch", -dc.frontSeatY - 0.12, "the gearbox is a manual TKX, so a clutch pedal is placed. Lateral offset is an allowance."));
  }

  // The library car is a manual. A skateboard has no gearbox, so no shifter is placed.
  if (layoutChoice.id === "front_engine") {
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
      explode: { axis: "z", sign: 1, rank: 3 },
    }));
  }

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
        explode: { axis: "y", sign: d.side === "L" ? -1 : 1, rank: 1 },
        mesh: { outline: d.outline, side: d.side },
      }));
    }
  }

  // Luggage and spare.
  const rearBack = rearM ? (rearM.landmarks.hPoint[0] + 0.25) : scene.sgRPRear.x + 0.3;
  const trunk = fitTrunk(loft.spec, rearBack, tailX - 0.08, spec.floorZ);
  const trunkVol = 8 * trunk.half[0] * trunk.half[1] * trunk.half[2];
  components.push(part({
    id: "TRUNK", name: "Trunk volume", group: "storage", role: "volume",
    placement: trunk.placement,
    half: trunk.half,
    geometry: envelope("box behind the rear seat back, shrunk until it sits under the fastback. Not an SAE J1100 luggage-block volume."),
    parameters: [param("volume", "Volume", trunkVol * 1000, "L", prov("calculated", "largest box behind the rear back that boxInsideEnvelope accepts"))],
    relationships: [{ kind: "clears", target: "SEAT_3", note: "starts behind the rear seat back" }],
    explode: { axis: "x", sign: 1, rank: 3 },
  }));
  const firewall = pkg.firewallX || cowlX;
  const cool = components.find((c) => c.id === "COOLING" || c.id === "RADIATOR");
  const noseUnit = components.find((c) => c.id === "MOTOR_FRONT" || c.id === "ENGINE");
  const limitX = Math.min(
    firewall,
    cool ? cool.placement.x - cool.half[0] : firewall,
    noseUnit ? noseUnit.placement.x - noseUnit.half[0] : firewall,
  );
  const frunk = fitFrunk(loft.spec, noseX, limitX, spec.floorZ);
  const frunkVol = 8 * frunk.half[0] * frunk.half[1] * frunk.half[2];
  components.push(part({
    id: "FRUNK", name: "Frunk volume", group: "storage", role: "volume",
    placement: frunk.placement,
    half: frunk.half,
    geometry: envelope("box shrunk to the loft ahead of the radiator and the engine. Not an SAE J1100 luggage-block volume. Zero-ish when the powertrain fills the nose."),
    parameters: [param("volume", "Volume", Math.max(0, frunkVol) * 1000, "L", prov("calculated", "largest box ahead of the powertrain that boxInsideEnvelope accepts"))],
    relationships: [{ kind: "clears", target: noseUnit?.id || cool?.id || "BODY_SHELL", note: "ahead of the nose powertrain" }],
    explode: { axis: "x", sign: -1, rank: 3 },
  }));
  components.push(part({
    id: "SPARE", name: "Spare tire", group: "storage", role: "spare",
    placement: { x: trunk.placement.x, y: 0, z: dc.floorZ + 0.05 },
    half: [0, 0, 0],
    geometry: envelope("not specified by the design, so not placed"),
    parameters: [param("specified", "Specified", 0, "1", prov("assumed", "the brief does not ask for a spare"))],
    relationships: [],
    explode: { axis: "z", sign: 1, rank: 0 },
  }));

  for (const d of loft.details) {
    const explode = d.role === "mirror" || d.role === "handle"
      ? { axis: "y", sign: d.placement.y < 0 ? -1 : 1, rank: 1 }
      : { axis: "z", sign: 1, rank: 0 };
    components.push(part({
      id: d.id, name: d.name, group: "exterior", role: d.role,
      placement: d.placement, half: d.half,
      geometry: envelope(d.note),
      parameters: [
        param("x", "Station", d.placement.x, "m", prov("calculated", "on the skin spline")),
        param("z", "Height", d.placement.z, "m", prov("calculated", "on the skin spline")),
        ...(d.id === "GRILLE" ? [param("width", "Opening width", d.half[1] * 2, "m", prov("estimated", "lower intake on the tapered nose, not the full cooling-core face"))] : []),
      ],
      relationships: d.id === "GRILLE" && cool
        ? [{ kind: "aligned-to", target: cool.id, note: "lower intake ahead of the cooling core, recessed in the bumper" }]
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
    const place = { x: box.center[0], y: box.center[1], z: box.center[2] };
    const fitted = boxInsideEnvelope(spec, place, box.half, 0.05) ? null : conformMember(spec, box);
    if (fitted) {
      const tube = tubeFromSpine(fitted.spine, fitted.section);
      components.push(part({
        id: n.id, name: n.name || n.id, group: "chassis", role: "frame",
        placement: tube.placement, half: tube.half,
        geometry: envelope("member centreline pulled onto the inner loft so the section stays inside the skin. The frame solver still uses the original centreline; this curve is the one that fits the body."),
        parameters: [param("section", "Section", n.geometry?.shape || "box", "1", prov("assumed", "tub design choice"))],
        relationships: [{ kind: "mounted-to", target: "BODY_SHELL", note: "follows the loft; the skin is not structural" }],
        explode: { axis: "z", sign: -1, rank: 2 },
        mesh: tube.mesh, spine: fitted.spine, section: fitted.section,
      }));
      continue;
    }
    components.push(part({
      id: n.id, name: n.name || n.id, group: "chassis", role: "frame",
      placement: place,
      half: box.half,
      geometry: envelope("tub member box from the structural layout. The frame solver uses the same centreline model."),
      parameters: [param("section", "Section", n.geometry?.shape || "box", "1", prov("assumed", "tub design choice"))],
      relationships: [{ kind: "mounted-to", target: "BODY_SHELL", note: "inside the loft; the skin is not structural" }],
      explode: { axis: "z", sign: -1, rank: 2 },
    }));
  }

  const checks = fitChecks({
    spec: loft.spec, scene, components, pkg, roofZ, minInnerRoof, measuredRoof, frontAxleX, rearAxleX,
    tyreR, tyreW, track, driver, driverF5, rearM, openings, powerW, layoutChoice, evPack,
  });
  const standards = standardsTable({ scene, dc, eye, roofZ, spec });

  const doc = {
    schema: ASSEMBLY_SCHEMA,
    coordinateSystem: { ...COORDINATE_SYSTEM, frontAxleX: r4(frontAxleX) },
    verification: {
      statement: measuredRoof
        ? "Geometric assembly. A shape that looks finished has not been manufactured or tested. Kernel solids are marked solid; every other part is a dimensioned envelope. The loft is fitted to the kernel bounding box and is not that solid. Each check is pass, warn, fail, or info."
        : "Geometric assembly. A shape that looks finished has not been manufactured or tested. The loft's length, width and height come from the styling skeleton pinned to the package hard points, not a kernel solid. Each check is pass, warn, fail, or info.",
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

  // Powertrain vs cabin. A front engine is checked at the firewall. Motors are checked the same way when they sit ahead of it.
  const engine = ctx.components.find((c) => c.id === "ENGINE");
  const wall = ctx.pkg.firewallX ?? ctx.scene.ahp.x;
  if (engine?.half) {
    const engineRear = engine.placement.x + engine.half[0];
    const gap = wall - engineRear;
    const lifts = (ctx.spec?.pushes || []).filter((p) => /engine|hood|radiator|deck|fuel/.test(p));
    add("powertrain-cabin", gap >= 0 ? "pass" : "fail",
      `engine rear face ${mm(engineRear)} mm, firewall ${mm(wall)} mm, gap ${mm(gap)} mm. ${lifts.join("; ") || "No hood push was required."}`,
      { valueM: r4(gap) });
  } else {
    const motors = ctx.components.filter((c) => c.id.startsWith("MOTOR_"));
    if (!motors.length) add("powertrain-cabin", "warn", "no drive unit, powertrain-to-cabin not checked");
    else {
      const ahead = motors.filter((m) => m.placement.x + m.half[0] > wall - 1e-6 && m.placement.x < wall);
      const intruding = motors.find((m) => m.placement.x < wall && m.placement.x + m.half[0] > wall + 0.01);
      if (intruding) add("powertrain-cabin", "fail", `${intruding.id} rear face crosses the firewall at ${mm(wall)} mm`);
      else add("powertrain-cabin", "pass",
        `${motors.map((m) => m.id).join(" and ")} clear the firewall at ${mm(wall)} mm${ahead.length ? "" : ""}`,
        { motors: motors.map((m) => m.id) });
    }
  }
  const layoutId = ctx.layoutChoice?.id || ctx.spec?.layout || "ev_skateboard";
  const pushes = ctx.spec?.pushes || [];
  const shapePushes = pushes.filter((p) => /raised/.test(p));
  const massNote = layoutId === "front_engine"
    ? "The displayed powertrain is the library gasoline set. The hood and the fenders rise only where that set clears the styling skeleton."
    : "The library mass tree is still the gasoline car. This assembly shows the sized motors, inverter, battery and cooler instead of that set.";
  const energy = ctx.evPack?.energy;
  const energyNote = energy
    ? ` Range was not specified. Assumed ${energy.assumedRangeKm} km at ${energy.whPerKm} Wh/km would need ${energy.needKWh.toFixed(0)} kWh. The floor pack that fits is ${energy.fitKWh.toFixed(1)} kWh (${energy.rangeFitKm.toFixed(0)} km at that rate), ${(energy.thickM * 1000).toFixed(0)} mm thick.`
    : "";
  add("powertrain-layout", "pass",
    `${ctx.layoutChoice?.reason || layoutId} ${massNote}${energyNote}${shapePushes.length ? ` ${shapePushes.join("; ")}.` : ""} ${(ctx.evPack?.notes || []).join(" ")}`.replace(/\s+/g, " ").trim(),
    { layout: layoutId, pushes });

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
    if (!partInsideEnvelope(ctx.spec, c, 0.05)) outside.push(c.id);
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

  if (layoutId !== "front_engine") {
    const installed = ctx.evPack?.installedW;
    const powerNote = Number.isFinite(ctx.powerW)
      ? `Solved required power is ${Math.round(ctx.powerW)} W.`
      : "Required power was not passed in, so it is not compared with the motor peak.";
    const short = Number.isFinite(ctx.powerW) && Number.isFinite(installed) && installed + 1 < ctx.powerW;
    add("cooling-power", short ? "warn" : "warn",
      `Cooling core is an assumed EV heat exchanger, not the library gasoline radiator and not a heat-rejection solve. Installed motor peak is ${installed ? Math.round(installed) : "unknown"} W. ${powerNote}${short ? " Installed peak is below the solved power." : ""}`,
      { powerW: Number.isFinite(ctx.powerW) ? Math.round(ctx.powerW) : null, installedW: installed || null });
  } else if (!Number.isFinite(ctx.powerW)) add("cooling-power", "warn", "required power was not passed in, so the radiator is the library part and is not resized");
  else add("cooling-power", "pass", `radiator stays the library core; required power at the brief speed is ${Math.round(ctx.powerW)} W (coolant-loop is a separate solver)`, { powerW: Math.round(ctx.powerW) });

  add("spare", "warn", "no spare tire is specified, so none is placed");
  if (ctx.spec?.crownKeys) checks.push(designQualityCheck(ctx.spec));
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

function fitTrunk(spec, rearBack, tailX, floorZ) {
  let x0 = rearBack + 0.04;
  let x1 = Math.max(x0 + 0.08, tailX);
  let z1 = floorZ + 0.55;
  let yHalf = Math.min((spec.halfWidth || 0.9) * 0.55, 0.55);
  for (let i = 0; i < 60; i++) {
    const z0 = floorZ + 0.02;
    const placement = { x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 };
    const half = [(x1 - x0) / 2, yHalf, (z1 - z0) / 2];
    if (half[0] > 0.03 && half[1] > 0.02 && half[2] > 0.02 && boxInsideEnvelope(spec, placement, half, 0.04)) {
      return { placement, half };
    }
    z1 -= 0.015;
    yHalf *= 0.94;
    if (z1 < z0 + 0.06) {
      x0 += 0.04;
      z1 = floorZ + 0.28;
    }
  }
  const x = Math.min(tailX - 0.12, rearBack + 0.2);
  const z = floorZ + 0.08;
  const y = Math.max(0.04, Math.min(0.12, sectionHalfWidth(spec, x, z) - 0.04));
  return { placement: { x, y: 0, z }, half: [0.06, y, 0.04] };
}

function fitFrunk(spec, noseX, limitX, floorZ) {
  let x0 = noseX + 0.12;
  let x1 = Math.max(x0 + 0.06, Math.min(limitX - 0.02, noseX + 0.9));
  let z1 = floorZ + 0.34;
  let yHalf = Math.min((spec.halfWidth || 0.9) * 0.42, 0.4);
  for (let i = 0; i < 48; i++) {
    const z0 = floorZ + 0.02;
    const placement = { x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 };
    const half = [(x1 - x0) / 2, yHalf, (z1 - z0) / 2];
    if (half[0] > 0.025 && half[1] > 0.02 && half[2] > 0.015 && boxInsideEnvelope(spec, placement, half, 0.05)) {
      return { placement, half };
    }
    z1 -= 0.01;
    yHalf *= 0.92;
    if (z1 < z0 + 0.05) {
      x1 = x0 + Math.max(0.06, (x1 - x0) * 0.86);
      z1 = floorZ + 0.18;
    }
  }
  const x = noseX + 0.2;
  const z = floorZ + 0.05;
  const y = Math.max(0.03, Math.min(0.08, sectionHalfWidth(spec, x, z) - 0.04));
  return { placement: { x, y: 0, z }, half: [0.04, y, 0.025] };
}

function memberFrame(box) {
  if (Number.isFinite(box.yawDeg) || Number.isFinite(box.pitchDeg)) {
    const yaw = ((box.yawDeg || 0) * Math.PI) / 180;
    const pitch = ((box.pitchDeg || 0) * Math.PI) / 180;
    const cp = Math.cos(pitch);
    return {
      ax: cp * Math.cos(yaw), ay: cp * Math.sin(yaw), az: -Math.sin(pitch), len: box.half[0],
      hy: Math.min(0.016, box.half[1] || 0.016), hz: Math.min(0.016, box.half[2] || 0.016),
    };
  }
  const ranked = [
    { len: box.half[0], ax: 1, ay: 0, az: 0 },
    { len: box.half[1], ax: 0, ay: 1, az: 0 },
    { len: box.half[2], ax: 0, ay: 0, az: 1 },
  ].sort((a, b) => b.len - a.len);
  const small = [...box.half].sort((a, b) => a - b);
  return { ...ranked[0], hy: Math.min(0.016, small[0] || 0.016), hz: Math.min(0.016, small[1] || 0.016) };
}

/** Pull a member that misses the loft onto a centreline the section can contain. */
function conformMember(spec, box) {
  const frame = memberFrame(box);
  const c = box.center;
  const steps = 14;
  const spine = [];
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps;
    let x = c[0] + frame.ax * frame.len * t;
    let y = c[1] + frame.ay * frame.len * t;
    let z = c[2] + frame.az * frame.len * t;
    x = Math.max(spec.noseX + 0.02, Math.min(spec.tailX - 0.02, x));
    let crown = crownAt(spec, x);
    z = Math.max(spec.floorZ + 0.03, Math.min(crown - 0.02, z));
    let hw = sectionHalfWidth(spec, x, z);
    let guard = 0;
    while (Math.abs(y) + frame.hy > hw - 0.005 && z > spec.floorZ + 0.05 && guard++ < 40) {
      z -= 0.012;
      crown = crownAt(spec, x);
      z = Math.min(z, crown - 0.02);
      hw = sectionHalfWidth(spec, x, z);
    }
    const lim = Math.max(0.02, hw - frame.hy - 0.008);
    y = Math.max(-lim, Math.min(lim, y));
    spine.push([r4(x), r4(y), r4(z)]);
  }
  const section = [Math.min(frame.hy, 0.016), Math.min(frame.hz, 0.016)];
  if (!partInsideEnvelope(spec, { spine, section }, 0.05)) return null;
  return { spine, section };
}

function tubeFromSpine(spine, section, origin) {
  const hy = section[0];
  const hz = section[1];
  const o = origin || spine.reduce((s, p) => ({ x: s.x + p[0], y: s.y + p[1], z: s.z + p[2] }), { x: 0, y: 0, z: 0 });
  if (!origin) {
    o.x /= spine.length;
    o.y /= spine.length;
    o.z /= spine.length;
  } else {
    o.x = origin.x;
    o.y = origin.y;
    o.z = origin.z;
  }
  const positions = [];
  const indices = [];
  const push = (x, y, z) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  for (let i = 0; i < spine.length - 1; i++) {
    const a = spine[i];
    const b = spine[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const wx = dx / L;
    const wy = dy / L;
    const wz = dz / L;
    let sx = -wy;
    let sy = wx;
    let sz = 0;
    if (Math.abs(wz) > 0.9) { sx = 0; sy = -wz; sz = wy; }
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const ux = wy * sz - wz * sy;
    const uy = wz * sx - wx * sz;
    const uz = wx * sy - wy * sx;
    const corners = (p) => [-1, 1].flatMap((syi) => [-1, 1].map((szi) => push(
      p[0] + syi * hy * sx + szi * hz * ux - o.x,
      p[1] + syi * hy * sy + szi * hz * uy - o.y,
      p[2] + syi * hy * sz + szi * hz * uz - o.z,
    )));
    const ca = corners(a);
    const cb = corners(b);
    const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const f of faces) {
      const q = f.map((k) => (k < 4 ? ca[k] : cb[k - 4]));
      indices.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
  }
  let hx = 0, hyb = 0, hzB = 0;
  for (let i = 0; i < positions.length; i += 3) {
    hx = Math.max(hx, Math.abs(positions[i]));
    hyb = Math.max(hyb, Math.abs(positions[i + 1]));
    hzB = Math.max(hzB, Math.abs(positions[i + 2]));
  }
  return {
    placement: { x: o.x, y: o.y, z: o.z },
    half: [hx || 0.01, hyb || 0.01, hzB || 0.01],
    mesh: { positions: positions.map(r4), indices },
  };
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
      if (d) return { ...c, mesh: d.mesh };
      if (c.spine?.length) return { ...c, mesh: tubeFromSpine(c.spine, c.section || [0.015, 0.015], c.placement).mesh };
      return c;
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

