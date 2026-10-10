// server/lib/conkay/cad/design-surface.js
//
// Roadmap 5 item 1. Panel cuts, glazing, lamp apertures and wheel-arch
// curves drawn on the package that already exists (the tub openings of
// brief 4 item 2, the sourced tyre, the CAD body parameters). Nothing
// here is measured off the styling reference, and nothing here trims
// the CAD solid or cuts another hole in the tub.
//
// The reference (car-style-ref-20261010.png) is a glossy two-door
// fastback: a long hood, slim headlamps, one glasshouse with no
// visible B-pillar, flush door cuts, and wheels that fill the arches.
// The image has no scale. Those proportions are conflicts, recorded
// below, not inputs.

const r4 = (v) => Math.round(v * 1e4) / 1e4;

export const DESIGN_SURFACE_VERSION = "1.0.0";

/** What the styling reference shows, and the limit on using it. */
export const STYLE_REFERENCE = Object.freeze({
  file: "car-style-ref-20261010.png",
  shows: Object.freeze([
    "two-door fastback coupe",
    "long sculpted hood",
    "slim angular headlamps",
    "one side glasshouse with no visible B-pillar",
    "fastback roof into a short rear deck",
    "flush door cuts",
    "large wheels filling the arches",
  ]),
  dimensions: "none: no length can be read from the image",
});

/**
 * Lamp slot, in metres. Each value is a design choice. None is taken
 * from the reference.
 */
export const LAMP_CHOICES = Object.freeze({
  slotHeightM: { value: 0.045, basis: "design choice: a slim horizontal slot, 45 mm tall. Not measured from the styling reference (the image has no scale)." },
  inboardYM: { value: 0.28, basis: "design choice: the slot's inboard end is 280 mm off the centreline. Not measured from the styling reference." },
  aboveTipM: { value: 0.02, basis: "design choice: the slot stays at least 20 mm above the nose-tip height, so it is on the nose rather than on the tip." },
  belowBeltM: { value: 0.02, basis: "design choice: the slot stays at least 20 mm below the lowest belt line, so it is on the nose rather than in the greenhouse." },
});

/** Side-glass reveal inside each door aperture. */
export const GLASS_REVEAL = Object.freeze({
  value: 0.04,
  basis: "design choice: side glass sits 40 mm inside the door aperture, for a frame and a seal. Not measured from the styling reference.",
});

/** A length in metres. Accepts a number or a quantity string ("620 mm", "0.62 m"). */
export function metres(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return NaN;
  if (/mm\b/i.test(v)) return n / 1000;
  return n;
}

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** True when every turn has the same sense (collinear steps are skipped). */
export function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return poly.length >= 3;
}

/**
 * Inset a convex polygon by d (metres). Inward is to the left of a
 * CCW boundary and to the right of a CW one. Returns null if the
 * polygon is not convex or an offset edge disappears.
 */
export function insetConvex(poly, d) {
  if (!(d > 0) || !isConvex(poly)) return null;
  const sign = Math.sign(signedArea(poly)) || 1;
  const lines = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return null;
    const nx = sign > 0 ? -dz / len : dz / len;
    const nz = sign > 0 ? dx / len : -dx / len;
    lines.push({ ox: p[0] + nx * d, oz: p[1] + nz * d, dx: dx / len, dz: dz / len });
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[(i - 1 + lines.length) % lines.length], b = lines[i];
    const den = a.dx * b.dz - a.dz * b.dx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((b.ox - a.ox) * b.dz - (b.oz - a.oz) * b.dx) / den;
    out.push([r4(a.ox + t * a.dx), r4(a.oz + t * a.dz)]);
  }
  if (!isConvex(out) || Math.abs(signedArea(out)) >= Math.abs(signedArea(poly)) - 1e-8) return null;
  return out;
}

