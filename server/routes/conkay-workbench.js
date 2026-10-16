// server/routes/conkay-workbench.js
//
// Workbench v0 API (conversational-loop item 5), signed in: a design held across a conversation, its knobs, locks,
// follow-ups and receipts. Knob moves and chat follow-ups take the same edit path (chat/what-if.js). Designs run on
// the real pipeline (the car's CAD body solves in the OCC kernel unless `screening` asks for the screening body);
// conversations live in this process, owned by the user who started them, at most MAX_CONVERSATIONS (oldest
// dropped).
//
//   POST /api/conkay/workbench            { prompt, screening? } -> { id, view } | { questions }
//   GET  /api/conkay/workbench/:id        -> { view }
//   POST /api/conkay/workbench/:id/knob   { variable, value }   -> { reply, view }
//   POST /api/conkay/workbench/:id/lock   { variable, locked }  -> { view }
//   POST /api/conkay/workbench/:id/ask    { text }              -> { reply, view }
//   POST /api/conkay/workbench/:id/undo                         -> { reply, view }

import express from "express";
import crypto from "node:crypto";
import { designFromChat } from "../lib/conkay/chat/run.js";
import { DesignConversation } from "../lib/conkay/chat/what-if.js";
import { workbenchView } from "../lib/conkay/chat/workbench.js";
import { carEvaluator } from "../lib/conkay/chat/orchestrator.js";
import { REPAIR_RULES } from "../lib/conkay/chat/repair-rules.js";
import { carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";

export const MAX_CONVERSATIONS = 20;

/** Replies without live sessions (they do not serialize and are not the client's business). */
const plain = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === "session" || k === "final" || k === "readsBefore" || k === "editedSession" ? undefined : v)));

export default function createConkayWorkbenchRouter({ requireAuth, store = new Map(), evaluatorFor = null }) {
  const router = express.Router();
  const auth = requireAuth || ((_req, _res, next) => next());
  const userOf = (req) => req.user?.id ?? req.user?.userId ?? null;
  const own = (req, res) => {
    const c = store.get(String(req.params.id));
    if (!c || c.owner !== userOf(req)) { res.status(404).json({ ok: false, error: "no such workbench design" }); return null; }
    c.touched = Date.now();
    return c;
  };
  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  };

  router.post("/workbench", auth, handle(async (req, res) => {
    const prompt = String(req.body?.prompt || "");
    const evaluate = (evaluatorFor || ((o) => carEvaluator({ carAcceptanceAsync, cadBody: !o.screening })))({ screening: !!req.body?.screening });
    const r = await designFromChat(prompt, { evaluate });
    if (!r.ok) return res.status(400).json({ ok: false, stage: r.stage, errors: r.errors });
    if (r.stage === "questions") return res.json({ ok: true, stage: "questions", questions: r.questions, claims: r.claims });
    if (r.stage !== "designed") return res.json({ ok: true, stage: r.stage, outcome: r.outcome });
    const conv = new DesignConversation({ evaluate, rules: REPAIR_RULES, requirements: r.ir.requirements, state: r.state, final: r.final });
    const id = crypto.randomUUID();
    store.set(id, { conv, owner: userOf(req), touched: Date.now() });
    while (store.size > MAX_CONVERSATIONS) store.delete([...store.entries()].sort((a, b) => a[1].touched - b[1].touched)[0][0]);
    res.json({ ok: true, stage: "designed", id, outcome: r.outcome, view: workbenchView(conv) });
  }));

  router.get("/workbench/:id", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    res.json({ ok: true, view: workbenchView(c.conv) });
  }));

  router.post("/workbench/:id/knob", auth, handle(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const reply = await c.conv.setKnob(String(req.body?.variable || ""), req.body?.value);
    res.json({ ok: true, reply: plain(reply), view: workbenchView(c.conv) });
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
