// server/lib/conkay/drawings/ga-drawing.js
//
// General-arrangement (GA) drawing of a vehicle, as sheets (drawings/sheet.js):
//   sheet 1: side elevation, plan and front view of the CAD body (hidden-line
//            projections from the kernel), tyres and axle centre lines, the key
//            dimensions, the first-angle projection symbol and the title block;
//   sheet 2: the bill of materials, the dimension table with the basis of every
//            value, and the notes (method, tolerance, what the drawing is not).
// Pure: the same input gives the same sheets. Every dimension shown is passed
// in with its value and basis (C computed, D design choice / derived layout,
// S sourced); nothing is measured off the picture.

import { fitText, ascii } from "./sheet.js";

export const SHEET_A3 = [420, 297];
const BORDER = 10;

const mmText = (m) => `${Math.round(m * 1000)}`;

function line(items, pts, style = "solid", w) { items.push({ t: "line", pts, style, ...(w ? { w } : {}) }); }
function text(items, x, y, s, size = 2.5, anchor = "start", bold = false) { items.push({ t: "text", x, y, s: ascii(s), size, anchor, bold }); }

/** Horizontal dimension between model x positions a and b (sheet mm), dimension line at yDim, extension lines from yFrom. */
function dimH(items, a, b, yFrom, yDim, label) {
  const dir = yDim < yFrom ? -1 : 1;
  line(items, [[a, yFrom + dir * 1], [a, yDim + dir * 1.5]], "thin");
  line(items, [[b, yFrom + dir * 1], [b, yDim + dir * 1.5]], "thin");
  line(items, [[a, yDim], [b, yDim]], "thin");
  items.push({ t: "arrow", x: a, y: yDim, dx: -1, dy: 0 }, { t: "arrow", x: b, y: yDim, dx: 1, dy: 0 });
  text(items, (a + b) / 2, yDim + 0.8, label, 2.5, "middle");
}

/** Vertical dimension between sheet heights a and b, dimension line at xDim, extension lines from xFrom. */
function dimV(items, a, b, xFrom, xDim, label, textAt = "side") {
  const dir = xDim < xFrom ? -1 : 1;
  line(items, [[xFrom + dir * 1, a], [xDim + dir * 1.5, a]], "thin");
  line(items, [[xFrom + dir * 1, b], [xDim + dir * 1.5, b]], "thin");
  line(items, [[xDim, a], [xDim, b]], "thin");
  items.push({ t: "arrow", x: xDim, y: a, dx: 0, dy: -1 }, { t: "arrow", x: xDim, y: b, dx: 0, dy: 1 });
  if (textAt === "top") text(items, xDim, Math.max(a, b) + 2.5, label, 2.5, "middle");
  else text(items, xDim + (dir < 0 ? -0.8 : 0.8), (a + b) / 2 - 1, label, 2.5, dir < 0 ? "end" : "start");
}

function view(items, v, map, { hidden = true } = {}) {
  if (hidden) for (const l of v.hidden) line(items, l.map(map), "hidden");
  for (const l of v.visible) line(items, l.map(map), "solid");
  if (v.outline) line(items, v.outline.map(map), "solid");
}

function frame(items, [W, H]) {
  items.push({ t: "rect", x: BORDER, y: BORDER, w: W - 2 * BORDER, h: H - 2 * BORDER, lw: 0.7 });
}

function firstAngleSymbol(items, x, y) {
  // ISO 128 / ISO 5456-2 first-angle symbol: truncated cone side view, then its end view (two circles) to the right
  line(items, [[x, y + 1.5], [x + 8, y], [x + 8, y + 6], [x, y + 4.5], [x, y + 1.5]], "thin");
  line(items, [[x - 1, y + 3], [x + 9, y + 3]], "centre");
  items.push({ t: "circle", cx: x + 14, cy: y + 3, r: 3, style: "thin" }, { t: "circle", cx: x + 14, cy: y + 3, r: 1.5, style: "thin" });
  line(items, [[x + 10, y + 3], [x + 18, y + 3]], "centre");
}

