// server/lib/conkay/physics/solvers/ga-drawing.js
//
// drawing.ga: the general-arrangement drawing of a vehicle, generated from the
// same model the solvers ran on: the CAD body (cad.body, its STEP projected by
// hidden-line removal, cad/conkay_drawing_occ.py), the axle and tyre positions,
// and the bill of materials (component library entries and designed parts, with
// the mass and mass state of every item from mass.part). Two A3 sheets, written
// as SVG (one per sheet) and one PDF.
//
// Revision: the model hash, a SHA-256 over everything the sheets show (the
// body's kernel request hash and mesh hashes, the projected views, every
// dimension and BOM row, the solver version). The engine re-runs this solver
// whenever the body, a position or a mass it read changes, so the revision
// follows the model; drawingStatus() says whether a sheet in hand is the
// current revision or superseded.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { registerSolver } from "../registry.js";
import { getComponent } from "../../components/index.js";
import { runDrawingKernel } from "../../cad/drawing-kernel.js";
import { bodyCacheDir } from "../../cad/body-kernel.js";
import { buildGaSheets } from "../../drawings/ga-drawing.js";
import { toSvg, toPdf } from "../../drawings/sheet.js";

export const GA_SOLVER_VERSION = "1.0.0";
export const GA_SCALE = 25;

// Projectors: view direction (toward the viewer) and the drawing's x axis. Model axes: x rearward, y right, z up.
export const GA_VIEWS = Object.freeze([
  { id: "side", dir: [0, -1, 0], xDir: [1, 0, 0] }, // from the left: nose to the left, z up
  { id: "plan", dir: [0, 0, 1], xDir: [1, 0, 0] }, // from above: nose to the left, +y (right side) up the sheet
  { id: "front", dir: [-1, 0, 0], xDir: [0, -1, 0] }, // from ahead: the car's right side on the left of the view
]);

const vehicles = (g) => [...g.nodes.values()].filter((n) => n.props?.vehicle?.packaging?.bodyShell).map((n) => n.id);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : typeof v === "number" ? Math.round(v * 1e9) / 1e9 : v);
const host = (u) => { try { const x = new URL(u); return `${x.host}${x.pathname.length > 1 ? x.pathname.slice(0, 40) : ""}`; } catch { return u || ""; } };
const BOM_KINDS = new Set(["Part", "Tire", "Seat", "Actuator", "Beam", "Plate", "Bolt"]);

function bomRows(ctx) {
  const groups = new Map();
  for (const id of [...ctx.graph.nodes.keys()].sort()) {
    const kind = ctx.get(id, "kind");
    if (!BOM_KINDS.has(kind)) continue;
    const compId = ctx.get(id, "props.component");
    const material = ctx.get(id, "material");
    if (!compId && !material) continue;
    const m = ctx.result("mass.part", id);
    const massKg = Number.isFinite(m?.outputs?.mass?.value) ? m.outputs.mass.value : null;
    const state = m?.outputs?.massState?.value || (m?.status === "NOT_COMPUTED" ? "not computed" : null);
    const key = compId ? `c:${compId}` : `n:${id}`;
    if (!groups.has(key)) {
      const c = compId ? getComponent(compId) : null;
      groups.set(key, {
        nodes: [], qty: 0, unitMassKg: massKg, massState: state,
        description: c ? [c.manufacturer, c.model, c.variant].filter(Boolean).join(" ") : `${ctx.get(id, "name") || id} (designed part)`,
        libraryId: compId || `material: ${material}`,
        sourceUrl: c?.mass?.massState?.source?.url || c?.dimensions?.source?.url || (m?.outputs?.massState?.detail?.materialRef ?? null),
        massNote: m?.status === "NOT_COMPUTED" ? m.reason : null,
      });
    }
    const gr = groups.get(key);
    gr.nodes.push(id);
    gr.qty += 1;
    if (gr.unitMassKg != null && massKg != null && Math.abs(gr.unitMassKg - massKg) > 1e-9) gr.unitMassKg = null; // not identical: no unit mass
  }
  return [...groups.values()].map((r, i) => ({ item: i + 1, ...r, source: host(r.sourceUrl) }));
}

