// server/domains/completion.js — the content-continuity feedback surface (G7).
// Read-only analytics for the ~2-month authored-quest cadence: "what have users
// completed, and which worlds are nearly out of authored content?"

import { completionSummary, worldQuestStatus, feedbackEnabled } from "../lib/completion-feedback.js";

export default function registerCompletionMacros(register) {
  register("completion", "summary", (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!feedbackEnabled()) return { ok: false, reason: "disabled" };
    return completionSummary(db);
  }, { note: "What users completed + which worlds are nearly exhausted (informs authored drops)." });

  register("completion", "exhaustion", (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!feedbackEnabled()) return { ok: false, reason: "disabled" };
    const worlds = worldQuestStatus(db);
    return { ok: true, worlds, nearlyExhausted: worlds.filter((w) => w.nearlyExhausted).map((w) => w.world_id) };
  }, { note: "Per-world authored-quest exhaustion + the dry-up early-warning flag." });
}
