// server/lib/conkay/structural/car-openings.js
//
// The openings in the car's tub and skin, designed (brief 4 item 2): the door
// apertures, the glazing openings and the service access, each a labelled
// design choice laid out from the tub's own nodes and members, then
//   - the service cut-outs are cut into the structure the frame model credits
//     (the firewall sheets get their pass-throughs, scored by the membrane FE;
//     the tunnel's gearbox cell loses its top wall over the gear-lever opening,
//     an open channel there);
//   - the door and glazing apertures are checked: no tub member or credited
//     sheet crosses a glazing opening, each occupant's egress line passes
//     through its door aperture (clearance to the pillars), and the aperture's
//     clear height over the H-point is set against the seated head-top height
//     (a WARN when short: real entry involves ducking, and no aperture
//     requirement is sourced);
//   - closedReference() panels every door and glazing opening with the 2 mm
//     sheet, a hypothetical closed shell, so the stiffness the openings cost
//     can be stated (a reference, not a design).
//
// The skin itself is not trimmed: the CAD body stays one closed surface (it is
// not credited structurally). The apertures here are the openings the skin's
// panel lines must follow; they are drawn from structure, not from the skin.

import { cutoutShearFactor } from "./membrane-fe.js";
import { getMaterial } from "../materials/index.js";

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const mm = (v) => Math.round(v * 1000);

export const OPENINGS_VERSION = "1.0.0";

/** The openings' design choices (metres), each with its basis. Coordinates: x aft, |y| outboard, z up. */
export const OPENING_CHOICES = Object.freeze({
  archClearance: { value: 0.03, basis: "design choice: the rear door's lower rear edge stops 30 mm ahead of the rear tyre envelope (wheel-arch liner and seal)" },
  firewallPassThroughs: {
    value: [
      { id: "steering-column", side: "R", y: -0.37, z: 0.58, d: 0.07, why: "steering column to the S550 EPAS rack: on the driver's wheel centreline (wheel at y -0.37); the column angle and the crossing height are a design choice (the column is not in the library)" },
      { id: "brake-pushrod", side: "R", y: -0.25, z: 0.49, d: 0.08, why: "brake booster / master-cylinder pushrod behind the right foot's pedal (foot y -0.21 to -0.32); booster spigot size an allowance (no booster in the library)" },
      { id: "clutch-pushrod", side: "R", y: -0.48, z: 0.49, d: 0.035, why: "clutch master-cylinder pushrod behind the left foot (foot y -0.42 to -0.53); the Tremec TKX is a manual gearbox" },
      { id: "loom-R", side: "R", y: -0.58, z: 0.60, d: 0.05, why: "main wiring loom grommet (allowance: no harness in the library)" },
      { id: "loom-L", side: "L", y: 0.55, z: 0.60, d: 0.05, why: "passenger-side loom / service grommet (allowance)" },
    ],
    basis: "design choice: firewall pass-throughs for the controls and services that must cross it; positions from the occupant's feet and the steering wheel, sizes are allowances (the parts are not in the component library)",
  },
  gearLeverOpening: { value: { x0: 1.96, x1: 2.06, width: 0.10 }, basis: "design choice: a 100 × 100 mm gear-lever opening in the top of the tunnel's gearbox cell over the TKX's rear (x 1.96-2.06); the TKX shifter position is not in the sourced data (assumed over the case's rear third): move it when the Tremec drawing's shifter dimension is sourced" },
  sheetMesh: { value: 0.02, basis: "membrane FE cell size 20 mm, re-run at 10 mm (the finer value is used; the change is reported; tests/conkay-tub-openings.test.js confirms 5 mm changes it by < 0.002)" },
});

