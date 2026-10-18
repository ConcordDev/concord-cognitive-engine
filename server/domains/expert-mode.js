// server/domains/expert-mode.js
//
// Sprint 10B+C — macro surface for expert mode.
//
// `expert_mode.answer` is the canonical entry point the chat lens
// calls when the user toggles "Expert Mode" on. It returns the answer
// + numbered sources + provenance so the lens can render citation
// chips with "(via Claude 4.5)" badges next to each source.
//
// Feature-parity build (Perplexity gap close): threaded follow-up
// conversation, live web search alongside the DTU corpus, Academic /
// Writing / Math / Video focus modes, Pages/Spaces collections,
// related-question suggestions, file/text upload as a query source,
// and markdown / shareable-link answer export.
//
// Persistence: per-user Maps on globalThis._concordSTATE.expertModeLens.
// That key is in LENS_STATE_KEYS, so the process snapshot
// (server.js#_serializeState / _hydrateState via
// lib/lens-state-persistence.js) round-trips threads, spaces, uploads,
// and share tokens across a restart. Maps are stored as
// { __type: "Map", entries } envelopes — a bare JSON.stringify(Map) is
// "{}". No new table and no migration. Upload text is capped at
// 200_000 characters per document (the ask path still feeds the brain
// only the first 12_000). Every value returned is real (user input, a
// real brain call, a real web fetch, or deterministic computation) —
// no seed/mock/demo data.

import crypto from "node:crypto";
import { expertAnswer, gatherSourcesForQuery, extractCitationIndices, EXPERT_SOURCE_TEXT_CAP } from "../lib/expert-mode.js";

// ---- store ---------------------------------------------------------------

// Per-document cap. The snapshot stores this text, so the cap is also
// the durability bound — a larger paste is rejected, not truncated.
const UPLOAD_TEXT_CAP = 200_000;

function store() {
  const STATE = (globalThis._concordSTATE = globalThis._concordSTATE || {});
  // Registered as expertModeLens (not a private _expertMode bag) so the
  // snapshot walker persists it. Hydration replaces this object with
  // rehydrated Maps; only a missing or non-object value is created fresh.
  if (!STATE.expertModeLens || typeof STATE.expertModeLens !== "object" || Array.isArray(STATE.expertModeLens)) {
    STATE.expertModeLens = {
      threads: new Map(),   // threadId -> { id, userId, title, focus, turns[], createdAt, updatedAt }
      spaces: new Map(),    // spaceId  -> { id, userId, name, description, answers[], shareToken, createdAt }
      uploads: new Map(),   // uploadId -> { id, userId, name, kind, text, chars, createdAt }
      shares: new Map(),    // shareToken -> { kind:'space'|'answer', refId, userId }
    };
  }
  const s = STATE.expertModeLens;
  if (!(s.threads instanceof Map)) s.threads = new Map();
  if (!(s.spaces instanceof Map)) s.spaces = new Map();
  if (!(s.uploads instanceof Map)) s.uploads = new Map();
  if (!(s.shares instanceof Map)) s.shares = new Map();
  return s;
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function now() { return Math.floor(Date.now() / 1000); }

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || null;
}

// ---- focus modes ---------------------------------------------------------
//
// A focus mode scopes which sources expert mode draws from and how the
// synthesis is framed. These are real behavioural switches, not labels:
// each mode changes whether web search runs, the query terms appended,
// and a directive prepended to the question.

const FOCUS_MODES = Object.freeze({
  all: {
    id: "all", label: "All", web: true,
    queryAugment: "",
    directive: "",
  },
  academic: {
    id: "academic", label: "Academic", web: true,
    queryAugment: " research study peer-reviewed",
    directive: "Answer with academic rigour. Prefer primary research and definitional sources. Hedge claims that are contested.",
  },
  writing: {
    id: "writing", label: "Writing", web: false,
    queryAugment: "",
    directive: "Answer as a writing aid. Prioritise clarity, structure, and tone over exhaustive citation. Draw only on the supplied corpus.",
  },
  math: {
    id: "math", label: "Math", web: false,
    queryAugment: " formula proof theorem",
    directive: "Answer with mathematical precision. Show the reasoning step by step. State assumptions explicitly. Do not approximate without saying so.",
  },
  video: {
    id: "video", label: "Video", web: true,
    queryAugment: " video lecture tutorial talk",
    directive: "Answer by pointing to instructional and lecture-style sources where they exist. Summarise what each covers.",
  },
});

