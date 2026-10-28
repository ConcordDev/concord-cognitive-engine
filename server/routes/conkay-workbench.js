// server/routes/conkay-workbench.js
//
// Workbench v0 API (conversational-loop item 5), signed in: a design held across a conversation, its knobs, locks,
// follow-ups and receipts. Knob moves and chat follow-ups take the same edit path (chat/what-if.js). Designs run on
// the real pipeline (the car's CAD body solves in the OCC kernel unless `screening` asks for the screening body);
// conversations live in this process, owned by the user who started them, at most MAX_CONVERSATIONS (oldest
// dropped).
//
//   POST /api/conkay/workbench            { prompt, screening? } -> { id, view } | { questions, pendingId, history }
//                                         a truss / bridge, bracket, beam or Sentinel-part brief is solved by the
//                                         class-problem solvers (chat/session.js) -> { stage: "solved", domain, answer }
//   POST /api/conkay/workbench            { pendingId, text }    -> continues the questions conversation
//   GET  /api/conkay/workbench/:id        -> { view }
//   POST /api/conkay/workbench/:id/knob   { variable, value }   -> { reply, view }
//   GET  /api/conkay/workbench/:id/assembly                     -> { assembly, view } (per-part analyses joined)
//   POST /api/conkay/workbench/:id/rerun  { solver }            -> { reply, rerun, assembly, view }
//   POST /api/conkay/workbench/:id/lock   { variable, locked }  -> { view }
//   POST /api/conkay/workbench/:id/ask    { text }              -> { reply, view }
//   POST /api/conkay/workbench/:id/undo                         -> { reply, view }
//
// The questions stage keeps the conversation: the reply is stored as a pending
// entry (the prompt turns so far, owner, screening choice) and the client sends
// { pendingId, text }; the joined turns re-run designFromChat as one brief, so
// the answers continue the same design instead of starting a fresh one. On
// 'designed' the pending entry is dropped for the real session id.

import express from "express";
import crypto from "node:crypto";
import { designFromChat } from "../lib/conkay/chat/run.js";
import { parseChatBrief } from "../lib/conkay/chat/brief-parser.js";
import { ChatSession } from "../lib/conkay/chat/session.js";
import { DesignConversation } from "../lib/conkay/chat/what-if.js";
import { workbenchView, assemblySnapshot, fitCheckDiff, attachSessionAnalyses } from "../lib/conkay/chat/workbench.js";
import { hydrateAssembly } from "../lib/conkay/assembly/build.js";
import { readStlFile } from "../lib/conkay/assembly/cad-skin.js";
import { carEvaluator } from "../lib/conkay/chat/orchestrator.js";
import { REPAIR_RULES } from "../lib/conkay/chat/repair-rules.js";
import { carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";

export const MAX_CONVERSATIONS = 20;

/** Replies without live sessions (they do not serialize and are not the client's business). */
const plain = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === "session" || k === "final" || k === "readsBefore" || k === "editedSession" ? undefined : v)));

/** A pending conversation's turns as role-tagged history for the client. */
const historyOf = (turns) => turns.map((text) => ({ role: "user", text }));

/**
 * The compact assembly snapshot made viewer-ready (HANDOFF-3 A2): hydrateAssembly rebuilds the meshes
 * from the surface spec; for a cad.body surface it needs the kernel's STL, which the session's own
 * cad.body run recorded (path + sha256) — readStl serves exactly that file, nothing else.
 */
function hydratedAssembly(conv, compact) {
  if (compact?.surface?.source !== "cad.body") return hydrateAssembly(compact);
  const envs = conv?.current?.final?.envelopes;
  const cad = envs ? [...envs.values()].find((x) => x?.solver?.id === "cad.body") : null;
  const stl = cad?.outputs?.files?.value?.stl;
  if (!stl?.path || !stl?.sha256) return hydrateAssembly(compact);
  try {
    return hydrateAssembly(compact, { readStl: (sha) => (sha === stl.sha256 ? readStlFile(stl.path) : null) });
  } catch {
    return hydrateAssembly(compact);
  }
}

