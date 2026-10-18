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

// A sentence that only asks for citations: "Give the source link.",
// "Please include sources", "Cite your sources", "With links".
const SOURCE_REQUEST_SENTENCE = /^(?:please\s+)?(?:(?:give|include|provide|cite|show|add|list|share|send|post|attach)\b[^.?!]*\b(?:sources?|links?|citations?|urls?|references?)\b|with\s+(?:a\s+|the\s+)?(?:sources?|links?|citations?)\b)/i;
// The same request glued to the question: "…Node.js and give the source link".
const SOURCE_REQUEST_TAIL = /[\s,;]+(?:and\s+)?(?:please\s+)?(?:(?:give|include|provide|cite|show|add|share)\s+(?:me\s+)?(?:the\s+|a\s+|your\s+|some\s+)?(?:sources?|links?|citations?|urls?|references?)(?:\s+links?)?|with\s+(?:a\s+|the\s+)?(?:sources?|links?|citations?))\b[^?!]*[.?!]*\s*$/i;
// "Search the web: …", "Look up …", "Google …". The directive is not the topic.
const LEADING_DIRECTIVE = /^(?:(?:please|can you|could you|would you)\s+)*(?:(?:do\s+a\s+)?(?:web\s+)?search(?:\s+(?:the\s+)?(?:web|internet|online|net))?(?:\s+(?:for|about|on))?|look\s+up|google|bing|find\s+out)\s*(?:[:,.\-\u2013\u2014]\s*|\s+)/i;

function stripInstructionTail(s) {
  s = s.replace(/([?!])(?=\S)/g, "$1 ");
  const parts = s.split(/(?<=[.?!])\s+/);
  if (parts.length > 1) {
    const kept = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i > 0 && /^(?:please\s+)?(?:answer|respond|reply|explain|summarize|summarise|keep|be)\b/i.test(part)) break;
      if (i > 0 && /^in\s+(?:one|a|1)\s+sentence\b/i.test(part)) break;
      // "Give the source link." / "Include sources." asks HOW to answer, not
      // WHAT to search. Left in, it sent Bing "… Give the source link" and
      // the only hits were search-engine home pages (live test 2026-10-17).
      if (i > 0 && SOURCE_REQUEST_SENTENCE.test(part)) break;
      kept.push(part);
    }
    s = kept.join(" ").trim();
  }
  s = s.replace(SOURCE_REQUEST_TAIL, "");
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
  {
    const next = s.replace(LEADING_DIRECTIVE, "").trim();
    if (/[a-z0-9]/i.test(next)) s = next;
  }
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
// Words that say WHEN or HOW FRESH, not WHAT. A hit about copper prices
// does not have to repeat "current" or "2026" to be about copper prices,
// so these never count as required terms.
const OPTIONAL_TERMS = new Set(
  `current latest today now recent recently live update updated news
   tonight yesterday week month year
   january february march april may june july august september october november december`
    .split(/\s+/).filter(Boolean),
);

// Words that say WHICH ASPECT of the thing is wanted. nodejs.org's
// "Download Node.js" page answers "latest stable version of Node.js" without
// repeating "stable" or "version"; requiring them dropped every official hit
// (live test 2026-10-17). They still go into the search string.
const QUALIFIER_TERMS = new Set(
  `version release stable lts newest official link source number info information detail`
    .split(/\s+/).filter(Boolean),
);

function requiredTerms(terms) {
  const req = terms.filter((t) => !OPTIONAL_TERMS.has(t) && !QUALIFIER_TERMS.has(t) && !/^(?:19|20)\d\d$/.test(t));
  if (req.length) return req;
  const q = terms.filter((t) => !OPTIONAL_TERMS.has(t) && !/^(?:19|20)\d\d$/.test(t));
  return q.length ? q : terms;
}

/**
 * Words a hit "says": title + snippet, plus the result host. Two adjacent
 * query terms written as one word ("node" + "js" → nodejs.org) both count.
 */