function resolveFocus(focus) {
  return FOCUS_MODES[String(focus || "all").toLowerCase()] || FOCUS_MODES.all;
}

// ---- live web grounding (shared by ask + sources_preview) ---------------
//
// Root cause of F1 (example.com walk): ask ran Wikipedia search on the
// shaped question and attached unrelated hits, while sources_preview only
// read the DTU corpus — so preview said [] and ask claimed "2 live web"
// that were never the requested page. One path now:
//   1. URLs in the question → fetchPublicPage those pages only.
//   2. If a URL was named but no usable extract → zero web sources (no filler).
//   3. No URL → webSearchForChat, with entity-decoded snippets.

const HONEST_URL_FETCH_FAILED =
  "Could not fetch a usable extract from the URL in the question. No web sources are cited.";

function shapeWebRow(r, query, decodeHtmlEntities) {
  const decode = typeof decodeHtmlEntities === "function" ? decodeHtmlEntities : (s) => String(s || "");
  const title = decode(r.title || query).slice(0, 200);
  const snippet = decode(r.snippet || r.content || "").slice(0, 240);
  const content = decode(r.content || r.snippet || "").slice(0, EXPERT_SOURCE_TEXT_CAP);
  const url = r.url || "";
  return {
    id: `web_${crypto.createHash("sha1").update(url || title || query).digest("hex").slice(0, 12)}`,
    title,
    snippet,
    content,
    url,
    creator_id: null,
    scope: "web",
    origin: "web",
    source_name: r.source || "web",
    ...(r.outlet ? { outlet: String(r.outlet).slice(0, 120) } : {}),
    ...(r.publishedAt ? { published_at: r.publishedAt } : {}),
    ...(r.provider ? { provider: r.provider } : {}),
    minted_by_provider: null,
    minted_by_model: null,
  };
}

/**
 * Shared web grounding for ask + sources_preview.
 * @returns {Promise<{ sources: object[], urlAttempted: boolean, urlFetched: number }>}
 */
async function gatherWebGrounding(query, limit) {
  const empty = { sources: [], urlAttempted: false, urlFetched: 0 };
  try {
    const mod = await import("../emergent/conscious-web-search.js");
    const cap = Math.max(1, Number(limit) || 5);
    const urls = (mod.extractUrls(query) || []).slice(0, cap);

    if (urls.length > 0) {
      const sources = [];
      for (const url of urls) {
        const page = await mod.fetchPublicPage(url);
        if (!page?.text || String(page.text).trim().length < 12) continue;
        let host = "web";
        try { host = new URL(page.url || url).hostname; } catch { /* keep web */ }
        sources.push(shapeWebRow({
          title: page.title || host,
          url: page.url || url,
          snippet: page.text.slice(0, 240),
          content: page.text.slice(0, EXPERT_SOURCE_TEXT_CAP),
          source: host,
        }, query, mod.decodeHtmlEntities));
      }
      return { sources, urlAttempted: true, urlFetched: sources.length };
    }

    const results = await mod.webSearchForChat([query]);
    const sources = (results || []).slice(0, cap).map((r) =>
      shapeWebRow(r, query, mod.decodeHtmlEntities),
    );
    return { sources, urlAttempted: false, urlFetched: 0 };
  } catch {
    return empty;
  }
}

/** @deprecated use gatherWebGrounding — kept for web_search standalone macro */
async function liveWebSources(query, limit) {
  const g = await gatherWebGrounding(query, limit);
  return g.sources;
}

/**
 * Compose the same source list ask will hand the brain (DTU + web).
 * Preview and ask must agree.
 */
async function gatherExpertSources({ db, userId, query, wantWeb, maxSources }) {
  const cap = Math.min(20, Math.max(2, Number(maxSources) || 8));
  const webCap = Math.min(5, cap);
  const grounded = wantWeb
    ? await gatherWebGrounding(query, webCap)
    : { sources: [], urlAttempted: false, urlFetched: 0 };
  const web = grounded.sources;
  const dtuRoom = Math.max(0, cap - web.length);
  const dtu = dtuRoom > 0
    ? gatherSourcesForQuery(db, { query, userId, limit: dtuRoom })
    : [];
  return {
    sources: [...dtu, ...web],
    web,
    dtu,
    urlAttempted: grounded.urlAttempted,
    urlFetched: grounded.urlFetched,
    cap,
  };
}