export function titleBlock(items, t, [W]) {
  const x0 = W - BORDER - 180, y0 = BORDER, w = 180, h = 46;
  items.push({ t: "rect", x: x0, y: y0, w, h, lw: 0.5 });
  const rows = [y0 + 38, y0 + 30, y0 + 22, y0 + 14, y0 + 6];
  for (const y of rows.slice(1)) line(items, [[x0, y + 4], [x0 + w, y + 4]], "thin");
  line(items, [[x0 + 110, y0], [x0 + 110, y0 + 34]], "thin");
  text(items, x0 + 2, y0 + 39.5, fitText(t.title, 4, w - 4), 4, "start", true);
  text(items, x0 + 2, rows[1], fitText(`Drawing no. ${t.number}   Sheet ${t.sheet}`, 2.8, 106), 2.8);
  text(items, x0 + 2, rows[2], fitText(`Scale 1:${t.scale} (A3)   Units ${t.units || "mm"}   ${t.projection}`, 2.8, 106), 2.8);
  text(items, x0 + 2, rows[3], fitText(`Model: ${t.model}`, 2.2, 106), 2.2);
  text(items, x0 + 2, rows[4], fitText(t.status, 2.2, 106), 2.2, "start", true);
  text(items, x0 + 2, y0 + 1.6, fitText(t.generated, 1.8, 106), 1.8);
  text(items, x0 + 112, rows[1], "Revision", 2.2);
  text(items, x0 + 112, rows[2] - 1, t.revision, 5, "start", true);
  text(items, x0 + 112, rows[3], fitText(`model hash ${t.modelHash.slice(0, 32)}`, 1.8, 66), 1.8);
  text(items, x0 + 112, rows[4] + 1.5, fitText(`${t.modelHash.slice(32)}`, 1.8, 66), 1.8);
  firstAngleSymbol(items, x0 + 150, y0 + 23);
  return { x0, y0, w, h };
}

/**
 * input: { title, number, scale (n for 1:n), revision, modelHash, status, generated, model,
 *          views: { side, plan, front } (kernel polylines, metres), body: { min:[x,y,z], max:[x,y,z] },
 *          axles: { frontX, rearX }, tyres: [{ id, x, y, r, halfWidth }],
 *          dims: { id: { valueM, basis } }, dimRows: [...], bom: [...], notes: [...] }
 */
