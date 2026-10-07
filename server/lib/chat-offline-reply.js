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