function relatedQuestions(query, answer) {
  // Deterministic, grounded follow-ups derived from the actual answer
  // text — no LLM, no invention. We surface noun-phrase pivots that
  // appear in the answer so each suggestion is anchored to real content.
  const base = String(query || "").trim().replace(/[?.!]+$/, "");
  const text = `${query} ${answer || ""}`;
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "how", "why",
    "are", "was", "were", "has", "have", "into", "their", "they", "you", "your", "its", "but",
    "not", "can", "will", "would", "should", "does", "did", "about", "which", "when", "where"]);
  const freq = new Map();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 4 || stop.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const topTerms = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
  const templates = [
    (t) => `How does ${t} compare to the alternatives?`,
    (t) => `What are the practical limits of ${t}?`,
    (t) => `Why does ${t} matter for ${base.slice(0, 40)}?`,
  ];
  const out = topTerms.map((t, i) => templates[i % templates.length](t));
  if (base) out.unshift(`What's the strongest counter-argument to: ${base}?`);
  return Array.from(new Set(out)).slice(0, 4);
}

function answerToMarkdown(turn, threadTitle) {
  const lines = [];
  if (threadTitle) lines.push(`# ${threadTitle}`, "");
  lines.push(`## ${turn.query}`, "");
  lines.push(turn.answer || "", "");
  if (Array.isArray(turn.sources) && turn.sources.length) {
    lines.push("### Sources", "");
    for (const s of turn.sources) {
      const prov = s.mintedByProvider && s.mintedByProvider !== "concord_default"
        ? ` (via ${s.mintedByModel || s.mintedByProvider})` : "";
      const where = s.url ? ` — ${s.url}` : (s.creatorId ? ` — by ${s.creatorId}` : "");
      lines.push(`${s.idx}. ${s.title}${prov}${where}`);
    }
    lines.push("");
  }
  if (turn.provider) lines.push(`_Synthesized by ${turn.model || turn.provider}._`);
  return lines.join("\n");
}

// Compose the conversational context for a follow-up turn. Perplexity
// keeps prior Q+A in scope; we prepend a compact transcript so the
// brain answers the follow-up coherently.
function threadContextQuery(thread, query) {
  if (!thread || !thread.turns.length) return query;
  const recent = thread.turns.slice(-3).map((t, i) =>
    `Earlier Q${i + 1}: ${t.query}\nEarlier A${i + 1}: ${(t.answer || "").slice(0, 600)}`
  ).join("\n\n");
  return `Conversation so far:\n${recent}\n\n--- New follow-up question ---\n${query}`;
}

// -------------------------------------------------------------------------