/** Upper semicircle in the side view, from the forward lip (smaller x) through the crown to the rearward lip. */
export function upperArch(cx, cz, radius, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = Math.PI * (1 - i / n);
    pts.push([r4(cx + radius * Math.cos(th)), r4(cz + radius * Math.sin(th))]);
  }
  return pts;
}

function nodeAt(nodes, id) {
  return nodes.find((n) => n.id === id) || null;
}

function lampSlots(body, tyre) {
  const need = ["noseTipHeightM", "beltMinM", "fenderCoverM"];
  if (!body || need.some((k) => !Number.isFinite(body[k]))) {
    return { state: "not placed", reason: "the shell has no nose-tip height, belt line and fender cover to bound a lamp" };
  }
  if (!tyre || !(tyre.trackHalfM > 0) || !(tyre.sectionWidthM > 0)) {
    return { state: "not placed", reason: "the front tyre's track and section width are not both known" };
  }
  const z0 = body.noseTipHeightM + LAMP_CHOICES.aboveTipM.value;
  const z1 = body.beltMinM - LAMP_CHOICES.belowBeltM.value;
  const h = LAMP_CHOICES.slotHeightM.value;
  if (!(z1 - z0 > h)) {
    return { state: "not placed", reason: `the nose band from ${r4(z0)} m to ${r4(z1)} m is shorter than the ${h} m slot` };
  }
  const zc = (z0 + z1) / 2;
  const yOut = tyre.trackHalfM - tyre.sectionWidthM / 2 - body.fenderCoverM;
  const yIn = LAMP_CHOICES.inboardYM.value;
  if (!(yOut > yIn)) {
    return { state: "not placed", reason: `the outboard end ${r4(yOut)} m is not outboard of the inboard end ${yIn} m` };
  }
  const slot = (side, sign) => ({
    id: `headlamp-${side}`,
    kind: "lamp-aperture",
    side,
    outlineYZ: [[sign * yIn, r4(zc - h / 2)], [sign * yOut, r4(zc - h / 2)], [sign * yOut, r4(zc + h / 2)], [sign * yIn, r4(zc + h / 2)]],
    bounds: {
      zLowM: r4(z0), zHighM: r4(z1),
      yInM: yIn, yOutM: r4(yOut),
    },
  });
  return {
    state: "placed",
    basis: [
      LAMP_CHOICES.slotHeightM.basis,
      LAMP_CHOICES.inboardYM.basis,
      LAMP_CHOICES.aboveTipM.basis,
      LAMP_CHOICES.belowBeltM.basis,
      "The vertical centre is the midpoint of the band between the nose tip (plus the clearance above it) and the belt (minus the clearance below it). The outboard end stops one fender-cover inside the front tyre's inner face.",
    ],
    slots: [slot("R", -1), slot("L", 1)],
  };
}

function wheelArches(tyres, archClearanceM) {
  if (!(archClearanceM >= 0)) return { state: "not drawn", reason: "no arch clearance on this shell" };
  const arches = [];
  for (const t of tyres) {
    if (!(t.diameterM > 0) || !t.position || !Number.isFinite(t.position.x) || !Number.isFinite(t.position.z)) continue;
    const r = t.diameterM / 2;
    const swept = t.steered && t.sectionWidthM > 0 ? Math.hypot(r, t.sectionWidthM / 2) : r;
    const radius = swept + archClearanceM;
    arches.push({
      id: `arch-${t.id}`,
      tyre: t.id,
      steered: Boolean(t.steered),
      centre: [r4(t.position.x), r4(t.position.z)],
      tyreRadiusM: r4(r),
      sweptRadiusM: r4(swept),
      archRadiusM: r4(radius),
      outline: upperArch(t.position.x, t.position.z, radius),
    });
  }
  return {
    state: arches.length ? "drawn" : "not drawn",
    basis: "The arch is the wheel well the CAD body already cuts: tyre radius, plus the steered swept radius sqrt(r^2 + (section/2)^2) on the front axle, plus archClearance (cad/body-params.js, a design choice). It is drawn, not recut.",
    archClearanceM,
    arches,
  };
}

