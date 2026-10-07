// The frontier card opens a link, then a bearing, then a mark.
// The cross-world feed and the royalty window stay off this domain.
// List returns id and name. The bearing and the mark come back
// only from link-detail. The in-memory bag is not on the shared
// lens-state key list, so the sqlite row is the restart record.

function linkState() {
  const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!STATE.concordLinkFrontier || !(STATE.concordLinkFrontier.links instanceof Map)) {
    STATE.concordLinkFrontier = { links: new Map() };
  }
  return STATE.concordLinkFrontier;
}

function linkDb(ctx) {
  return ctx?.db || globalThis._concordSTATE?.db || null;
}

function linksReady(db) {
  if (!db || typeof db.prepare !== "function") return false;
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='concord_link_frontier_links'").get();
  } catch (_e) {
    return false;
  }
}

function linkActor(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "";
}

function linkClean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function linkNow() {
  return new Date().toISOString();
}

function linkId() {
  return `lk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function linkBucket(userId) {
  const st = linkState();
  if (!st.links.has(userId)) st.links.set(userId, []);
  return st.links.get(userId);
}

function linkFromRow(row) {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name || !row.id) return null;
  const bearing = typeof row.bearing === "string" ? row.bearing : "";
  const mark = typeof row.mark === "string" && row.mark.trim() ? row.mark : null;
  return {
    id: row.id,
    name,
    bearing,
    mark,
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

function readLinkRows(ctx, userId) {
  const db = linkDb(ctx);
  if (!linksReady(db)) return [];
  return db.prepare(
    "SELECT id, name, bearing, mark, created_at, updated_at FROM concord_link_frontier_links WHERE user_id = ? ORDER BY created_at ASC, id ASC",
  ).all(userId);
}

function writeLinkRow(ctx, userId, link) {
  const db = linkDb(ctx);
  if (!linksReady(db)) {
    const err = new Error("link_not_saved");
    err.code = "link_not_saved";
    throw err;
  }
  db.prepare(`
    INSERT INTO concord_link_frontier_links
      (id, user_id, name, bearing, mark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      bearing = excluded.bearing,
      mark = excluded.mark,
      updated_at = excluded.updated_at
  `).run(
    link.id,
    userId,
    link.name,
    link.bearing,
    link.mark,
    link.createdAt,
    link.updatedAt,
  );
}

function hydrateLinks(ctx, userId) {
  const bucket = linkBucket(userId);
  const seen = new Set(bucket.map((item) => item.id));
  for (const row of readLinkRows(ctx, userId)) {
    if (!row?.id || seen.has(row.id)) continue;
    const link = linkFromRow(row);
    if (!link) continue;
    bucket.push(link);
    seen.add(link.id);
  }
  return bucket;
}

function findLink(ctx, userId, id) {
  const live = linkBucket(userId).find((item) => item.id === id);
  if (live) return live;
  return hydrateLinks(ctx, userId).find((item) => item.id === id) || null;
}

function orderedLinks(ctx, userId) {
  return hydrateLinks(ctx, userId)
    .filter((item) => item.name)
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
}

function linkFace(link) {
  return { id: link.id, name: link.name };
}

export default function registerConcordLinkFrontierActions(registerLensAction) {
  registerLensAction("concord-link-frontier", "link-open", (ctx, _artifact, params = {}) => {
    try {
      const userId = linkActor(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const name = linkClean(params.name, 4000);
      if (!name) return { ok: false, error: "name required" };
      const now = linkNow();
      const link = {
        id: linkId(),
        name,
        bearing: "",
        mark: null,
        createdAt: now,
        updatedAt: now,
      };
      const bucket = linkBucket(userId);
      bucket.push(link);
      try {
        writeLinkRow(ctx, userId, link);
      } catch (err) {
        const idx = bucket.findIndex((item) => item.id === link.id);
        if (idx >= 0) bucket.splice(idx, 1);
        return { ok: false, error: "link_not_saved", detail: String(err?.message || err) };
      }
      return { ok: true, result: { linkId: link.id, link: linkFace(link) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("concord-link-frontier", "link-list", (ctx, _artifact, _params) => {
    try {
      const userId = linkActor(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const links = orderedLinks(ctx, userId).map(linkFace);
      return { ok: true, result: { links, count: links.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("concord-link-frontier", "link-detail", (ctx, _artifact, params = {}) => {
    try {
      const userId = linkActor(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const id = linkClean(params.id || params.linkId, 80);
      if (!id) return { ok: false, error: "missing_link_id" };
      const link = findLink(ctx, userId, id);
      if (!link) return { ok: false, error: "link_not_found" };
      return {
        ok: true,
        result: {
          link: {
            id: link.id,
            name: link.name,
            bearing: link.bearing,
            mark: link.mark,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("concord-link-frontier", "link-bearing", (ctx, _artifact, params = {}) => {
    try {
      const userId = linkActor(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const id = linkClean(params.id || params.linkId, 80);
      if (!id) return { ok: false, error: "missing_link_id" };
      const bearing = linkClean(params.bearing, 8000);
      if (!bearing) return { ok: false, error: "bearing required" };
      const link = findLink(ctx, userId, id);
      if (!link) return { ok: false, error: "link_not_found" };
      const previous = link.bearing;
      const previousAt = link.updatedAt;
      link.bearing = bearing;
      link.updatedAt = linkNow();
      try {
        writeLinkRow(ctx, userId, link);
      } catch (err) {
        link.bearing = previous;
        link.updatedAt = previousAt;
        return { ok: false, error: "link_not_saved", detail: String(err?.message || err) };
      }
      return { ok: true, result: { linkId: link.id, link: linkFace(link) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("concord-link-frontier", "link-mark", (ctx, _artifact, params = {}) => {
    try {
      const userId = linkActor(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const id = linkClean(params.id || params.linkId, 80);
      if (!id) return { ok: false, error: "missing_link_id" };
      const mark = linkClean(params.mark, 8000);
      if (!mark) return { ok: false, error: "mark required" };
      const link = findLink(ctx, userId, id);
      if (!link) return { ok: false, error: "link_not_found" };
      const previous = link.mark;
      const previousAt = link.updatedAt;
      link.mark = mark;
      link.updatedAt = linkNow();
      try {
        writeLinkRow(ctx, userId, link);
      } catch (err) {
        link.mark = previous;
        link.updatedAt = previousAt;
        return { ok: false, error: "link_not_saved", detail: String(err?.message || err) };
      }
      return { ok: true, result: { linkId: link.id, link: linkFace(link) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