/**
 * The session's current assembly, viewer-ready, with each component's analysis links joined from
 * the session's own envelopes (HANDOFF-3 A4). Null when the design has no assembly run.
 */
function assemblyFor(conv) {
  const snap = assemblySnapshot(conv);
  return snap ? attachSessionAnalyses(conv, hydratedAssembly(conv, snap.compact)) : null;
}

export default function createConkayWorkbenchRouter({ requireAuth, store = new Map(), evaluatorFor = null }) {
  const router = express.Router();
  const auth = requireAuth || ((_req, _res, next) => next());
  const userOf = (req) => req.user?.id ?? req.user?.userId ?? null;
  const makeEvaluator = (screening) => (evaluatorFor || ((o) => carEvaluator({ carAcceptanceAsync, cadBody: !o.screening })))({ screening });
  const own = (req, res) => {
    const c = store.get(String(req.params.id));
    if (!c || c.pending || c.owner !== userOf(req)) { res.status(404).json({ ok: false, error: "no such workbench design" }); return null; }
    c.touched = Date.now();
    return c;
  };
  const pendingOwn = (req, res) => {
    const p = store.get(String(req.body?.pendingId));
    if (!p || !p.pending || p.owner !== userOf(req)) { res.status(404).json({ ok: false, error: "no such pending conversation" }); return null; }
    p.touched = Date.now();
    return p;
  };
  const evict = () => { while (store.size > MAX_CONVERSATIONS) store.delete([...store.entries()].sort((a, b) => a[1].touched - b[1].touched)[0][0]); };
  // A refused brief is logged by stage and the first reason only: never the prompt, never who sent it.
  const logReject = (stage, errors, domain) => {
    const first = Array.isArray(errors) && errors[0] ? String(errors[0].error || "").replace(/\s+/g, " ").slice(0, 160) : "";
    console.warn(`[conkay-workbench] 400 stage=${stage || "?"} domain=${domain || "none"} reason=${JSON.stringify(first)}`);
  };
  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  };

  router.post("/workbench", auth, handle(async (req, res) => {
    // a reply to the questions stage continues that conversation
    if (req.body?.pendingId) {
      const p = pendingOwn(req, res); if (!p) return;
      const turns = [...p.turns, String(req.body?.text || "")];
      const r = await designFromChat(turns.join("\n\n"), { evaluate: makeEvaluator(p.screening) });
      if (!r.ok) { logReject(r.stage, r.errors, r.domain); return res.status(400).json({ ok: false, stage: r.stage, errors: r.errors, pendingId: p.id, history: historyOf(turns) }); }
      if (r.stage === "questions") {
        p.turns = turns;
        return res.json({ ok: true, stage: "questions", questions: r.questions, claims: r.claims, pendingId: p.id, history: historyOf(turns) });
      }
      if (r.stage !== "designed") return res.json({ ok: true, stage: r.stage, outcome: r.outcome, pendingId: p.id, history: historyOf(turns) });
      const conv = new DesignConversation({ evaluate: makeEvaluator(p.screening), rules: REPAIR_RULES, requirements: r.ir.requirements, state: r.state, final: r.final });
      const id = crypto.randomUUID();
      store.set(id, { conv, owner: userOf(req), touched: Date.now() });
      store.delete(p.id); // the pending brief became a real session
      evict();
      return res.json({ ok: true, stage: "designed", id, outcome: r.outcome, view: workbenchView(conv) });
    }
    const prompt = String(req.body?.prompt || "").slice(0, 4000);
    // Not a car: the class-problem solvers answer it in one turn (no orchestrator, no conversation kept).
    const pre = parseChatBrief(prompt);
    if (pre.domain && pre.domain !== "car") {
      const t = new ChatSession().ask(prompt);
      if (t.kind === "questions") return res.json({ ok: true, stage: "questions", domain: t.domain, questions: t.questions, claims: t.claims });
      if (t.kind === "answer") return res.json({ ok: true, stage: "solved", domain: t.domain, answer: plain(t.answer), claims: t.claims, assumptions: t.assumptions, ...(t.followUps ? { followUps: t.followUps } : {}) });
      const errors = t.errors || [{ error: "the solver did not answer" }];
      logReject(t.kind, errors, t.domain);
      return res.status(400).json({ ok: false, stage: t.kind, domain: t.domain, errors, claims: t.claims });
    }
    const screening = !!req.body?.screening;
    const r = await designFromChat(prompt, { evaluate: makeEvaluator(screening) });
    if (!r.ok) { logReject(r.stage, r.errors, r.domain); return res.status(400).json({ ok: false, stage: r.stage, errors: r.errors }); }
    if (r.stage === "questions") {
      const id = crypto.randomUUID();
      store.set(id, { pending: true, id, turns: [prompt], owner: userOf(req), touched: Date.now(), screening });
      evict();
      return res.json({ ok: true, stage: "questions", domain: r.domain, questions: r.questions, claims: r.claims, pendingId: id, history: historyOf([prompt]) });
    }
    if (r.stage !== "designed") return res.json({ ok: true, stage: r.stage, outcome: r.outcome });
    const conv = new DesignConversation({ evaluate: makeEvaluator(screening), rules: REPAIR_RULES, requirements: r.ir.requirements, state: r.state, final: r.final });
    const id = crypto.randomUUID();
    store.set(id, { conv, owner: userOf(req), touched: Date.now() });
    evict();
    res.json({ ok: true, stage: "designed", id, outcome: r.outcome, view: workbenchView(conv) });
  }));

  router.get("/workbench/:id", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    res.json({ ok: true, view: workbenchView(c.conv) });
  }));

  router.post("/workbench/:id/knob", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    // an invalid knob value is an input error (HTTP 400 invalid_input), never a 200 with an error string;
    // a successful edit also returns what it changed in the solved assembly: the fit checks that flipped,
    // the solver runs that re-ran, and the new compact assembly (HANDOFF-3 A1)
    const before = assemblySnapshot(c.conv);
    const reply = await c.conv.setKnob(String(req.body?.variable || ""), req.body?.value);
    if (reply?.error === "invalid_input") {
      return res.status(400).json({ ok: false, error: "invalid_input", field: reply.field, reason: reply.reason, message: reply.message });
    }
    const after = assemblySnapshot(c.conv);
    res.json({
      ok: true,
      reply: plain(reply),
      fitCheckDiff: fitCheckDiff(before?.checks, after?.checks),
      rerun: Array.isArray(reply?.diff?.rerun) ? reply.diff.rerun : [],
      assembly: after ? assemblyFor(c.conv) : null,
      view: workbenchView(c.conv),
    });
  }));

  router.get("/workbench/:id/assembly", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const assembly = assemblyFor(c.conv);
    if (!assembly) return res.status(404).json({ ok: false, error: "no assembly for this design" });
    res.json({ ok: true, assembly, view: workbenchView(c.conv) });
  }));

  router.post("/workbench/:id/rerun", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const solver = String(req.body?.solver || "");
    if (!solver) return res.status(400).json({ ok: false, error: "invalid_input", field: "solver", reason: "required", message: "solver is required" });
    const reply = c.conv.rerunSolver(solver);
    if (reply?.kind === "error") {
      return res.status(reply.error === "not_run" ? 404 : 400).json({ ok: false, error: reply.error, message: reply.message });
    }
    res.json({ ok: true, reply: plain(reply), rerun: reply.rerun, assembly: assemblyFor(c.conv), view: workbenchView(c.conv) });
  }));

  router.post("/workbench/:id/lock", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const v = String(req.body?.variable || "");
    const r = req.body?.locked === false ? c.conv.unlock(v) : c.conv.lock(v);
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true, view: workbenchView(c.conv) });
  }));

  router.post("/workbench/:id/ask", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const reply = await c.conv.ask(String(req.body?.text || ""));
    res.json({ ok: true, reply: plain(reply), view: workbenchView(c.conv) });
  }));

  router.post("/workbench/:id/undo", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const reply = await c.conv.undo();
    res.json({ ok: true, reply, view: workbenchView(c.conv) });
  }));

  return router;
}
