// server/domains/run-draft.js
//
// F4.1 — shared in-run draft surface. Any run-mode (roguelite/extraction/horde)
// calls these at a draft step. Domain key: 'run_draft'.
//   run_draft.offer     — deterministic N-boon offering for a run
//   run_draft.pick      — take a boon (validates not-already-picked)
//   run_draft.modifiers — accumulated live modifier bundle + active synergies

import { rollDraft, recordPick, getRunModifiers } from "../lib/run-draft.js";

const KINDS = new Set(["roguelite", "extraction", "horde"]);

export default function registerRunDraftMacros(register) {
  register("run_draft", "offer", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { runKind, runId } = input;
    if (!KINDS.has(runKind) || !runId) return { ok: false, reason: "missing_inputs" };
    const count = Math.max(1, Math.min(5, Number(input.count) || 3));
    return { ok: true, offering: rollDraft(db, runKind, String(runId), count) };
  });

  register("run_draft", "pick", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    const { runKind, runId, pickId } = input;
    if (!userId || !KINDS.has(runKind) || !runId || !pickId) return { ok: false, reason: "missing_inputs" };
    const r = recordPick(db, { runKind, runId: String(runId), userId, pickId: String(pickId) });
    if (!r.ok) return r;
    return { ok: true, ...r, ...getRunModifiers(db, runKind, String(runId)) };
  });

  register("run_draft", "modifiers", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { runKind, runId } = input;
    if (!KINDS.has(runKind) || !runId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, ...getRunModifiers(db, runKind, String(runId)) };
  });
}