export default function registerExpertModeMacros(register) {
  // ----- core cited answer (unchanged behaviour) --------------------------
  register("expert_mode", "answer", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = actorId(ctx);
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
    const userId = actorId(ctx);
    const { query, maxSources, useWeb, focus } = input || {};
    if (!db || !query) return { ok: false, reason: "missing_inputs" };
    const mode = resolveFocus(focus);
    const wantWeb = useWeb != null ? !!useWeb : mode.web;
    const packed = await gatherExpertSources({
      db, userId, query: String(query).trim(), wantWeb, maxSources,
    });
    // Same rows ask will pass as extras + DTUs (shape the UI chip expects).
    const sources = packed.sources.map((s) => ({
      id: s.id,
      title: s.title,
      snippet: s.snippet || "",
      url: s.url || "",
      scope: s.scope,
      origin: s.origin || (s.scope === "web" ? "web" : s.scope),
      creator_id: s.creator_id ?? null,
      minted_by_provider: s.minted_by_provider ?? null,
      minted_by_model: s.minted_by_model ?? null,
      source_name: s.source_name || null,
    }));
    return {
      ok: true,
      query: String(query).trim(),
      sources,
      webCount: packed.web.length,
      urlAttempted: packed.urlAttempted,
      urlFetched: packed.urlFetched,
    };
  }, { note: "Preview the sources that would be cited for a query, WITHOUT running the brain. Shares gatherExpertSources with ask so the chip count matches." });

  register("expert_mode", "extract_citations", async (_ctx, input = {}) => {
    const text = input?.text ?? input?.answer ?? "";
    return { ok: true, indices: extractCitationIndices(text || "") };
  }, { note: "Parse a text for [N] citation markers. Stateless utility for the citation-chip renderer." });

  register("expert_mode", "focus_modes", async () => {
    return {
      ok: true,
      modes: Object.values(FOCUS_MODES).map((m) => ({
        id: m.id, label: m.label, web: m.web,
      })),
    };
  }, { note: "List the available focus modes (Academic / Writing / Math / Video / All) so the UI can render the selector." });

  // ----- threaded conversation -------------------------------------------
  register("expert_mode", "ask", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = actorId(ctx);
    const { query, threadId, focus, useWeb, maxSources } = input || {};
    if (!db) return { ok: false, reason: "no_db" };
    if (!query || !String(query).trim()) return { ok: false, reason: "missing_query" };
    if (!userId) return { ok: false, reason: "no_actor" };

    const st = store();
    let thread = threadId ? st.threads.get(threadId) : null;
    if (threadId && (!thread || thread.userId !== userId)) {
      return { ok: false, reason: "thread_not_found" };
    }
    const mode = resolveFocus(focus || thread?.focus);

    // Live web search runs when the focus mode allows it AND the caller
    // opts in (default on for web-capable modes).
    const wantWeb = useWeb != null ? !!useWeb : mode.web;

    // Threaded context: prior Q+A folds into the query the brain sees.
    const contextQuery = threadContextQuery(thread, String(query).trim());
    const augmented = `${contextQuery}${mode.directive ? `\n\n[Focus directive] ${mode.directive}` : ""}`;

    // Shared path with sources_preview. URL questions fetch that page;
    // never pad with unrelated Wikipedia when the URL fetch fails.
    const searchQuery = `${String(query).trim()}${mode.queryAugment || ""}`;
    const packed = wantWeb
      ? await gatherExpertSources({
        db, userId, query: searchQuery, wantWeb: true, maxSources,
      })
      : {
        web: [], dtu: null, sources: null, urlAttempted: false, urlFetched: 0,
        cap: Math.min(20, Math.max(2, Number(maxSources) || 8)),
      };
    const web = packed.web;
    const cap = packed.cap;

    let answerRes;
    try {
      if (wantWeb && packed.urlAttempted && packed.urlFetched === 0) {
        answerRes = {
          ok: true,
          answer: HONEST_URL_FETCH_FAILED,
          sources: [],
          provider: null,
          model: null,
          citationsRecorded: 0,
        };
      } else {
        answerRes = await expertAnswer({
          db, userId, query: augmented,
          opts: { maxSources: cap, extraSources: web, refuseWhenNoSources: wantWeb },
        });
      }
    } catch (e) {
      return { ok: false, reason: "brain_failed", error: String(e?.message || e) };
    }
    if (!answerRes || answerRes.ok === false) {
      return { ok: false, reason: "brain_failed", error: answerRes?.error || "unknown" };
    }

    const sources = Array.isArray(answerRes.sources) ? answerRes.sources : [];
    const webCount = sources.filter((s) => s.origin === "web" || s.scope === "web").length;

    const turn = {
      id: uid("turn"),
      query: String(query).trim(),
      answer: answerRes.answer || "",
      sources,
      provider: answerRes.provider || null,
      model: answerRes.model || null,
      citationsRecorded: answerRes.citationsRecorded || 0,
      focus: mode.id,
      webCount,
      askedAt: now(),
    };

    if (!thread) {
      thread = {
        id: uid("thr"),
        userId,
        title: turn.query.slice(0, 80),
        focus: mode.id,
        turns: [],
        createdAt: now(),
        updatedAt: now(),
      };
      st.threads.set(thread.id, thread);
    }
    thread.turns.push(turn);
    thread.focus = mode.id;
    thread.updatedAt = now();

    return {
      ok: true,
      threadId: thread.id,
      turn,
      relatedQuestions: relatedQuestions(turn.query, turn.answer),
      focus: mode.id,
      turnCount: thread.turns.length,
    };
  }, { note: "Threaded cited answer. Folds prior turns into context, honours the focus mode, optionally runs live web search, returns related-question suggestions." });

  register("expert_mode", "thread_list", async (ctx) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const threads = Array.from(st.threads.values())
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((t) => ({
        id: t.id, title: t.title, focus: t.focus,
        turnCount: t.turns.length,
        lastQuery: t.turns.length ? t.turns[t.turns.length - 1].query : null,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
      }));
    return { ok: true, threads, total: threads.length };
  }, { note: "List the caller's saved expert-mode conversation threads, newest first." });

  register("expert_mode", "thread_get", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const thread = st.threads.get(input?.threadId);
    if (!thread || thread.userId !== userId) return { ok: false, reason: "thread_not_found" };
    return { ok: true, thread };
  }, { note: "Fetch one full conversation thread with all turns, sources, and provenance." });

  register("expert_mode", "thread_delete", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const thread = st.threads.get(input?.threadId);
    if (!thread || thread.userId !== userId) return { ok: false, reason: "thread_not_found" };
    st.threads.delete(thread.id);
    return { ok: true, deleted: thread.id };
  }, { note: "Delete one of the caller's conversation threads." });

  register("expert_mode", "related_questions", async (_ctx, input = {}) => {
    const { query, answer } = input || {};
    if (!query) return { ok: false, reason: "missing_query" };
    return { ok: true, questions: relatedQuestions(query, answer || "") };
  }, { note: "Derive grounded follow-up questions from an answer's actual content. Deterministic — no invention." });

  // ----- live web search standalone --------------------------------------
  register("expert_mode", "web_search", async (_ctx, input = {}) => {
    const { query, limit } = input || {};
    if (!query || !String(query).trim()) return { ok: false, reason: "missing_query" };
    const results = await liveWebSources(String(query).trim(), Math.min(8, Math.max(1, Number(limit) || 5)));
    return { ok: true, query: String(query).trim(), results, total: results.length };
  }, { note: "Live web search (DuckDuckGo / Wikipedia / Brave if keyed) — surfaces web sources alongside the DTU corpus." });

  // ----- Pages / Spaces --------------------------------------------------
  register("expert_mode", "space_create", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const name = String(input?.name || "").trim();
    if (!name) return { ok: false, reason: "missing_name" };
    const st = store();
    const space = {
      id: uid("spc"),
      userId,
      name: name.slice(0, 120),
      description: String(input?.description || "").slice(0, 400),
      answers: [],
      shareToken: null,
      createdAt: now(),
      updatedAt: now(),
    };
    st.spaces.set(space.id, space);
    return { ok: true, space };
  }, { note: "Create a Page/Space — a shareable collection of saved expert-mode answers." });

  register("expert_mode", "space_list", async (ctx) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const spaces = Array.from(st.spaces.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id, name: s.name, description: s.description,
        answerCount: s.answers.length, shareToken: s.shareToken,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
      }));
    return { ok: true, spaces, total: spaces.length };
  }, { note: "List the caller's Pages/Spaces." });

  register("expert_mode", "space_get", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    const st = store();
    const space = st.spaces.get(input?.spaceId);
    if (!space) return { ok: false, reason: "space_not_found" };
    // Owner always; non-owner only via share token.
    const owner = space.userId === userId;
    if (!owner && (!input?.shareToken || input.shareToken !== space.shareToken)) {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true, space, owner };
  }, { note: "Fetch a Space with all saved answers — by owner, or by anyone holding the share token." });

  register("expert_mode", "space_add_answer", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const space = st.spaces.get(input?.spaceId);
    if (!space || space.userId !== userId) return { ok: false, reason: "space_not_found" };
    const { query, answer, sources, provider, model } = input || {};
    if (!query || !answer) return { ok: false, reason: "missing_answer" };
    const entry = {
      id: uid("ans"),
      query: String(query).slice(0, 400),
      answer: String(answer),
      sources: Array.isArray(sources) ? sources : [],
      provider: provider || null,
      model: model || null,
      addedAt: now(),
    };
    space.answers.push(entry);
    space.updatedAt = now();
    return { ok: true, spaceId: space.id, entry, answerCount: space.answers.length };
  }, { note: "Save a cited answer into a Space collection." });

  register("expert_mode", "space_remove_answer", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const space = st.spaces.get(input?.spaceId);
    if (!space || space.userId !== userId) return { ok: false, reason: "space_not_found" };
    const before = space.answers.length;
    space.answers = space.answers.filter((a) => a.id !== input?.answerId);
    if (space.answers.length === before) return { ok: false, reason: "answer_not_found" };
    space.updatedAt = now();
    return { ok: true, spaceId: space.id, answerCount: space.answers.length };
  }, { note: "Remove a saved answer from a Space." });

  register("expert_mode", "space_share", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const space = st.spaces.get(input?.spaceId);
    if (!space || space.userId !== userId) return { ok: false, reason: "space_not_found" };
    if (input?.revoke) {
      if (space.shareToken) st.shares.delete(space.shareToken);
      space.shareToken = null;
      space.updatedAt = now();
      return { ok: true, spaceId: space.id, shareToken: null, revoked: true };
    }
    if (!space.shareToken) {
      space.shareToken = crypto.randomBytes(12).toString("hex");
      st.shares.set(space.shareToken, { kind: "space", refId: space.id, userId });
      space.updatedAt = now();
    }
    return {
      ok: true,
      spaceId: space.id,
      shareToken: space.shareToken,
      shareUrl: `/lenses/expert-mode?space=${space.id}&token=${space.shareToken}`,
    };
  }, { note: "Mint (or revoke) a share token + link for a Space so others can read it." });

  register("expert_mode", "space_delete", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const space = st.spaces.get(input?.spaceId);
    if (!space || space.userId !== userId) return { ok: false, reason: "space_not_found" };
    if (space.shareToken) st.shares.delete(space.shareToken);
    st.spaces.delete(space.id);
    return { ok: true, deleted: space.id };
  }, { note: "Delete a Space and revoke its share token." });

  // ----- file / text upload as a query source ----------------------------
  //
  // F2 root cause (walk): three POSTs 503'd with event_loop_lag_critical
  // (lagMs ~3193) BEFORE this handler ran — admission shed under process-
  // wide lag (snapshot stringify / other traffic), not embedding/hashing
  // inside upload. This path must stay cooperative: yield before parking a
  // large paste, never sync-embed/hash, and schedule persistence on the
  // chunked saveStateDebounced path so the request itself does not take a
  // multi-hundred-ms stringify.
  register("expert_mode", "upload_source", async (ctx, input = {}) => {
  try {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const name = String(input?.name || "Untitled").slice(0, 200);
    const text = String(input?.text || "");
    if (!text.trim()) return { ok: false, reason: "missing_text" };
    if (text.length > UPLOAD_TEXT_CAP) return { ok: false, reason: "too_large" };

    // Yield so a large paste does not monopolize the loop next to admission
    // recovery (same setImmediate pattern as npc-simulator / chunked-json).
    if (text.length > 4_096) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }

    const st = store();
    const upload = {
      id: uid("upl"),
      userId,
      name,
      kind: String(input?.kind || "text"),
      text,
      chars: text.length,
      createdAt: now(),
    };
    st.uploads.set(upload.id, upload);

    // Schedule chunked snapshot — never JSON.stringify the whole STATE here.
    try {
      const save = globalThis._concordSaveStateDebounced;
      if (typeof save === "function") save();
    } catch { /* persistence best-effort; in-memory row is already set */ }

    return {
      ok: true,
      upload: { id: upload.id, name: upload.name, kind: upload.kind, chars: upload.chars, createdAt: upload.createdAt },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
}, { note: "Upload pasted file/PDF text as a query source. The text is stored per-user and can be cited as source [U]." });

  register("expert_mode", "upload_list", async (ctx) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const uploads = Array.from(st.uploads.values())
      .filter((u) => u.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((u) => ({ id: u.id, name: u.name, kind: u.kind, chars: u.chars, createdAt: u.createdAt }));
    return { ok: true, uploads, total: uploads.length };
  }, { note: "List the caller's uploaded query-source documents." });

  register("expert_mode", "upload_delete", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const upload = st.uploads.get(input?.uploadId);
    if (!upload || upload.userId !== userId) return { ok: false, reason: "upload_not_found" };
    st.uploads.delete(upload.id);
    return { ok: true, deleted: upload.id };
  }, { note: "Delete an uploaded query-source document." });

  register("expert_mode", "ask_with_upload", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const { query, uploadId, focus } = input || {};
    if (!query || !String(query).trim()) return { ok: false, reason: "missing_query" };
    const st = store();
    const upload = st.uploads.get(uploadId);
    if (!upload || upload.userId !== userId) return { ok: false, reason: "upload_not_found" };
    const mode = resolveFocus(focus);

    // The uploaded document is supplied to the brain as the prime source.
    let answerRes;
    try {
      const grounded =
        `${mode.directive ? `[Focus directive] ${mode.directive}\n\n` : ""}` +
        `Use the following uploaded document as the primary source for your answer. ` +
        `Cite it as [U] when you draw on it.\n\n` +
        `--- Document: ${upload.name} ---\n${upload.text.slice(0, 12_000)}\n--- End document ---\n\n` +
        `Question: ${String(query).trim()}`;
      answerRes = await expertAnswer({
        db: ctx?.db, userId, query: grounded, opts: { maxSources: 6 },
      });
    } catch (e) {
      return { ok: false, reason: "brain_failed", error: String(e?.message || e) };
    }
    if (!answerRes || answerRes.ok === false) {
      return { ok: false, reason: "brain_failed", error: answerRes?.error || "unknown" };
    }
    const sources = [
      {
        idx: 0, id: upload.id, title: `📎 ${upload.name}`,
        creatorId: userId, scope: "upload", origin: "upload",
        mintedByProvider: null, mintedByModel: null,
      },
      ...(Array.isArray(answerRes.sources) ? answerRes.sources : []),
    ];
    return {
      ok: true,
      answer: answerRes.answer || "",
      sources,
      provider: answerRes.provider || null,
      model: answerRes.model || null,
      uploadName: upload.name,
      relatedQuestions: relatedQuestions(String(query).trim(), answerRes.answer || ""),
    };
  }, { note: "Answer a question grounded primarily in an uploaded document, with the upload as source [U]." });

  // ----- answer export ---------------------------------------------------
  register("expert_mode", "export_markdown", async (_ctx, input = {}) => {
    const { query, answer, sources, provider, model, title } = input || {};
    if (!query || !answer) return { ok: false, reason: "missing_answer" };
    const md = answerToMarkdown(
      { query, answer, sources: Array.isArray(sources) ? sources : [], provider, model },
      title || null,
    );
    return { ok: true, markdown: md, bytes: Buffer.byteLength(md, "utf8") };
  }, { note: "Render a cited answer (or whole thread title) as portable Markdown for copy/download." });

  register("expert_mode", "export_thread_markdown", async (ctx, input = {}) => {
  try {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const st = store();
    const thread = st.threads.get(input?.threadId);
    if (!thread || thread.userId !== userId) return { ok: false, reason: "thread_not_found" };
    const md = thread.turns
      .map((t, i) => answerToMarkdown(t, i === 0 ? thread.title : null))
      .join("\n\n---\n\n");
    return { ok: true, markdown: md, bytes: Buffer.byteLength(md, "utf8"), turnCount: thread.turns.length };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
}, { note: "Export an entire conversation thread as one Markdown document." });

  register("expert_mode", "share_answer", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_actor" };
    const { query, answer } = input || {};
    if (!query || !answer) return { ok: false, reason: "missing_answer" };
    const st = store();
    const token = crypto.randomBytes(12).toString("hex");
    const payload = {
      query: String(query), answer: String(answer),
      sources: Array.isArray(input?.sources) ? input.sources : [],
      provider: input?.provider || null, model: input?.model || null,
      createdAt: now(),
    };
    st.shares.set(token, { kind: "answer", refId: token, userId, payload });
    return { ok: true, shareToken: token, shareUrl: `/lenses/expert-mode?answer=${token}` };
  }, { note: "Mint a shareable link for a single cited answer." });

  register("expert_mode", "share_resolve", async (_ctx, input = {}) => {
    const token = input?.shareToken;
    if (!token) return { ok: false, reason: "missing_token" };
    const st = store();
    const share = st.shares.get(token);
    if (!share) return { ok: false, reason: "not_found" };
    if (share.kind === "answer") {
      return { ok: true, kind: "answer", answer: share.payload };
    }
    if (share.kind === "space") {
      const space = st.spaces.get(share.refId);
      if (!space) return { ok: false, reason: "not_found" };
      return { ok: true, kind: "space", space };
    }
    return { ok: false, reason: "not_found" };
  }, { note: "Resolve a share token to its shared answer or Space (read-only, no auth required)." });
}
