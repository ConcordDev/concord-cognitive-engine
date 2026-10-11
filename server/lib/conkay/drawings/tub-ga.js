// server/lib/conkay/drawings/tub-ga.js
//
// GA / detail sheets of the structural tub, from the same model the frame
// solver ran. Three A3 sheets:
//   1  side and plan stick (member centrelines) and the C/D/S dimension table
//   2  joint type per part (every extrusion end and every sheet)
//   3  torsion load path, stiffness range, Bredt cross-check, specific stiffness
// Every dimension string ends with its tag: C computed, D design choice, S sourced.
// Nothing on the sheet is measured off the picture. No date: the same model
// gives the same sheets.

import crypto from "node:crypto";
import { ascii } from "./sheet.js";
import { titleBlock, SHEET_A3 } from "./ga-drawing.js";

const BORDER = 10;

function text(items, x, y, s, size = 2.2, anchor = "start", extra = {}) {
  items.push({ t: "text", x, y, s: ascii(String(s)), size, anchor, ...extra });
}
function line(items, pts, style = "solid") { items.push({ t: "line", pts, style }); }
function frame(items, [W, H]) {
  items.push({ t: "rect", x: BORDER, y: BORDER, w: W - 2 * BORDER, h: H - 2 * BORDER, lw: 0.7 });
}
function tagged(items, x, y, body, tag, size = 2.1) {
  text(items, x, y, `${body} ${tag}`, size, "start", { tag });
}

const mm = (m) => `${Math.round(m * 1000)} mm`;
const n1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "unknown");
const n3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "unknown");

function hashOf(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

/** Stick view. axisA/axisB are node fields ("x","z" or "x","y"). */
function stick(items, nodes, members, { x0, y0, w, h, axisA, axisB }) {
  const xs = nodes.map((n) => n[axisA]);
  const ys = nodes.map((n) => n[axisB] ?? 0);
  const minA = Math.min(...xs), maxA = Math.max(...xs);
  const minB = Math.min(...ys), maxB = Math.max(...ys);
  const s = Math.min(w / Math.max(maxA - minA, 1e-6), h / Math.max(maxB - minB, 1e-6));
  const map = (n) => [x0 + (n[axisA] - minA) * s, y0 + ((n[axisB] ?? 0) - minB) * s];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const m of members) {
    if (String(m.id).includes("/d")) continue;
    const a = byId.get(m.i), b = byId.get(m.j);
    if (!a || !b) continue;
    line(items, [map(a), map(b)], "solid");
  }
}

/**
 * Sheets from plain data. dims: [{ body, tag, basis }]. joints: [{ part, type, weld, count, tag }].
 * loadPath, range, crossCheck, specific are the solver output objects (or a fixture of the same shape).
 */