export function buildGaSheets(input) {
  const sheetCount = input.sheet3 ? 3 : 2;
  const k = 1000 / input.scale; // sheet mm per model metre
  const [W, H] = SHEET_A3;
  const { min, max } = input.body;
  const d = input.dims;
  const tag = (id) => `${mmText(d[id].valueM)} ${d[id].basis}`;

  // ---- sheet 1
  const s1 = [];
  frame(s1, SHEET_A3);
  const X0 = 30, G = 212; // side view: model x = min x at X0, ground at G
  const side = ([x, z]) => [X0 + (x - min[0]) * k, G + z * k];
  const PY = 125; // plan view centre line
  const plan = ([x, y]) => [X0 + (x - min[0]) * k, PY + y * k];
  const FX = 300; // front view centre (y = 0)
  const front = ([u, z]) => [FX + u * k, G + z * k];

  text(s1, X0, G + (max[2] * k) + 8, "SIDE ELEVATION (left side)", 2.8, "start", true);
  view(s1, input.views.side, side);
  line(s1, [[X0 - 8, G], [X0 + (max[0] - min[0]) * k + 8, G]], "thin"); // ground line
  for (const ax of [input.axles.frontX, input.axles.rearX]) line(s1, [side([ax, -0.06]), side([ax, max[2] + 0.06])], "centre");
  for (const ty of input.tyres.filter((t) => t.y < 0)) s1.push({ t: "circle", cx: side([ty.x, 0])[0], cy: G + ty.r * k, r: ty.r * k, style: "phantom" });

  text(s1, X0, PY + max[1] * k + 6, "PLAN (from above; the car's right side at the top)", 2.8, "start", true);
  view(s1, input.views.plan, plan);
  line(s1, [plan([min[0] - 0.15, 0]), plan([max[0] + 0.15, 0])], "centre");
  for (const ty of input.tyres) {
    const a = plan([ty.x - ty.r, ty.y - ty.halfWidth]), b = plan([ty.x + ty.r, ty.y + ty.halfWidth]);
    line(s1, [a, [b[0], a[1]], b, [a[0], b[1]], a], "phantom");
  }
  for (const ax of [input.axles.frontX, input.axles.rearX]) line(s1, [plan([ax, min[1] - 0.06]), plan([ax, max[1] + 0.06])], "centre");

  text(s1, FX - (max[1] * k), G + (max[2] * k) + 8, "FRONT VIEW", 2.8, "start", true);
  view(s1, input.views.front, front, { hidden: false });
  line(s1, [[FX - max[1] * k - 6, G], [FX + max[1] * k + 6, G]], "thin");
  line(s1, [front([0, -0.06]), front([0, max[2] + 0.06])], "centre");
  const frontTyres = input.tyres.filter((t) => t.x === input.axles.frontX);
  for (const ty of frontTyres) {
    const u = -ty.y; // front view: drawing x = -model y
    const a = front([u - ty.halfWidth, 0]), b = front([u + ty.halfWidth, 2 * ty.r]);
    line(s1, [a, [b[0], a[1]], b, [a[0], b[1]], a], "phantom");
    line(s1, [front([u, -0.08]), front([u, 2 * ty.r + 0.04])], "centre");
  }

  // dimensions: side elevation
  const xs = (x) => side([x, 0])[0];
  dimH(s1, xs(min[0]), xs(input.axles.frontX), G, G - 9, tag("frontOverhang"));
  dimH(s1, xs(input.axles.frontX), xs(input.axles.rearX), G, G - 9, tag("wheelbase"));
  dimH(s1, xs(input.axles.rearX), xs(max[0]), G, G - 9, tag("rearOverhang"));
  dimH(s1, xs(min[0]), xs(max[0]), G, G - 17, tag("overallLength"));
  const midX = (input.axles.frontX + input.axles.rearX) / 2;
  dimV(s1, G, G + d.groundClearance.valueM * k, xs(midX), xs(midX) + 1, "");
  text(s1, xs(midX) + 3, G + 1, `${tag("groundClearance")} (lowest point of the body)`, 2.2);
  dimV(s1, G, G + max[2] * k, front([max[1], 0])[0], front([max[1], 0])[0] + 8, tag("overallHeight"));
  // plan
  dimV(s1, PY + min[1] * k, PY + max[1] * k, X0, X0 - 12, tag("overallWidth"), "top");
  // front view: track
  if (frontTyres.length === 2) {
    const [l, r] = frontTyres.map((t) => front([-t.y, 0])[0]).sort((a, b) => a - b);
    dimH(s1, l, r, G - 2, G - 11, tag("frontTrack"));
  }
  dimH(s1, front([min[1], 0])[0], front([max[1], 0])[0], G - 2, G - 19, tag("overallWidth"));

  // notes and dimension legend (sheet 1, above the title block)
  const nx = W - BORDER - 180, ny = BORDER + 50;
  text(s1, nx, ny + 54, "NOTES", 2.8, "start", true);
  const n1 = [
    "Dimensions in mm. C = computed from the CAD body (kernel receipt), D = layout design",
    "choice or derivation, S = sourced (cited). Values and bases: sheet 2.",
    "Hidden-line projection of the B-rep body (OpenCascade polygonal HLR); edges within the",
    `tessellation deflection (${input.toleranceText}). Tyres and axles: phantom / centre lines.`,
    input.cutaway?.length
      ? "Cutaway lines (thin) are the assembly projection: occupants, openings, controls and powertrain envelopes."
      : "Outer skin only: no doors, glazing openings, closures or structure. Front view: hidden lines omitted.",
    "Revision = hash of the model this sheet was generated from. Any change to the body,",
    "layout or BOM gives a new revision; a sheet whose revision differs from the model's",
    "current one is superseded.",
    ...input.notes.slice(0, 2),
  ];
  n1.forEach((s, i) => text(s1, nx, ny + 48 - i * 4.2, fitText(s, 2.3, 178), 2.3));
  for (const c of input.cutaway || []) {
    const pts = (c.pts || []).map(side);
    if (pts.length > 1) line(s1, pts, c.style || "thin", c.w);
  }
  titleBlock(s1, { ...input, sheet: `1 of ${sheetCount}` }, SHEET_A3);

  // ---- sheet 2: BOM, dimension table, notes
  const s2 = [];
  frame(s2, SHEET_A3);
  let y = H - BORDER - 8;
  text(s2, BORDER + 4, y, "BILL OF MATERIALS (component library + designed parts)", 3.2, "start", true);
  y -= 7;
  const cols = [
    ["Item", 10], ["Qty", 9], ["Nodes", 52], ["Description", 94], ["Library id / material", 98], ["Unit mass kg", 22], ["Mass state", 20], ["Source", 85],
  ];
  const x0 = BORDER + 4;
  const rowH = 5;
  const drawRow = (cells, yy, bold = false, size = 2.3) => {
    let x = x0;
    cells.forEach((c, i) => {
      const [, w] = cols[i];
      text(s2, i === 5 ? x + w - 1.5 : x + 1, yy + 1.5, fitText(c, size, w - 2.5), size, i === 5 ? "end" : "start", bold);
      x += w;
    });
    line(s2, [[x0, yy], [x, yy]], "thin");
  };
  drawRow(cols.map(([c]) => c), y, true, 2.4);
  for (const r of input.bom) {
    y -= rowH;
    drawRow([String(r.item), String(r.qty), r.nodes.join(", "), r.description, r.libraryId, r.unitMassKg == null ? "not computed" : r.unitMassKg.toFixed(2), r.massState || "", r.source || ""], y);
  }
  y -= rowH;
  text(s2, x0 + 1, y + 1.5, fitText(input.bomNote, 2.2, 390), 2.2);
  y -= 10;
  text(s2, x0, y, "KEY DIMENSIONS (value, basis, where it comes from)", 3.2, "start", true);
  y -= 6;
  for (const r of input.dimRows) {
    text(s2, x0 + 1, y, fitText(r.label, 2.3, 48), 2.3);
    text(s2, x0 + 70, y, `${mmText(d[r.id].valueM)}`, 2.3, "end");
    text(s2, x0 + 74, y, d[r.id].basis, 2.3, "start", true);
    text(s2, x0 + 80, y, fitText(r.from, 2.1, 310), 2.1);
    y -= 4.2;
  }
  y -= 4;
  text(s2, x0, y, "NOTES", 3.2, "start", true);
  y -= 5.5;
  for (const s of input.notes) {
    text(s2, x0 + 1, y, fitText(s, 2.2, 385), 2.2);
    y -= 4;
    if (y < BORDER + 52) break;
  }
  titleBlock(s2, { ...input, sheet: `2 of ${sheetCount}` }, SHEET_A3);

  const sheets = [{ size: SHEET_A3, items: s1 }, { size: SHEET_A3, items: s2 }];
  if (input.sheet3) sheets.push(input.sheet3);
  return sheets;
}