export const gaDrawing = registerSolver({
  id: "drawing.ga",
  version: GA_SOLVER_VERSION,
  domain: "drawing.ga",
  domains: ["drawing.ga"],
  fidelity: 1,
  method: "Hidden-line projection (OpenCascade HLRBRep_PolyAlgo) of the CAD body's STEP into side, plan and front views at 1:25 on A3, first-angle; tyres and axle centre lines from the node positions; key dimensions from cad.body (computed) and the layout (design / derived); BOM grouped from the component library and designed parts with mass.part masses; title block revision = SHA-256 of everything shown",
  reference: "server/lib/conkay/drawings/ga-drawing.js",
  targets: vehicles,
  run(ctx, veh) {
    const pkg = ctx.get(veh, "props.vehicle.packaging");
    const bodyId = pkg?.bodyShell;
    const body = bodyId ? ctx.result("cad.body", bodyId) : null;
    if (!body || body.status === "NOT_COMPUTED" || body.status === "ERROR") return { notComputed: `no drawing without the CAD body: cad.body@${bodyId} ${body?.status ?? "missing"}${body?.reason ? ` (${body.reason})` : ""}` };
    const files = body.outputs.files?.value || {};
    if (!files.step?.path || !fs.existsSync(files.step.path)) return { notComputed: "the CAD body has no STEP file to project" };
    const geometryHash = files.stl?.sha256 || files.glb?.sha256;
    if (!geometryHash) return { notComputed: "the CAD body has no mesh hash (STL/GLB) to tie the drawing revision to" };
    const proj = runDrawingKernel({ command: "project", step: files.step.path, geometryHash, views: GA_VIEWS });
    if (!proj.ok) return { notComputed: proj.unavailable || proj.error };

    const dimsOut = body.outputs.dimensions.value;
    // The extents drawn and dimensioned are the drawing kernel's bracketed ones (cad/extents_occ.py), measured on
    // the same STEP the views come from; cad.body measures its solid the same way, so a difference between the
    // two is reported (it would mean the exported STEP and the solved body disagree).
    const bb = { min: proj.extents.min, max: proj.extents.max };
    const bboxCheck = ["x", "y", "z"].flatMap((a, i) => [
      { side: `min ${a}`, reportedM: dimsOut.bbox.min[i], exactM: bb.min[i], outsideMm: Math.round((bb.min[i] - dimsOut.bbox.min[i]) * 1e4) / 10 },
      { side: `max ${a}`, reportedM: dimsOut.bbox.max[i], exactM: bb.max[i], outsideMm: Math.round((dimsOut.bbox.max[i] - bb.max[i]) * 1e4) / 10 },
    ]);
    const fx = ctx.get(veh, "props.vehicle.frontAxleX"), rx = ctx.get(veh, "props.vehicle.rearAxleX");
    const tyres = (pkg.tyres || []).map((t) => {
      const p = ctx.get(t.node, "position");
      return { id: t.id, x: p.x, y: p.y, r: t.diameterM / 2, halfWidth: t.widthM / 2, source: t.dims?.source || null };
    });
    const ty = (id) => tyres.find((t) => t.id === id);
    const rev = pkg.layoutRevision;
    const layoutBasis = rev ? `layout revision ${rev.version} (derived / design choices; old -> new rows in the realization README)` : "layout design choices";
    const dims = {
      overallLength: { valueM: bb.max[0] - bb.min[0], basis: "C" },
      overallWidth: { valueM: bb.max[1] - bb.min[1], basis: "C" },
      overallHeight: { valueM: bb.max[2], basis: "C" },
      groundClearance: { valueM: bb.min[2], basis: "C" },
      wheelbase: { valueM: rx - fx, basis: "D" },
      frontTrack: { valueM: Math.abs(ty("TIRE_FR").y - ty("TIRE_FL").y), basis: "D" },
      rearTrack: { valueM: Math.abs(ty("TIRE_RR").y - ty("TIRE_RL").y), basis: "D" },
      frontOverhang: { valueM: fx - bb.min[0], basis: "C" },
      rearOverhang: { valueM: bb.max[0] - rx, basis: "C" },
      tyreDiameter: { valueM: 2 * ty("TIRE_FL").r, basis: "S" },
    };
    const dimRows = [
      { id: "overallLength", label: "Overall length", from: `exact extents of the cad.body solid (BRepExtrema; body kernel ${body.outputs.kernel.value.occt || ""}, request ${body.outputs.kernel.value.requestHash})` },
      { id: "overallWidth", label: "Overall width (body)", from: "exact extents of the cad.body solid (BRepExtrema)" },
      { id: "overallHeight", label: "Overall height", from: "exact extents of the cad.body solid (ground at z = 0; static, no suspension travel)" },
      { id: "groundClearance", label: "Ground clearance (body)", from: "exact lowest point of the cad.body solid (static; suspension travel not published, not included)" },
      { id: "wheelbase", label: "Wheelbase", from: `rear axle x - front axle x: ${layoutBasis}` },
      { id: "frontTrack", label: "Front track", from: "tyre centre y positions: design choice" },
      { id: "rearTrack", label: "Rear track", from: "tyre centre y positions: design choice" },
      { id: "frontOverhang", label: "Front overhang", from: "front axle x - exact body front" },
      { id: "rearOverhang", label: "Rear overhang", from: "exact body rear - rear axle x" },
      { id: "tyreDiameter", label: "Tyre overall diameter", from: `component library (sourced: ${ty("TIRE_FL").source || "see library"})` },
    ];
    const bom = bomRows(ctx);
    const views = Object.fromEntries(GA_VIEWS.map((v) => [v.id, proj.views[v.id]]));
    const model = {
      solver: `drawing.ga@${GA_SOLVER_VERSION}`, scale: GA_SCALE,
      body: { requestHash: body.outputs.kernel.value.requestHash, stl: files.stl?.sha256 || null, glb: files.glb?.sha256 || null },
      projection: proj.requestHash, viewsHash: sha(JSON.stringify(views)), extents: bb,
      axles: { fx, rx }, tyres, dims, bom: bom.map(({ sourceUrl, ...r }) => ({ ...r, sourceUrl })), layoutRevision: rev?.version || null,
    };
    const modelHash = sha(JSON.stringify(canonical(model)));
    const revision = `R-${modelHash.slice(0, 8).toUpperCase()}`;
    const notes = [
      "SCREENING DRAWING: generated from a software model; not checked, not approved, not for manufacture.",
      "All masses are mass.part results (state: sourced / estimated / computed / placeholder); occupants (payload) are not parts and are not listed.",
      `Projection: ${proj.method.algorithm}; ${proj.method.tolerance}. Not drawn: ${proj.method.notDrawn}.`,
      "Silhouette segments of near-tangent surfaces can be classed hidden over short lengths by the polygonal algorithm; they are drawn as the algorithm classes them.",
      "Static geometry only: suspension travel, steering lock and tyre deflection are not shown.",
      ...(rev?.groundClearance ? [`Layout revision ${rev.version}: ground clearance target ${Math.round(rev.groundClearance.targetM * 1000)} mm (${rev.groundClearance.hold}); ${rev.groundClearance.tradeoffs.map((t) => `${t.item}${t.value != null ? ` ${t.value} ${t.unit}` : ""}`).join("; ")}.`] : []),
    ];
    const occt = body.outputs.kernel.value.occt || "?";
    const sheets = buildGaSheets({
      title: `GENERAL ARRANGEMENT - ${veh} (ConKay library car)`,
      number: `CK-GA-${veh}`,
      scale: GA_SCALE,
      revision, modelHash,
      projection: "First-angle projection",
      status: "SCREENING - NOT FOR MANUFACTURE",
      generated: `Generated by ConKay drawing.ga ${GA_SOLVER_VERSION} from cad.body (OCCT ${occt}); revision = model hash`,
      model: `${bodyId} + ${veh} layout + BOM (${bom.length} items)`,
      views, body: bb, axles: { frontX: fx, rearX: rx }, tyres, dims, dimRows, bom,
      toleranceText: `${proj.method.linearDeflectionM * 1000} mm`,
      bomNote: "Quantities by node; unit mass from mass.part (not computed where the solver did not compute it). Payload (occupants) excluded. Full source URLs: drawing.json.",
      notes,
    });
    const meta = { drawing: `CK-GA-${veh}`, revision, modelHash, solver: `drawing.ga@${GA_SOLVER_VERSION}`, body: model.body };
    const dir = path.join(bodyCacheDir(), "drawings", modelHash.slice(0, 24));
    fs.mkdirSync(dir, { recursive: true });
    const write = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return { path: p, bytes: Buffer.byteLength(data), sha256: sha(data) }; };
    const bboxDiff = Math.max(...bboxCheck.map((b) => Math.abs(b.outsideMm)));
    const warnings = bboxDiff > 0.5 ? [`cad.body's extents and the drawing kernel's differ by up to ${bboxDiff} mm on one side (the exported STEP and the solved body disagree); the drawing dimensions use the drawing kernel's`] : [];
    const out = {
      sheet1Svg: write(`CK-GA-${veh}-${revision}-sheet1.svg`, toSvg(sheets[0], { ...meta, sheet: 1 })),
      sheet2Svg: write(`CK-GA-${veh}-${revision}-sheet2.svg`, toSvg(sheets[1], { ...meta, sheet: 2 })),
      pdf: write(`CK-GA-${veh}-${revision}.pdf`, toPdf(sheets, { ...meta, title: `CK-GA-${veh} ${revision}`, producer: `ConKay drawing.ga ${GA_SOLVER_VERSION}` })),
    };
    out.json = write(`CK-GA-${veh}-${revision}.json`, JSON.stringify({ ...meta, dims, dimRows, bom, notes, views: Object.fromEntries(Object.entries(proj.views).map(([k, v]) => [k, { bbox: v.bbox, visibleLengthM: v.visibleLengthM, hiddenLengthM: v.hiddenLengthM }])), projection: proj.method }, null, 2));
    return {
      inputs: {
        body: { value: model.body, source: `cad.body@${bodyId}` },
        views: { value: GA_VIEWS },
        scale: { value: `1:${GA_SCALE}`, basis: "design choice: fits the car's side, plan and front views on A3" },
      },
      outputs: {
        revision: { value: revision, basis: "computed: first 8 hex of the model hash" },
        modelHash: { value: modelHash, basis: "computed: SHA-256 of the canonical model the sheets show (body hashes, views, dimensions, BOM, solver version)" },
        dimensions: { value: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, { mm: Math.round(v.valueM * 1000), basis: v.basis }])), unit: "mm", note: "C computed (cad.body), D design / derived layout, S sourced" },
        bom: { value: bom },
        views: { value: Object.fromEntries(Object.entries(proj.views).map(([k, v]) => [k, { visible: v.visible.length, hidden: v.hidden.length, visibleLengthM: v.visibleLengthM, hiddenLengthM: v.hiddenLengthM }])), note: "polylines per view from the projection kernel" },
        projection: { value: { ...proj.method, kernel: proj.kernel, requestHash: proj.requestHash } },
        extents: { value: { ...bb, minBracket: proj.extents.minBracket ?? null, maxBracket: proj.extents.maxBracket ?? null }, unit: "m", basis: `computed: ${proj.extents.method}` },
        bboxCheck: { value: bboxCheck, note: "per side (mm): cad.body's reported extent minus the drawing kernel's, both bracketed measurements; a non-zero value means the exported STEP and the solved body disagree" },
        files: { value: out },
      },
      warnings,
      covers: [veh, bodyId],
      assumptions: [
        "A screening drawing of a software model: not checked, approved or released; not for manufacture.",
        "Outer skin, tyres and axle lines only: no structure, closures, glazing openings or interior are drawn.",
        "Static geometry: no suspension travel, steering lock or tyre deflection.",
      ],
    };
  },
});

/** Is a drawing in hand (its embedded meta, or the SVG / JSON text) the current revision of the session's model? */
export function drawingStatus(drawing, session, veh = "VEH") {
  let meta = drawing;
  if (typeof drawing === "string") {
    const m = drawing.match(/<metadata id="conkay-drawing">([^<]*)<\/metadata>/);
    const raw = m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : drawing;
    try { meta = JSON.parse(raw); } catch { return { current: false, reason: "no ConKay drawing metadata found" }; }
  }
  const run = session.result(`drawing.ga@${veh}`);
  if (!run || run.status === "NOT_COMPUTED" || run.status === "ERROR") return { current: false, reason: `the model's drawing is not computed (${run?.reason || run?.error || "no run"})` };
  const now = run.outputs.modelHash.value;
  return now === meta.modelHash
    ? { current: true, revision: meta.revision }
    : { current: false, revision: meta.revision, currentRevision: run.outputs.revision.value, reason: `superseded: the model changed since ${meta.revision} (now ${run.outputs.revision.value})` };
}