export function buildTubGaSheets(input) {
  const [W, H] = SHEET_A3;
  const modelHash = input.modelHash || hashOf({ dims: input.dims, joints: input.joints, range: input.range });
  const head = {
    title: input.title || "Structural tub",
    number: input.number || "CK-TUB-001",
    scale: input.scale || 25,
    revision: input.revision || "A",
    modelHash,
    status: input.status || "SCREENING — not a physical test",
    generated: input.generated || "from the tub model; deterministic, no date",
    model: input.model || "structural/car-tub.js + structure.frame",
    projection: "stick, first-angle title block",
    units: "mm",
  };
  const s1 = [], s2 = [], s3 = [];
  frame(s1, SHEET_A3);
  text(s1, 16, 270, "Side elevation (x–z), left-hand members", 3, "start", { bold: true });
  if (input.nodes?.length && input.members?.length) {
    const left = input.nodes.filter((n) => n.y >= -1e-6);
    stick(s1, left, input.members, { x0: 18, y0: 168, w: 200, h: 88, axisA: "x", axisB: "z" });
    text(s1, 16, 158, "Plan (x–y)", 3, "start", { bold: true });
    stick(s1, input.nodes, input.members, { x0: 18, y0: 78, w: 200, h: 72, axisA: "x", axisB: "y" });
  }
  text(s1, 230, 270, "Dimensions", 3, "start", { bold: true });
  text(s1, 230, 264, "C computed   D design choice   S sourced", 2);
  let y = 256;
  for (const d of input.dims || []) {
    tagged(s1, 230, y, d.body, d.tag, 2);
    y -= 4.2;
    if (y < 64) break;
  }
  titleBlock(s1, { ...head, sheet: "1 of 3" }, SHEET_A3);

  frame(s2, SHEET_A3);
  text(s2, 16, 270, "Joint schedule — type per part", 3.2, "start", { bold: true });
  text(s2, 16, 264, "Every extrusion end that meets another part, and every sheet flange.", 2);
  tagged(s2, 16, 258, "Joint type bonded+riveted, weld no", "D", 2.4);
  text(s2, 16, 252, "Part", 2.1, "start", { bold: true });
  text(s2, 90, 252, "Ends", 2.1);
  text(s2, 110, 252, "Type", 2.1);
  y = 246;
  for (const j of input.joints || []) {
    text(s2, 16, y, j.part, 1.9);
    text(s2, 90, y, String(j.count), 1.9);
    tagged(s2, 110, y, `${j.type}, weld ${j.weld ? "yes" : "no"}`, j.tag || "D", 1.9);
    y -= 3.6;
    if (y < 64) break;
  }
  text(s2, 16, 58, "Rivets are the peel fasteners. Their stiffness is not credited. Sources are on sheet 3.", 2);
  titleBlock(s2, { ...head, sheet: "2 of 3" }, SHEET_A3);

  frame(s3, SHEET_A3);
  text(s3, 16, 270, "Torsion: load path, range, cross-check, specific stiffness", 3, "start", { bold: true });
  y = 262;
  for (const row of input.sheet3 || []) {
    if (row.tag) tagged(s3, 16, y, row.body, row.tag, 2);
    else text(s3, 16, y, row.body, 2);
    y -= 4.4;
    if (y < 64) break;
  }
  titleBlock(s3, { ...head, sheet: "3 of 3" }, SHEET_A3);
  return [{ size: SHEET_A3, items: s1 }, { size: SHEET_A3, items: s2 }, { size: SHEET_A3, items: s3 }];
}

function choiceDim(choices, key, label, unit) {
  const c = choices[key];
  if (!c) return null;
  const v = c.value;
  let body;
  if (typeof v === "number") body = `${label} ${unit === "mm" ? mm(v) : v}`;
  else if (v && typeof v === "object" && v.width) body = `${label} ${mm(v.width)} x ${mm(v.height)} wall ${mm(v.wall)}`;
  else if (Array.isArray(v)) body = `${label} ${v.map((x) => (typeof x === "number" && unit === "mm" ? mm(x) : x)).join(" to ")}`;
  else body = `${label} ${v}`;
  return { body, tag: "D", basis: c.basis };
}

/**
 * Build the sheet input from a tub layout and a structure.frame envelope.
 * choices: TUB_DESIGN_CHOICES (or the layout's resolved numbers are not used here;
 * the tagged rows come from the choice records, which carry the basis).
 */
