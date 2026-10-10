// server/lib/conkay/drawings/assembly-ga.js
//
// General-arrangement drawing of an assembly built from parts (a frame of
// tubes and plates plus datasheet envelopes, e.g. Sentinel Milestone 1), as
// sheets (drawings/sheet.js):
//   sheet 1: front elevation, the view from the right (placed right of the
//            front view) and the plan (below it), first-angle; exact hidden
//            lines of the part boxes (drawings/box-hlr.js); the known-mass CG
//            in all three views; the support polygon and the stability margin
//            in the plan; key dimensions; the title block.
//   sheet 2: bill of materials with the mass state of every line, mass totals
//            by state and the unknown items, the CG / support-polygon check,
//            the dimension table with the basis of every value, and notes.
// Pure: the same input gives the same sheets. Every number drawn is passed in
// with its basis (C computed, D design / layout choice, S sourced); nothing is
// measured off the picture.
//
// Frame: x forward, y to the robot's left, z up; ground at z = 0.

import { fitText, ascii } from "./sheet.js";
import { titleBlock, SHEET_A3 } from "./ga-drawing.js";

const BORDER = 10;
const mm = (m) => `${Math.round(m * 1000)}`;

function line(items, pts, style = "solid", w) { items.push({ t: "line", pts, style, ...(w ? { w } : {}) }); }
function text(items, x, y, s, size = 2.5, anchor = "start", bold = false) { items.push({ t: "text", x, y, s: ascii(s), size, anchor, bold }); }

function dimH(items, a, b, yFrom, yDim, label) {
  const dir = yDim < yFrom ? -1 : 1;
  line(items, [[a, yFrom + dir * 1], [a, yDim + dir * 1.5]], "thin");
  line(items, [[b, yFrom + dir * 1], [b, yDim + dir * 1.5]], "thin");
  line(items, [[a, yDim], [b, yDim]], "thin");
  items.push({ t: "arrow", x: a, y: yDim, dx: -1, dy: 0 }, { t: "arrow", x: b, y: yDim, dx: 1, dy: 0 });
  text(items, (a + b) / 2, yDim + (dir < 0 ? -3.2 : 0.8), label, 2.3, "middle");
}

function dimV(items, a, b, xFrom, xDim, label) {
  const dir = xDim < xFrom ? -1 : 1;
  line(items, [[xFrom + dir * 1, a], [xDim + dir * 1.5, a]], "thin");
  line(items, [[xFrom + dir * 1, b], [xDim + dir * 1.5, b]], "thin");
  line(items, [[xDim, a], [xDim, b]], "thin");
  items.push({ t: "arrow", x: xDim, y: a, dx: 0, dy: -1 }, { t: "arrow", x: xDim, y: b, dx: 0, dy: 1 });
  text(items, xDim + (dir < 0 ? -0.8 : 0.8), (a + b) / 2 - 1, label, 2.3, dir < 0 ? "end" : "start");
}

/** CG symbol (ISO 7000-style: circle with crossed diameters), radius r sheet mm. */
function cgMark(items, x, y, r = 1.8) {
  items.push({ t: "circle", cx: x, cy: y, r, style: "thin" });
  line(items, [[x - r, y], [x + r, y]], "thin");
  line(items, [[x, y - r], [x, y + r]], "thin");
  items.push({ t: "rect", x, y, w: r * 0.7, h: r * 0.7, lw: 0.1, fill: "#000" }, { t: "rect", x: x - r * 0.7, y: y - r * 0.7, w: r * 0.7, h: r * 0.7, lw: 0.1, fill: "#000" });
}

function frame(items) {
  items.push({ t: "rect", x: BORDER, y: BORDER, w: SHEET_A3[0] - 2 * BORDER, h: SHEET_A3[1] - 2 * BORDER, lw: 0.7 });
}

const SCALES = [5, 10, 15, 20, 25, 50, 100];

/** Largest standard scale at which the three views fit the A3 layout. */
export function pickScale({ min, max }) {
  for (const n of SCALES) {
    const k = 1000 / n;
    const h = (max.z - Math.min(0, min.z)) * k + (max.x - min.x) * k + 70; // front view + plan + gaps/labels
    const w = (max.y - min.y) * k + (max.x - min.x) * k + 110; // front + side + dims, left of the title block
    if (h <= SHEET_A3[1] - 2 * BORDER && w <= SHEET_A3[0] - 2 * BORDER - 185) return n;
  }
  return SCALES.at(-1);
}