function hitWords(terms, title, snippet, url) {
  const blob = new Set(contentWords(`${title || ""} ${snippet || ""}`));
  let host = "";
  try { host = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
  for (const w of contentWords(host.replace(/\.[a-z]+$/i, ""))) blob.add(w);
  for (let i = 0; i + 1 < terms.length; i++) {
    const joined = `${terms[i]}${terms[i + 1]}`;
    if (blob.has(joined) || blob.has(stemToken(joined))) { blob.add(terms[i]); blob.add(terms[i + 1]); }
  }
  return blob;
}

// Questions whose answer changes over time (prices, scores, weather, news).
// An encyclopedia lead cannot answer them; citing "2000s commodities boom"
// for "copper prices" is worse than saying the search found nothing.
const FRESHNESS_RE = /\b(?:price|prices|pricing|cost|costs|quote|rate|rates|stock|stocks|share price|market|score|scores|weather|forecast|news|latest|current|today|tonight|this week|right now|live)\b/i;

export function isFreshnessQuery(query) {
  return FRESHNESS_RE.test(String(query || "")) || /\b20\d\d\b/.test(String(query || ""));
}

export function isWebSourceRelevant(query, title, snippet, url) {
  const shaped = shapeSearchQuery(query);
  const terms = requiredTerms(queryTerms(shaped));
  if (!terms.length) return false;
  const blob = hitWords(terms, title, snippet, url);
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
  return (rows || []).filter((r) => isWebSourceRelevant(query, r.title, r.snippet || r.content || "", r.url));
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

// ── SearXNG (optional, self-hosted, SEARXNG_URL) ────────────────────────────

async function searxngSearch(query) {
  const base = String(process.env.SEARXNG_URL || "").replace(/\/+$/, "");
  if (!base) return [];
  try {
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": CHAT_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, 6).map((r) => ({
      title: decodeHtmlEntities(r.title || ""),
      url: r.url || "",
      snippet: decodeHtmlEntities(r.content || "").slice(0, 300),
      content: decodeHtmlEntities(r.content || "").slice(0, 2000),
      source: hostOf(r.url, "searxng"),
      provider: "searxng",
      query,
      fetchedAt: new Date().toISOString(),
    })).filter((r) => /^https?:\/\//i.test(r.url));
  } catch (_e) {
    return [];
  }
}

// ── Bing web results page (keyless fallback) ────────────────────────────────
// Without BRAVE_API_KEY / SEARXNG_URL the only "web search" used to be
// Wikipedia full-text search, which matches any article that mentions the
// words: "copper prices" cited "2000s commodities boom" and "Islamic State".
// DuckDuckGo's HTML endpoint answers bots with a 202 anomaly page, so the
// keyless general-web fallback is Bing's results page. Turn it off with
// CONCORD_WEB_SEARCH_BING=0 (then set BRAVE_API_KEY or SEARXNG_URL).

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function hostOf(url, fallback = "web") {
  try { return new URL(url).hostname; } catch { return fallback; }
}

