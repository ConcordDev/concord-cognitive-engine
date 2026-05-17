// server/lib/federation-peer-discovery.js
//
// Phase 13 (Stage D) — NodeInfo 2.1 peer-instance discovery.
//
// `probePeerInstance(db, baseUrl)` does the standard two-hop fetch:
//   1. GET {baseUrl}/.well-known/nodeinfo
//      → expect { links: [{ rel, href }] }
//      → pick rel ending in "/2.1" (fall back to .0/.1 if 2.1 absent)
//   2. GET {href}
//      → expect { software: { name, version }, protocols, usage }
//      → upsert into federation_peer_instances
//
// Mastodon, Lemmy, Misskey, Pleroma, and others all serve this — using
// the spec means peer discovery works out-of-the-box across the Fediverse.

const PROBE_TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function pickNodeInfoHref(links) {
  if (!Array.isArray(links)) return null;
  // Prefer 2.1 then 2.0 then 1.x.
  const rank = (rel) =>
    rel?.endsWith("/2.1") ? 3 :
    rel?.endsWith("/2.0") ? 2 :
    rel?.endsWith("/1.1") ? 1 :
    rel?.endsWith("/1.0") ? 0 : -1;
  let best = null;
  let bestScore = -1;
  for (const l of links) {
    const s = rank(l?.rel);
    if (s > bestScore && typeof l?.href === "string") { best = l.href; bestScore = s; }
  }
  return best;
}

/**
 * Probe a peer instance via NodeInfo 2.1. Upserts the row in
 * `federation_peer_instances` with the freshly discovered metadata.
 * Best-effort — failures mark the row as unreachable but never throw.
 */
export async function probePeerInstance(db, baseUrl) {
  if (!db) return { ok: false, reason: "no_db" };
  if (typeof baseUrl !== "string" || !baseUrl.startsWith("http")) {
    return { ok: false, reason: "invalid_base_url" };
  }
  const trimmed = baseUrl.replace(/\/+$/, "");
  const nodeInfoIndex = `${trimmed}/.well-known/nodeinfo`;
  const nowSec = Math.floor(Date.now() / 1000);

  let nodeInfo;
  let err = null;
  try {
    const index = await fetchJson(nodeInfoIndex);
    const href = pickNodeInfoHref(index?.links);
    if (!href) throw new Error("no_nodeinfo_href");
    nodeInfo = await fetchJson(href);
  } catch (e) {
    err = String(e?.message || e);
  }

  if (err || !nodeInfo) {
    upsertPeerStatus(db, trimmed, "unreachable", err, nowSec);
    return { ok: false, baseUrl: trimmed, reason: "probe_failed", error: err };
  }

  const softwareName = nodeInfo?.software?.name || null;
  const softwareVersion = nodeInfo?.software?.version || null;
  const capabilities = {
    protocols: nodeInfo?.protocols || [],
    openRegistrations: nodeInfo?.openRegistrations === true,
    usage: nodeInfo?.usage || null,
  };

  try {
    db.prepare(`
      INSERT INTO federation_peer_instances
        (base_url, software_name, software_version, capabilities_json, status, last_seen_at, last_probe_at, last_error)
      VALUES (?, ?, ?, ?, 'active', ?, ?, NULL)
      ON CONFLICT(base_url) DO UPDATE SET
        software_name = excluded.software_name,
        software_version = excluded.software_version,
        capabilities_json = excluded.capabilities_json,
        status = 'active',
        last_seen_at = excluded.last_seen_at,
        last_probe_at = excluded.last_probe_at,
        last_error = NULL
    `).run(trimmed, softwareName, softwareVersion, JSON.stringify(capabilities), nowSec, nowSec);
  } catch (e) {
    return { ok: false, reason: "upsert_failed", error: e?.message };
  }
  return { ok: true, baseUrl: trimmed, softwareName, softwareVersion, capabilities };
}

function upsertPeerStatus(db, baseUrl, status, lastError, nowSec) {
  try {
    db.prepare(`
      INSERT INTO federation_peer_instances (base_url, status, last_probe_at, last_error)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(base_url) DO UPDATE SET
        status = excluded.status,
        last_probe_at = excluded.last_probe_at,
        last_error = excluded.last_error
    `).run(baseUrl, status, nowSec, lastError);
  } catch { /* ignore — table may not exist on minimal test DBs */ }
}

/**
 * List known peer instances for the federation lens. Active by default;
 * pass `{ all: true }` to include unreachable + banned.
 */
export function listPeerInstances(db, { all = false, limit = 100 } = {}) {
  if (!db) return [];
  try {
    const where = all ? "" : `WHERE status = 'active'`;
    return db.prepare(`
      SELECT base_url, name, software_name, software_version, capabilities_json,
             status, first_seen_at, last_seen_at, last_probe_at, last_error
      FROM federation_peer_instances
      ${where}
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(limit);
  } catch { return []; }
}

export { pickNodeInfoHref };