function sideGlass(doors) {
  const pieces = [];
  for (const d of doors) {
    const outline = insetConvex(d.outline, GLASS_REVEAL.value);
    pieces.push(outline ? {
      id: `side-glass-${d.id.replace("door-", "")}`,
      kind: "glazing",
      inDoor: d.id,
      revealM: GLASS_REVEAL.value,
      basis: GLASS_REVEAL.basis,
      outline,
      state: "inset",
    } : {
      id: `side-glass-${d.id.replace("door-", "")}`,
      kind: "glazing",
      inDoor: d.id,
      revealM: null,
      basis: GLASS_REVEAL.basis,
      outline: d.outline,
      state: "aperture",
      reason: "A uniform reveal needs a convex aperture. This outline is not convex: the rear door steps around the wheel arch. The glass line is the aperture itself. No reveal is invented along that step.",
    });
  }
  return pieces;
}

function glazingQuads(glazing, nodes) {
  const quads = [];
  for (const g of glazing.filter((x) => x.corners)) {
    const pts = g.corners.map((id) => {
      const n = nodeAt(nodes, id);
      return n ? [r4(n.x), r4(n.y), r4(n.z)] : null;
    });
    quads.push({
      id: g.id, kind: "glazing", name: g.name, corners: g.corners,
      outlineXYZ: pts.every(Boolean) ? pts : null,
      state: pts.every(Boolean) ? "on the tub nodes" : "a corner node is missing",
      areaM2: g.areaM2 ?? null,
    });
  }
  return quads;
}

function bPillar(doors) {
  const rows = [];
  for (const side of ["L", "R"]) {
    const front = doors.find((d) => d.id === `door-front-${side}`);
    const rear = doors.find((d) => d.id === `door-rear-${side}`);
    if (!front || !rear) continue;
    const aft = Math.max(...front.outline.map((p) => p[0]));
    const fore = Math.min(...rear.outline.map((p) => p[0]));
    rows.push({ side, aftOfFrontDoorM: r4(aft), foreOfRearDoorM: r4(fore), widthM: r4(fore - aft) });
  }
  return rows;
}

/**
 * The design-surface layers and the conflicts with the styling reference.
 * spec: { openings, nodes, tyres, body, tyreRecord, recheck }.
 * body fields are metres. tyres carry diameterM, sectionWidthM, steered, position {x,y,z}.
 * recheck is filled by the solver from the other solvers; omitted here it stays absent.
 */
