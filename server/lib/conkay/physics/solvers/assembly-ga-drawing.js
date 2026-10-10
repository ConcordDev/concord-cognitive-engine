// server/lib/conkay/physics/solvers/assembly-ga-drawing.js
//
// drawing.ga-assembly: the general-arrangement drawing of an assembly built
// from part records (Sentinel Milestone 1 and anything shaped like it: frame
// tubes and plates, bought parts as datasheet envelopes), generated from the
// same design graph and the same solver results the iterate loop ran:
//   - views: exact hidden-line projection of the boxes geometry.clearance and
//     stability.static use (drawings/box-hlr.js); no CAD kernel needed;
//   - BOM: every body, grouped, with its mass and mass state from mass.budget;
//     unknown masses are listed as unknown with the reason, never as zero;
//   - CG and support polygon: the known-mass CG (mass.budget) and the contact
//     hull and margin (stability.static), drawn in all views; the check reads
//     PASS only when the mass budget is closed AND the margin meets the
//     requirement. With unknown masses it is "not passed: mass budget open",
//     whatever the known-mass margin, and the envelope is WARN.
// Revision: SHA-256 of everything the sheets show. The engine re-runs this
// whenever a part, position, mass or check it read changes (a loop repair
// gives a new revision); drawingStatus(..., "drawing.ga-assembly") says whether
// a sheet in hand is current.
//
// Targets: Assembly nodes with props.drawing ({ number?, title? }).

import { createHash } from "node:crypto";
import { registerSolver } from "../registry.js";
import { aabb } from "./geometry-stability.js";
import { keepContent } from "./ga-drawing.js";
import { projectBoxes } from "../../drawings/box-hlr.js";
import { buildAssemblyGaSheets, pickScale } from "../../drawings/assembly-ga.js";
import { toSvg, toPdf } from "../../drawings/sheet.js";

export const ASSEMBLY_GA_VERSION = "1.0.0";

// Frame: x forward, y left, z up. First-angle: the view from the right sits right of the front view, the plan below it.
export const ASSEMBLY_GA_VIEWS = Object.freeze({
  front: { u: ["y", 1], v: ["z", 1], depth: ["x", 1] },
  side: { u: ["x", 1], v: ["z", 1], depth: ["y", -1] },
  plan: { u: ["y", 1], v: ["x", -1], depth: ["z", 1] },
});

const sha = (s) => createHash("sha256").update(s).digest("hex");
const r9 = (v) => Math.round(v * 1e9) / 1e9;
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : typeof v === "number" ? r9(v) : v);
const mmS = (m) => `${Math.round(m * 1000)}`;
const host = (u) => { try { const x = new URL(u); return `${x.host}${x.pathname.length > 1 ? x.pathname.slice(0, 40) : ""}`; } catch { return null; } };

function bodies(ctx, id, out = []) {
  for (const child of ctx.children(id, "CONTAINS")) {
    if (child.kind === "Assembly") bodies(ctx, child.id, out);
    else out.push(child);
  }
  return out;
}

/** Tube bore as an inner box (drawn in the view along the tube axis). */
function bore(ctx, id, box) {
  const g = ctx.get(id, "geometry");
  if (g?.shape !== "rect-tube" || !Number.isFinite(g.wall)) return null;
  const axis = ctx.get(id, "props.axis") || "x";
  const min = { ...box.min }, max = { ...box.max };
  for (const a of ["x", "y", "z"]) if (a !== axis) { min[a] += g.wall; max[a] -= g.wall; }
  return { axis, min, max };
}

function describe(ctx, n) {
  const g = ctx.get(n.id, "geometry");
  const act = ctx.get(n.id, "props.actuator");
  const bat = ctx.get(n.id, "props.battery");
  const mat = ctx.get(n.id, "material");
  if (act) return { description: `actuator, datasheet envelope`, material: act.model };
  if (bat) return { description: `battery ${bat.series}S${bat.parallel}P (cells only; BMS/enclosure separate)`, material: bat.cell?.model || "cell not stated" };
  if (g?.shape === "rect-tube") return { description: `rect tube ${mmS(g.width)}x${mmS(g.height)}x${(g.wall * 1000).toFixed(2)} mm wall, L ${mmS(g.length)} mm`, material: mat || "no material" };
  if (g?.shape === "plate") return { description: `plate ${mmS(g.length)}x${mmS(g.width)}x${mmS(g.thickness)} mm`, material: mat || "no material" };
  return { description: n.name || n.id, material: mat || (ctx.get(n.id, "props.envelope") ? "envelope only (no material)" : "-") };
}

