/**
 * Offline synonym expansion for retrieval.
 *
 * SYN_MAP used to be a frozen plain object. Query tokens are looked up
 * directly, and stemLite("constructors") is "constructor". On a plain
 * object that key is Object.prototype.constructor — a function — so
 * `for (const s of syns)` threw `syns is not iterable` and runMacro
 * surfaced it as macro_uncaught_throw before the LLM was called.
 * The same throw hits "toString", "__proto__", "valueOf", and
 * "hasOwnProperty" when those strings are used as keys.
 *
 * One bad token degrades to "no synonyms for that token". It does not
 * abort the rest of the expansion.
 */

import { nullDict, ownArray } from "./own-lookup.js";

export const SYN_MAP = Object.freeze(nullDict({
  "talk": ["chat", "conversation", "dialogue"],
  "chat": ["talk", "conversation", "dialogue"],
  "conversation": ["chat", "talk", "dialogue"],
  "help": ["assist", "support", "aid"],
  "fix": ["repair", "patch", "resolve"],
  "bug": ["issue", "error", "problem"],
  "search": ["retrieve", "lookup", "find"],
  "retrieve": ["search", "lookup", "find"],
  "dtu": ["dtus", "unit", "thought"],
  "dtus": ["dtu", "units", "thoughts"],
  "offline": ["local", "local-first", "no-llm"],
  "static": ["canned", "repetitive", "monotone"],
  "dynamic": ["adaptive", "responsive", "fluid"],
  "meaning": ["semantics", "intent", "sense"],
  "synonym": ["similar", "equivalent", "alias"],
  "topic": ["subject", "theme", "thread"],
  "recency": ["recent", "fresh", "new"],
  "recent": ["recency", "fresh", "new"],
}));

/** Own synonym array for this exact key, or null. */
export function synonymsFor(token, map = SYN_MAP) {
  return ownArray(map, token);
}

/**
 * Walk a synonym list. Non-arrays (including inherited functions) are
 * skipped. A throw inside fn skips that one entry.
 */
export function forEachSynonym(list, fn) {
  if (!Array.isArray(list) || typeof fn !== "function") return;
  for (const s of list) {
    try { fn(s); } catch { /* one bad synonym does not abort the list */ }
  }
}

/**
 * Stem each token and union its synonyms.
 * A token whose lookup or stem throws contributes nothing and the
 * remaining tokens still expand.
 *
 * Lookup matches the historical `MAP[token] || MAP[stem(token)]`:
 * an own array (even empty) wins over the stemmed key.
 *
 * @param {unknown} tokens
 * @param {(t: unknown) => string} [stem]
 * @param {object} [map]
 * @returns {string[]}
 */
export function expandTokenList(tokens, stem, map = SYN_MAP) {
  const stemFn = typeof stem === "function" ? stem : (x) => String(x ?? "");
  const out = new Set();
  const list = Array.isArray(tokens) ? tokens : [];
  for (const raw of list) {
    let stemmed = "";
    try { stemmed = stemFn(raw); } catch { stemmed = ""; }
    if (stemmed) out.add(stemmed);
    let syns = null;
    try {
      const direct = synonymsFor(raw, map);
      const viaStem = synonymsFor(stemmed, map);
      syns = Array.isArray(direct) ? direct : (Array.isArray(viaStem) ? viaStem : null);
    } catch { syns = null; }
    forEachSynonym(syns, (s) => {
      const ss = stemFn(s);
      if (ss) out.add(ss);
    });
  }
  return Array.from(out).slice(0, 256);
}