export function designSurface(spec) {
  const openings = spec.openings;
  const doors = openings?.doors || [];
  const nodes = spec.nodes || [];
  const tyres = spec.tyres || [];
  const body = spec.body || null;
  const tyreRecord = spec.tyreRecord || null;
  const pillars = bPillar(doors);
  const front = tyres.find((t) => t.id === "TIRE_FL") || tyres.find((t) => t.steered);
  const lamps = lampSlots(body, front ? { trackHalfM: Math.abs(front.position?.y), sectionWidthM: front.sectionWidthM } : null);
  const arches = wheelArches(tyres, body?.archClearanceM);
  const railZ = nodes.filter((n) => /^RR\d/.test(n.id)).map((n) => n.z).filter((z) => Number.isFinite(z));
  const roofRailZM = railZ.length ? r4(Math.max(...railZ)) : null;

  const conflicts = [
    {
      id: "rear-doors-b-pillar",
      reference: "The image is a two-door coupe. No B-pillar shows in the side glass.",
      package: `The package seats four and has ${doors.length} door apertures. The B-pillar is the gap between the front and rear apertures: ${pillars.map((p) => `${p.side} ${p.widthM} m`).join(", ") || "not found"}.`,
      copied: false,
    },
    {
      id: "wheel-size",
      reference: "The image shows wheels that fill the arches. No diameter can be read from it.",
      package: tyreRecord?.dimensions?.overallDiameterM
        ? `${tyreRecord.id}: overall diameter ${tyreRecord.dimensions.overallDiameterM} m, section ${tyreRecord.dimensions.sectionWidthM} m, rim ${tyreRecord.dimensions.rimDiameterIn} in. Source: ${tyreRecord.dimensions.source?.title || "library"} ${tyreRecord.dimensions.source?.url || ""}.`
        : "The tyre diameter is not on the component record.",
      copied: false,
    },
    {
      id: "roof-height",
      reference: "The image shows a low, long greenhouse. No roof height can be read from it.",
      package: [
        roofRailZM != null ? `The tub's highest roof-rail node is at z ${roofRailZM} m (structure, not the skin).` : "No roof-rail node was found.",
        Number.isFinite(body?.beltMaxM)
          ? `The CAD parameters were not edited: beltMax ${body.beltMaxM} m, fastback ${body.fastbackDeg} deg, nose extension ${body.noseExtensionM} m (each a design choice in cad/body-params.js).`
          : "This shell is not the CAD body, so the belt, the fastback and the nose extension are not on it.",
        Number.isFinite(spec.recheck?.roofHeightM) ? `The CAD solid's height is ${spec.recheck.roofHeightM} m (cad.body).` : "The CAD solid's height is not computed on this run.",
      ].join(" "),
      copied: false,
    },
    {
      id: "nose-length",
      reference: "The image shows a long hood.",
      package: Number.isFinite(body?.noseExtensionM)
        ? `The nose extension is ${body.noseExtensionM} m ahead of the frontmost enclosed envelope (cad/body-params.js, a design choice). It was not lengthened.`
        : "No nose extension is on this shell.",
      copied: false,
    },
    {
      id: "glasshouse",
      reference: "The image has one side glass, unbroken by a pillar.",
      package: "Side glass is split into a front piece and a rear piece by the B-pillar, one in each door. It was not joined into one opening.",
      copied: false,
    },
  ];

  return {
    version: DESIGN_SURFACE_VERSION,
    reference: STYLE_REFERENCE,
    skinTrimmed: false,
    tubRecut: false,
    layers: {
      panelCuts: doors.map((d) => ({
        id: d.id, kind: "door-cut", side: d.side, name: d.name,
        outline: d.outline, lengthAtSillM: d.lengthAtSillM, heightM: d.heightM,
        flush: "The cut line is the aperture edge. No moulding offset is added. The CAD solid is not trimmed.",
      })),
      bPillar: pillars,
      glazing: [
        ...glazingQuads(openings?.glazing || [], nodes),
        ...sideGlass(doors),
      ],
      lamps,
      wheelArches: arches,
    },
    conflicts,
    continuity: {
      g2Claim: false,
      skin: "The CAD skin, when it is solved, is a least-squares cubic B-spline (cad.body). A cubic B-spline is not fair everywhere; fairness is the kernel's curvature count, not an assumption. These layers are polylines. A polyline is only G0 at its corners, and they are not trimmed into the spline, so they do not change it.",
      zebra: "render_zebra.py can reflect an existing STEP of this skin. That image is of the skin as lofted. It is not a restyle, and it is not evidence that the surface is G2.",
    },
    recheck: spec.recheck || null,
    assumptions: [
      "The layers follow the tub openings (structural/car-openings.js) and the CAD body parameters. They do not cut the skin and they do not cut another hole in the tub.",
      "Door and glazing holes in the tub are brief 4 item 2. Glazing is not credited as structure there.",
      "No coordinate is taken from the styling reference. Where the reference and the package disagree, the package is kept and the disagreement is a conflict.",
      "Flush is the absence of an added moulding offset on the aperture line. It is not a claim that the solid was recut.",
    ],
  };
}
