// server/lib/conkay/assembly/style.js
//
// The body is styled first. Profile, plan and shoulder are Fritsch–Carlson
// monotone cubics: C1, no overshoot, flat outside the end controls. A natural
// cubic rang the hood under the arch when one control was lifted, so this
// interpolant is the one the loft samples. Curvature is continuous on each
// span; the design-quality check reports the largest tangent change over
// 80 mm. A containment pass then lifts only the controls a box actually hits,
// blended back toward the pinned nose and tail, and records the push.
// The watertight loft samples those curves. It does not wrap the skin over
// the powertrain boxes.

import { getComponent } from "../components/index.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const LAYOUTS = Object.freeze(["ev_skateboard", "front_engine", "mid_engine", "rear_engine"]);

const MOTOR_ID = "motor.ford.eluminator.m-9000-mache";

// Range is not in the brief. Mixed-cycle consumption and pack density are
// assumptions, labelled as such wherever they are reported. 180 mph is not
// the range condition.
const ASSUMED_RANGE_KM = 400;
const ASSUMED_WH_PER_KM = 160;
const ASSUMED_WH_PER_L = 250;
const PACK_BOTTOM_Z = 0.10;

const BANDS = Object.freeze({
  dashToAxle: [0.18, 0.32],
  hoodVsArchM: [-0.02, 0.08],
  rakeDeg: [55, 65],
  greenhouseToBody: [0.40, 0.65],
  tumblehomeDeg: [8, 20],
  beltRiseM: [0, 0.08],
  fenderOverTrack: [1.05, 1.35],
  kammToPeak: [0.40, 0.72],
  maxTurnDeg: 25,
});

/**
 * Fritsch–Carlson monotone cubic. Tangents are continuous, and a slope
 * reversal gets a zero tangent, so a local push cannot ring a valley into
 * the next span. Flat outside the end controls.
 */
export function makeSpline(points) {
  const pts = [];
  for (const p of [...points].sort((a, b) => a.x - b.x)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.v)) continue;
    if (!pts.length || p.x - pts[pts.length - 1].x > 1e-4) pts.push({ x: p.x, v: p.v });
    else pts[pts.length - 1].v = p.v;
  }
  const n = pts.length;
  if (!n) return () => 0;
  if (n === 1) return () => pts[0].v;
  const h = new Array(n - 1);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1].x - pts[i].x || 1e-6;
    d[i] = (pts[i + 1].v - pts[i].v) / h[i];
  }
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-12) { m[i] = 0; m[i + 1] = 0; continue; }
    const aa = m[i] / d[i];
    const bb = m[i + 1] / d[i];
    const s = aa * aa + bb * bb;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * aa * d[i];
      m[i + 1] = t * bb * d[i];
    }
  }
  return (x) => {
    if (x <= pts[0].x) return pts[0].v;
    if (x >= pts[n - 1].x) return pts[n - 1].v;
    let i = 0;
    while (i < n - 2 && pts[i + 1].x < x) i++;
    const t = (x - pts[i].x) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i].v + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * pts[i + 1].v + (t3 - t2) * h[i] * m[i + 1];
  };
}

export function sampleSpline(points, step = 0.03) {
  const ev = makeSpline(points);
  if (!points.length) return [];
  const x0 = Math.min(...points.map((p) => p.x));
  const x1 = Math.max(...points.map((p) => p.x));
  const out = [];
  for (let x = x0; x < x1 - 1e-6; x += step) out.push({ x, v: ev(x) });
  out.push({ x: x1, v: ev(x1) });
  return out;
}

function deriv(ev, x) {
  const h = 0.02;
  return (ev(x + h) - ev(x - h)) / (2 * h);
}

/** Largest tangent change over an 80 mm run, in degrees. A steady windshield slope is not a kink. */
export function maxTurnDeg(points) {
  const ev = makeSpline(points);
  if (points.length < 3) return 0;
  const x0 = points[0].x + 0.05;
  const x1 = points[points.length - 1].x - 0.05;
  let max = 0;
  for (let x = x0; x <= x1; x += 0.04) {
    const a0 = Math.atan(deriv(ev, x - 0.04));
    const a1 = Math.atan(deriv(ev, x + 0.04));
    max = Math.max(max, Math.abs(a1 - a0) * 180 / Math.PI);
  }
  return max;
}

