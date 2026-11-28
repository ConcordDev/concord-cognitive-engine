// server/lib/conkay/build/index.js
//
// buildFromBrief: what the person wants → Kay's design graph → every
// applicable solver → a report of what was checked, what wasn't and why, in
// the person's units → a 3D model of the parts. Revising with answers re-plans
// from the previous graph. Builds persist per user (migration 518).

import crypto from "node:crypto";
import { planBuild, checkPlan } from "./planner.js";
import { buildReport } from "./report.js";
import { openDesign } from "../index.js";
import { designIrParts } from "../cad-glb.js";

/** Model call through the person's brain routing; null when unavailable. */
export async function defaultChat({ db, userId }) {
  const { brainChat } = await import("../../byo-router.js");
  return async (messages) => {
    try {
      const r = await brainChat({ db, userId, slot: "conscious", messages, opts: { temperature: 0.2, maxTokens: 3500, timeoutMs: 120000 } });
      return r?.ok ? { ok: true, text: r.text } : { ok: false, error: r?.error || "model unavailable" };
    } catch (e) { return { ok: false, error: e.message }; }
  };
}

export async function defaultLookup(query) {
  const { textbookLookup } = await import("../../openstax-lookup.js");
  return textbookLookup(query, { waitMs: 20000 });
}

/** The parts as one chat mesh artifact (metres) with a range per part. */
export function buildMesh(graph, title) {
  const { parts, skipped } = designIrParts({ nodes: [...graph.nodes.values()] });
  if (!parts.length) return { artifact: null, skipped };
  const positions = []; const indices = []; const partRanges = [];
  for (const p of parts) {
    const v0 = positions.length / 3, i0 = indices.length;
    // Design coordinates are z-up (frames, heights); the 3D view is y-up: (x, y, z) → (x, z, −y).
    for (let k = 0; k < p.positions.length; k += 3) positions.push(p.positions[k] / 1000, p.positions[k + 2] / 1000, -p.positions[k + 1] / 1000);
    for (const i of p.indices) indices.push(i + v0);
    partRanges.push({ id: p.id, v0, v1: positions.length / 3, i0, i1: indices.length, name: p.name, nodeName: p.nodeName, size_mm: p.size_mm, shape: p.shape });
  }
  // Overall size (display axes, mm) so the view frames the whole build and its grid is to scale.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < positions.length; k++) { const a = k % 3; lo[a] = Math.min(lo[a], positions[k]); hi[a] = Math.max(hi[a], positions[k]); }
  const ext = hi.map((h, a) => Math.round((h - lo[a]) * 1e4) / 10);
  return {
    artifact: {
      kind: "mesh", source: "conkay_build", title: `${title || "build"} model`, meshKind: "build-assembly",
      positions, indices, vertexCount: positions.length / 3, triangleCount: indices.length / 3,
      geometryUnits: "m", units: "mm", partRanges,
      extents_mm: { x: ext[0], y: ext[1], z: ext[2] },
      bbox_mm: { length: ext[0], height: ext[1], width: ext[2] },
    },
    skipped,
  };
}

/** Run a planned IR through every solver (and external kernels) and report. */
export async function checkBuild(ir, { text, plan, settle = true }) {
  // The plan keeps the person's units; the solvers read SI.
  const ready = checkPlan(ir);
  if (!ready.ok) return { ok: false, error: "compile", errors: ready.errors };
  const opened = openDesign(ready.ir);
  if (!opened.ok) return { ok: false, error: "compile", errors: opened.errors };
  if (settle) { try { await opened.session.settle(); } catch { /* kernel failures stay NOT_COMPUTED with their reason */ } }
  const report = buildReport(opened.session, { text, plan: { ...plan, ir } });
  const mesh = buildMesh(opened.session.graph, ir.design?.name);
  if (mesh.skipped?.length) for (const s of mesh.skipped) report.gaps.push({ target: s.id, targetName: s.name, reason: `not drawn in 3D: ${s.reason}` });
  return { ok: true, session: opened.session, report, artifact: mesh.artifact };
}

/**
 * brief → plan → solvers → report. deps: { chat, lookup } (injected in tests;
 * defaults route through the person's model and the textbook index).
 */
