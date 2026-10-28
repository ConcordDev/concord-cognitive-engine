// server/lib/news-summarizer.js
//
// Concord's OWN short summaries for summary-only (restricted-tier) news items.
//
// Input  = headline + the feed description, held IN MEMORY ONLY (the queue below)
//          for the one LLM call; it is never written to disk, a DTU, or the cache.
// Output = 1-2 sentences, <= 45 words, in Concord's words. Rejected (no summary is
//          stored) if it shares any run of 8+ consecutive words with the description.
// Store  = { [dedupHash]: { text, at } } in the feed-cache file ("news-summaries"
//          source), so summaries survive restarts like the rest of the warm cache.
//
// Honesty: no summary => null. Never a fabricated one, never the outlet's text.
// Budget: <= SUMMARY_BUDGET summaries per SUMMARY_WINDOW_MS, low priority (runs from
// the warm tick), skipped entirely when no brain is ready.

import { registerSource, hasSource, peek, put } from "./feed-cache.js";
import { getDedupKeyAndHash } from "./dedup-keys.js";
import { validateConcordSummary } from "./news-outlet-policy.js";

export const SUMMARY_SOURCE_ID = "news-summaries";
const STORE_KEY = "v1";
export const SUMMARY_BUDGET = 30;
export const SUMMARY_WINDOW_MS = 10 * 60 * 1000;
const PER_CALL = 3;            // never hog the event loop / brain from a single warm tick
const QUEUE_MAX = 300;
const STORE_MAX = 3000;
const RETRY_AFTER_REJECT_MS = 60 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const _queue = new Map();      // hash -> { hash, title, description, url, source }   (description: memory only)
const _rejected = new Map();   // hash -> ts of last failed attempt
let _stamps = [];              // timestamps of attempts inside the window
let _now = () => Date.now();

export function __resetSummarizerForTests({ now } = {}) {
  _queue.clear(); _rejected.clear(); _stamps = [];
  _now = typeof now === "function" ? now : () => Date.now();
}

function ensureStore() {
  if (hasSource(SUMMARY_SOURCE_ID)) return;
  registerSource(SUMMARY_SOURCE_ID, {
    ttlMs: YEAR_MS, staleMaxMs: YEAR_MS, persist: true, breaker: false,
    license: "internal-only",
    fetcher: async () => ({}), // never called: entries are written with put()
  });
}

function store() {
  ensureStore();
  const e = peek(SUMMARY_SOURCE_ID, STORE_KEY);
  return e?.data && typeof e.data === "object" ? e.data : {};
}

/** Stable key for an article: the repo-wide dedup hash of (url, title). */
export function itemHash(title, url) {
  try { return getDedupKeyAndHash({ title, sourceUrl: url }).hash; } catch { return `${title}|${url}`; }
}

/** Concord summary for an article by title+url, or null (read-only). */
export function summaryForItem(title, url) { return summaryFor(itemHash(title, url)); }

/** Queue an article for a Concord summary (description is held in memory only). */
export function queueItemForSummary({ title, url, description, source }) {
  return queueForSummary({ hash: itemHash(title, url), title, description, url, source });
}

/** Concord summary text for a dedup hash, or null. */
export function summaryFor(hash) {
  const s = store()[hash];
  return s && typeof s.text === "string" && s.text ? s.text : null;
}

/** Remember an item that wants a summary. Description is kept in memory only, until used. */
export function queueForSummary(item) {
  if (!item?.hash || !item.title || !item.description) return false;
  if (_queue.has(item.hash)) return false;
  const rej = _rejected.get(item.hash);
  if (rej && _now() - rej < RETRY_AFTER_REJECT_MS) return false;
  if (summaryFor(item.hash)) return false;
  if (_queue.size >= QUEUE_MAX) _queue.delete(_queue.keys().next().value);
  _queue.set(item.hash, { hash: item.hash, title: item.title, description: item.description, url: item.url, source: item.source });
  return true;
}

export function summaryQueueSize() { return _queue.size; }

function windowLeft() {
  const t = _now();
  _stamps = _stamps.filter((x) => t - x < SUMMARY_WINDOW_MS);
  return Math.max(0, SUMMARY_BUDGET - _stamps.length);
}

const SYSTEM = "You write one-to-two sentence neutral news summaries. Use your own words entirely: never copy phrases from the source text. At most 40 words. Output only the summary, no quotes, no preface.";

/**
 * Summarize up to PER_CALL queued items. `llm(prompt, {system})` resolves to the model text
 * (or a { content } object) and may throw; `ready()` false skips the whole run.
 * Never throws.
 */
export async function runSummaryBatch({ llm, ready, max = PER_CALL } = {}) {
  const out = { ran: false, reason: null, stored: 0, rejected: 0, attempted: 0 };
  try {
    if (typeof llm !== "function") { out.reason = "no_llm"; return out; }
    if (typeof ready === "function" && !(await ready())) { out.reason = "brain_not_ready"; return out; }
    if (!_queue.size) { out.reason = "empty"; return out; }
    const left = Math.min(max, windowLeft());
    if (left <= 0) { out.reason = "budget"; return out; }
    out.ran = true;
    // newest-queued first: the headlines users see first get summarized first
    const picks = [..._queue.values()].reverse().slice(0, left);
    for (const it of picks) {
      _queue.delete(it.hash); // description is dropped from memory after this one attempt either way
      _stamps.push(_now());
      out.attempted++;
      let text = "";
      try {
        const res = await llm(`Headline: ${it.title}\n\nSource text:\n${it.description.slice(0, 1500)}\n\nSummary:`, { system: SYSTEM, maxTokens: 120, temperature: 0.3 });
        text = typeof res === "string" ? res : String(res?.content ?? res?.text ?? "");
      } catch { text = ""; }
      const v = validateConcordSummary(text, it.description);
      if (!v.ok) { _rejected.set(it.hash, _now()); out.rejected++; continue; }
      const cur = { ...store() };
      cur[it.hash] = { text: v.summary, at: _now() };
      const keys = Object.keys(cur);
      if (keys.length > STORE_MAX) {
        keys.sort((a, b) => (cur[a].at || 0) - (cur[b].at || 0));
        for (const k of keys.slice(0, keys.length - STORE_MAX)) delete cur[k];
      }
      put(SUMMARY_SOURCE_ID, STORE_KEY, cur);
      out.stored++;
    }
  } catch (e) {
    out.reason = `error: ${e?.message || e}`;
  }
  return out;
}