function maxCurvatureChange(points) {
  const ev = makeSpline(points);
  if (points.length < 3) return 0;
  const kappa = (x) => {
    const h = 0.025;
    const zm = ev(x - h);
    const z0 = ev(x);
    const zp = ev(x + h);
    const d1 = (zp - zm) / (2 * h);
    const d2 = (zp - 2 * z0 + zm) / (h * h);
    return d2 / (1 + d1 * d1) ** 1.5;
  };
  const x0 = points[0].x + 0.08;
  const x1 = points[points.length - 1].x - 0.08;
  let max = 0;
  let prev = kappa(x0);
  for (let x = x0 + 0.08; x <= x1; x += 0.08) {
    const k = kappa(x);
    max = Math.max(max, Math.abs(k - prev) / 0.08);
    prev = k;
  }
  return max;
}

export function chooseLayout({ layout, brief } = {}) {
  if (layout && LAYOUTS.includes(layout)) {
    return {
      id: layout,
      chosenBy: "caller",
      reason: `Layout ${layout.replaceAll("_", " ")} was requested. The styling skeleton stays the same; only the package, and the curves it actually hits, change.`,
    };
  }
  const text = String(brief || "");
  const why = text
    ? "The brief asks for a light four-seat car with a futuristic aerodynamic shape."
    : "This design is the light four-seat futuristic car.";
  return {
    id: "ev_skateboard",
    chosenBy: "conkay",
    reason: `${why} That shape is a floor battery and compact motors, not a tall front engine under the hood. front_engine, mid_engine and rear_engine stay available.`,
  };
}

function motorBox() {
  const m = getComponent(MOTOR_ID);
  const d = m?.dimensions;
  if (!d?.lengthM || !d?.heightM || !d?.widthM) return null;
  return {
    id: m.id,
    lengthM: d.lengthM,
    heightM: d.heightM,
    widthM: d.widthM,
    massKg: m.mass?.kg ?? null,
    peakW: m.ratings?.peakPowerW?.value ?? null,
    source: d.source?.url || m.mass?.massState?.source?.url || null,
  };
}

function boxPart({ id, name, role, x, y, z, hx, hy, hz, note, parameters, relationships }) {
  return {
    id, name, role,
    placement: { x, y, z },
    half: [hx, hy, hz],
    note,
    parameters,
    relationships: relationships || [{ kind: "mounted-to", target: "BODY_SHELL", note }],
  };
}

/**
 * Size the displayed powertrain. The library mass tree stays the gasoline car;
 * these envelopes are what the studio shows for the chosen layout.
 */
