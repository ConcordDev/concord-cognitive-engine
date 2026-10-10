// server/lib/chat-offline-reply.js
//
// When no LLM answers, chat replies from the DTUs it retrieved. Seed packs
// carry many numbered copies of one note ("Risk Smoothing #609", "#619", …),
// so the reply lists each distinct text once instead of the same sentence
// five times.

/**
 * @param {Array<{human?: {summary?: string}, content?: string, title?: string}>} dtus - ranked, most relevant first
 * @param {number} [limit]
 * @returns {string[]} distinct summaries, in rank order
 */
export function distinctDtuSummaries(dtus, limit = 5) {
  const seen = new Set();
  const out = [];
  for (const d of Array.isArray(dtus) ? dtus : []) {
    const summary = String(d?.human?.summary || d?.content || d?.title || "").trim();
    const key = summary.replace(/#\d+\b/g, "").replace(/\s+/g, " ").toLowerCase();
    if (!summary || seen.has(key)) continue;
    seen.add(key);
    out.push(summary);
    if (out.length === limit) break;
  }
  return out;
}

/** Machine-readable code when the requested brain produced no reply. */
export const AI_UNAVAILABLE_CODE = "ai_unavailable";

/** Short human notice. Not an answer to the user's message. */
export const AI_UNAVAILABLE_NOTICE =
  "AI is temporarily unavailable — your message was saved, try again shortly.";

/**
 * Honest chat fields when the brain was requested and no LLM reply was produced.
 * Stored notes stay on `retrieval`, labelled as notes, and never become `reply`.
 * @param {{ items?: string[] }} [opts]
 */
export function aiUnavailableChat({ items } = {}) {
  const notes = (Array.isArray(items) ? items : []).map((s) => String(s || "").trim()).filter(Boolean);
  const out = {
    ok: false,
    code: AI_UNAVAILABLE_CODE,
    llmUsed: false,
    reply: AI_UNAVAILABLE_NOTICE,
    notice: AI_UNAVAILABLE_NOTICE,
  };
  if (notes.length) {
    out.retrieval = { kind: "stored_notes", label: "Stored notes", items: notes };
  }
  return out;
}