export async function buildFromBrief({ brief, answers = [], previous = null, db = null, userId = null, chat = null, lookup = null, settle = true }) {
  const text = [brief, ...answers.map((a) => a.answer)].join("\n");
  const plan = await planBuild({
    brief, answers, previous,
    chat: chat || (await defaultChat({ db, userId })),
    lookup: lookup === null ? defaultLookup : lookup,
  });
  if (!plan.ok) return plan;
  const ran = await checkBuild(plan.ir, { text, plan, settle });
  if (!ran.ok) return { ok: false, error: "compile", errors: ran.errors };
  return { ok: true, summary: plan.summary, ir: plan.ir, plan, report: ran.report, artifact: ran.artifact, session: ran.session };
}

// ── persistence ──────────────────────────────────────────────────────────────
const has = (db) => { try { return !!db?.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conkay_builds'").get(); } catch { return false; } };

export function saveBuild(db, { id = null, userId, brief, answers, result }) {
  if (!has(db) || !userId) return null;
  const bid = id || `bld_${crypto.randomBytes(8).toString("hex")}`;
  const planJson = result?.ok ? JSON.stringify({ ir: result.ir, summary: result.summary, questions: result.plan.questions, assumptions: result.plan.assumptions, sources: result.plan.sources }) : null;
  const reportJson = result?.ok ? JSON.stringify(result.report) : null;
  const status = !result?.ok ? "failed" : result.plan.questions.some((q) => q.blocking) ? "needs_answers" : result.report.verdict;
  db.prepare(`INSERT INTO conkay_builds (id, user_id, brief, answers_json, plan_json, report_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET answers_json = excluded.answers_json, plan_json = COALESCE(excluded.plan_json, conkay_builds.plan_json),
      report_json = COALESCE(excluded.report_json, conkay_builds.report_json), status = excluded.status, updated_at = unixepoch()`)
    .run(bid, userId, String(brief).slice(0, 4000), JSON.stringify(answers || []), planJson, reportJson, status);
  return bid;
}

export function loadBuild(db, id, userId) {
  if (!has(db)) return null;
  const row = db.prepare("SELECT * FROM conkay_builds WHERE id = ? AND user_id = ?").get(String(id), String(userId));
  if (!row) return null;
  const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  return { id: row.id, brief: row.brief, answers: parse(row.answers_json, []), plan: parse(row.plan_json, null), report: parse(row.report_json, null), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listBuilds(db, userId, limit = 20) {
  if (!has(db)) return [];
  return db.prepare("SELECT id, brief, status, updated_at FROM conkay_builds WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(String(userId), Math.min(100, Math.max(1, limit | 0)))
    .map((r) => ({ id: r.id, brief: r.brief, status: r.status, updatedAt: r.updated_at }));
}

/**
 * Edit a saved build (no model): apply the person's values, re-run every
 * solver, save the new graph and report. Returns the same shape as a build.
 */
export async function editBuild(db, { id, userId, edits, settle = true }) {
  const { applyEdits } = await import("./edit.js");
  const b = loadBuild(db, id, userId);
  if (!b) return { ok: false, error: "not_found" };
  if (!b.plan?.ir) return { ok: false, error: "no_plan", message: "This build has no design yet; ask Kay to plan it first." };
  const ed = applyEdits(b.plan.ir, edits);
  if (!ed.ok) return { ok: false, error: "invalid_edit", errors: ed.errors };
  const text = [b.brief, ...b.answers.map((a) => a.answer), ...edits.map((e) => String(e.value))].join("\n");
  const plan = { ...b.plan, ir: ed.ir };
  const ran = await checkBuild(ed.ir, { text, plan, settle });
  if (!ran.ok) return { ok: false, error: "compile", errors: ran.errors };
  const result = { ok: true, summary: b.plan.summary, ir: ed.ir, plan: { questions: b.plan.questions || [], assumptions: b.plan.assumptions || [], sources: b.plan.sources || [] }, report: ran.report };
  saveBuild(db, { id: b.id, userId, brief: b.brief, answers: b.answers, result });
  return { ...result, id: b.id, applied: ed.applied, artifact: ran.artifact ? { ...ran.artifact, buildId: b.id, report: ran.report, summary: b.plan.summary } : { kind: "build", source: "conkay_build", title: ed.ir.design?.name || "build", buildId: b.id, report: ran.report, summary: b.plan.summary } };
}

/**
 * Reopen a saved build: its stored report (exactly what was checked when it
 * was saved) and its 3D parts rebuilt from the saved graph.
 */
export function openBuild(db, id, userId) {
  const b = loadBuild(db, id, userId);
  if (!b) return null;
  let artifact = null;
  if (b.plan?.ir && b.report) {
    const ready = checkPlan(b.plan.ir);
    const opened = ready.ok ? openDesign(ready.ir) : null;
    const mesh = opened?.ok ? buildMesh(opened.session.graph, b.plan.ir.design?.name) : null;
    artifact = { ...(mesh?.artifact || { kind: "build", source: "conkay_build", title: b.plan.ir.design?.name || "build" }), buildId: b.id, report: b.report, summary: b.plan.summary };
  }
  return { build: b, artifact };
}

/**
 * The build as one STEP file of real B-rep solids (OpenCascade). The graph is
 * recompiled from the saved plan, so the file is exactly the saved design.
 */
export async function buildStepFile(db, id, userId) {
  const b = loadBuild(db, id, userId);
  if (!b) return { ok: false, error: "not_found" };
  if (!b.plan?.ir) return { ok: false, error: "no_plan" };
  const ready = checkPlan(b.plan.ir);
  if (!ready.ok) return { ok: false, error: "compile", errors: ready.errors };
  const opened = openDesign(ready.ir);
  if (!opened.ok) return { ok: false, error: "compile", errors: opened.errors };
  const { buildStep } = await import("../geometry/solids.js");
  const r = await buildStep(opened.session.graph);
  return r.ok ? { ok: true, step: r.step, name: (b.plan.ir.design?.name || "build").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "build", parts: r.parts } : { ok: false, error: "kernel", message: r.error };
}

/**
 * Size a saved build (no model): the person or Kay names what may change and
 * within what bounds; the lightest design on which every check passes is
 * found, re-checked in full, and saved. Returns the build shape plus the
 * sizing receipt.
 */
export async function sizeSavedBuild(db, { id, userId, variables, settle = true }) {
  const { sizeBuild } = await import("./size.js");
  const b = loadBuild(db, id, userId);
  if (!b) return { ok: false, error: "not_found" };
  if (!b.plan?.ir) return { ok: false, error: "no_plan" };
  const sized = sizeBuild(b.plan.ir, { variables });
  if (!sized.ok) return { ok: false, error: sized.error, errors: sized.errors };
  if (!sized.feasible) return { ok: true, id: b.id, feasible: false, sizing: sized };
  const text = [b.brief, ...b.answers.map((a) => a.answer), ...sized.changes.map((c) => c.to)].join("\n");
  const plan = { ...b.plan, ir: sized.ir };
  const ran = await checkBuild(sized.ir, { text, plan, settle });
  if (!ran.ok) return { ok: false, error: "compile", errors: ran.errors };
  const result = { ok: true, summary: b.plan.summary, ir: sized.ir, plan: { questions: b.plan.questions || [], assumptions: b.plan.assumptions || [], sources: b.plan.sources || [] }, report: ran.report };
  saveBuild(db, { id: b.id, userId, brief: b.brief, answers: b.answers, result });
  const { ir: _ir, ...receipt } = sized;
  return { ok: true, id: b.id, feasible: true, sizing: receipt, report: ran.report,
    artifact: { ...(ran.artifact || { kind: "build", source: "conkay_build", title: sized.ir.design?.name || "build" }), buildId: b.id, report: ran.report, summary: b.plan.summary, sizing: receipt } };
}

/** Summary for the chat model: numbers only from the report. */
export function buildToolSummary(result) {
  const r = result.report;
  return {
    summary: result.summary,
    verdict: r.verdict, headline: r.headline,
    parts: r.parts, masses: r.masses,
    checked: r.checked.map((c) => ({ part: c.targetName, check: c.check, demand: c.demand, capacity: c.capacity, pass: c.pass, basis: c.basis })),
    notChecked: r.gaps.slice(0, 12).map((g) => ({ part: g.targetName, why: g.reason })),
    computed: r.computed.slice(0, 8).map((c) => ({ part: c.targetName, solver: c.solver, outputs: c.outputs, note: c.note })),
    questions: r.questions, assumptions: r.assumptions,
    sources: r.sources.map((s) => ({ for: s.for, book: s.book, section: s.section, url: s.url })),
  };
}