export function powertrainForLayout(layoutId, ctx) {
  const motor = motorBox();
  const notes = [];
  if (!motor) {
    return { parts: [], notes: ["the Eluminator motor is not in the library, so no drive unit was sized"], energy: null, motor: null };
  }
  const heel = ctx.heelZ;
  const bottom = Math.max(PACK_BOTTOM_Z, ctx.floorZ || PACK_BOTTOM_Z);
  const thick = Math.max(0.02, heel - bottom);
  const motorBottom = Math.max(bottom, ctx.floorZ * 0.4);
  const mz = motorBottom + motor.heightM / 2;
  const parts = [];
  const placeMotor = (id, name, x) => boxPart({
    id, name, role: "powertrain",
    x, y: 0, z: mz,
    hx: motor.lengthM / 2, hy: motor.widthM / 2, hz: motor.heightM / 2,
    note: `Ford Performance Eluminator envelope (${motor.lengthM} × ${motor.widthM} × ${motor.heightM} m), integral reduction, bottom at ${motorBottom.toFixed(3)} m. Not a housing model.`,
    parameters: [
      ["length", "Length", motor.lengthM, "m", "sourced", motor.source],
      ["height", "Height", motor.heightM, "m", "sourced", motor.source],
      ["peakPower", "Peak power", motor.peakW, "W", "sourced", motor.source],
      ["mass", "Mass", motor.massKg, "kg", "sourced", motor.source],
    ],
  });

  const rearClear = (ctx.rearSeatBackX ?? ctx.rearAxleX - 0.4) + 0.04;
  let frontX = ctx.frontAxleX;
  let rearX = Math.max(ctx.rearAxleX + 0.1, rearClear + motor.lengthM / 2);
  let midX = rearClear + motor.lengthM / 2;
  if (layoutId === "ev_skateboard") {
    const frontRearFace = frontX + motor.lengthM / 2;
    if (ctx.firewallX && frontRearFace > ctx.firewallX - 0.02) {
      frontX = ctx.firewallX - 0.02 - motor.lengthM / 2;
      notes.push("front motor shifted ahead of the firewall");
    }
    parts.push(placeMotor("MOTOR_FRONT", "Front drive unit", frontX));
    parts.push(placeMotor("MOTOR_REAR", "Rear drive unit", rearX));
  } else if (layoutId === "mid_engine") {
    const gap = ctx.rearAxleX - rearClear;
    if (gap < motor.lengthM) {
      notes.push(`seat-to-axle gap is ${Math.round(gap * 1000)} mm and the motor is ${Math.round(motor.lengthM * 1000)} mm long, so the unit sits across the rear axle`);
    }
    parts.push(placeMotor("MOTOR_MID", "Mid drive unit", midX));
  } else if (layoutId === "rear_engine") {
    const x = Math.min(ctx.tailX - motor.lengthM / 2 - 0.08, Math.max(rearX, ctx.rearAxleX + motor.lengthM / 2 + 0.02));
    parts.push(placeMotor("MOTOR_REAR", "Rear drive unit", x));
  }

  const lead = parts[0];
  const invH = 0.11;
  const invL = 0.36;
  const invW = 0.26;
  let invX = lead.placement.x - lead.half[0] - invL / 2 - 0.04;
  if (invX - invL / 2 < ctx.noseX + 0.35) invX = lead.placement.x + lead.half[0] + invL / 2 + 0.04;
  if (ctx.firewallX && lead.placement.x < ctx.firewallX && invX + invL / 2 > ctx.firewallX - 0.02) {
    invX = ctx.firewallX - invL / 2 - 0.02;
  }
  const invZ = motorBottom + invH / 2;
  parts.push(boxPart({
    id: "INVERTER", name: "Traction inverter", role: "powertrain",
    x: invX, y: 0, z: invZ, hx: invL / 2, hy: invW / 2, hz: invH / 2,
    note: "Assumed traction-inverter envelope. The Eluminator listing excludes the inverter and the library has no sized inverter.",
    parameters: [
      ["length", "Length", invL, "m", "assumed", "not a library part"],
      ["height", "Height", invH, "m", "assumed", "not a library part"],
    ],
    relationships: [{ kind: "constrained-by", target: lead.id, note: "beside the drive unit, ahead of the firewall when there is one" }],
  }));

  const coolT = 0.04;
  const coolW = 0.52;
  const coolH = 0.16;
  const coolX = ctx.noseX + 0.22 + coolT / 2;
  const coolZ = Math.max(ctx.floorZ + 0.02, 0.18) + coolH / 2;
  parts.push(boxPart({
    id: "COOLING", name: "Cooling core", role: "cooling",
    x: coolX, y: 0, z: coolZ, hx: coolT / 2, hy: Math.min(coolW / 2, (ctx.halfWidth || 0.9) * 0.42), hz: coolH / 2,
    note: "Assumed low cooling core behind the lower intake. Not the library gasoline radiator and not a heat-rejection solve.",
    parameters: [
      ["height", "Core height", coolH, "m", "assumed", "EV layout allowance, not the gasoline radiator"],
      ["width", "Core width", coolW, "m", "assumed", "EV layout allowance"],
    ],
  }));

  const drive = parts.filter((p) => p.id.startsWith("MOTOR_"));
  const frontMost = drive.reduce((a, b) => (a.placement.x < b.placement.x ? a : b));
  const rearMost = drive.reduce((a, b) => (a.placement.x > b.placement.x ? a : b));
  let x0 = drive.length >= 2 ? frontMost.placement.x + frontMost.half[0] + 0.05 : ctx.frontAxleX + 0.5;
  let x1 = rearMost.placement.x - rearMost.half[0] - 0.05;
  if (x1 < x0 + 0.35) x1 = x0 + Math.max(0.5, (ctx.rearAxleX - ctx.frontAxleX) * 0.45);
  const yHalf = Math.min(0.55, (ctx.track || 1.6) / 2 - 0.22);
  const z0 = bottom;
  const z1 = heel;
  const length = Math.max(0.2, x1 - x0);
  const volumeM3 = length * (yHalf * 2) * thick;
  const fitKWh = volumeM3 * ASSUMED_WH_PER_L;
  const needKWh = ASSUMED_RANGE_KM * ASSUMED_WH_PER_KM / 1000;
  const rangeFitKm = fitKWh * 1000 / ASSUMED_WH_PER_KM;
  notes.push(`range is not in the brief; ${ASSUMED_RANGE_KM} km mixed at ${ASSUMED_WH_PER_KM} Wh/km would be ${needKWh.toFixed(0)} kWh. The floor stack is ${(thick * 1000).toFixed(0)} mm between ${bottom.toFixed(2)} m clearance and the heel at ${heel.toFixed(3)} m, so the pack that fits is ${fitKWh.toFixed(1)} kWh at an assumed ${ASSUMED_WH_PER_L} Wh/L (${rangeFitKm.toFixed(0)} km at that consumption).`);
  parts.push(boxPart({
    id: "BATTERY", name: "Floor battery", role: "powertrain",
    x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2,
    hx: length / 2, hy: yHalf, hz: thick / 2,
    note: "Skateboard pack limited by ground clearance and the heel plane. Energy density and the range target are assumed. Not a sourced cell.",
    parameters: [
      ["energyKWh", "Energy that fits", Math.round(fitKWh * 10) / 10, "kWh", "estimated", `${volumeM3.toFixed(3)} m³ at assumed ${ASSUMED_WH_PER_L} Wh/L`],
      ["energyNeedKWh", "Energy for the assumed range", Math.round(needKWh * 10) / 10, "kWh", "assumed", `range was not specified; ${ASSUMED_RANGE_KM} km at ${ASSUMED_WH_PER_KM} Wh/km, not at 180 mph`],
      ["thickness", "Pack thickness", thick, "m", "calculated", `heel ${heel.toFixed(3)} m minus clearance ${bottom.toFixed(2)} m`],
    ],
  }));

  const installedW = (motor.peakW || 0) * parts.filter((p) => p.id.startsWith("MOTOR_")).length;
  return {
    parts,
    notes,
    energy: { fitKWh, needKWh, rangeFitKm, thickM: thick, assumedRangeKm: ASSUMED_RANGE_KM, whPerKm: ASSUMED_WH_PER_KM, whPerL: ASSUMED_WH_PER_L },
    motor,
    installedW,
  };
}