const pointInPoly = (p, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const lerpZ = (a, b, x) => a[2] + ((b[2] - a[2]) * (x - a[0])) / (b[0] - a[0]);

/**
 * The openings for a tub layout (car-tub.js tubLayout): door apertures (side view, x-z, per side),
 * glazing openings and service cut-outs, from the layout's nodes and design choices.
 */
export function openingsLayout(layout, { rearTyreMinX, rearTyreTopZ, choices = OPENING_CHOICES } = {}) {
  const c = layout.choices;
  const oc = Object.fromEntries(Object.entries({ ...OPENING_CHOICES, ...choices }).map(([k, v]) => [k, v.value]));
  const node = (id) => layout.nodes.find((n) => n.id === id);
  const half = c.roofSection.height / 2, postHalf = c.postSection.width / 2;
  const sillTop = c.sillSection.bottomZ + c.sillSection.height;
  const XF = c.firewallX, XB = c.bHoopX;
  const A0 = node("FWA.L"), R0 = node("RR0.L"), R1 = node("RR1.L"), R2 = node("RR2.L");
  const railUnder = (x) => (x <= R1.x ? lerpZ([R0.x, 0, R0.z], [R1.x, 0, R1.z], x) : lerpZ([R1.x, 0, R1.z], [R2.x, 0, R2.z], x)) - half;
  const aTheta = Math.atan2(R0.z - A0.z, R0.x - A0.x);
  const aUnder = (x) => lerpZ([A0.x, 0, A0.z], [R0.x, 0, R0.z], x) - half / Math.cos(aTheta);
  const xFront = XF + 0.04; // firewall post's rear face
  const xBf = XB - postHalf, xBr = XB + postHalf, xC = R2.x - postHalf;
  const archX = rearTyreMinX - oc.archClearance, archZ = rearTyreTopZ + oc.archClearance;
  const doors = [];
  for (const s of ["L", "R"]) {
    doors.push({
      id: `door-front-${s}`, side: s, kind: "door", name: `Front door aperture ${s}`,
      outline: [[xFront, sillTop], [xBf, sillTop], [xBf, railUnder(xBf)], [R0.x, railUnder(R0.x)], [xFront, aUnder(xFront)]].map(([x, z]) => [r4(x), r4(z)]),
      bounds: ["firewall post", "A-pillar", "roof rail", "B-post", "sill (top)"],
    });
    doors.push({
      id: `door-rear-${s}`, side: s, kind: "door", name: `Rear door aperture ${s}`,
      outline: [[xBr, c.kickTopZ], [archX, c.kickTopZ], [archX, archZ], [xC, archZ], [xC, railUnder(xC)], [xBr, railUnder(xBr)]].map(([x, z]) => [r4(x), r4(z)]),
      bounds: ["B-post", "sill kick (top)", "rear wheel arch", "C-post", "rear roof rail"],
    });
  }
  for (const d of doors) {
    const xs = d.outline.map((p) => p[0]), zs = d.outline.map((p) => p[1]);
    d.lengthAtSillM = r4(d.outline[1][0] - d.outline[0][0]);
    d.maxLengthM = r4(Math.max(...xs) - Math.min(...xs));
    d.heightM = r4(Math.max(...zs) - Math.min(...zs));
    d.sillHeightM = r4(d.outline[0][1]);
    d.areaM2 = r4(Math.abs(d.outline.reduce((s, p, i) => { const q = d.outline[(i + 1) % d.outline.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2);
  }
  const glazing = [
    { id: "windscreen", kind: "glazing", name: "Windscreen", corners: ["FWA.L", "FWA.R", "RR0.R", "RR0.L"], bounds: ["scuttle", "A-pillars", "windscreen header"] },
    { id: "backlight", kind: "glazing", name: "Backlight (rear screen)", corners: ["RR1.L", "RR1.R", "RR2.R", "RR2.L"], bounds: ["roof bow (B-hoop top)", "rear roof rails", "C-post tops"] },
    ...["L", "R"].flatMap((s) => [
      { id: `side-glass-front-${s}`, kind: "glazing", name: `Front side glass ${s} (in the door)`, inDoor: `door-front-${s}` },
      { id: `side-glass-rear-${s}`, kind: "glazing", name: `Rear side glass ${s} (in the door)`, inDoor: `door-rear-${s}` },
    ]),
  ];
  for (const g of glazing) {
    if (!g.corners) continue;
    const p = g.corners.map(node);
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    g.areaM2 = r4((d(p[0], p[1]) + d(p[3], p[2])) / 2 * (d(p[1], p[2]) + d(p[0], p[3])) / 2);
  }
  const service = [
    ...oc.firewallPassThroughs.map((h) => ({ ...h, kind: "service", cuts: `firewall-${h.side}`, shape: "circle" })),
    { id: "gear-lever", kind: "service", cuts: "tunnel-f (top wall)", shape: "rect", ...oc.gearLeverOpening, why: "gear lever through the tunnel top" },
  ];
  // the firewall sheet's physical extent (between the lower cross and the scuttle, the centre post and the side posts)
  const sheetBounds = { z: [r4(c.bottomZ + 0.28), r4(c.scuttleZ[0])], y: [0.04, r4(c.sillY - 0.04)] };
  return { version: OPENINGS_VERSION, doors, glazing, service, sheetBounds, choices: oc };
}

/**
 * Cut the service openings into the layout's frame model (in place, returns notes): the firewall
 * sheets' shear stiffness scaled by their membrane-FE factor; the gearbox cell open over the lever.
 */
export function applyServiceCutouts(layout, openings) {
  const c = layout.choices;
  const mat = getMaterial(c.material);
  const E = mat.youngsModulusPa, nu = mat.poisson;
  const notes = [];
  for (const s of ["L", "R"]) {
    const panel = layout.panels.find((p) => p.id === `firewall-${s}`);
    if (!panel) continue;
    const nodes = panel.nodes.map((id) => layout.nodes.find((n) => n.id === id));
    const a = Math.abs(nodes[0].y - nodes[1].y), b = Math.abs(nodes[2].z - nodes[1].z), z0 = nodes[1].z;
    const plate = layout.parts.find((p) => p.id === panel.part);
    const t = parseFloat(plate.geometry.thickness);
    const holes = openings.service.filter((h) => h.cuts === `firewall-${s}`).map((h) => ({ id: h.id, shape: "circle", cx: a - Math.abs(h.y), cy: h.z - z0, r: h.d / 2 }));
    if (!holes.length) continue;
    const f = cutoutShearFactor({ a, b, t, E, nu, holes, cell: openings.choices.sheetMesh });
    panel.shearStiffnessFactor = { value: f.value, basis: f.basis, meshChange: f.meshChange };
    panel.cutouts = holes.map((h) => h.id);
    notes.push({ panel: panel.id, holes: holes.map((h) => h.id), factor: f.value, coarse: f.coarse, holeAreaM2: f.holeArea });
  }
  // gear-lever opening: split the gearbox cell at its front edge; the members over it are an open channel
  const g = openings.service.find((h) => h.id === "gear-lever");
  const f1 = layout.members.findIndex((m) => m.id === "tunnel-f1");
  if (g && f1 >= 0) {
    const part = layout.parts.find((p) => p.id === layout.members[f1].part);
    const geo = part.geometry;
    const zT = layout.nodes.find((n) => n.id === "T1.98").z;
    layout.nodes.push({ id: `T${g.x0}`, x: g.x0, y: 0, z: zT });
    // the top wall is left either side of the opening: two lips of (cell width - opening width) / 2
    const open = { shape: "u-channel", width: parseFloat(geo.width), height: parseFloat(geo.height), wall: parseFloat(geo.wall), lip: r4((parseFloat(geo.width) - g.width) / 2) };
    const i0 = layout.members[f1].i;
    layout.members.splice(f1, 1, { id: "tunnel-f1", i: i0, j: `T${g.x0}`, part: part.id }, { id: "tunnel-f1-open", i: `T${g.x0}`, j: "T1.98", part: part.id, section: open, cutout: "gear-lever" });
    const f2 = layout.members.find((m) => m.id === "tunnel-f2");
    if (f2 && g.x1 >= 2.06) { f2.section = open; f2.cutout = "gear-lever"; }
    notes.push({ member: "tunnel-f1-open, tunnel-f2", from: "rect-tube (closed cell)", to: `lipped open channel over x ${g.x0}-${g.x1} (top wall cut ${mm(g.width)} mm wide, ${mm(open.lip)} mm lips left)` });
  }
  return notes;
}

/**
 * A hypothetical closed shell: every door and glazing opening panelled with the floor's sheet (for the
 * stiffness the openings cost). Adds panels to a copy of the frame model; not a design.
 */
export function closedReference(frameModel, layout) {
  const fm = JSON.parse(JSON.stringify(frameModel));
  const sheet = layout.parts.find((p) => /^TUB_FLOOR_L$/.test(p.id)).id;
  const quads = [];
  for (const s of ["L", "R"]) {
    quads.push({ id: `closed-front-${s}`, nodes: [`S${layout.choices.firewallX}.${s}`, `BK.${s}`, `RR1.${s}`, `RR0.${s}`] });
    quads.push({ id: `closed-apillar-${s}`, nodes: [`S${layout.choices.firewallX}.${s}`, `RR0.${s}`, `FWA.${s}`, `FWU.${s}`] });
    quads.push({ id: `closed-rear-${s}`, nodes: [`BK.${s}`, `QA.${s}`, `RR2.${s}`, `RR1.${s}`] });
  }
  quads.push({ id: "closed-windscreen", nodes: ["FWA.L", "FWA.R", "RR0.R", "RR0.L"] });
  quads.push({ id: "closed-backlight", nodes: ["RR1.L", "RR1.R", "RR2.R", "RR2.L"] });
  fm.panels.push(...quads.map((q) => ({ ...q, part: sheet })));
  return fm;
}

/**
 * Check the openings against the tub and the occupants (packageScene scenarios). Returns
 * { rows, failures, warnings, margins }.
 */
export function checkOpenings(openings, layout, scenarios) {
  // layout: anything with the frame model's nodes, members and panels (a tubLayout, or CHASSIS.props.frameModel)
  const rows = [], failures = [], warnings = [], margins = [];
  const node = (id) => layout.nodes.find((n) => n.id === id);
  // egress through the door apertures
  for (const [key, occ] of Object.entries(scenarios)) {
    for (const o of occ) {
      const side = o.landmarks.y >= 0 ? "L" : "R";
      const [hx, hz] = o.landmarks.hPoint;
      // the egress line rises from the H-point; it meets the aperture at the H-point's height or at the
      // aperture's sill if that is higher (the occupant rises over the sill)
      const zAt = (d) => Math.max(hz, Math.min(...d.outline.map((p) => p[1]))) + 0.01;
      const door = openings.doors.filter((d) => d.side === side).find((d) => pointInPoly([hx, zAt(d)], d.outline));
      if (!door) { failures.push(`${o.seat} (${key}): no door aperture over the H-point x ${r4(hx)} m`); continue; }
      const z = zAt(door);
      // clear x at the egress line's foot, and the aperture's height over the H-point at that x
      const edges = door.outline.map((p, i) => [p, door.outline[(i + 1) % door.outline.length]]);
      const crossX = edges.filter(([p, q]) => (p[1] - z) * (q[1] - z) < 0 || (p[1] === z && q[1] === z)).map(([p, q]) => (p[1] === q[1] ? p[0] : p[0] + ((q[0] - p[0]) * (z - p[1])) / (q[1] - p[1])));
      const fore = Math.max(...crossX.filter((x) => x <= hx)), aft = Math.min(...crossX.filter((x) => x >= hx));
      const top = Math.min(...edges.filter(([p, q]) => (p[0] - hx) * (q[0] - hx) <= 0 && p[0] !== q[0]).map(([p, q]) => p[1] + ((q[1] - p[1]) * (hx - p[0])) / (q[0] - p[0])).filter((zz) => zz > z));
      const clearHeight = top - hz;
      const row = { seat: o.seat, occupant: key, door: door.id, hPointX: r4(hx), foreClearanceM: r4(hx - fore), aftClearanceM: r4(aft - hx), clearHeightAboveHPointM: r4(clearHeight), seatedHeadTopAboveHPointM: r4(o.entry.need) };
      rows.push(row);
      margins.push({ check: `${o.seat} ${key}: egress line inside ${door.id} (clearance to the nearer pillar ≥ 0)`, demand: 0, capacity: Math.min(row.foreClearanceM, row.aftClearanceM), unit: "m" });
      if (Math.min(row.foreClearanceM, row.aftClearanceM) < 0) failures.push(`${o.seat} ${key}: egress line outside ${door.id}`);
      if (clearHeight < o.entry.need) warnings.push(`${o.seat} ${key}: ${door.id} clears ${mm(clearHeight)} mm over the H-point at the roof rail, the seated head top is ${mm(o.entry.need)} mm: entry needs a ${mm(o.entry.need - clearHeight)} mm duck (no aperture requirement sourced; real entry involves ducking)`);
    }
  }
  // glazing: no credited sheet may use a glazing opening's corners as its own
  for (const g of openings.glazing.filter((x) => x.corners)) {
    const set = new Set(g.corners);
    const hit = layout.panels.filter((p) => p.nodes.every((n) => set.has(n)));
    rows.push({ glazing: g.id, areaM2: g.areaM2, creditedSheetsInIt: hit.map((p) => p.id) });
    if (hit.length) failures.push(`${g.id}: credited sheet(s) ${hit.map((p) => p.id).join(", ")} sit in a glazing opening`);
    // and no member crosses it (a member joining two non-adjacent corners)
    const diag = layout.members.filter((m) => (m.i === g.corners[0] && m.j === g.corners[2]) || (m.i === g.corners[1] && m.j === g.corners[3]));
    if (diag.length) failures.push(`${g.id}: member(s) ${diag.map((m) => m.id).join(", ")} cross it`);
  }
  // service cut-outs: inside the firewall sheet's physical extent, clear of its boundary members and of each other
  const sheetZ = openings.sheetBounds.z, sheetY = openings.sheetBounds.y;
  const holes = openings.service.filter((h) => h.shape === "circle");
  for (const h of holes) {
    const rr = h.d / 2, ay = Math.abs(h.y);
    const edge = Math.min(h.z - rr - sheetZ[0], sheetZ[1] - (h.z + rr), ay - rr - sheetY[0], sheetY[1] - (ay + rr));
    rows.push({ cutout: h.id, sheet: h.cuts, edgeDistanceM: r4(edge) });
    margins.push({ check: `${h.id}: inside the firewall sheet, clear of the lower cross, scuttle and posts`, demand: 0, capacity: r4(edge), unit: "m" });
    if (edge < 0) failures.push(`${h.id} cuts into the firewall's boundary members by ${mm(-edge)} mm`);
  }
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i], b = holes[j];
      if (a.side !== b.side) continue;
      const gap = Math.hypot(a.y - b.y, a.z - b.z) - a.d / 2 - b.d / 2;
      if (gap < 0) failures.push(`${a.id} and ${b.id} overlap by ${mm(-gap)} mm`);
    }
  }
  const lever = openings.service.find((h) => h.id === "gear-lever");
  if (lever) {
    const tw = 0.31;
    rows.push({ cutout: "gear-lever", x: [lever.x0, lever.x1], widthM: lever.width, tunnelCellWidthM: tw });
    if (lever.width > tw - 0.02) failures.push("gear-lever opening wider than the tunnel cell's top less its corners");
    if (!(node("T1.98"))) failures.push("gear-lever opening: tunnel node missing");
  }
  return { rows, failures, warnings, margins };
}
