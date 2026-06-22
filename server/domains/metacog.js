// server/domains/metacog.js
//
// Metacognition read-path. Cognitive Fingerprint (#5): a user's thinking-style
// profile (output, domain breadth, citation influence, depth, dominant domains,
// derived style) computed from real activity, plus the snapshot time-series.
//
// Registered from server.js: registerMetacogMacros(register).

import { computeFingerprint, getFingerprintHistory } from "../lib/cognitive-fingerprint.js";
import { replayForAgent } from "../lib/cognitive-replay.js";

export default function registerMetacogMacros(register) {
  register("metacog", "fingerprint", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, userId, fingerprint: computeFingerprint(db, userId) };
  }, { note: "current cognitive fingerprint — thinking-style profile from real activity (#5)" });

  register("metacog", "fingerprint_history", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, userId, history: getFingerprintHistory(db, userId, input.limit) };
  }, { note: "cognitive fingerprint snapshot time-series (#5)" });

  register("metacog", "replay", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const agentId = input.agentId || ctx?.actor?.userId;
    if (!agentId) return { ok: false, reason: "no_agent" };
    return replayForAgent(db, agentId, { sinceTs: input.sinceTs, topN: input.topN });
  }, { note: "cognitive replay — a grounded retrospective over real recorded deliberations (#3)" });
}
