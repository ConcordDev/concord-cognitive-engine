// @env-config-ok: external search-target URLs
/**
 * Conscious Web Search — Chat-Level Tool Use
 *
 * When DTU context and model knowledge aren't sufficient, the conscious
 * brain searches the web mid-conversation, reads results, incorporates
 * them into the response, and cites sources.
 *
 * The user never needs to ask for it — the system detects when it needs
 * external knowledge and goes to get it.
 *
 * The knowledge loop closes:
 *   User asks → DTU context searched → if insufficient → web search →
 *   response uses both substrate + web → exchange saved as DTU →
 *   web source saved as DTU → both get embedded →
 *   next similar question → answered from substrate → no web needed
 *
 * Same legal guardrails as entity exploration.
 * Additive only. No existing logic changes.
 */

import { checkRobotsTxt, WEB_POLICY } from "./entity-web-exploration.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";
import logger from '../logger.js';

// ── Chat User Agent ─────────────────────────────────────────────────────────

const CHAT_USER_AGENT = "ConcordChat/1.0 (+https://concord-os.org/bot-policy)";

// ── Trigger Patterns — Explicit Web Requests ────────────────────────────────

const WEB_TRIGGER_PATTERNS = [
  /search (for|the web|online|internet)/i,
  /look up/i,
  /find (me |)(a |)source/i,
  /what('s| is) the latest/i,
  /current (news|status|price|situation)/i,
  /cite (your |)source/i,
  /back (that|it) up/i,
  /where did you (get|find|hear) that/i,
  /is that (true|accurate|correct|real)/i,
  /fact.?check/i,
  /can you verify/i,
  /what happened (today|yesterday|recently|this week)/i,
  /who (won|died|resigned|was elected)/i,
  /how much (does|is|are)/i,
  /what('s| is) the (score|weather|time|price)/i,
];

/**
 * Check if the user message explicitly triggers a web search.
 */
export function requiresWebSearch(message) {
  for (const pattern of WEB_TRIGGER_PATTERNS) {
    if (pattern.test(message)) return true;
  }
  return false;
}

// ── URL Safety ──────────────────────────────────────────────────────────────

function isBlockedUrl(url) {
  const lower = url.toLowerCase();
  for (const pattern of WEB_POLICY.blockedPatterns) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

// ── Delay Helper ────────────────────────────────────────────────────────────

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// ── Web Search Execution ────────────────────────────────────────────────────

/**
 * Search the web for chat context.
 * Uses a generic web search approach (fetch search API or Wikipedia as fallback).
 *
 * @param {string[]} queries - Search queries (max 3)
 * @returns {Promise<Array>} Web results with content
 */
// ── Query shaping + relevance ───────────────────────────────────────────────
//
// Root cause (measured 2026-10-11 against the live APIs):
//
//   * api.duckduckgo.com is an instant-answer lookup, not a web search.
//     Abstract/Answer stay empty for natural questions ("What is the capital
//     of France?") and even for "capital of France". They fill for entity
//     names ("France", "Eiffel Tower").
//   * Wikipedia list=search is CirrusSearch. Every token is ANDed, so a
//     unique prefix ("EM18610 …") returns totalhits 0. `?` is a one-character
//     wildcard. Question words and "Answer in one sentence" promote the
//     articles "Question" and "Capital punishment" (the word "sentence" hits
//     death-penalty copy). "capital of France" itself still ranks "Capital
//     punishment in France" above Paris; the old code kept only the first
//     two hits, so the relevant page never got fetched.
//
// Shaping runs inside webSearchForChat so expert mode AND the chat callers
// (utility-brain queries, the raw-message fallback, and the socket path)
// share one behavior. Already-short keyword queries are left alone.
// A hit that does not survive the relevance check is dropped. Nothing is
// invented in its place.

const SEARCH_STOP = new Set(
  `a an the of in on for and or to from with by at as into over
   is are was were be been being
   what who where when why how which
   do does did can could would should
   this that these those it its their his her
   please tell me you your
   about than then also not`.split(/\s+/).filter(Boolean),
);

const LEADING_FRAME = /^(?:(?:please|can you|could you|would you|tell me|do you know)\s+)*(?:what(?:'s| is| are| was| were)|who(?:'s| is| are| was| were)|where(?:'s| is| are| was| were)|when(?:'s| is| are| was| were)|why(?:'s| is| are| was| were| did| does)|how(?:'s| is| are| many| much| long| do| does| did)|which(?: is| are| was| were)?|is|are|was|were|did|does|do)\s+/i;
const LEADING_ARTICLE = /^(?:the|a|an)\s+/i;
const LEADING_ID = /^(?:[A-Za-z]{1,8}\d{3,}(?:\s+|$))+/;

function tokenize(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#a-z0-9]+;/gi, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function stemToken(w) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function contentWords(text) {
  const out = [];
  for (const raw of tokenize(text)) {
    const w = stemToken(raw);
    if (!w || SEARCH_STOP.has(w) || w.length < 2) continue;
    if (w.length < 3 && !/^[a-z]{2}$/.test(w)) continue;
    out.push(w);
  }
  return out;
}

function queryTerms(query) {
  const seen = new Set();
  const terms = [];
  for (const w of contentWords(query)) {
    if (seen.has(w)) continue;
    seen.add(w);
    terms.push(w);
  }
  return terms;
}

function stripInstructionTail(s) {
  s = s.replace(/([?!])(?=\S)/g, "$1 ");
  const parts = s.split(/(?<=[.?!])\s+/);
  if (parts.length > 1) {
    const kept = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i > 0 && /^(?:please\s+)?(?:answer|respond|reply|explain|summarize|summarise|keep|be)\b/i.test(part)) break;
      if (i > 0 && /^in\s+(?:one|a|1)\s+sentence\b/i.test(part)) break;
      kept.push(part);
    }
    s = kept.join(" ").trim();
  }
  s = s.replace(/\s+(?:please\s+)?(?:answer|respond|reply)\s+in\s+(?:one|a|1)\s+sentence\b[\s\S]*$/i, "");
  s = s.replace(/\s+(?:in\s+(?:one|a|1)\s+sentence|briefly|in\s+\d+\s+words|keep it (?:short|brief)|be (?:brief|concise))\s*[.?!]*\s*$/i, "");
  return s.trim();
}

/**
 * Turn a user question into a search string.
 * Keyword queries ("Eiffel Tower", "France capital city") pass through.
 * Returns "" when nothing searchable remains — callers must return no sources.
 */
export function shapeSearchQuery(raw) {
  let s = String(raw || "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = stripInstructionTail(s);
  s = s.replace(LEADING_ID, "").trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEADING_FRAME, "").replace(LEADING_ARTICLE, "").trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(/[?*~!]+/g, " ").replace(/[.]+$/g, "").replace(/\s+/g, " ").trim();
  if (!/[a-z0-9]/i.test(s)) return "";
  return s;
}

function hasCompoundClash(terms, title) {
  const titleWords = contentWords(title);
  if (titleWords.length < 2 || terms.length === 0) return false;
  const q = new Set(terms);
  // "Capital punishment…" is a different concept that merely shares the
  // first query word. "Boiling point" is not: the next word is also a query term.
  return q.has(titleWords[0]) && !q.has(titleWords[1]);
}

function hasOrderedTightMatch(terms, text) {
  if (terms.length < 2) return false;
  const words = contentWords(text);
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== terms[0]) continue;
    let qi = 1;
    for (let j = i + 1; j < words.length && qi < terms.length; j++) {
      if (words[j] === terms[qi]) qi++;
      else break;
    }
    if (qi === terms.length) return true;
  }
  return false;
}

