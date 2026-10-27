// ConKay answers from retrieved Concord notes first.
//
// When a DTU is named in the question or the retrieval match is strong, the
// tool-heavy agent loop still web-searched (its lookup fallback call runs
// web_search when the model answers from memory). This is a direct, tool-free
// turn over the notes; when the notes don't hold the answer it returns null
// and the normal agent loop runs.

import { sanitizeAgentHistory } from "../chat/agent-history-sanitize.js";

// Routes whose work needs a tool (writes, design, media, jobs, code).
const TOOL_ROUTES = new Set(["action", "save", "music", "browse", "design", "fea", "long", "jobs", "continue", "code", "remember", "status", "recall"]);
const WANTS_WEB_RE = /\b(?:search (?:the )?(?:web|internet|online)|google|latest|news|today'?s|current(?:ly)?|price|stock)\b/i;
export const NOT_IN_NOTES = "NOT_IN_NOTES";

/** A strong DTU match on a question that needs no tool. */
export function notesDirectEligible({ plan = null, got = null, message = "" } = {}) {
  if (!got?.strong || !String(got?.text || "").trim()) return false;
  if (plan?.fallbackCall?.tool && plan.fallbackCall.tool !== "web_search") return false;
  if (plan?.route && TOOL_ROUTES.has(plan.route)) return false;
  return !WANTS_WEB_RE.test(String(message || ""));
}

export function notesAnswerMessages({ block, message, history = [] }) {
  const system = [
    "You are ConKay, Concord's assistant. Answer the user's question from the CONCORD KNOWLEDGE notes below.",
    "Use only the notes. Give the answer first (a number when a number is asked), then name the DTU title you used in one short sentence.",
    `If the notes do not contain the answer, reply with exactly ${NOT_IN_NOTES} and nothing else.`,
    "",
    String(block || "").slice(0, 8000),
  ].join("\n");
  const prior = sanitizeAgentHistory(history).slice(-6);
  return [{ role: "system", content: system }, ...prior, { role: "user", content: String(message || "").slice(0, 4000) }];
}

/** @returns {Promise<{answer:string, model?:string, provider?:string}|null>} */
export async function answerFromNotes({ brain, db, userId, slot, block, message, history = [], timeoutMs = 45000 }) {
  if (typeof brain !== "function") return null;
  let r;
  try {
    r = await brain({ db, userId, slot: slot || "conscious", messages: notesAnswerMessages({ block, message, history }), opts: { temperature: 0.2, maxTokens: 400, timeoutMs } });
  } catch { return null; }
  const text = String(r?.text || "").replace(/\[TOOL_CALL:[\s\S]*?\]\s*\]?/g, "").trim();
  if (!r?.ok || !text || text.includes(NOT_IN_NOTES)) return null;
  return { answer: text, model: r.model, provider: r.provider };
}