function ctrl(id, x, v, pin = false) {
  return { id, x, v, pin };
}

/**
 * About thirty styling controls: crown profile, plan half-width, shoulder/belt.
 * Section tumblehome is applied in the loft from tumblehomeDeg.
 */
export function styleControls(spec, pins = {}) {
  const nose = spec.noseX;
  const tail = spec.tailX;
  const ax = spec.frontAxleX;
  const rx = spec.rearAxleX;
  const R = spec.tyreRadius + (spec.archGap || 0.032);
  const archTop = (spec.tyreCenterZ || spec.tyreRadius) + R;
  const hw = spec.halfWidth;
  const cap = Number.isFinite(spec.roofZ) ? spec.roofZ : 2;
  const belt = spec.beltZ;
  const cowlX = spec.cowlX;
  const headerX = spec.headerX;
  const cowlZ = Math.min(spec.cowlZ, cap - 0.05);
  const headerZ = Math.min(spec.headerZ, cap - 0.01);
  const kammX = spec.kammX ?? (tail - Math.min(0.16, (tail - rx) * 0.25));
  const kammZ = Math.min(spec.kammZ, cap - 0.08);
  const noseZ = Math.min(spec.noseTipZ ?? 0.5, cowlZ - 0.12, cap);
  const hood = Math.min(cap - 0.04, archTop + 0.012);
  const frontHeadX = pins.frontHeadX ?? lerp(headerX, spec.bPillarX || headerX + 0.4, 0.7);
  const rearHeadX = pins.rearHeadX ?? lerp(frontHeadX, rx, 0.85);
  const frontNeed = Math.min(cap, (pins.frontHeadZ ?? headerZ) + 0.022);
  const rearNeed = Math.min(cap, (pins.rearHeadZ ?? frontNeed - 0.02) + 0.022);
  const glass = Math.max(0.28, belt * 0.5);
  const peakZ = Math.min(cap, Math.max(belt + glass, frontNeed + 0.04));
  const peakX = clamp(Math.min(headerX + 0.16, frontHeadX - 0.06), headerX + 0.04, frontHeadX - 0.02);
  const headRoof = Math.min(cap, Math.max(frontNeed, peakZ - 0.055));
  const rearRoof = Math.min(cap, Math.max(rearNeed, Math.min(headRoof - 0.03, peakZ - 0.09)));
  const under = (v) => Math.min(v, cap);
  // Most of the hood rise happens in the first 0.42 m, then the plane
  // flattens. Spread so the tangent change over 80 mm stays under 25°.
  const riseX = nose + 0.2;
  const riseZ = noseZ + (hood - noseZ) * 0.42;
  const leadX = nose + Math.min(0.48, (ax - nose) * 0.55);
  const leadZ = noseZ + (hood - noseZ) * 0.82;
  const fastX = lerp(rearHeadX, kammX, 0.55);
  const fastZ = lerp(rearRoof, kammZ, 0.62);

  const crown = [
    ctrl("nose-tip", nose, under(noseZ), true),
    ctrl("nose-rise", riseX, under(riseZ)),
    ctrl("hood-lead", leadX, under(leadZ)),
    ctrl("hood-axle", ax, under(hood)),
    ctrl("cowl", cowlX, under(cowlZ)),
    ctrl("ws-mid", lerp(cowlX, headerX, 0.5), under(lerp(cowlZ, headerZ, 0.5))),
    ctrl("header", headerX, under(headerZ)),
    ctrl("roof-peak", peakX, under(peakZ)),
    ctrl("roof-front-head", frontHeadX, under(headRoof)),
    ctrl("roof-rear-head", rearHeadX, under(rearRoof)),
    ctrl("fastback", fastX, under(fastZ)),
    ctrl("kamm", kammX, under(kammZ)),
    ctrl("tail", tail, under(kammZ), true),
  ];

  const archFront = ax - R;
  const kY = hw * Math.sqrt(clamp(spec.kammRatio ?? 0.45, 0.25, 0.75));
  const plan = [
    ctrl("plan-nose", nose, hw * 0.9, true),
    ctrl("plan-corner", nose + 0.14, hw * 0.985),
    ctrl("plan-arch", archFront - 0.015, hw * 0.995),
    ctrl("plan-axle", ax, hw),
    ctrl("plan-b", spec.bPillarX || lerp(cowlX, rx, 0.45), hw * 0.975),
    ctrl("plan-rear", rx, hw * 0.96),
    ctrl("plan-kamm", kammX, kY),
    ctrl("plan-tail", tail, kY * 0.92, true),
  ];

  const beltRear = Math.min(cap - 0.05, belt + 0.032);
  const shoulder = [
    ctrl("sh-nose", nose, Math.min(noseZ - 0.015, hood)),
    ctrl("sh-arch-f", archFront, archTop + 0.008),
    ctrl("sh-axle", ax, archTop + 0.014),
    ctrl("sh-arch-b", ax + R * 0.85, archTop + 0.008),
    ctrl("sh-cowl", cowlX, Math.min(belt, cowlZ - 0.01)),
    ctrl("sh-belt", headerX, belt),
    ctrl("sh-rear-arch", rx, beltRear),
    ctrl("sh-kamm", kammX, Math.min(kammZ + 0.04, beltRear)),
    ctrl("sh-tail", tail, Math.min(kammZ * 0.72, belt)),
  ];

  return {
    crown: monotoneX(crown),
    plan: monotoneX(plan),
    shoulder: monotoneX(shoulder),
    kammX,
    peakZ,
    archTop,
    beltRiseM: 0.032,
  };
}

