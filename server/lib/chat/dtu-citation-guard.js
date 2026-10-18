// server/lib/chat/dtu-citation-guard.js
//
// A reply may only cite DTUs that were actually retrieved for this turn.
//
// Live-test finding (2026-10-17): "What does my Concord substrate (DTUs)
// know about heat pumps? Cite the DTUs you used." got five bullets like
// "**DTU: Heat Pump Efficiency Metrics** — …" and none of those DTUs exist;
// nothing about heat pumps was retrieved. This module checks every DTU
// reference in a reply against what the turn retrieved (context DTUs, tool
// results) and removes the ones that are not there:
//
//   * dtu_… ids that were not retrieved are replaced with "[unknown DTU]"
//   * a bullet/heading that names "DTU: <title>" (or DTU "<title>") whose
//     title matches no retrieved DTU is dropped, with its continuation lines
//   * when the user asked about their DTUs and every cited DTU was invented,
//     the reply becomes an honest "no matching DTUs" answer
//
// Deterministic, no model call.

const ID_RE = /\bdtu_[a-z0-9_]{6,}\b/gi;
const STOP = new Set("the a an of and or to in on for with by at from is are was were be my your our this that these those dtu dtus note notes".split(" "));

function words(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w));
}

function walk(value, acc, depth = 0, seen = new WeakSet()) {
  if (value == null || depth > 8) return;
  if (typeof value === "string") {
    for (const m of value.match(ID_RE) || []) acc.ids.add(m.toLowerCase());
    // JSON-stringified tool results: pull "title":"…" pairs.
    for (const m of value.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.){2,200})"/g)) acc.titles.add(m[1]);
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { for (const v of value) walk(v, acc, depth + 1, seen); return; }
  const id = typeof value.id === "string" ? value.id : (typeof value.dtuId === "string" ? value.dtuId : null);
  if (id) acc.ids.add(id.toLowerCase());
  if (typeof value.title === "string" && value.title.trim()) acc.titles.add(value.title.trim());
  for (const v of Object.values(value)) walk(v, acc, depth + 1, seen);
}

/** ids + titles of every DTU in the given values (DTU objects, tool results, strings). */
export function collectRetrievedDtus(...sources) {
  const acc = { ids: new Set(), titles: new Set() };
  for (const s of sources) walk(s, acc);
  return acc;
}

function titleMatches(candidate, titles) {
  const cw = words(candidate);
  if (!cw.length) return true; // nothing to judge
  for (const t of titles) {
    const tw = new Set(words(t));
    if (!tw.size) continue;
    const hit = cw.filter((w) => tw.has(w)).length;
    if (hit / cw.length >= 0.6 || (hit >= 2 && hit / tw.size >= 0.6)) return true;
  }
  return false;
}

const LABELLED_LINE = /^\s*(?:[-*•+]|\d+[.)])?\s*(?:#{1,6}\s*)?\**\s*(?:DTU|Note)\s*(?:#\s*\d+\s*)?[:–—-]\s*\**\s*([^*\n]{2,160}?)\s*\**\s*(?:[—–:]\s|\s-\s|\(|$)/i;
// A song/receipt line names a real thing the chat made ("Late Night Drives" is ready to play below;
// Saved in productivity: … id tsk_…). The long-chat probe lost exactly that line on "what song".
const RECEIPT_LINE = /\bready to play below\b|^\s*Saved in [\w-]+:|\bid (?:tsk|proj|evt|media)[_-]/i;
function namesKnownTitle(line, titles) {
  const l = String(line || "").toLowerCase();
  for (const t of titles) { const s = String(t || "").trim().toLowerCase(); if (s.length >= 4 && l.includes(s)) return true; }
  return false;
}
const QUOTED_REF = /\bDTU\s+(?:titled\s+|called\s+|named\s+)?["“'‘]([^"”'’\n]{3,140})["”'’]/gi;

/** True when the user is asking what their DTUs/substrate contain. */
export function asksAboutOwnDtus(prompt) {
  return /\b(?:my|our)\s+(?:concord\s+)?(?:dtus?|substrate|lattice|notes|knowledge\s+base)\b/i.test(String(prompt || ""))
    || /\bcite\s+the\s+dtus?\b/i.test(String(prompt || ""));
}

function topicOf(prompt) {
  const m = String(prompt || "").match(/\babout\s+([^?.!]{2,80})/i);
  return m ? m[1].trim() : "";
}

/**
 * @param {string} reply
 * @param {{ids:Set<string>, titles:Set<string>}} retrieved  from collectRetrievedDtus
 * @param {{prompt?:string}} [opts]
 * @returns {{ text: string, removed: string[], kept: number }}
 */
export function guardDtuCitations(reply, retrieved, { prompt = "" } = {}) {
  const text = String(reply || "");
  const ids = retrieved?.ids instanceof Set ? retrieved.ids : new Set();
  const titles = retrieved?.titles instanceof Set ? retrieved.titles : new Set();
  const removed = [];
  let kept = 0;

  // 1. Labelled DTU bullets / headings.
  const lines = text.split("\n");
  const out = [];
  let dropping = false;
  for (const line of lines) {
    const m = line.match(LABELLED_LINE);
    // "Note: …" is ordinary prose ("Note: I can't play audio"); only judge it when the user asked about their notes/DTUs.
    if (m && /^\s*(?:[-*•+]|\d+[.)])?\s*(?:#{1,6}\s*)?\**\s*Note\b/i.test(line) && !asksAboutOwnDtus(prompt)) { out.push(line); dropping = false; continue; }
    if (m) {
      if (titleMatches(m[1], titles) || RECEIPT_LINE.test(line) || namesKnownTitle(line, titles)) { kept++; dropping = false; out.push(line); }
      else { removed.push(m[1].trim()); dropping = true; }
      continue;
    }
    if (dropping) {
      // continuation of a dropped bullet: indented text, until a blank line or a new bullet
      if (!line.trim() || /^\s*(?:[-*•+]|\d+[.)])\s/.test(line) || /^\S/.test(line)) dropping = false;
      else continue;
    }
    out.push(line);
  }
  let result = out.join("\n");

  // 2. Quoted references inside prose.
  result = result.replace(QUOTED_REF, (whole, title) => {
    if (titleMatches(title, titles)) { kept++; return whole; }
    removed.push(title.trim());
    return "a DTU I could not find";
  });

  // 3. Raw ids.
  result = result.replace(ID_RE, (id) => {
    if (ids.has(id.toLowerCase())) { kept++; return id; }
    removed.push(id);
    return "[unknown DTU]";
  });

  if (!removed.length) return { text, removed, kept };

  if (asksAboutOwnDtus(prompt) && kept === 0) {
    const topic = topicOf(prompt);
    const have = Array.from(titles).filter((t) => !/^(?:AI|User|Chat):\s/.test(t)).slice(0, 5);
    const lead = `I didn't find any DTUs${topic ? ` about ${topic}` : ""} in what I retrieved for this question, so I can't cite any.`;
    const tail = have.length ? `\n\nThe DTUs that did come back were: ${have.map((t) => `"${t}"`).join(", ")}.` : "";
    return { text: `${lead}${tail}`, removed: Array.from(new Set(removed)), kept };
  }
  result = result.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
  result += `\n\n_Removed ${removed.length} DTU reference${removed.length === 1 ? "" : "s"} that did not match anything retrieved for this answer._`;
  return { text: result, removed: Array.from(new Set(removed)), kept };
}
