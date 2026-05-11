// server/domains/expert-mode.js
//
// Sprint 10B+C — macro surface for expert mode.
//
// `expert_mode.answer` is the canonical entry point the chat lens
// calls when the user toggles "Expert Mode" on. It returns the answer
// + numbered sources + provenance so the lens can render citation
// chips with "(via Claude 4.5)" badges next to each source.

import { expertAnswer, gatherSourcesForQuery, extractCitationIndices } from "../lib/expert-mode.js";

export default function registerExpertModeMacros(register) {
  register("expert_mode", "answer", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    const { query, slot, maxSources, maxTokens } = input || {};
    if (!db) return { ok: false, reason: "no_db" };
    if (!query) return { ok: false, reason: "missing_query" };
    return expertAnswer({
      db, userId, query,
      opts: { slot, maxSources, maxTokens },
    });
  }, { note: "Perplexity-style cited answer. Routes through brainChat() so the user's BYO key kicks in. Records cascade citations for every source actually referenced." });

  register("expert_mode", "sources_preview", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    const { query, maxSources } = input || {};
    if (!db || !query) return { ok: false, reason: "missing_inputs" };
    const sources = gatherSourcesForQuery(db, { query, userId, limit: maxSources || 8 });
    return { ok: true, query, sources };
  }, { note: "Preview the sources that would be cited for a query, WITHOUT running the brain. Cheap; lets the UI show 'about to consult N sources' before the user commits." });

  register("expert_mode", "extract_citations", async (_ctx, input = {}) => {
    const { text } = input || {};
    return { ok: true, indices: extractCitationIndices(text || "") };
  }, { note: "Parse a text for [N] citation markers. Stateless utility for the citation-chip renderer." });
}