function monotoneX(rows) {
  const s = [...rows].sort((a, b) => a.x - b.x);
  const out = [];
  for (const p of s) {
    if (!out.length || p.x - out[out.length - 1].x > 0.012) out.push({ ...p });
    else out[out.length - 1] = { ...p, x: out[out.length - 1].x + 0.013 };
  }
  return out;
}

function spanDeficit(ev, x0, x1, need) {
  let deficit = 0;
  let at = x0;
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let i = 0; i <= 10; i++) {
    const x = a + (b - a) * (i / 10);
    const d = need - ev(x);
    if (d > deficit) { deficit = d; at = x; }
  }
  return { deficit, at };
}

/**
 * Lift only the controls that cover a conflicting span. Pinned controls
 * (nose tip, tail tip, plan nose) stay put so the overhang profile holds.
 * Values are capped by the roof limit so a short kernel body is not grown
 * back up to the head.
 */
export function pushControls(curves, conflicts, cap) {
  const crown = curves.crown.map((c) => ({ ...c }));
  const plan = curves.plan.map((c) => ({ ...c }));
  const shoulder = curves.shoulder.map((c) => ({ ...c }));
  const pushes = [];
  // A monotone cubic stays between its endpoint values, so the span clears
  // once both edges sit at the need. The rise is spread back toward the
  // nearest pin (or 0.36 m, whichever is closer) so the push is a ramp,
  // not a spike between two untouched neighbours.
  const lift = (rows, name, x0, x1, need, reason, limit = cap) => {
    const target = Math.min(limit, need);
    if (!Number.isFinite(target)) return;
    const base = makeSpline(rows);
    if (spanDeficit(base, x0, x1, target).deficit <= 0.003) return;
    let moved = 0;
    const bump = (c, v) => {
      if (!c || c.pin || !Number.isFinite(v)) return;
      const next = Math.min(limit, v);
      if (next > c.v + 0.0005) {
        moved = Math.max(moved, next - c.v);
        c.v = next;
      }
    };
    const xLo = rows[0].x;
    const xHi = rows[rows.length - 1].x;
    for (const edge of [x0, x1]) {
      if (edge <= xLo + 0.02 || edge >= xHi - 0.02) continue;
      const have = rows.find((c) => Math.abs(c.x - edge) < 0.018);
      const v = Math.max(target, base(edge));
      if (have) bump(have, v);
      else {
        rows.push({ id: `${name}-push`, x: edge, v, pin: false });
        moved = Math.max(moved, Math.max(0, v - base(edge)));
      }
    }
    rows.sort((a, b) => a.x - b.x);
    for (const c of rows) {
      if (c.x >= x0 - 1e-3 && c.x <= x1 + 1e-3) bump(c, target);
    }
    const spread = (edge, dir) => {
      let pinX = dir < 0 ? xLo : xHi;
      for (const c of rows) {
        if (!c.pin) continue;
        if (dir < 0 && c.x <= edge) pinX = c.x;
        if (dir > 0 && c.x >= edge && c.x < pinX) pinX = c.x;
      }
      const far = dir < 0 ? Math.max(pinX, edge - 0.36) : Math.min(pinX, edge + 0.36);
      if (Math.abs(edge - far) < 0.02) return;
      const edgeV = Math.max(target, base(edge));
      const farV = base(far);
      for (const c of rows) {
        const t = (c.x - far) / (edge - far);
        if (t <= 0.02 || t >= 0.98) continue;
        bump(c, farV + (edgeV - farV) * t);
      }
    };
    spread(x0, -1);
    spread(x1, 1);
    const left = spanDeficit(makeSpline(rows), x0, x1, target);
    if (left.deficit > 0.003) {
      for (const c of rows) {
        if (!c.pin && c.x >= x0 - 0.01 && c.x <= x1 + 0.01) bump(c, target + left.deficit);
      }
    }
    const still = spanDeficit(makeSpline(rows), x0, x1, target);
    if (moved > 0.002) pushes.push(`${name} raised ${Math.round(moved * 1000)} mm for ${reason}`);
    if (still.deficit > 0.003) pushes.push(`${name} still short by ${Math.round(still.deficit * 1000)} mm for ${reason}`);
  };

  for (const hit of conflicts) {
    const x0 = hit.x - hit.hx;
    const x1 = hit.x + hit.hx;
    if (Number.isFinite(hit.zTop)) {
      lift(crown, hit.curve || "crown", x0, x1, Math.min(cap, hit.zTop + (hit.zClear ?? 0.028)), hit.reason);
      if (hit.liftShoulder) lift(shoulder, "shoulder", x0, x1, Math.min(cap - 0.012, hit.zTop + 0.012), hit.reason);
    }
    if (Number.isFinite(hit.yHalf)) {
      const planCap = Math.max(...plan.map((c) => c.v));
      lift(plan, "plan", x0, x1, hit.yHalf + 0.05, hit.reason, planCap);
    }
  }

  return { crown, plan, shoulder, pushes };
}

