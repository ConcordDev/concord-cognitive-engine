// server/lib/expert-mode.js
//
// Sprint 10B+C — Perplexity-style "expert mode" + the revolving-door
// global-DTU pull.
//
// Two parts that compose:
//
//   1. EXPERT MODE PROMPT — a citation-disciplined system prompt that
//      forces the brain to cite every factual claim against a numbered
//      source list. Sources include:
//        - DTUs from the user's own corpus
//        - Global DTUs (public/published, including frontier-tier-
//          minted ones from other users — this is the revolving door)
//        - Optional web search results
//
//   2. REVOLVING DOOR — when answering a free-tier user's question,
//      the substrate searches the global DTU corpus and surfaces the
//      best matches. DTUs minted by power users with frontier-tier
//      API keys (Claude/GPT/Grok) are AUTOMATICALLY included. The
//      free user gets frontier-quality synthesis without paying for
//      it; the frontier-tier creator gets royalty cascade credits
//      when their DTU is cited.
//
// Concretely the cascade fires through the EXISTING royalty-cascade
// substrate — every DTU we cite in an expert-mode answer is recorded
// as a citation via registerCitation(). That's the entire economic
// loop. We don't add new economics; we wire the new chat mode INTO
// the existing economics.

import { brainChat, provenanceFrom } from "./byo-router.js";
import { TASK_PROMPTS } from "./prompt-registry.js";

// System prompt centralized in prompt-registry.js. Edit there.
const EXPERT_SYSTEM_PROMPT = TASK_PROMPTS.expertMode();

/**
 * Pull candidate DTUs from the global corpus for a given query.
 * Free-tier users automatically see DTUs minted by paid-tier users
 * (the revolving door). The provenance is preserved so the citation
 * chip in the UI can show "(via Claude-opus-4-7)" etc.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.query           text to match against
 * @param {string} [opts.userId]        optional — to also surface user's own DTUs
 * @param {number} [opts.limit=8]       max sources to return
 * @param {boolean} [opts.includeUserPrivate=true]
 * @returns {Array<{id, title, snippet, minted_by_provider, minted_by_model, creator_id, scope}>}
 */
export function gatherSourcesForQuery(db, opts = {}) {
  if (!db || !opts.query) return [];
  const q = String(opts.query).toLowerCase().slice(0, 200);
  const limit = Math.min(20, opts.limit || 8);
  const userId = opts.userId || null;

  // Tokenise to 3+ char alphabetic terms for LIKE pattern matching.
  // Real production would use FTS5; this is "good enough" for the
  // first wire-up and matches the existing search-dtus substrate
  // shape.
  const terms = Array.from(new Set(
    q.split(/[^a-z0-9]+/i).filter(w => w.length >= 3).slice(0, 8)
  ));
  if (terms.length === 0) return [];

  // Build a CASE that scores rows by how many terms appear in title+content.
  // The same per-term clauses also gate the WHERE via OR-across-terms so we
  // never need a full table scan: at least one term must match for a row to
  // be considered, but no single term has to be "the first" one.
  const scoreCases = terms.map(() =>
    `(CASE WHEN LOWER(title) LIKE ? OR LOWER(COALESCE(content, '')) LIKE ? THEN 1 ELSE 0 END)`
  ).join(" + ");
  const matchClauses = terms.map(() =>
    `LOWER(title) LIKE ? OR LOWER(COALESCE(content, '')) LIKE ?`
  ).join(" OR ");
  const scoreArgs = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
  const matchArgs = terms.flatMap(t => [`%${t}%`, `%${t}%`]);

  let sql, args;
  if (userId && opts.includeUserPrivate !== false) {
    sql = `
      SELECT id, title,
             SUBSTR(COALESCE(content, ''), 1, 240) AS snippet,
             minted_by_provider, minted_by_model,
             creator_id, COALESCE(scope, 'personal') AS scope,
             ${scoreCases} AS score
      FROM dtus
      WHERE (
        (COALESCE(scope, 'personal') IN ('public', 'published', 'global'))
        OR creator_id = ?
      )
      AND (${matchClauses})
      ORDER BY score DESC, created_at DESC
      LIMIT ?
    `;
    args = [...scoreArgs, userId, ...matchArgs, limit];
  } else {
    sql = `
      SELECT id, title,
             SUBSTR(COALESCE(content, ''), 1, 240) AS snippet,
             minted_by_provider, minted_by_model,
             creator_id, COALESCE(scope, 'personal') AS scope,
             ${scoreCases} AS score
      FROM dtus
      WHERE COALESCE(scope, 'personal') IN ('public', 'published', 'global')
      AND (${matchClauses})
      ORDER BY score DESC, created_at DESC
      LIMIT ?
    `;
    args = [...scoreArgs, ...matchArgs, limit];
  }

  try {
    return db.prepare(sql).all(...args);
  } catch {
    // dtus table absent or schema differs — return empty list.
    return [];
  }
}