/**
 * True when a hit is about the shaped query.
 * Drops "Capital punishment" for a capital-of-France question.
 * Keeps a keyword hit whose title is the thing that was asked about.
 */
export function isWebSourceRelevant(query, title, snippet) {
  const shaped = shapeSearchQuery(query);
  const terms = queryTerms(shaped);
  if (!terms.length) return false;
  const blob = new Set(contentWords(`${title || ""} ${snippet || ""}`));
  const matched = terms.filter((t) => blob.has(t));
  if (matched.length === 0) return false;
  if (hasCompoundClash(terms, title) && !hasOrderedTightMatch(terms, `${title || ""} ${snippet || ""}`)) {
    return false;
  }
  // "X of Y" must mention both sides. Otherwise "capital" alone cites
  // Capital punishment, and a unique head noun never has to appear.
  if (terms.length >= 2 && /\bof\b/i.test(shaped) && matched.length !== terms.length) return false;
  if (terms.length >= 2 && !blob.has(terms[terms.length - 1])) return false;
  return true;
}

function keepRelevant(query, rows) {
  return (rows || []).filter((r) => isWebSourceRelevant(query, r.title, r.snippet || r.content || ""));
}

// Courtesy pause between Wikipedia article fetches. Skipped under the test
// runner so a mocked search does not sit on a 2s timer; production still waits.
const WIKI_COURTESY_DELAY_MS = String(process.env.NODE_ENV).toLowerCase() === "test" ? 0 : 2000;