function inBand(v, [lo, hi]) {
  return v >= lo && v <= hi;
}

export function measureStyle(spec) {
  const crown = spec.crownKeys || [];
  const plan = spec.planKeys || [];
  const shoulder = spec.shoulderKeys || [];
  const cEv = makeSpline(crown);
  const pEv = makeSpline(plan);
  const sEv = makeSpline(shoulder);
  const ax = spec.frontAxleX;
  const rx = spec.rearAxleX;
  const wb = Math.max(0.5, rx - ax);
  const archTop = (spec.tyreCenterZ || spec.tyreRadius) + spec.tyreRadius + (spec.archGap || 0.032);
  const peak = crown.reduce((m, p) => Math.max(m, p.v), 0);
  const kamm = cEv(spec.kammX || spec.tailX);
  const belt0 = sEv(spec.headerX || spec.cowlX);
  const belt1 = sEv(spec.bPillarX || rx);
  const ratios = {
    dashToAxle: (spec.cowlX - ax) / wb,
    hoodVsArchM: cEv(ax) - archTop,
    rakeDeg: spec.rakeDeg,
    greenhouseToBody: Math.max(0, peak - spec.beltZ) / Math.max(0.2, spec.beltZ),
    tumblehomeDeg: spec.tumblehomeDeg ?? 14,
    beltRiseM: belt1 - belt0,
    fenderOverTrack: pEv(ax) / Math.max(0.2, (spec.track || spec.halfWidth * 1.6) / 2),
    kammToPeak: peak > 0.2 ? kamm / peak : 0,
    maxTurnDeg: maxTurnDeg(crown),
    maxCurvatureChange: maxCurvatureChange(crown),
    hoodAtAxleM: cEv(ax),
    peakM: peak,
  };
  const flags = [];
  if (!inBand(ratios.dashToAxle, BANDS.dashToAxle)) flags.push(`dash-to-axle ${ratios.dashToAxle.toFixed(2)} outside ${BANDS.dashToAxle.join("–")}`);
  if (!inBand(ratios.hoodVsArchM, BANDS.hoodVsArchM)) flags.push(`hood above the front axle is ${(ratios.hoodVsArchM * 1000).toFixed(0)} mm relative to the arch top, outside ${BANDS.hoodVsArchM.map((n) => Math.round(n * 1000)).join("–")} mm`);
  if (!inBand(ratios.rakeDeg, BANDS.rakeDeg)) flags.push(`windshield rake ${ratios.rakeDeg.toFixed(1)}° outside ${BANDS.rakeDeg.join("–")}°`);
  if (!inBand(ratios.greenhouseToBody, BANDS.greenhouseToBody)) flags.push(`greenhouse-to-body ${ratios.greenhouseToBody.toFixed(2)} outside ${BANDS.greenhouseToBody.join("–")} (target about 0.5)`);
  if (!inBand(ratios.tumblehomeDeg, BANDS.tumblehomeDeg)) flags.push(`tumblehome ${ratios.tumblehomeDeg}° outside ${BANDS.tumblehomeDeg.join("–")}°`);
  if (!inBand(ratios.fenderOverTrack, BANDS.fenderOverTrack)) flags.push(`fender over half-track ${ratios.fenderOverTrack.toFixed(2)} outside ${BANDS.fenderOverTrack.join("–")}`);
  if (!inBand(ratios.kammToPeak, BANDS.kammToPeak)) flags.push(`kamm-to-peak ${ratios.kammToPeak.toFixed(2)} outside ${BANDS.kammToPeak.join("–")}`);
  if (ratios.maxTurnDeg >= BANDS.maxTurnDeg) flags.push(`silhouette turn ${ratios.maxTurnDeg.toFixed(1)}° over 80 mm is at least ${BANDS.maxTurnDeg}°`);
  return { ratios, flags, controlCount: crown.length + plan.length + shoulder.length };
}