/**
 * input: { title, number, scale, revision, modelHash, status, generated, model,
 *          views: { front, side, plan } (projectBoxes output, model metres in (u, v)),
 *          extents: { min, max } (m), cg: { x, y, z }, polygon: [{ x, y }] | null,
 *          marginLine: { from: { x, y }, to: { x, y } } | null, feet: [{ x, y }],
 *          dims: { id: { valueM, basis } }, dimRows, bom, bomTotals: [text], cgRows: [[label, value, basis]],
 *          notDrawn: [id], notes: [text] }
 */
export function buildAssemblyGaSheets(input) {
  const k = 1000 / input.scale;
  const { min, max } = input.extents;
  const d = input.dims;
  const tag = (id) => (d[id] ? `${mm(d[id].valueM)} ${d[id].basis}` : "");

  // ---- sheet 1: views
  const s1 = [];
  frame(s1);
  const FX = BORDER + 30 + -min.y * k; // front view: sheet x of y = 0
  const PY = BORDER + 22 + max.x * k; // plan: sheet y of x = 0 (front of the assembly at the bottom)
  const G = PY - min.x * k + 18; // front/side ground line, above the plan
  const SX = FX + max.y * k + 45 + -min.x * k; // side view: sheet x of x = 0
  const front = ([u, v]) => [FX + u * k, G + v * k];
  const side = ([u, v]) => [SX + u * k, G + v * k];
  const plan = ([u, v]) => [FX + u * k, PY + v * k];
  const drawView = (v, map) => {
    for (const l of v.hidden) line(s1, l.map(map), "hidden");
    for (const l of v.visible) line(s1, l.map(map), "solid");
  };
  const top = G + max.z * k;

  text(s1, FX + min.y * k, top + 7, "FRONT ELEVATION (from +x)", 2.8, "start", true);
  drawView(input.views.front, front);
  line(s1, [[FX + min.y * k - 8, G], [FX + max.y * k + 8, G]], "thin");
  line(s1, [front([0, -0.08]), front([0, max.z + 0.08])], "centre");

  text(s1, SX + min.x * k, top + 7, "VIEW FROM THE RIGHT (from -y)", 2.8, "start", true);
  drawView(input.views.side, side);
  line(s1, [[SX + min.x * k - 8, G], [SX + max.x * k + 8, G]], "thin");

  text(s1, FX + min.y * k, PY - min.x * k + 2.5, "PLAN (from above; front at the bottom)", 2.8, "start", true);
  drawView(input.views.plan, plan);
  line(s1, [plan([0, -max.x - 0.06]), plan([0, -min.x + 0.06])], "centre");

  // CG (known mass) in all three views
  cgMark(s1, ...front([input.cg.y, input.cg.z]));
  cgMark(s1, ...side([input.cg.x, input.cg.z]));
  const cgPlan = plan([input.cg.y, -input.cg.x]);
  cgMark(s1, ...cgPlan);
  const cgF = front([input.cg.y, input.cg.z]), lx = FX + max.y * k + 4;
  line(s1, [[cgF[0] + 1.8, cgF[1]], [lx - 1, cgF[1]]], "thin");
  text(s1, lx, cgF[1] - 0.7, "CG (known mass)", 2);

  // support polygon and margin (plan)
  if (input.polygon?.length) {
    const pts = input.polygon.map((p) => plan([p.y, -p.x]));
    line(s1, [...pts, pts[0]], "phantom", 0.35);
    text(s1, plan([max.y, -min.x])[0] + 2, plan([max.y, -min.x])[1] - 2, "support polygon (phantom)", 2);
  }
  for (const f of input.feet || []) line(s1, [plan([f.y, -f.x - 0.03]), plan([f.y, -f.x + 0.03])], "centre");
  if (input.marginLine) {
    const a = plan([input.marginLine.from.y, -input.marginLine.from.x]), b = plan([input.marginLine.to.y, -input.marginLine.to.x]);
    line(s1, [a, b], "thin");
    arrowAt(s1, b, a);
    text(s1, plan([max.y, 0])[0] + 2, cgPlan[1] - 1, `stability margin ${tag("stabilityMargin")}`, 2.2);
  }

  // dimensions
  dimV(s1, G, top, FX + min.y * k, FX + min.y * k - 12, tag("overallHeight"));
  dimH(s1, FX + min.y * k, FX + max.y * k, G - 1, G - 8, tag("overallWidth"));
  dimH(s1, SX + min.x * k, SX + max.x * k, G - 1, G - 8, tag("overallDepth"));
  dimV(s1, G, G + input.cg.z * k, SX + max.x * k, SX + max.x * k + 8, tag("cgHeight"));
  if (input.feet?.length === 2 && d.stance) {
    const [l, r] = input.feet.map((f) => plan([f.y, -f.x])[0]).sort((p, q) => p - q);
    const bottom = PY - max.x * k;
    dimH(s1, l, r, bottom - 1, bottom - 6, `stance ${tag("stance")}`);
  }

  // first-angle note + notes block
  const nx = SHEET_A3[0] - BORDER - 180, ny = BORDER + 52;
  text(s1, nx, ny + 92, "NOTES", 2.8, "start", true);
  const n1 = [
    "Dimensions in mm. C = computed from the model, D = layout design choice, S = sourced (cited).",
    "Values, bases and sources: sheet 2. Nothing is scaled off this sheet.",
    "Bodies are drawn as the boxes the solvers use: frame tubes and plates at their section and",
    "length; bought parts (actuators, sensors, compute, battery) as datasheet envelopes, not",
    "detailed geometry. Hidden lines exact for those boxes. Joints, fasteners, wiring: not drawn.",
    `Not drawn (no position or geometry in the model): ${input.notDrawn.join(", ") || "none"}.`,
    "CG = centre of the KNOWN mass only. Unknown masses are listed on sheet 2; they can move it.",
    "Revision = hash of the model this sheet shows. Any change to a part, position, mass or check",
    "gives a new revision; a sheet whose revision differs from the model's is superseded.",
    ...input.notes.slice(0, 3),
  ];
  n1.forEach((s, i) => text(s1, nx, ny + 86 - i * 4.2, fitText(s, 2.2, 178), 2.2));
  titleBlock(s1, { ...input, sheet: "1 of 2" }, SHEET_A3);

  // ---- sheet 2: BOM, mass closure, CG check, dimensions, notes
  const s2 = [];
  frame(s2);
  let y = SHEET_A3[1] - BORDER - 8;
  const x0 = BORDER + 4;
  text(s2, x0, y, "BILL OF MATERIALS (part records; mass state per line)", 3.2, "start", true);
  y -= 6.5;
  const cols = [["Item", 9], ["Qty", 8], ["Nodes", 50], ["Description", 92], ["Material / part", 62], ["Unit kg", 17], ["State", 20], ["Source / reason", 132]];
  const row = (cells, yy, bold = false, size = 2.1) => {
    let x = x0;
    cells.forEach((c, i) => {
      const [, w] = cols[i];
      text(s2, i === 5 ? x + w - 1.5 : x + 1, yy + 1.4, fitText(c, size, w - 2.5), size, i === 5 ? "end" : "start", bold);
      x += w;
    });
    line(s2, [[x0, yy], [x, yy]], "thin");
  };
  row(cols.map(([c]) => c), y, true, 2.3);
  for (const r of input.bom) {
    y -= 4.4;
    row([String(r.item), String(r.qty), r.nodes.join(", "), r.description, r.material, r.unitMassKg == null ? "unknown" : r.unitMassKg.toFixed(3), r.massState, r.source], y);
  }
  y -= 5.5;
  for (const t of input.bomTotals) { text(s2, x0 + 1, y, fitText(t, 2.3, 390), 2.3, "start", true); y -= 4.2; }

  y -= 3;
  text(s2, x0, y, "CG AND SUPPORT-POLYGON CHECK", 3.2, "start", true);
  y -= 5.5;
  for (const [label, value, basis] of input.cgRows) {
    text(s2, x0 + 1, y, fitText(label, 2.2, 95), 2.2);
    text(s2, x0 + 98, y, fitText(value, 2.2, 120), 2.2, "start", true);
    text(s2, x0 + 220, y, fitText(basis, 2.0, 170), 2.0);
    y -= 4;
  }

  y -= 3;
  text(s2, x0, y, "KEY DIMENSIONS (value, basis, where it comes from)", 3.2, "start", true);
  y -= 5.5;
  for (const r of input.dimRows) {
    if (y < BORDER + 52) break;
    text(s2, x0 + 1, y, fitText(r.label, 2.2, 60), 2.2);
    text(s2, x0 + 80, y, mm(d[r.id].valueM), 2.2, "end");
    text(s2, x0 + 83, y, d[r.id].basis, 2.2, "start", true);
    text(s2, x0 + 89, y, fitText(r.from, 2.0, 300), 2.0);
    y -= 3.9;
  }
  titleBlock(s2, { ...input, sheet: "2 of 2" }, SHEET_A3);
  return [{ size: SHEET_A3, items: s1 }, { size: SHEET_A3, items: s2 }];
}

/** Arrowhead at the polygon edge end of the margin line. */
function arrowAt(s, at, from) {
  s.push({ t: "arrow", x: at[0], y: at[1], dx: at[0] - from[0], dy: at[1] - from[1] });
}