/** Bing wraps result links in /ck/a?...&u=a1<base64url(target)>. */
export function decodeBingHref(href) {
  const h = decodeHtmlEntities(href || "").trim();
  let u;
  try { u = new URL(h); } catch { return ""; }
  if (!/(^|\.)bing\.com$/i.test(u.hostname)) return /^https?:$/.test(u.protocol) ? h : "";
  if (!u.pathname.startsWith("/ck/")) return "";
  const enc = u.searchParams.get("u") || "";
  if (!enc.startsWith("a1")) return "";
  try {
    const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const target = Buffer.from(b64, "base64").toString("utf8");
    return /^https?:\/\/[^\s]+$/i.test(target) ? target : "";
  } catch {
    return "";
  }
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Parse organic results (li.b_algo) out of a Bing results page. */
export function parseBingResults(html, query, limit = 6) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || "").split(/<li class="b_algo"/i).slice(1);
  for (const block of blocks) {
    const a = block.match(/<h2[^>]*>\s*<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = decodeBingHref(a[1]);
    if (!url || seen.has(url) || isBlockedUrl(url)) continue;
    const title = stripTags(a[2]);
    if (!title) continue;
    const cap = block.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/i);
    const p = (cap ? cap[1] : block).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = p
      ? stripTags(p[1].replace(/<span class="news_dt">([\s\S]*?)<\/span>/i, "$1 ")).replace(/^[\s·•-]+/, "")
      : "";
    seen.add(url);
    out.push({
      title: title.slice(0, 200),
      url,
      snippet: snippet.slice(0, 300),
      content: snippet.slice(0, 2000),
      source: hostOf(url),
      provider: "bing",
      query,
      fetchedAt: new Date().toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function bingSearch(query) {
  if (String(process.env.CONCORD_WEB_SEARCH_BING || "1") === "0") return [];
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&cc=US`;
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return parseBingResults(await res.text(), query);
  } catch (_e) {
    return [];
  }
}

/**
 * Live web results for one already-shaped query from the general-web
 * providers (Brave → SearXNG → Bing), relevance-filtered and de-duplicated.
 */
/**
 * Web-index hits must cover the query, not one shared word: "Current |
 * Future of Banking" mentions "price" but not "copper". Both terms of a
 * two-term query; at least two thirds of a longer one.
 */
export function coversQuery(query, title, snippet, url) {
  const req = requiredTerms(queryTerms(shapeSearchQuery(query)));
  if (!req.length) return false;
  if (hasCompoundClash(req, title) && !hasOrderedTightMatch(req, `${title || ""} ${snippet || ""}`)) return false;
  const blob = hitWords(req, title, snippet, url);
  const hit = req.filter((t) => blob.has(t)).length;
  return req.length <= 2 ? hit === req.length : hit / req.length >= 2 / 3;
}

function keepCovering(query, rows) {
  return (rows || []).filter((r) => coversQuery(query, r.title, r.snippet || r.content || "", r.url));
}

/**
 * Keyword form of the query without freshness filler
 * ("current copper price today" → "copper price",
 *  "latest stable version of Node.js" → "node js stable version").
 * Bing's keyless page answers "latest …" with news home pages.
 */
export function compactSearchQuery(query) {
  const terms = queryTerms(shapeSearchQuery(query));
  const kept = terms.filter((t) => !OPTIONAL_TERMS.has(t) && !/^(?:19|20)\d\d$/.test(t));
  // The keyless page ranks on the leading word ("stable version node js" →
  // dictionary entries for "stable"), so the subject goes first.
  const subject = kept.filter((t) => !QUALIFIER_TERMS.has(t));
  const ordered = [...subject, ...kept.filter((t) => QUALIFIER_TERMS.has(t))];
  return (ordered.length ? ordered : terms).slice(0, 5).join(" ");
}

async function generalWebResults(query) {
  const rows = [];
  if (process.env.BRAVE_API_KEY) rows.push(...keepCovering(query, (await braveSearch(query)).map((r) => ({ provider: "brave", ...r }))));
  if (rows.length < 3) rows.push(...keepCovering(query, await searxngSearch(query)));
  if (rows.length < 3) {
    rows.push(...keepCovering(query, await bingSearch(query)));
    // Bing's keyless page sometimes ranks on the first word only when the
    // query carries filler ("current copper price today" → the bank named
    // Current). Retry once with just the required terms.
    const compact = compactSearchQuery(query);
    if (rows.length < 2 && compact && compact !== query.toLowerCase()) {
      rows.push(...keepCovering(query, await bingSearch(compact)));
    }
  }
  // Bing's keyless page now ranks on the first word only from this host
  // ("lightest carbon bike frames 2026" -> dictionary pages), so the relevance
  // filter rightly drops everything and web_search came back empty. Google
  // News' RSS search is keyless and ranks the whole query (reviews, buyer's
  // guides, spec pages); it fills in when the web index gave fewer than two.
  if (rows.length < 3) rows.push(...keepHalfCovering(query, await googleRssSearch(query)).slice(0, 5));
  const seen = new Set();
  return rows.filter((r) => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

/** Article titles name the topic, not every query word: half the required terms (all of a two-term query). */
function keepHalfCovering(query, rows) {
  const req = requiredTerms(queryTerms(shapeSearchQuery(query)));
  if (!req.length) return [];
  return (rows || []).filter((r) => {
    const blob = hitWords(req, r.title, r.snippet || "", "");
    const hit = req.filter((t) => blob.has(t)).length;
    return req.length <= 2 ? hit === req.length : hit / req.length >= 0.5;
  });
}

async function googleRssSearch(query) {
  if (String(process.env.CONCORD_WEB_SEARCH_GNEWS || "1") === "0") return [];
  const q = shapeSearchQuery(query) || query;
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { "User-Agent": CHAT_USER_AGENT }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return parseGoogleNewsRss(await res.text(), query, 8).map((r) => ({ ...r, provider: "google-rss" }));
  } catch (_e) {
    return [];
  }
}

// ── News (Bing News results page, keyless; Google News RSS fallback) ───────
// "today's top tech news" went to Bing's general web page as "top tech" and
// cited a Ford technician program, a plumbing company and an Amazon listing
// (live test 2026-10-17). News questions need a news index: Bing News cards
// carry the publisher's article URL, title, outlet and age directly.
// CONCORD_WEB_SEARCH_NEWS=0 turns this off.

const NEWS_QUERY_RE = /\b(?:news|headlines?|breaking|happening|stories|story|announced|announcement)\b/i;
const NEWS_FILLER = new Set(
  `news headline headlines top biggest big latest breaking today todays tonight current recent
   happening going story stories world week right now this day update updates major important
   whats what give tell show me any some new`.split(/\s+/).filter(Boolean),
);
const NEWS_TOPIC_ALIASES = { tech: "technology", ai: "artificial intelligence" };

export function isNewsQuery(query) {
  return NEWS_QUERY_RE.test(String(query || ""));
}

/** Topic of a news question ("today's top tech news" → "technology"); "" = general headlines. */
export function newsTopic(query) {
  const words = tokenize(String(query || "").replace(/[’‘]/g, "'").replace(/'s\b/gi, ""))
    .filter((w) => !SEARCH_STOP.has(w) && !NEWS_FILLER.has(w) && !/^(?:19|20)\d\d$/.test(w));
  return words.map((w) => NEWS_TOPIC_ALIASES[w] || w).slice(0, 6).join(" ");
}

function attr(tag, name) {
  const m = String(tag || "").match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  return m ? decodeHtmlEntities(m[1]).trim() : "";
}

/** Parse news cards out of a Bing News results page. */
export function parseBingNewsResults(html, query, limit = 6) {
  const out = [];
  const seen = new Set();
  const parts = String(html || "").split(/<div class="news-card newsitem/i).slice(1);
  for (const part of parts) {
    const open = part.slice(0, part.indexOf(">") + 1);
    const url = attr(open, "data-url") || attr(open, "url");
    const title = attr(open, "data-title") || attr(open, "title");
    if (!/^https?:\/\//i.test(url) || !title || seen.has(url) || isBlockedUrl(url)) continue;
    const outlet = attr(open, "data-author");
    const age = (part.match(/class="ns_sc_tm"[^>]*>([^<]{1,20})</i) || [])[1] || "";
    const snipM = part.match(/<div class="snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snipM ? stripTags(snipM[1]) : "";
    seen.add(url);
    const lead = [outlet, age ? `${age.trim()} ago` : ""].filter(Boolean).join(", ");
    const text = `${lead ? `${lead}: ` : ""}${snippet || title}`;
    out.push({
      title: title.slice(0, 200), url, snippet: text.slice(0, 300), content: text.slice(0, 2000),
      source: hostOf(url), outlet, age: age.trim(), provider: "bing-news", query, fetchedAt: new Date().toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Parse a Google News RSS feed (fallback; links are news.google.com redirects). */
export function parseGoogleNewsRss(xml, query, limit = 6) {
  const out = [];
  for (const item of String(xml || "").split(/<item>/i).slice(1)) {
    const get = (t) => { const m = item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? decodeHtmlEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : ""; };
    const url = get("link");
    let title = get("title");
    const outlet = get("source");
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3));
    if (!/^https?:\/\//i.test(url) || !title) continue;
    const date = get("pubDate");
    const text = `${[outlet, date].filter(Boolean).join(", ")}: ${title}`;
    out.push({ title: title.slice(0, 200), url, snippet: text.slice(0, 300), content: text.slice(0, 2000), source: outlet || "news.google.com", outlet, provider: "google-news", query, fetchedAt: new Date().toISOString() });
    if (out.length >= limit) break;
  }
  return out;
}

async function newsResults(rawQuery) {
  if (String(process.env.CONCORD_WEB_SEARCH_NEWS || "1") === "0") return [];
  const topic = newsTopic(rawQuery);
  const q = topic || "world news"; // "top stories" returned lifestyle filler
  try {
    const res = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&setlang=en&cc=US`, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const rows = parseBingNewsResults(await res.text(), q);
      if (rows.length) return rows;
    }
  } catch (_e) { /* fall back to the RSS feed */ }
  try {
    const url = topic
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${topic} when:2d`)}&hl=en-US&gl=US&ceid=US:en`
      : "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";
    const res = await fetch(url, { headers: { "User-Agent": CHAT_USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (res.ok) return parseGoogleNewsRss(await res.text(), q);
  } catch (_e) { /* no news source reachable */ }
  return [];
}

// ── Software release status (endoflife.date open API, keyless) ─────────────
// "What is the latest stable version of Node.js?" is a lookup, not a ranking
// problem. endoflife.date publishes a documented public JSON API for ~480
// products (Node.js, Python, PostgreSQL, Ubuntu, …) with each release line,
// its newest patch, LTS status and the project's official release page. It
// runs before the general web index and only for version/release questions
// that name a product it tracks. Turn it off with CONCORD_WEB_SEARCH_RELEASES=0.

const EOL_API = "https://endoflife.date/api/v1";
const EOL_PRODUCTS_TTL_MS = 12 * 60 * 60 * 1000;
let _eolProducts = null; // { at, list }

const VERSION_QUESTION_RE = /\b(?:versions?|releases?|lts|end[- ]of[- ]life|eol|support(?:ed)?\s+until)\b/i;
const VERSION_WORDS = new Set(
  `latest current newest recent stable lts version versions release releases
   most new last official what which is the of for a an`.split(/\s+/).filter(Boolean),
);

export function isVersionQuery(query) {
  return VERSION_QUESTION_RE.test(String(query || ""));
}

const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Find the endoflife.date product a query names. Longest phrase wins. */
export function matchReleaseProduct(query, products) {
  const index = new Map();
  for (const p of products || []) {
    for (const k of [p.name, p.label, ...(p.aliases || [])]) {
      const n = normKey(k);
      if (n.length >= 2 && !index.has(n)) index.set(n, p);
    }
  }
  const words = String(query || "").split(/\s+/).map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9+#]+$/gi, "")).filter(Boolean);
  for (let len = Math.min(3, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const gram = words.slice(i, i + len);
      if (gram.every((w) => VERSION_WORDS.has(w.toLowerCase()))) continue;
      if (len === 1 && (VERSION_WORDS.has(gram[0].toLowerCase()) || SEARCH_STOP.has(gram[0].toLowerCase()))) continue;
      const hit = index.get(normKey(gram.join("")));
      if (hit) return hit;
    }
  }
  return null;
}

async function eolProducts() {
  if (_eolProducts && Date.now() - _eolProducts.at < EOL_PRODUCTS_TTL_MS) return _eolProducts.list;
  const res = await fetch(`${EOL_API}/products`, {
    headers: { Accept: "application/json", "User-Agent": CHAT_USER_AGENT },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const list = Array.isArray(data?.result) ? data.result : [];
  if (list.length) _eolProducts = { at: Date.now(), list };
  return list;
}

/** Test hook: forget the cached product list. */
export function _resetReleaseCache() { _eolProducts = null; }

function describeRelease(r) {
  const latest = r?.latest?.name ? `${r.latest.name}${r.latest.date ? ` (${r.latest.date})` : ""}` : r?.name;
  const status = [];
  if (r.isLts) status.push("LTS");
  else if (r.ltsFrom) status.push(`becomes LTS ${r.ltsFrom}`);
  if (r.isEol) status.push("end of life");
  else if (r.eolFrom) status.push(`supported until ${r.eolFrom}`);
  return `${latest}${status.length ? ` [${r.label || r.name}: ${status.join(", ")}]` : ""}`;
}

/** Turn an endoflife.date product document into cited search rows. */
export function releaseRowsFromProduct(product, query) {
  const label = product?.label || product?.name || "";
  const releases = (product?.releases || []).filter((r) => r && r.latest?.name);
  if (!label || !releases.length) return [];
  const maintained = releases.filter((r) => r.isMaintained !== false && !r.isEol);
  const newest = (maintained[0] || releases[0]);
  const newestLts = releases.find((r) => r.isLts && !r.isEol);
  const parts = [`Newest ${label} release: ${describeRelease(newest)}.`];
  if (newestLts && newestLts !== newest) parts.push(`Newest LTS release: ${describeRelease(newestLts)}.`);
  const summary = parts.join(" ");
  const lines = maintained.slice(0, 4).map((r) => `- ${describeRelease(r)}`);
  const official = product.links?.releasePolicy || "";
  const html = product.links?.html || `https://endoflife.date/${encodeURIComponent(product.name)}`;
  const fetchedAt = new Date().toISOString();
  const content = [summary, lines.length ? `Maintained release lines:\n${lines.join("\n")}` : "", official ? `Official release page: ${official}` : ""]
    .filter(Boolean).join("\n").slice(0, 2000);
  const rows = [];
  if (official && /^https?:\/\//i.test(official) && !isBlockedUrl(official)) {
    rows.push({
      title: `${label} releases (official release schedule)`,
      url: official,
      snippet: `${summary} Release schedule published by the ${label} project.`.slice(0, 300),
      content,
      source: hostOf(official),
      provider: "endoflife",
      query,
      fetchedAt,
    });
  }
  rows.push({
    title: `${label} release and support status | endoflife.date`,
    url: html,
    snippet: summary.slice(0, 300),
    content,
    source: "endoflife.date",
    provider: "endoflife",
    query,
    fetchedAt,
  });
  return rows;
}

async function releaseInfoResults(query) {
  if (String(process.env.CONCORD_WEB_SEARCH_RELEASES || "1") === "0") return [];
  if (!isVersionQuery(query)) return [];
  try {
    const product = matchReleaseProduct(query, await eolProducts());
    if (!product?.name) return [];
    const res = await fetch(`${EOL_API}/products/${encodeURIComponent(product.name)}`, {
      headers: { Accept: "application/json", "User-Agent": CHAT_USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return releaseRowsFromProduct(data?.result, query);
  } catch (_e) {
    return [];
  }
}

export async function webSearchForChat(queries) {
  const allResults = [];

  for (const raw of (queries || []).slice(0, 3)) {
    const query = shapeSearchQuery(raw);
    if (!query) continue;

    // 0. Release lookups ("latest stable version of Node.js") from a
    //    structured, keyless public API, before any results page.
    const releaseRows = await releaseInfoResults(query);
    allResults.push(...releaseRows);

    // 0b. News questions go to a news index first; a general web page ranks
    //     "top tech news" on brand names (TopTech Electric & Plumbing).
    if (isNewsQuery(raw) || isNewsQuery(query)) {
      const newsRows = await newsResults(raw);
      allResults.push(...newsRows.slice(0, 6));
      logger.info('emergent:conscious-web-search', 'web_search', { event: "web_search_news", query: query.slice(0, 120), news: newsRows.length, providers: [...new Set(newsRows.map((r) => r.provider))] });
      if (newsRows.length >= 3) break;
    }

    // 1. DuckDuckGo instant answer. Empty for natural questions; useful once
    //    the query has been reduced to an entity name.
    const ddgResult = await duckduckgoInstant(query);
    if (ddgResult && isWebSourceRelevant(query, ddgResult.title, ddgResult.snippet || ddgResult.content, ddgResult.url)) {
      allResults.push(ddgResult);
    }

    // 2. General web search (Brave if keyed, SearXNG if configured, else
    //    the keyless Bing results page). These are ranked by a real web
    //    index, so they come before the Wikipedia fallback.
    const webRows = await generalWebResults(query);
    allResults.push(...webRows.slice(0, 5));
    logger.info('emergent:conscious-web-search', 'web_search', {
      event: "web_search", query: query.slice(0, 120), release: releaseRows.length, web: webRows.length,
      providers: [...new Set(webRows.map((r) => r.provider || "web"))],
    });
    if (allResults.length >= 5) break; // enough results

    // 3. Wikipedia is an encyclopedia fallback. It only runs when the web
    //    providers gave fewer than two hits, and never for time-sensitive
    //    questions (prices, scores, news): its full-text search matches any
    //    article that merely mentions the words.
    if (webRows.length >= 2 || isFreshnessQuery(raw) || isFreshnessQuery(query)) continue;

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
            // Search blurb only — often the first sentence, and not the fact.
            // content is the plain-text lead. Expert Mode cites content.
            // Decode entities so chips never show &quot; / &#039;.
            snippet: decodeHtmlEntities((result.snippet || "").replace(/<[^>]+>/g, "")).slice(0, 300),
            content: decodeHtmlEntities(page.extract).slice(0, 2000),
            source: "en.wikipedia.org",
            provider: "wikipedia",
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
              if (isWebSourceRelevant(query, row.title, row.snippet, row.url)) allResults.push(row);
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

// ── HTML entity decode (search blurbs + page extracts) ───────────────────────

/**
 * Decode common HTML entities in search blurbs and page text.
 * Wikipedia list=search snippets ship `&quot;` / `&#039;` — those must not
 * reach the expert-mode source chip as markup.
 */
export function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const n = parseInt(d, 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&amp;/gi, "&");
}

function extractTitleFromHtml(html) {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    const t = decodeHtmlEntities(titleTag[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (t) return t.slice(0, 200);
  }
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const t = decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (t) return t.slice(0, 200);
  }
  return "";
}

// ── Fetch Public Page Content ───────────────────────────────────────────────

/**
 * Fetch a public page's text content with full legal compliance.
 * Returns { text, url, title } or null. Title comes from <title>/<h1>.
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
    const title = extractTitleFromHtml(html);
    // Basic HTML → text extraction (strip tags) + entity decode
    const text = decodeHtmlEntities(
      html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ).slice(0, 3000);

    if (!text || text.length < 12) return null;

    return { text, url, title: title || null };
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