export function tubGaInput({ choices, nodes, members, frontAxleX, rearAxleX, frame }) {
  const out = frame.outputs;
  const jr = out["stiffness.torsional.jointRange"]?.value;
  const cc = out["stiffness.torsional.crossCheck"]?.value;
  const lp = out["stiffness.torsional.loadPath"]?.value || [];
  const spec = out["stiffness.torsional.specific"]?.value;
  const sched = out["stiffness.jointSchedule"]?.value;
  const dims = [
    choiceDim(choices, "firewallX", "Firewall plane", "mm"),
    choiceDim(choices, "frontRailX0", "Front rail, nose end", "mm"),
    choiceDim(choices, "frontRailSection", "Front rail section", "mm"),
    choiceDim(choices, "sillSection", "Sill section", "mm"),
    choiceDim(choices, "sillY", "Sill centreline |y|", "mm"),
    choiceDim(choices, "quarterSection", "Rear quarter section", "mm"),
    choiceDim(choices, "quarterY", "Quarter centreline |y|", "mm"),
    choiceDim(choices, "kickStartX", "Sill kick start", "mm"),
    choiceDim(choices, "heelX", "Heel cross", "mm"),
    choiceDim(choices, "rearBulkheadX", "Rear bulkhead", "mm"),
    choiceDim(choices, "rearCrossX", "Rear end cross", "mm"),
    choiceDim(choices, "sheet", "Floor and firewall sheet", "mm"),
    choiceDim(choices, "roofSection", "Roof-ring section", "mm"),
    choiceDim(choices, "postSection", "B- and C-post section", "mm"),
    Number.isFinite(frontAxleX) && Number.isFinite(rearAxleX)
      ? { body: `Wheelbase ${mm(rearAxleX - frontAxleX)}`, tag: "C", basis: "computed: rear axle x minus front axle x on this model" }
      : null,
    { body: "Screening target 10800 N.m/deg", tag: "S", basis: "Lotus 2011 Elise press pack" },
    { body: "Elise brochure stiffness 9800 N.m/deg", tag: "S", basis: "Lotus Elise 2011 brochure; conflicts with 10800; not averaged" },
    { body: "Elise tub and door beams 68 kg", tag: "S", basis: "both manufacturer documents" },
    { body: "Elise vehicle weight 876 kg", tag: "S", basis: "both manufacturer documents; fluids and driver not stated" },
  ].filter(Boolean);
  if (jr) {
    dims.push(
      { body: `Rigid-joint stiffness ${n1(jr.rigidPerDegree)} N.m/deg`, tag: "C", basis: "structure.frame, rigid joints, upper bound" },
      { body: `Computed bond-line low ${n1(jr.lowComputedPerDegree)} N.m/deg`, tag: "C", basis: "lowest scenario whose springs are computed from the adhesive data" },
      { body: `Estimated joint-wall low ${n1(jr.lowEstimatedPerDegree)} N.m/deg`, tag: "C", basis: "computed from the EN 1993-1-8 bound, which is itself an estimate applied outside its domain" },
    );
  }
  const byPart = new Map();
  for (const r of sched?.rows || []) {
    const key = r.part || r.member;
    const cur = byPart.get(key) || { part: key, type: r.type, weld: r.weld, count: 0, tag: "D" };
    cur.count += 1;
    if (r.weld) cur.weld = true;
    byPart.set(key, cur);
  }
  const groups = (cut) => Object.entries(cut.groups || {}).map(([g, v]) => `${g} ${(100 * (v.share || 0)).toFixed(0)}%`).join(", ");
  const sheet3 = [
    { body: "Load path is the rigid-joint twist case. Shares are this model.", tag: null },
    ...lp.map((cut) => ({
      body: `Cut x ${n3(cut.x)} m  torque ${n1(cut.totalNm)} N.m  equilibrium ${n3(cut.equilibrium)}  ${groups(cut)}`,
      tag: "C",
    })),
    cc ? { body: `With panels ${n1(cc.withPanelsPerDegree)} N.m/deg`, tag: "C" } : null,
    cc ? { body: `Panels removed ${n1(cc.withoutPanelsPerDegree)} N.m/deg`, tag: "C" } : null,
    cc ? { body: `Saint-Venant closed extrusions ${n1(cc.saintVenantPerDegree)} N.m/deg`, tag: "C" } : null,
    cc ? { body: `Panel fraction ${n3(cc.panelFraction)}`, tag: "C" } : null,
    cc ? { body: cc.reading, tag: null } : null,
    { body: "Cross-check is not a shell-element result. A diaphragm is required before four shear panels reproduce Bredt.", tag: null },
  ].filter(Boolean);
  if (spec) {
    const tub = spec.tubMassKg?.massKg;
    sheet3.push({ body: `Tub mass ${n1(tub)} kg`, tag: "C" });
    sheet3.push({ body: `Vehicle mass ${n1(spec.vehicleMassKg)} kg, gross ${n1(spec.grossMassKg)} kg`, tag: "C" });
    sheet3.push({ body: `Chassis assembly ${n1(spec.chassisMassKg)} kg (not tub-only)`, tag: "C" });
    for (const r of spec.ours || []) {
      sheet3.push({ body: `${r.id} ${n1(r.perKgTub)} N.m/deg per kg tub, ${n1(r.perKgVehicle)} per kg vehicle (${r.state})`, tag: "C" });
    }
    for (const e of spec.elise || []) {
      sheet3.push({ body: `Elise ${e.stiffnessPerDegree} N.m/deg: ${n1(e.perKgTub)} per kg of the 68 kg tub, ${n1(e.perKgVehicle)} per kg of 876 kg`, tag: "S" });
    }
    sheet3.push({ body: spec.eliseNote || "", tag: null });
  }
  sheet3.push({ body: "Passing these checks is not a physical validation of the car.", tag: null });
  return {
    nodes, members, dims, joints: [...byPart.values()],
    range: jr || null,
    status: frame.status ? `SOLVER ${frame.status} — screening, not a physical test` : undefined,
    modelHash: hashOf({ dims, joints: [...byPart.values()].map((j) => [j.part, j.count, j.type]), jr, cc, lp }),
    sheet3,
  };
}