export function designQualityCheck(spec) {
  const { ratios, flags, controlCount } = measureStyle(spec);
  const pushes = Array.isArray(spec.pushes) ? spec.pushes : [];
  const r = ratios;
  const detail = [
    `${controlCount} styling controls.`,
    `dash-to-axle ${(r.dashToAxle * 100).toFixed(0)}% of the wheelbase,`,
    `hood ${(r.hoodVsArchM * 1000).toFixed(0)} mm vs the arch top,`,
    `rake ${r.rakeDeg.toFixed(1)}°,`,
    `greenhouse/body ${r.greenhouseToBody.toFixed(2)},`,
    `tumblehome ${r.tumblehomeDeg}°,`,
    `belt rise ${(r.beltRiseM * 1000).toFixed(0)} mm,`,
    `fender/half-track ${r.fenderOverTrack.toFixed(2)},`,
    `kamm/peak ${r.kammToPeak.toFixed(2)},`,
    `max silhouette turn ${r.maxTurnDeg.toFixed(1)}° over 80 mm,`,
    `max curvature change ${r.maxCurvatureChange.toFixed(2)} 1/m².`,
    pushes.length ? `Pushes: ${pushes.join("; ")}.` : "No containment push.",
  ];
  const hl = spec.highlightContinuity;
  if (hl && Number.isFinite(hl.maxDeg)) {
    const panel = Number.isFinite(hl.panelMaxDeg) ? hl.panelMaxDeg : hl.maxDeg;
    detail.push(`Off-crease highlight bend ${hl.maxDeg.toFixed(1)}° at the tightest edge (${hl.over8 || 0} adjacent pairs over 8°). Edges longer than 28 mm stay within ${panel.toFixed(1)}°.`);
    if (panel > 8) flags.push(`panel highlight bend ${panel.toFixed(1)}° exceeds 8° off the crease lines`);
    if (hl.maxDeg > 25) flags.push(`highlight bend ${hl.maxDeg.toFixed(1)}° exceeds 25° off the crease lines`);
  }
  if (Number.isFinite(spec.cagePoints)) {
    detail.push(`Half-body cage ${spec.cagePoints} control points, Catmull–Clark level ${spec.cageLevels || 3}.`);
  }
  detail.push(flags.length ? `Outside the styling bands: ${flags.join("; ")}.` : "Inside the styling bands used for a modern sedan or GT.");
  const text = detail.join(" ");
  return {
    id: "design-quality",
    status: flags.length ? "warn" : "info",
    detail: text,
    maxTurnDeg: Math.round(r.maxTurnDeg * 10) / 10,
    maxCurvatureChange: Math.round(r.maxCurvatureChange * 100) / 100,
    highlightMaxDeg: hl && Number.isFinite(hl.maxDeg) ? hl.maxDeg : null,
    panelHighlightMaxDeg: hl && Number.isFinite(hl.panelMaxDeg) ? hl.panelMaxDeg : null,
    ratios: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 1000) / 1000 : v])),
    pushes,
  };
}

export { BANDS };