/**
 * Sheet 3, projected from the assembly (not from the kernel solid).
 * Side cutaway, plan of the seat H-points, and the dimension / fit table.
 * meta: { scale, number, revision, modelHash, status, generated, model, title }
 */
export function buildPackagingSheet(assembly, meta) {
  const k = 1000 / meta.scale;
  const [W, H] = SHEET_A3;
  const b = assembly.surface.mesh.bounds;
  const items = [];
  items.push({ t: "rect", x: BORDER, y: BORDER, w: W - 2 * BORDER, h: H - 2 * BORDER, lw: 0.7 });
  const X0 = 28, G = 168;
  const side = ([x, z]) => [X0 + (x - b.min[0]) * k, G + z * k];
  const stations = assembly.surface.mesh.stations || [];
  if (stations.length > 1) {
    const roof = stations.map((st) => side([st.x, st.roofZ]));
    const floor = [...stations].reverse().map((st) => side([st.x, st.floorZ]));
    line(items, [...roof, ...floor, roof[0]], "solid");
    const belt = stations.map((st) => side([st.x, st.beltZ]));
    line(items, belt, "thin");
  }
  text(items, X0, G + (b.max[2] - 0) * k + 8, "SIDE CUTAWAY (assembly projection, left side)", 2.8, "start", true);
  for (const c of assembly.components) {
    if (c.mesh?.outline) line(items, c.mesh.outline.map((p) => side(p)), "thin");
    if (!c.half || !["occupant", "seat", "control", "powertrain", "cooling", "vision", "volume"].includes(c.role)) continue;
    if (c.id === "SPARE") continue;
    const x0 = c.placement.x - c.half[0], x1 = c.placement.x + c.half[0];
    const z0 = c.placement.z - c.half[2], z1 = c.placement.z + c.half[2];
    line(items, [side([x0, z0]), side([x1, z0]), side([x1, z1]), side([x0, z1]), side([x0, z0])], "thin");
  }
  const front = assembly.components.find((c) => c.id === "AXLE_FRONT");
  const rear = assembly.components.find((c) => c.id === "AXLE_REAR");
  const wbM = rear && front ? rear.placement.x - front.placement.x : null;
  if (wbM != null) {
    const a = side([front.placement.x, 0])[0], b2 = side([rear.placement.x, 0])[0];
    dimH(items, a, b2, G, G - 10, `${Math.round(wbM * 1000)} D`);
  }
  // plan of the H-points
  const PY = 78;
  const plan = ([x, y]) => [X0 + (x - b.min[0]) * k, PY + y * k];
  text(items, X0, PY + 28, "PLAN - SEAT H-POINTS (assembly)", 2.8, "start", true);
  line(items, [plan([b.min[0], 0]), plan([b.max[0], 0])], "centre");
  for (const c of assembly.components.filter((c) => c.role === "occupant" || c.role === "seat")) {
    const p = plan([c.placement.x, c.placement.y]);
    items.push({ t: "circle", cx: p[0], cy: p[1], r: c.role === "occupant" ? 1.6 : 2.4, style: "thin" });
    text(items, p[0] + 2, p[1] + 1, c.id, 1.8);
  }
  // table
  let y = H - BORDER - 8;
  const x0 = 250;
  text(items, x0, y, "PACKAGING DIMENSIONS AND FIT", 3, "start", true);
  y -= 5;
  for (const row of assembly.standards || []) {
    text(items, x0, y, fitText(`${row.id}  ${row.valueMm} ${row.unit}  ${row.state}  ${row.standard}`, 2, 155), 2);
    y -= 3.6;
  }
  y -= 2;
  text(items, x0, y, "FIT CHECKS", 2.8, "start", true);
  y -= 4.5;
  for (const c of assembly.checks || []) {
    text(items, x0, y, fitText(`${c.status.toUpperCase()}  ${c.id}  ${c.detail || ""}`, 1.9, 155), 1.9);
    y -= 3.4;
    if (y < BORDER + 52) break;
  }
  text(items, x0, BORDER + 50, "Projected from the assembly. Envelopes are not kernel solids.", 1.8);
  titleBlock(items, { ...meta, sheet: "3 of 3", title: meta.title || "Packaging and occupant layout" }, SHEET_A3);
  return {
    size: SHEET_A3,
    items,
    projected: { wheelbaseMm: wbM == null ? null : Math.round(wbM * 1000) },
  };
}
