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
// ── DuckDuckGo Instant Answer (free, no key) ────────────────────────────────

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

  for (const query of (queries || []).slice(0, 3)) {
    // 1. Try DuckDuckGo instant answer first (fast, free, broad)
    const ddgResult = await duckduckgoInstant(query);
    if (ddgResult) allResults.push(ddgResult);

    // 2. Try Brave Search if API key is configured
    if (process.env.BRAVE_API_KEY) {
      const braveResults = await braveSearch(query);
      allResults.push(...braveResults);
      if (allResults.length >= 5) break; // enough results
    }

    try {
      // 3. Wikipedia as supplementary source (especially good for factual/encyclopedic)
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": CHAT_USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });

      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();

      for (const result of (searchData.query?.search || []).slice(0, 2)) {
        await delay(2000); // courteous delay

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
              allResults.push({
                title: hit.title || "HN discussion",
                url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                snippet: `${hit.title} (${hit.points || 0} points, ${hit.num_comments || 0} comments)`,
                content: hit.title || "",
                source: hit.url ? new URL(hit.url).hostname : "news.ycombinator.com",
                query,
                fetchedAt: new Date().toISOString(),
              });
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
