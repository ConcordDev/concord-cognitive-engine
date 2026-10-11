// server/domains/conkay-design.js
//
// Lens actions for the ConKay physical-system compiler (lib/conkay/index.js).
// A design belongs to the user who opened it. It is stored as its Design IR
// plus its edit log (migration 470); results are rebuilt by replaying both,
// so what you see after a restart is exactly what was computed before.
//
//   conkay_design.open      { ir }                  → new design, every applicable solver run
//   conkay_design.get       { designId }            → results, coverage, graph, history
//   conkay_design.edit      { designId, text }      → a sentence ("make bolt B1 stainless")
//                           { designId, ops }       → or graph ops [{ node, path, value (SI) }]
//   conkay_design.list      {}                      → your designs
//   conkay_design.solvers   {}                      → the solver registry
//   conkay_design.parse-brief { brief }             → numeric targets + unparsed intent
//   conkay_design.feasibility { brief, bounds? }    → physics bound on whether any design could meet it
//   conkay_design.from-brief  { brief }             → open a design: system tree + wired requirements
//   conkay_design.export      { designId }          → the Realization Package (files as text)
//   conkay_design.car-acceptance { brief }          → the brief built from the component library: mass by state, critical-placeholder gate, tyre and top-speed status (computed, not saved)

import crypto from "node:crypto";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { parseBrief } from "../lib/conkay/compiler/requirement-parser.js";
import { checkFeasibility } from "../lib/conkay/compiler/feasibility.js";
import { compileBrief } from "../lib/conkay/compiler/architectures.js";
// Registers bracket.plate before any design is opened. Kept off index.js so
// this solver does not collide with in-flight ConKay solver PRs.
import "../lib/conkay/physics/solvers/bracket-plate.js";
import { carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";

const SESSION_CACHE_MAX = 64;
const sessions = new Map(); // designId -> session (LRU by insertion order)

const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || null;
const nowIso = () => new Date().toISOString();

function cache(id, session) {
  sessions.delete(id);
  sessions.set(id, session);
  while (sessions.size > SESSION_CACHE_MAX) sessions.delete(sessions.keys().next().value);
}

function loadRow(db, id, userId) {
  const row = db.prepare("SELECT * FROM conkay_designs WHERE id = ?").get(String(id || ""));
  if (!row || row.owner_id !== userId) return null; // someone else's design reads as not found
  return row;
}

/** Rebuild a session from the stored IR and edit log. */
function sessionFor(db, row) {
  const hit = sessions.get(row.id);
  if (hit) { cache(row.id, hit); return { ok: true, session: hit }; }
  const opened = openDesign(JSON.parse(row.ir_json));
  if (!opened.ok) return { ok: false, error: `stored design no longer compiles: ${opened.errors.join("; ")}` };
  const edits = db.prepare("SELECT * FROM conkay_design_edits WHERE design_id = ? ORDER BY revision").all(row.id);
  for (const e of edits) {
    const r = opened.session.engine.applyEdits(JSON.parse(e.ops_json), { source: e.source, text: e.text });
    if (!r.ok) return { ok: false, error: `edit ${e.revision} no longer applies: ${r.error}` };
  }
  cache(row.id, opened.session);
  return { ok: true, session: opened.session };
}

function view(id, row, session) {
  return {
    designId: id,
    name: row.name,
    summary: session.summary(),
    results: session.results(),
    coverage: session.coverage(),
    graph: session.graph.toJSON(),
  };
}

/** Tests only: drop cached sessions so the next read replays from the database. */
export function _resetDesignSessionCache() {
  sessions.clear();
}

export default function registerConkayDesignActions(registerLensActionRaw) {
  const actions = {};
  const registerLensAction = (domain, name, fn) => { actions[name] = fn; return registerLensActionRaw(domain, name, fn); };
  registerLensAction("conkay_design", "solvers", () => ({ ok: true, result: { solvers: listSolvers() } }));

  registerLensAction("conkay_design", "parse-brief", (_ctx, _artifact, params) => {
    const brief = String(params?.brief || "").slice(0, 4000);
    if (!brief.trim()) return { ok: false, error: "send a brief" };
    return { ok: true, result: parseBrief(brief) };
  });

  registerLensAction("conkay_design", "feasibility", (_ctx, _artifact, params) => {
    const brief = String(params?.brief || "").slice(0, 4000);
    if (!brief.trim()) return { ok: false, error: "send a brief" };
    const parsed = parseBrief(brief);
    const bounds = params?.bounds && typeof params.bounds === "object" ? params.bounds : {};
    return { ok: true, result: { parsed, feasibility: checkFeasibility(parsed, bounds) } };
  });

  registerLensAction("conkay_design", "open", async (ctx, _artifact, params) => {
    const userId = actor(ctx);
    if (!userId || userId === "anon") return { ok: false, error: "sign in to save a design" };
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no database" };
    const ir = params?.ir;
    const opened = openDesign(ir);
    if (!opened.ok) return { ok: false, error: "the design did not compile", errors: opened.errors };
    const id = `dsg_${crypto.randomUUID()}`;
    const ts = nowIso();
    const name = String(opened.session.graph.design.name).slice(0, 200);
    db.prepare("INSERT INTO conkay_designs (id, owner_id, name, ir_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, userId, name, JSON.stringify(ir), ts, ts);
    cache(id, opened.session);
    await opened.session.settle(); // external kernels (CAD body, drawing) run off the request path
    return { ok: true, result: view(id, { name }, opened.session) };
  });

  registerLensAction("conkay_design", "from-brief", async (ctx, artifact, params) => {
    const brief = String(params?.brief || "").slice(0, 4000);
    if (!brief.trim()) return { ok: false, error: "send a brief" };
    const c = compileBrief(brief);
    if (c.error) return { ok: false, error: c.error, parsed: c.parsed, ...(c.supportedParts ? { supportedParts: c.supportedParts } : {}) };
    const opened = await actions.open(ctx, artifact, { ir: c.ir });
    const solvedFields = c.solve ? {
      assumed: c.assumed, assumptions: c.assumptions, solve: c.solve, mesh: c.mesh,
    } : {};
    if (!opened.ok) {
      if (c.solve && /sign in|no database/i.test(String(opened.error || ""))) {
        return { ok: true, result: { architecture: c.architecture, parsed: c.parsed, ...solvedFields, saved: false, saveError: opened.error } };
      }
      return opened;
    }
    return { ok: true, result: { ...opened.result, architecture: c.architecture, parsed: c.parsed, unmapped: c.unmapped, ...solvedFields, saved: true } };
  });

  registerLensAction("conkay_design", "car-acceptance", async (_ctx, _artifact, params) => {
    const brief = String(params?.brief || "").slice(0, 4000);
    if (!brief.trim()) return { ok: false, error: "send a brief" };
    const r = await carAcceptanceAsync(brief);
    if (!r.ok) return { ok: false, error: r.error, ...(r.errors ? { errors: r.errors } : {}) };
    return { ok: true, result: r.report };
  });

  registerLensAction("conkay_design", "get", async (ctx, _artifact, params) => {
    const db = ctx?.db;
    const row = db && loadRow(db, params?.designId, actor(ctx));
    if (!row) return { ok: false, error: "design not found" };
    const s = sessionFor(db, row);
    if (!s.ok) return { ok: false, error: s.error };
    await s.session.settle();
    return { ok: true, result: view(row.id, row, s.session) };
  });

  registerLensAction("conkay_design", "edit", async (ctx, _artifact, params) => {
    const db = ctx?.db;
    const row = db && loadRow(db, params?.designId, actor(ctx));
    if (!row) return { ok: false, error: "design not found" };
    const s = sessionFor(db, row);
    if (!s.ok) return { ok: false, error: s.error };
    const { session } = s;
    let report;
    if (typeof params?.text === "string" && params.text.trim()) report = session.editText(params.text.slice(0, 500));
    else if (Array.isArray(params?.ops) && params.ops.length) report = session.edit(params.ops);
    else return { ok: false, error: "send text or ops" };
    if (!report.ok) return { ok: false, error: report.error };
    const entry = session.graph.history.at(-1);
    const ts = nowIso();
    db.transaction(() => {
      db.prepare("INSERT INTO conkay_design_edits (design_id, revision, source, text, ops_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(row.id, entry.revision, entry.source, entry.text, JSON.stringify(entry.ops.map((o) => o.replay)), ts);
      db.prepare("UPDATE conkay_designs SET updated_at = ? WHERE id = ?").run(ts, row.id);
    })();
    const settled = await session.settle();
    return { ok: true, result: { designId: row.id, ...report, ...(settled.kernels ? { kernelRerun: settled.rerun } : {}), summary: session.summary() } };
  });

  registerLensAction("conkay_design", "export", async (ctx, _artifact, params) => {
    const db = ctx?.db;
    const row = db && loadRow(db, params?.designId, actor(ctx));
    if (!row) return { ok: false, error: "design not found" };
    const s = sessionFor(db, row);
    if (!s.ok) return { ok: false, error: s.error };
    await s.session.settle();
    return { ok: true, result: { designId: row.id, revision: s.session.graph.revision, ...s.session.realizationPackage() } };
  });

  registerLensAction("conkay_design", "list", (ctx) => {
    const db = ctx?.db;
    const userId = actor(ctx);
    if (!db || !userId) return { ok: true, result: { designs: [] } };
    const designs = db.prepare("SELECT id, name, created_at, updated_at FROM conkay_designs WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100").all(userId);
    return { ok: true, result: { designs } };
  });
}
