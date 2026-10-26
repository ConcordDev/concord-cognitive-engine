/**
 * When chat's dtu.get comes back "DTU not found", try the next id from a
 * dtu.search result already in this turn. A stale or invisible first hit
 * must not end the turn as "I couldn't complete run_lens_action" while a
 * later hit would have resolved.
 */

export function isDtuGetNotFound(result) {
  if (!result || result.ok !== false) return false;
  if (String(result.domain || "") !== "dtu") return false;
  if (!/^get$/i.test(String(result.action || ""))) return false;
  const err = `${result.error || ""} ${result.result?.error || ""}`;
  return /not found/i.test(err);
}

export function collectSearchHitIds(toolResults) {
  const ids = [];
  for (const row of toolResults || []) {
    const dtus = row?.result?.dtus;
    if (!Array.isArray(dtus)) continue;
    const domain = String(row.domain || "");
    const action = String(row.action || "");
    const isSearch = domain === "dtu" && /search/i.test(action);
    if (!isSearch && !row.result?.query) continue;
    for (const dtu of dtus) {
      if (dtu?.id) ids.push(String(dtu.id));
    }
  }
  return ids;
}

export function nextDtuGetId(toolResults, usedIds) {
  const used = new Set((usedIds || []).map(String));
  for (const row of toolResults || []) {
    if (String(row?.domain || "") !== "dtu") continue;
    if (!/^get$/i.test(String(row?.action || ""))) continue;
    const id = row?.input?.id || row?.result?.dtu?.id;
    if (id) used.add(String(id));
  }
  return collectSearchHitIds(toolResults).find((id) => !used.has(id)) || null;
}

export async function fallThroughDtuGet(result, prior, retryGet) {
  if (!isDtuGetNotFound(result) || typeof retryGet !== "function") return result;
  const failedId = String(result?.input?.id || "");
  const used = failedId ? [failedId] : [];
  let current = result;
  for (let i = 0; i < 5 && isDtuGetNotFound(current); i++) {
    const nextId = nextDtuGetId([...(prior || []), current], used);
    if (!nextId) break;
    used.push(nextId);
    const retry = await retryGet(nextId);
    if (retry?.ok) return { ...retry, fellThroughFrom: failedId || used[0] };
    current = retry || current;
  }
  return result;
}
