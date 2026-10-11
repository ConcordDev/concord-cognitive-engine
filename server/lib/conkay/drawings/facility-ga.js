// server/lib/conkay/drawings/facility-ga.js
//
// Plant general-arrangement (GA) drawing of a facility SSC skeleton (the
// NuScale US600 skeleton in safety-case/facility-nuscale-us600.js), as sheets
// (drawings/sheet.js):
//   sheet 1: plan of the module bays and section A-A through one bay, drawn
//            ONLY from dimensions the model carries with a basis; everything
//            the sources do not give (bay arrangement, building outline, grade
//            elevation, gallery / control room location) is written on the
//            sheet as UNKNOWN and not drawn;
//   sheet 2: SSC register (grouped), dimension table with basis and fact,
//            conflicts and notes;
//   sheet 3: the FSAR gap pull list (document, ADAMS accession, chapter,
//            section and how the locator is known) and the retrieval log.
// Pure: the same input gives the same sheets. Bases: S2 = secondary source
// (design-family value, not a US600 value), C = computed from drawn values,
// D = drawing placement choice (schematic), UNK = unknown (not drawn).

import { fitText, ascii } from "./sheet.js";
import { titleBlock, SHEET_A3 } from "./ga-drawing.js";

const BORDER = 10;
const FT = 0.3048; // m per ft (exact)

function line(items, pts, style = "solid", w) { items.push({ t: "line", pts, style, ...(w ? { w } : {}) }); }
function text(items, x, y, s, size = 2.5, anchor = "start", bold = false) { items.push({ t: "text", x, y, s: ascii(s), size, anchor, bold }); }
function rect(items, x, y, w, h, style = "solid") { line(items, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], style); }
function frame(items) { items.push({ t: "rect", x: BORDER, y: BORDER, w: SHEET_A3[0] - 2 * BORDER, h: SHEET_A3[1] - 2 * BORDER, lw: 0.7 }); }

function dimH(items, a, b, yFrom, yDim, label) {
  const dir = yDim < yFrom ? -1 : 1;
  line(items, [[a, yFrom + dir * 1], [a, yDim + dir * 1.5]], "thin");
  line(items, [[b, yFrom + dir * 1], [b, yDim + dir * 1.5]], "thin");
  line(items, [[a, yDim], [b, yDim]], "thin");
  items.push({ t: "arrow", x: a, y: yDim, dx: -1, dy: 0 }, { t: "arrow", x: b, y: yDim, dx: 1, dy: 0 });
  text(items, (a + b) / 2, yDim + (dir < 0 ? -3.2 : 0.8), label, 2.2, "middle");
}

function dimV(items, a, b, xFrom, xDim, label) {
  const dir = xDim < xFrom ? -1 : 1;
  line(items, [[xFrom + dir * 1, a], [xDim + dir * 1.5, a]], "thin");
  line(items, [[xFrom + dir * 1, b], [xDim + dir * 1.5, b]], "thin");
  line(items, [[xDim, a], [xDim, b]], "thin");
  items.push({ t: "arrow", x: xDim, y: a, dx: 0, dy: -1 }, { t: "arrow", x: xDim, y: b, dx: 0, dy: 1 });
  text(items, xDim + (dir < 0 ? -0.8 : 0.8), (a + b) / 2 - 1, label, 2.2, dir < 0 ? "end" : "start");
}

/** ft and m label of a dimension row: "76 ft (23.16 m) S2". */
export function dimLabel(d) {
  if (d.valueFt == null) return `UNKNOWN (${d.gap})`;
  return `${+d.valueFt.toFixed(2)} ft (${(d.valueFt * FT).toFixed(2)} m) ${d.basis}`;
}

const SCALES = [100, 200, 250, 500, 1000];

