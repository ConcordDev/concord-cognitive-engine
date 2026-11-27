// server/lib/conkay/build/index.js
//
// buildFromBrief: what the person wants → Kay's design graph → every
// applicable solver → a report of what was checked, what wasn't and why, in
// the person's units → a 3D model of the parts. Revising with answers re-plans
// from the previous graph. Builds persist per user (migration 518).

import crypto from "node:crypto";
import { planBuild } from "./planner.js";
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
    for (const x of p.positions) positions.push(x / 1000);
    for (const i of p.indices) indices.push(i + v0);
    partRanges.push({ v0, v1: positions.length / 3, i0, i1: indices.length, name: p.name, nodeName: p.nodeName, size_mm: p.size_mm, shape: p.shape });
  }
  return {
    artifact: {
      kind: "mesh", source: "conkay_build", title: `${title || "build"} model`, meshKind: "build-assembly",
      positions, indices, vertexCount: positions.length / 3, triangleCount: indices.length / 3,
      geometryUnits: "m", units: "mm", partRanges,
    },
    skipped,
  };
}

/** Run a planned IR through every solver (and external kernels) and report. */
export async function checkBuild(ir, { text, plan, settle = true }) {
  const opened = openDesign(ir);
  if (!opened.ok) return { ok: false, error: "compile", errors: opened.errors };
  if (settle) { try { await opened.session.settle(); } catch { /* kernel failures stay NOT_COMPUTED with their reason */ } }
  const report = buildReport(opened.session, { text, plan });
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
