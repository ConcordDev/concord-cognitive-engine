/**
 * World Bank catalog search — relevance-ranked.
 *
 * The WB indicator registry has no server-side text filter, so the
 * society domain pulls pages and filters locally. Kept as a pure
 * function (the wbJson transport is injected) so the domain and the
 * tests share one implementation.
 *
 * Ranking matters: returning matches in raw catalog order buried
 * exact hits under whatever the first page matched, and stopping the
 * scan at the result limit meant deep-catalog codes were never seen.
 * Matches are therefore collected across the whole scan, scored
 * (exact code → code prefix → name prefix → code fragment → name
 * fragment), de-duplicated, and only then truncated to the limit.
 * A code-shaped query ("SP.POP.TOTL") additionally gets a direct
 * registry lookup, since the paged scan may never reach its page.
 */

export function scoreIndicatorMatch(id, name, query) {
  const idL = String(id || "").toLowerCase();
  const nameL = String(name || "").toLowerCase();
  if (!nameL.includes(query) && !idL.includes(query)) return -1;
  if (idL === query) return 0;
  if (idL.startsWith(query)) return 1;
  if (nameL.startsWith(query)) return 2;
  if (idL.includes(query)) return 3;
  return 4;
}

export async function searchIndicatorCatalog(wbJson, wbBase, query, limit) {
  const scored = [];
  const pushMatch = (ind) => {
    if (!ind) return;
    const score = scoreIndicatorMatch(ind.id, ind.name, query);
    if (score < 0) return;
    scored.push({
      score,
      match: {
        code: String(ind.id || ""),
        name: String(ind.name || ""),
        source: ind.source?.value || null,
        topics: Array.isArray(ind.topics) ? ind.topics.map((t) => t.value).filter(Boolean) : [],
      },
    });
  };

  if (/^[\w.]{3,}$/.test(query) && query.includes(".")) {
    try {
      const one = await wbJson(`${wbBase}/indicator/${encodeURIComponent(query.toUpperCase())}?format=json`);
      const hit = (one && one[1] && one[1][0]) || null;
      if (hit && String(hit.id || "").toLowerCase() === query) pushMatch(hit);
    } catch { /* direct lookup is best-effort; the scan still runs */ }
  }

  for (let page = 1; page <= 6; page++) {
    const json = await wbJson(`${wbBase}/indicator?format=json&per_page=500&page=${page}`);
    const list = json[1] || [];
    for (const ind of list) pushMatch(ind);
    if (!list.length) break;
  }

  const seen = new Set();
  return scored
    .sort((a, b) => a.score - b.score)
    .map((s) => s.match)
    .filter((m) => (seen.has(m.code) ? false : (seen.add(m.code), true)))
    .slice(0, limit);
}