/** Largest standard scale at which the bay row (bays at true size, fixed sheet gaps) and the section fit sheet 1. */
export function pickFacilityScale({ bays, bayFt, gapMm, sectionFt }) {
  for (const n of SCALES) {
    const k = (1000 * FT) / n; // sheet mm per ft
    const row = bays * bayFt * k + (bays - 1) * gapMm;
    if (row <= SHEET_A3[0] - 2 * BORDER - 40 && sectionFt * k <= 120) return n;
  }
  return SCALES.at(-1);
}

/**
 * input: { title, number, scale, revision, modelHash, status, generated, model,
 *          bays: [{ id, label }], dims: { id: { valueFt|null, basis, fact?, gap?, label } },
 *          unknownNotDrawn: [text], sscRows: [[group, scope, count, ids, facts]], dimRows: [id],
 *          conflicts: [text], gaps: [{ id, item, effect, sources: [...] }], retrieval: [{ url, status, note? }],
 *          notes: [text], banner }
 */
export function buildFacilityGaSheets(input) {
  const kFt = (1000 * FT) / input.scale;
  const d = input.dims;
  const bay = d.baySquare.valueFt * kFt;
  const cnvD = d.cnvDiameter.valueFt * kFt;
  const cnvH = d.cnvHeight.valueFt * kFt;
  const depth = d.bayDepth.valueFt * kFt;
  const GAP = input.gapMm;
  const [W, H] = SHEET_A3;

  // ---- sheet 1: plan (top) and section A-A (bottom left)
  const s1 = [];
  frame(s1);
  const X0 = BORDER + 20;
  const PY = H - BORDER - 52; // plan: bottom edge of the bay row
  text(s1, X0, PY + bay + 12, "PLAN AT POOL LEVEL - MODULE BAYS (schematic order)", 2.8, "start", true);
  text(s1, X0, PY + bay + 7.5, fitText("Each bay and containment at true size and scale. Bay ARRANGEMENT, spacing, walls, building outline and pool extent: UNKNOWN (G-dimensions) - bays shown in module order with a fixed sheet gap, NOT to scale between bays.", 2.1, W - 2 * BORDER - 25), 2.1);
  input.bays.forEach((b, i) => {
    const x = X0 + i * (bay + GAP);
    rect(s1, x, PY, bay, bay);
    const cx = x + bay / 2, cy = PY + bay / 2;
    s1.push({ t: "circle", cx, cy, r: cnvD / 2, style: "solid" });
    line(s1, [[cx - bay / 2 - 1, cy], [cx + bay / 2 + 1, cy]], "centre");
    line(s1, [[cx, cy - bay / 2 - 1], [cx, cy + bay / 2 + 1]], "centre");
    text(s1, cx, PY + bay + 1.5, b.label, 2.3, "middle", true);
  });
  // plan dimensions on bay 1, section mark through bay 1
  dimH(s1, X0, X0 + bay, PY, PY - 8, dimLabel(d.baySquare));
  const c1 = X0 + bay / 2;
  line(s1, [[X0 - 6, PY + bay / 2], [X0 - 1.5, PY + bay / 2]], "solid", 0.6);
  text(s1, X0 - 7, PY + bay / 2 - 1, "A", 3, "end", true);
  s1.push({ t: "arrow", x: X0 - 3, y: PY + bay / 2 + 2.5, dx: 0, dy: 1 });
  text(s1, c1, PY - 14, fitText(`CNV dia ${dimLabel(d.cnvDiameter)}; centred in bay: D (schematic)`, 2.1, 120), 2.1, "start");

  // section A-A through one bay (floor at SY)
  const SY = BORDER + 70;
  const SX = X0 + 30;
  text(s1, X0, SY + cnvH + 16, "SECTION A-A - ONE MODULE BAY (true scale)", 2.8, "start", true);
  // floor
  line(s1, [[SX - 6, SY], [SX + bay + 6, SY]], "solid", 0.7);
  for (let x = SX - 6; x < SX + bay + 6; x += 2.5) line(s1, [[x, SY], [x - 2, SY - 2]], "thin");
  // bay sides up to the water surface (bay is "20 ft square by 53 ft deep" of water)
  line(s1, [[SX, SY], [SX, SY + depth]], "phantom");
  line(s1, [[SX + bay, SY], [SX + bay, SY + depth]], "phantom");
  // water surface
  line(s1, [[SX - 6, SY + depth], [SX + bay + 6, SY + depth]], "thin");
  line(s1, [[SX + bay + 2, SY + depth + 2.2], [SX + bay + 5, SY + depth + 2.2], [SX + bay + 3.5, SY + depth], [SX + bay + 2, SY + depth + 2.2]], "thin");
  text(s1, SX + bay + 7, SY + depth - 0.8, "pool water surface", 2.1);
  // containment vessel: seated on the bay floor (D), centred
  const cxs = SX + (bay - cnvD) / 2;
  rect(s1, cxs, SY, cnvD, cnvH);
  line(s1, [[SX + bay / 2, SY - 3], [SX + bay / 2, SY + cnvH + 3]], "centre");
  text(s1, SX + bay / 2, SY + cnvH + 4.5, "containment vessel (CNV) envelope", 2.1, "middle");
  // dims
  dimV(s1, SY, SY + depth, SX, SX - 9, dimLabel(d.bayDepth));
  dimV(s1, SY, SY + cnvH, SX + bay, SX + bay + 34, dimLabel(d.cnvHeight));
  dimV(s1, SY + depth, SY + cnvH, SX + bay, SX + bay + 6, dimLabel(d.cnvAboveWater));
  dimH(s1, cxs, cxs + cnvD, SY, SY - 7, dimLabel(d.cnvDiameter));
  dimH(s1, SX, SX + bay, SY, SY - 15, dimLabel(d.baySquare));
  text(s1, SX - 9, SY - 22, fitText(`Radial clearance CNV to bay boundary: ${dimLabel(d.radialClearance)} (nominal; flanges, supports, guides not modelled)`, 2.1, 190), 2.1);
  text(s1, SX - 9, SY - 26, fitText("CNV seated on the bay floor and centred: D (schematic placement; the support arrangement is not in the sources read).", 2.1, 190), 2.1);

  // UNKNOWN / not drawn box (right of the section)
  const ux = SX + bay + 72, uy = SY + cnvH + 14;
  text(s1, ux, uy, "NOT DRAWN - UNKNOWN (positions not in the sources read)", 2.6, "start", true);
  input.unknownNotDrawn.forEach((s, i) => text(s1, ux, uy - 5 - i * 4, fitText(`- ${s}`, 2.1, W - BORDER - ux - 4), 2.1));
  const ny = uy - 8 - input.unknownNotDrawn.length * 4;
  text(s1, ux, ny, "NOTES", 2.6, "start", true);
  input.notes.slice(0, 5).forEach((s, i) => text(s1, ux, ny - 4.5 - i * 4, fitText(s, 2.1, W - BORDER - ux - 4), 2.1));
  titleBlock(s1, { ...input, sheet: "1 of 3" }, SHEET_A3);

  // ---- sheet 2: SSC register, dimension table, conflicts
  const s2 = [];
  frame(s2);
  const x0 = BORDER + 4;
  let y = H - BORDER - 8;
  text(s2, x0, y, fitText(input.banner, 2.6, W - 2 * BORDER - 8), 2.6, "start", true);
  y -= 7;
  text(s2, x0, y, "SSC REGISTER (from the model; per-module items grouped)", 3.0, "start", true);
  y -= 6;
  const cols = [["SSC / group", 120], ["Scope", 24], ["Count", 14], ["Ids", 110], ["Facts (verbatim quotes, sheet 3 / model)", 128]];
  const row = (cells, yy, bold = false) => {
    let x = x0;
    cells.forEach((c, i) => { text(s2, x + 1, yy + 1.4, fitText(c, 2.1, cols[i][1] - 2), 2.1, "start", bold); x += cols[i][1]; });
    line(s2, [[x0, yy], [x, yy]], "thin");
  };
  row(cols.map(([c]) => c), y, true);
  for (const r of input.sscRows) { y -= 4.2; row(r.map(String), y); }
  y -= 9;
  text(s2, x0, y, "DIMENSIONS (value, basis, source fact)", 3.0, "start", true);
  y -= 5.5;
  for (const id of input.dimRows) {
    const r = d[id];
    text(s2, x0 + 1, y, fitText(r.label, 2.1, 70), 2.1);
    text(s2, x0 + 74, y, fitText(dimLabel(r), 2.1, 60), 2.1, "start", true);
    text(s2, x0 + 138, y, fitText(r.from, 2.0, W - 2 * BORDER - 146), 2.0);
    y -= 4;
  }
  y -= 5;
  text(s2, x0, y, "CONFLICTS KEPT FOR REVIEW (not merged)", 3.0, "start", true);
  y -= 5;
  for (const c of input.conflicts) { text(s2, x0 + 1, y, fitText(c, 2.1, W - 2 * BORDER - 10), 2.1); y -= 4; }
  y -= 4;
  text(s2, x0, y, "NOTES", 3.0, "start", true);
  y -= 5;
  for (const s of input.notes) { if (y < BORDER + 52) break; text(s2, x0 + 1, y, fitText(s, 2.1, W - 2 * BORDER - 10), 2.1); y -= 4; }
  titleBlock(s2, { ...input, sheet: "2 of 3" }, SHEET_A3);

  // ---- sheet 3: FSAR gap pull list + retrieval log
  const s3 = [];
  frame(s3);
  y = H - BORDER - 8;
  text(s3, x0, y, "FSAR GAPS - PULL LIST FOR A HUMAN (automated retrieval blocked; every gap stays UNKNOWN until read)", 3.0, "start", true);
  y -= 5;
  text(s3, x0, y, fitText("Chapter titles verbatim from 10 CFR 52 App. G III.A.2.b; accessions from 88 FR 3287 XVII. Section basis: rule = cited in the rule; verify = standard-format number, check the DCA contents.", 2.0, W - 2 * BORDER - 8), 2.0);
  y -= 6;
  const gc = [["Gap", 26], ["Document", 120], ["ADAMS", 22], ["Chapter (Tier 2)", 88], ["Section / figure", 106], ["Basis", 12]];
  const grow = (cells, yy, bold = false, size = 2.0) => {
    let x = x0;
    cells.forEach((c, i) => { text(s3, x + 1, yy + 1.3, fitText(c, size, gc[i][1] - 2), size, "start", bold); x += gc[i][1]; });
    line(s3, [[x0, yy], [x, yy]], "thin");
  };
  grow(gc.map(([c]) => c), y, true, 2.1);
  for (const g of input.gaps) {
    for (const [j, s] of g.sources.entries()) {
      y -= 3.8;
      grow([j ? "" : g.id, s.document, s.adams, s.chapter || "-", s.section, s.sectionBasis], y);
    }
  }
  y -= 7;
  text(s3, x0, y, "GAP EFFECTS ON THIS DRAWING AND THE SCREEN", 3.0, "start", true);
  y -= 4.6;
  for (const g of input.gaps) { text(s3, x0 + 1, y, fitText(`${g.id}: ${g.item} -> ${g.effect}`, 1.9, W - 2 * BORDER - 10), 1.9); y -= 3.5; }
  y -= 4;
  text(s3, x0, y, "RETRIEVAL LOG (automated attempts)", 3.0, "start", true);
  y -= 4.6;
  for (const r of input.retrieval) {
    if (y < BORDER + 50) break;
    text(s3, x0 + 1, y, fitText(`${r.status}  ${r.url}${r.note ? `  (${r.note})` : ""}`, 1.9, 225), 1.9);
    y -= 3.5;
  }
  titleBlock(s3, { ...input, sheet: "3 of 3" }, SHEET_A3);

  return [{ size: SHEET_A3, items: s1 }, { size: SHEET_A3, items: s2 }, { size: SHEET_A3, items: s3 }];
}
