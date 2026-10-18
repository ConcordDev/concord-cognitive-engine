// server/lib/chat/link-grounding.js
//
// Links in a reply must come from something Concord actually retrieved.
//
// Live-test finding (2026-10-17): after a web_search that returned
// unrelated Wikipedia pages, the brain answered "copper prices" with
// figures and links that were in none of the results. The prompt already
// says "cite only URLs that came back"; nothing checked it. This module is
// that check:
//
//   collectAllowedUrls(...sources)  every http(s) URL found in the user's
//                                   message, history and tool results
//   enforceGroundedLinks(text, set) drop any URL in the reply that is not
//                                   in the set (markdown links keep their
//                                   label) and say how many were removed
//
// Deterministic, no model call.

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** Drop sentence punctuation glued to a URL; keep a ")" that closes a "(" in it. */
export function stripTrailingPunctuation(raw) {
  let s = String(raw || "");
  while (s.length) {
    const c = s[s.length - 1];
    if (c === ")") {
      const open = (s.match(/\(/g) || []).length;
      const close = (s.match(/\)/g) || []).length;
      if (close <= open) break;
    } else if (!".,;:!?]}>*_'\"".includes(c)) {
      break;
    }
    s = s.slice(0, -1);
  }
  return s;
}

/** Canonical form for comparison: lower-case host, no fragment, no trailing slash. */
export function normalizeUrl(raw) {
  let s = String(raw || "").trim();
  s = stripTrailingPunctuation(s);
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return "";
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    try { out = decodeURI(out); } catch { /* keep encoded form */ }
    return out;
  } catch {
    return "";
  }
}

function walk(value, out, depth = 0, seen = new WeakSet()) {
  if (value == null || depth > 8) return;
  if (typeof value === "string") {
    let text = value;
    // Tool results are often JSON strings; their URLs may be escaped.
    if (text.includes("\\/")) text = text.replace(/\\\//g, "/");
    for (const m of text.match(URL_RE) || []) {
      const n = normalizeUrl(m);
      if (n) out.add(n);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const v of value) walk(v, out, depth + 1, seen);
    return;
  }
  for (const v of Object.values(value)) walk(v, out, depth + 1, seen);
}

/** Every URL that appears anywhere in the given values (strings, arrays, objects). */
export function collectAllowedUrls(...sources) {
  const out = new Set();
  for (const s of sources) walk(s, out);
  return out;
}

function isAllowed(url, allowed) {
  const n = normalizeUrl(url);
  if (!n) return true; // not a URL we can judge; leave it
  if (allowed.has(n)) return true;
  // A result URL quoted without its query string is still that result.
  for (const a of allowed) {
    const base = a.split("?")[0];
    if (n === base || n.split("?")[0] === base) return true;
  }
  return false;
}

/**
 * Remove links that no retrieved source contains.
 * @returns {{ text: string, removed: string[] }}
 */
export function enforceGroundedLinks(text, allowed, { note = true } = {}) {
  const src = String(text || "");
  const set = allowed instanceof Set ? allowed : collectAllowedUrls(allowed);
  const removed = [];
  // 1. Markdown links: keep the label, drop the target.
  let out = src.replace(/\[([^\]\n]{0,300})\]\((https?:\/\/[^\s)]+(?:\([^\s)]*\))?[^\s)]*)\)/gi, (whole, label, url) => {
    if (isAllowed(url, set)) return whole;
    removed.push(normalizeUrl(url) || url);
    return label;
  });
  // 2. Bare URLs (including <https://...> autolinks).
  out = out.replace(/<?\bhttps?:\/\/[^\s<>"'`]+>?/gi, (whole) => {
    const bare = whole.replace(/^</, "").replace(/>$/, "");
    const n = normalizeUrl(bare);
    if (!n || isAllowed(bare, set)) return whole;
    removed.push(n);
    // keep trailing sentence punctuation that the URL regex swallowed
    const tail = bare.slice(stripTrailingPunctuation(bare).length);
    return `[link removed]${tail}`;
  });
  if (removed.length && note) {
    out = `${out.replace(/\s+$/, "")}\n\n_Removed ${removed.length} link${removed.length === 1 ? "" : "s"} that did not come from the search results or tools used for this answer._`;
  }
  return { text: out, removed: Array.from(new Set(removed)) };
}

/** Instruction appended to every web_search result the brain reads. */
export const WEB_GROUNDING_RULE =
  "Answer only from these results. Cite only these URLs, exactly as given. Where results carry a published date, lead with the newest items and say each one's outlet and date (for example \"Reuters, Oct 16\"); never present an older item as current. If the results do not contain the answer, say the search did not find it; do not fill in figures, dates or links from memory.";

/** Tool result text for a search that found nothing relevant. */
export const WEB_NO_RESULTS_RULE =
  "No relevant web results were found for this query. Tell the user the search found nothing relevant. Do not answer from memory as though it were sourced, and give no links.";