// ── DuckDuckGo Instant Answer (free, no key) ────────────────────────────────
// Not a web search. Returns a summary only when the query names an entity
// the instant-answer index already has. Natural-language questions come back empty.

async function duckduckgoInstant(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": CHAT_USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const text = d.AbstractText || d.Answer || "";
    if (!text) return null;
    return {
      title: d.Heading || query,
      url: d.AbstractURL || d.Redirect || "",
      snippet: text.slice(0, 300),
      content: text.slice(0, 2000),
      source: d.AbstractSource || "DuckDuckGo",
      query,
      fetchedAt: new Date().toISOString(),
    };
  } catch (_e) {
    return null;
  }
}

// ── Brave Search (optional, requires BRAVE_API_KEY env) ─────────────────────

async function braveSearch(query) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).slice(0, 5).map(r => ({
      title: r.title || "",
      url: r.url || "",
      snippet: (r.description || "").slice(0, 300),
      content: (r.description || "").slice(0, 2000),
      source: r.url ? new URL(r.url).hostname : "brave",
      query,
      fetchedAt: new Date().toISOString(),
    }));
  } catch (_e) {
    return [];
  }
}

export async function webSearchForChat(queries) {
  const allResults = [];

  for (const raw of (queries || []).slice(0, 3)) {
    const query = shapeSearchQuery(raw);
    if (!query) continue;

    // 1. DuckDuckGo instant answer. Empty for natural questions; useful once
    //    the query has been reduced to an entity name.
    const ddgResult = await duckduckgoInstant(query);
    if (ddgResult && isWebSourceRelevant(query, ddgResult.title, ddgResult.snippet || ddgResult.content)) {
      allResults.push(ddgResult);
    }

    // 2. Try Brave Search if API key is configured
    if (process.env.BRAVE_API_KEY) {
      const braveResults = keepRelevant(query, await braveSearch(query));
      allResults.push(...braveResults);
      if (allResults.length >= 5) break; // enough results
    }

    try {
      // 3. Wikipedia. Pull a wider candidate set than we will cite, drop
      //    title clashes (Capital punishment) using the search snippet, and
      //    only then pay the courtesy delay + extract fetch for survivors.
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=8`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": CHAT_USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });

      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();
      const candidates = (searchData.query?.search || [])
        .filter((result) => isWebSourceRelevant(query, result.title, result.snippet || ""))
        .slice(0, 2);

      for (const result of candidates) {
        await delay(WIKI_COURTESY_DELAY_MS);

        const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title)}`;
        const allowed = await checkRobotsTxt(articleUrl);
        if (!allowed) continue;

        // Fetch extract
        const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(result.title)}&format=json`;
        const extractRes = await fetch(extractUrl, {
          headers: { "User-Agent": CHAT_USER_AGENT },
          signal: AbortSignal.timeout(8000),
        });

        if (!extractRes.ok) continue;
        const extractData = await extractRes.json();
        const pages = extractData.query?.pages || {};
        const page = Object.values(pages)[0];

        if (page?.extract) {
          allResults.push({
            title: result.title,
            url: articleUrl,
            snippet: (result.snippet || "").replace(/<[^>]+>/g, "").slice(0, 300),
            content: page.extract.slice(0, 2000),
            source: "en.wikipedia.org",
            query,
            fetchedAt: new Date().toISOString(),
          });
        }
      }

      // Also try HackerNews for tech queries
      if (query.match(/tech|code|software|programming|ai|machine learning/i)) {
        try {
          const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=2`;
          const hnRes = await fetch(hnUrl, {
            headers: { "User-Agent": CHAT_USER_AGENT },
            signal: AbortSignal.timeout(5000),
          });

          if (hnRes.ok) {
            const hnData = await hnRes.json();
            for (const hit of (hnData.hits || []).slice(0, 2)) {
              const row = {
                title: hit.title || "HN discussion",
                url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                snippet: `${hit.title} (${hit.points || 0} points, ${hit.num_comments || 0} comments)`,
                content: hit.title || "",
                source: hit.url ? new URL(hit.url).hostname : "news.ycombinator.com",
                query,
                fetchedAt: new Date().toISOString(),
              };
              if (isWebSourceRelevant(query, row.title, row.snippet)) allResults.push(row);
            }
          }
        } catch (_e) { logger.debug('emergent:conscious-web-search', 'HN is supplementary — silent fail', { error: _e?.message }); }
      }
    } catch (err) {
      // Search is best-effort — continue with next query
      logger.debug('emergent:conscious-web-search', 'Wikipedia search failed', { query, error: err?.message });
    }
  }

  return allResults;
}