/**
 * Compose the messages array for an expert-mode chat call.
 * @param {string} query
 * @param {Array} sources    output of gatherSourcesForQuery()
 * @returns {Array<{role,content}>}
 */
export function composeExpertMessages(query, sources) {
  const sourceBlock = sources.length === 0
    ? "(no sources retrieved; answer briefly and say so explicitly)"
    : sources.map((s, i) =>
        `[${i + 1}] ${s.title || s.id}\n${s.snippet || ""}\n` +
        `    — by ${s.creator_id || "unknown"}` +
        (s.minted_by_provider && s.minted_by_provider !== "concord_default"
          ? ` (minted with ${s.minted_by_model || s.minted_by_provider})`
          : "")
      ).join("\n\n");

  return [
    { role: "system", content: EXPERT_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Question: ${query}\n\n--- Numbered sources ---\n\n${sourceBlock}`,
    },
  ];
}

/**
 * Full expert-mode dispatch. Brains it through the brainChat() router
 * (so the user's BYO key, if any, kicks in), records cascade citations
 * for every source actually referenced, and returns the answer + the
 * citation set + provenance for UI rendering.
 *
 * @param {object} args
 * @param {object} args.db
 * @param {string} args.userId
 * @param {string} args.query
 * @param {object} [args.opts]    forwarded to brainChat()
 * @returns {Promise<{ok, answer, sources, provider, model, citationsRecorded, error?}>}
 */
export async function expertAnswer({ db, userId, query, opts = {} }) {
  if (!query) return { ok: false, error: "missing_query" };
  const sources = gatherSourcesForQuery(db, { query, userId, limit: opts.maxSources || 8 });
  const messages = composeExpertMessages(query, sources);

  const r = await brainChat({
    db,
    userId,
    slot: opts.slot || "conscious",
    messages,
    opts: { temperature: 0.2, maxTokens: opts.maxTokens || 2048 },
  });

  if (!r.ok) {
    return { ok: false, error: r.error || "brain_failed", sources };
  }

  // Best-effort: record a citation for each source the answer references
  // (we detect [N] markers). The royalty cascade pays the source's
  // creator on the next purchase that ancestors them.
  const refs = extractCitationIndices(r.text);
  let citationsRecorded = 0;
  for (const idx of refs) {
    const s = sources[idx - 1];
    if (!s || !s.id || s.creator_id === userId) continue; // never self-cite
    try {
      // Lazy import — registerCitation lives in the royalty-cascade
      // module which has its own dependency chain.
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const result = await registerCitation(db, {
        parentDtuId: s.id,
        citingDtuId: null, // expert-mode answers aren't (yet) DTUs themselves
        citerId: userId,
        kind: "expert_mode_reference",
        parentDtu: { visibility: s.scope, creator_id: s.creator_id, id: s.id },
      });
      if (result?.ok) citationsRecorded++;
    } catch { /* royalty-cascade not wired in this test env */ }
  }

  return {
    ok: true,
    answer: r.text,
    sources: sources.map((s, i) => ({
      idx: i + 1,
      id: s.id,
      title: s.title,
      creatorId: s.creator_id,
      scope: s.scope,
      mintedByProvider: s.minted_by_provider,
      mintedByModel: s.minted_by_model,
    })),
    provider: r.provider,
    model: r.model,
    citationsRecorded,
    ...provenanceFrom(r),
  };
}

/** Extract [N] or [N, M] citation indices from a text. Dedupes. */
export function extractCitationIndices(text) {
  if (!text) return [];
  const seen = new Set();
  const re = /\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const n of m[1].split(",").map(s => parseInt(s.trim(), 10))) {
      if (Number.isFinite(n) && n > 0) seen.add(n);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

export const EXPERT_MODE_CONSTANTS = Object.freeze({
  EXPERT_SYSTEM_PROMPT,
});
