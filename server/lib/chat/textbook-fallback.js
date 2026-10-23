/**
 * textbook_lookup → web_search fallback. OpenStax search returns its nearest
 * sections even when none states the fact (live: "Young's modulus of steel"
 * came back as three passages without "steel"; the model then answered from
 * memory). When no passage carries every key term of the query, the agent
 * loop runs web_search for the same query in that turn.
 */
const STOP = new Set([
  "what", "which", "whats", "the", "for", "and", "with", "from", "that", "this", "per", "according",
  "value", "values", "formula", "equation", "textbook", "openstax", "book", "source", "typical",
  "does", "how", "much", "many", "about", "into", "give", "tell", "find", "look", "show", "explain",
]);

export function keyTerms(query) {
  return [...new Set(String(query || "").toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z0-9.-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** True when the textbook result should be backed by a web search. */
export function textbookNeedsWeb(result) {
  if (!result || result.tool !== "textbook_lookup") return false;
  if (!result.ok) return true;
  const rows = Array.isArray(result.results) ? result.results : [];
  if (!rows.length) return true;
  const terms = keyTerms(result.query);
  if (!terms.length) return false;
  const stem = (w) => w.replace(/(?:ing|es|s)$/, "");
  return !rows.some((r) => {
    const hay = `${r.section || ""} ${r.passage || ""}`.toLowerCase();
    return terms.every((t) => hay.includes(stem(t)));
  });
}