// ── Fetch Public Page Content ───────────────────────────────────────────────

/**
 * Fetch a public page's text content with full legal compliance.
 */
export async function fetchPublicPage(url) {
  if (isBlockedUrl(url)) return null;

  const allowed = await checkRobotsTxt(url);
  if (!allowed) return null;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CHAT_USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const html = await res.text();
    // Basic HTML → text extraction (strip tags)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);

    return { text, url };
  } catch {
    return null;
  }
}

// ── Evaluation Prompt Builder ───────────────────────────────────────────────

/**
 * Build the prompt that asks the conscious brain to evaluate if web search is needed.
 */
export function buildEvaluationPrompt(userMessage, contextSummary, lens) {
  return TASK_PROMPTS.webSearchEvaluation({ userMessage, contextSummary, lens });
}

/**
 * Build the prompt for generating search queries from a user message.
 */
export function buildQueryGenerationPrompt(userMessage, lens) {
  return TASK_PROMPTS.webSearchQueryGen({ userMessage, lens });
}

/**
 * Build the response system prompt with both DTU and web context.
 */
export function buildResponsePrompt(dtuContext, webContext) {
  return TASK_PROMPTS.webSearchResponse({ dtuContext, webContext });
}

// ── URL Extraction ──────────────────────────────────────────────────────────

/**
 * Extract URLs from a response string.
 */
export function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s)]+/g;
  return [...new Set((text || "").match(urlRegex) || [])];
}

// ── Metrics ─────────────────────────────────────────────────────────────────

const chatWebMetrics = {
  totalChats: 0,
  webAugmented: 0,
  queriesGenerated: 0,
  sourcesUsed: 0,
  dtusCreatedFromWeb: 0,
  avgSearchLatencyMs: 0,
  triggerBreakdown: { explicit: 0, evaluated: 0, skipped: 0 },
};

export function recordChatWebMetrics(type, searchLatencyMs, sourcesUsed) {
  chatWebMetrics.totalChats++;
  if (type === "web-augmented") {
    chatWebMetrics.webAugmented++;
    chatWebMetrics.sourcesUsed += sourcesUsed;
    const n = chatWebMetrics.webAugmented;
    chatWebMetrics.avgSearchLatencyMs =
      (chatWebMetrics.avgSearchLatencyMs * (n - 1) + searchLatencyMs) / n;
  }
  if (type === "explicit") chatWebMetrics.triggerBreakdown.explicit++;
  else if (type === "evaluated") chatWebMetrics.triggerBreakdown.evaluated++;
  else chatWebMetrics.triggerBreakdown.skipped++;
}

export function getChatWebMetrics() {
  return { ...chatWebMetrics };
}