/** Nearest point on a polygon edge to p (plan). */
function nearestOnPolygon(poly, p) {
  let best = null;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const dd = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || dd < best.d) best = { d: dd, q };
  });
  return best?.q ?? null;
}

export const assemblyGaDrawing = registerSolver({
  id: "drawing.ga-assembly",
  version: ASSEMBLY_GA_VERSION,
  domain: "drawing.ga",
  domains: ["drawing.ga", "mass.budget", "stability.static"],
  fidelity: 0,
  method: "Exact hidden-line projection of the part boxes (front, view from the right, plan; first-angle) at the largest standard scale that fits A3; BOM from the part records with mass.budget masses and states; known-mass CG and stability.static support polygon and margin drawn; CG check PASS only with a closed mass budget and the margin requirement met; title block revision = SHA-256 of everything shown",
  reference: "server/lib/conkay/drawings/assembly-ga.js",
  regime: "static pose of the design graph; part boxes (frame members exact, bought parts as datasheet envelopes)",
  units: { inputs: "m, kg", outputs: "mm on the sheets, m / kg in the envelope" },
  tolerance: "exact box geometry; dimensions rounded to 1 mm on the sheets",
  screening: true,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.drawing).map((n) => n.id),
  run(ctx, id) {
    const mb = ctx.result("mass.budget", id);
    const st = ctx.result("stability.static", id);
    if (!mb || mb.status === "NOT_COMPUTED" || mb.status === "ERROR") return { notComputed: `no drawing without the mass budget: mass.budget@${id} ${mb?.status ?? "missing"}${mb?.reason ? ` (${mb.reason})` : ""}` };
    if (!st || st.status === "NOT_COMPUTED" || st.status === "ERROR") return { notComputed: `no drawing without the support polygon: stability.static@${id} ${st?.status ?? "missing"}${st?.reason ? ` (${st.reason})` : ""}` };

    const all = bodies(ctx, id).filter((n) => !ctx.get(n.id, "props.logical"));
    const boxes = [], notDrawn = [];
    for (const n of [...all].sort((a, b) => a.id.localeCompare(b.id))) {
      const b = aabb(ctx, n.id);
      if (!b) { notDrawn.push(n.id); continue; }
      boxes.push({ id: n.id, min: b.min, max: b.max, inner: bore(ctx, n.id, b) });
    }
    if (!boxes.length) return { notComputed: "no body has a position and a box to draw" };
    const ext = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    for (const b of boxes) for (const a of ["x", "y", "z"]) { ext.min[a] = Math.min(ext.min[a], b.min[a]); ext.max[a] = Math.max(ext.max[a], b.max[a]); }
    const views = Object.fromEntries(Object.entries(ASSEMBLY_GA_VIEWS).map(([k, v]) => {
      const p = projectBoxes(boxes, v);
      return [k, { visible: p.visible, hidden: p.hidden }];
    }));

    // mass: every body, known or not
    const M = mb.outputs;
    const known = new Map(M.items.value.map((i) => [i.id, i]));
    const unknown = new Map(M.unknownItems.value.map((u) => [u.id, u]));
    const groups = new Map();
    for (const n of [...all].sort((a, b) => a.id.localeCompare(b.id))) {
      const k = known.get(n.id), u = unknown.get(n.id);
      const { description, material } = describe(ctx, n);
      const ms = ctx.get(n.id, "props.massState");
      // per-node run ids are dropped from the source so identical parts group into one line
      const src = k ? (ms?.source?.url ? host(ms.source.url) : String(k.source || "").replace(/@[\w.-]+/g, "")) : u ? u.reason : "not in the mass budget";
      const unitMassKg = k ? k.mass : null;
      const massState = k ? k.state : "unknown";
      const key = JSON.stringify([description, material, unitMassKg == null ? null : r9(unitMassKg), massState, src]);
      if (!groups.has(key)) groups.set(key, { nodes: [], qty: 0, description, material, unitMassKg, massState, source: src || "" });
      const g = groups.get(key);
      g.nodes.push(n.id); g.qty += 1;
    }
    const bom = [...groups.values()].map((r, i) => ({ item: i + 1, ...r }));
    const by = M.massByState.value;
    const unknownIds = [...unknown.keys()];
    const closed = unknownIds.length === 0;
    const bomTotals = [
      `Known mass ${M.knownMass.value.toFixed(2)} kg: sourced ${by.sourced.toFixed(2)}, computed ${by.computed.toFixed(2)}, estimated ${by.estimated.toFixed(2)}, requirement ${by.requirement.toFixed(2)} kg (mass.budget).`,
      closed ? "Mass budget closed: every body has a mass with a state." : `Unknown mass: ${unknownIds.length} item(s) (${unknownIds.join(", ")}). MASS BUDGET NOT CLOSED: total mass and CG are not established.`,
    ];

    // CG and support polygon
    const S = st.outputs;
    const cg = { x: M.cgX.value, y: Math.abs(M.cgY.value) < 1e-12 ? 0 : M.cgY.value, z: M.cgZ.value };
    const poly = S.supportPolygon.value;
    const margin = S.stabilityMargin.value;
    const reqId = (ctx.graph.requirements || []).find((q) => q.of?.solver === "stability.static" && q.of?.output === "stabilityMargin" && q.of?.target === id)?.id;
    const req = reqId ? ctx.requirement(reqId) : null;
    const reqMin = Number.isFinite(req?.min?.si) ? req.min.si : null;
    const tol = S.unknownMassTolerance?.value || null;
    let verdict;
    if (margin < 0) verdict = "FAIL: the known-mass CG is outside the support polygon";
    else if (!closed) verdict = `NOT PASSED: mass budget open (${unknownIds.length} unknown item(s)); the known-mass margin is not a pass`;
    else if (reqMin != null && margin < reqMin) verdict = `FAIL: margin below the requirement ${req.id}`;
    else verdict = "PASS";
    const contacts = ctx.get(id, "props.stability.contacts") || [];
    const feet = contacts.map((c) => ctx.get(c, "position")).filter(Boolean).map((p) => ({ x: p.x, y: p.y }));
    const foot0 = contacts.length ? ctx.get(contacts[0], "geometry") : null;

    const dims = {
      overallHeight: { valueM: ext.max.z - Math.min(0, ext.min.z), basis: "C" },
      overallWidth: { valueM: ext.max.y - ext.min.y, basis: "C" },
      overallDepth: { valueM: ext.max.x - ext.min.x, basis: "C" },
      cgHeight: { valueM: cg.z, basis: "C" },
      stabilityMargin: { valueM: margin, basis: "C" },
      ...(feet.length === 2 ? { stance: { valueM: Math.hypot(feet[0].x - feet[1].x, feet[0].y - feet[1].y), basis: "D" } } : {}),
      ...(foot0?.shape === "plate" ? { footLength: { valueM: foot0.length, basis: "D" }, footWidth: { valueM: foot0.width, basis: "D" } } : {}),
    };
    const dimRows = [
      { id: "overallHeight", label: "Overall height", from: "top of the highest part box above the ground plane z = 0 (same boxes as geometry.clearance)" },
      { id: "overallWidth", label: "Overall width (y)", from: "extents of the part boxes" },
      { id: "overallDepth", label: "Overall depth (x)", from: "extents of the part boxes (payload envelope and solar panel included)" },
      { id: "cgHeight", label: "CG height (known mass only)", from: `${mb.runId}: sum(m z)/sum(m) over the known masses` },
      { id: "stabilityMargin", label: "Stability margin", from: `${st.runId}: distance from the known-mass CG to the nearest support-polygon edge` },
      ...(dims.stance ? [{ id: "stance", label: "Stance (foot centres)", from: `contact positions ${contacts.join(", ")}: layout design choice` }] : []),
      ...(dims.footLength ? [{ id: "footLength", label: "Foot plate length", from: `${contacts[0]} geometry: design choice` }, { id: "footWidth", label: "Foot plate width", from: `${contacts[0]} geometry: design choice` }] : []),
    ];
    const f3 = (v) => (v * 1000).toFixed(0);
    const cgRows = [
      ["CG of the known mass (x, y, z)", `(${f3(cg.x)}, ${f3(cg.y)}, ${f3(cg.z)}) mm`, `C  ${mb.runId}; ${M.knownMass.value.toFixed(2)} kg known`],
      ["Support polygon (contact hull)", `${poly.length} corners, ${contacts.join(" + ")}`, `C  ${st.runId}; pose: ${ctx.get(id, "props.stability.pose") || "not stated"}`],
      ["Stability margin (known mass)", `${f3(margin)} mm`, `C  ${st.runId}`],
      ["Required margin", reqMin != null ? `>= ${f3(reqMin)} mm (${req.id})` : "no requirement stated", reqMin != null ? "requirement (locked)" : "-"],
      ["Unknown-mass items", closed ? "none" : `${unknownIds.length}: ${unknownIds.join(", ")}`, "mass.budget (never counted as zero)"],
      ...(tol ? [["Unknown mass the stance tolerates", Number.isFinite(tol.massKg) ? `${tol.massKg.toFixed(1)} kg total at the worst point` : "any (no corner outside)", "C  stability.static: worst corner of the plan extents; a bound to measure against, not a pass"]] : []),
      ["CHECK", verdict, closed ? "" : "measure or source the unknown masses, then re-run"],
    ];

    const scale = pickScale(ext);
    const nameOf = ctx.get(id, "name") || id;
    const drawingProps = ctx.get(id, "props.drawing") || {};
    const number = drawingProps.number || `CK-GA-${id}`;
    const nearest = margin >= 0 ? nearestOnPolygon(poly, cg) : null;
    const notes = [
      "SCREENING DRAWING: generated from a software model; not checked, not approved, not for manufacture.",
      "Masses: mass.budget states (sourced / computed / estimated / requirement / unknown).",
      "Passing software checks is not physical validation: weigh the parts and run the tip test.",
    ];
    const model = {
      solver: `drawing.ga-assembly@${ASSEMBLY_GA_VERSION}`, scale,
      boxes: boxes.map((b) => ({ id: b.id, min: b.min, max: b.max, inner: b.inner })),
      notDrawn, dims, bom, cg, poly, margin, verdict, tolerance: tol, reqMin,
    };
    const modelHash = sha(JSON.stringify(canonical(model)));
    const revision = `R-${modelHash.slice(0, 8).toUpperCase()}`;
    const sheets = buildAssemblyGaSheets({
      title: drawingProps.title || `GENERAL ARRANGEMENT - ${nameOf}`,
      number, scale, revision, modelHash,
      projection: "First-angle projection",
      status: closed && verdict === "PASS" ? "SCREENING - NOT FOR MANUFACTURE" : "SCREENING - NOT FOR MANUFACTURE - MASS/CG OPEN",
      generated: `Generated by ConKay drawing.ga-assembly ${ASSEMBLY_GA_VERSION} from the design graph; revision = model hash`,
      model: `${id}: ${boxes.length} part boxes + BOM (${bom.length} lines) + ${mb.runId} + ${st.runId}`,
      views, extents: ext, cg, polygon: poly, marginLine: nearest ? { from: cg, to: nearest } : null, feet,
      dims, dimRows, bom, bomTotals, cgRows, notDrawn, notes,
    });
    const meta = { drawing: number, revision, modelHash, solver: `drawing.ga-assembly@${ASSEMBLY_GA_VERSION}` };
    const files = {
      sheet1Svg: keepContent(`${number}-${revision}-sheet1.svg`, toSvg(sheets[0], { ...meta, sheet: 1 })),
      sheet2Svg: keepContent(`${number}-${revision}-sheet2.svg`, toSvg(sheets[1], { ...meta, sheet: 2 })),
      pdf: keepContent(`${number}-${revision}.pdf`, toPdf(sheets, { ...meta, title: `${number} ${revision}`, producer: `ConKay drawing.ga-assembly ${ASSEMBLY_GA_VERSION}` })),
    };
    files.json = keepContent(`${number}-${revision}.json`, JSON.stringify({ ...meta, dims, dimRows, bom, bomTotals, cgRows, notDrawn, notes }, null, 2));
    const cgCheck = { verdict, closed, margin, requiredMargin: reqMin, unknownItems: unknownIds, tolerableUnknownMassKg: tol ? tol.massKg : null };
    return {
      inputs: {
        massBudget: { value: mb.runId, source: mb.runId },
        stability: { value: st.runId, source: st.runId },
        boxes: { value: boxes.length, note: "part boxes drawn" },
        scale: { value: `1:${scale}`, basis: "computed: largest standard scale at which the views fit A3" },
      },
      outputs: {
        revision: { value: revision, basis: "computed: first 8 hex of the model hash" },
        modelHash: { value: modelHash, basis: "computed: SHA-256 of the canonical model the sheets show" },
        dimensions: { value: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, { mm: Math.round(v.valueM * 1000), basis: v.basis }])), unit: "mm", note: "C computed, D design / layout choice" },
        bom: { value: bom },
        bomTotals: { value: bomTotals },
        cgCheck: { value: cgCheck },
        notDrawn: { value: notDrawn },
        views: { value: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, { visible: v.visible.length, hidden: v.hidden.length }])), note: "segments per view" },
        files: { value: files, note: "content-addressed (sha256); write them with writeDrawingFiles(envelope, dir)" },
      },
      warnings: verdict === "PASS" ? [] : [`CG / support-polygon check ${verdict}`],
      covers: [id],
      assumptions: [
        "A screening drawing of a software model: not checked, approved or released; not for manufacture.",
        "Bought parts drawn as their datasheet envelopes; frame members as their sections; no joints or fasteners drawn.",
        "Static pose as stated for stability.static; no gait, no joint angles.",
      ],
    };
  },
});
