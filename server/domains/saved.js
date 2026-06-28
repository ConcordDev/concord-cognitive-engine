// server/domains/saved.js
//
// saved lens — parity vs Twitter/X Bookmarks + Pocket.
//
// The legacy /api/social/bookmarks surface only ever held social posts.
// This domain is the cross-lens saved-items substrate: it can save any
// kind of thing (social posts, DTUs, articles, lens artifacts), organise
// them into folders/collections, tag them freeform, search/sort/filter,
// flip read-later / archive states, and export the whole list.
//
// Registration: this domain registers through the canonical `register`
// (MACROS) registry — `registerSavedMacros(register)` in server.js — so the
// macros are reachable both via POST /api/lens/run AND via runMacro (which
// the contract engine + macro-assassin drive). Handlers use the canonical
// 2-arg `(ctx, input)` convention and return a `{ ok, result }` envelope
// (the dispatcher's `_unwrapLensEnvelope` strips the `result` layer so the
// frontend reads `r.data.result.<field>`).
//
// Persistence: globalThis._concordSTATE.savedLens — two Maps keyed by
// userId:
//   items[userId]   -> Map(itemId -> savedItem)
//   folders[userId] -> Map(folderId -> folder)
//
// Every handler self-scopes by ctx.actor.userId; anonymous calls return
// { ok:false, error:'no_user' } so nothing leaks across users. Handlers
// never throw — every body is wrapped in try/catch.

const MAX_TAG_LEN = 40;
const MAX_TAGS = 24;
const MAX_NOTE_LEN = 2000;
const MAX_TITLE_LEN = 400;
const VALID_KINDS = ["post", "dtu", "article", "artifact", "link", "other"];
const VALID_STATES = ["unread", "read", "archived"];

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE reading.
// Fail-CLOSED: a clamped poisoned `limit`/`offset` that returns ok:true is the
// defect the macro-assassin's V2 vector catches. An absent/null field is fine.
// Returns null when clean, else the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

function persist() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}

function getSavedState() {
  const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!STATE.savedLens) STATE.savedLens = {};
  const s = STATE.savedLens;
  if (!(s.items instanceof Map)) s.items = new Map();
  if (!(s.folders instanceof Map)) s.folders = new Map();
  return s;
}

function userItems(userId) {
  const s = getSavedState();
  if (!(s.items.get(userId) instanceof Map)) s.items.set(userId, new Map());
  return s.items.get(userId);
}

function userFolders(userId) {
  const s = getSavedState();
  if (!(s.folders.get(userId) instanceof Map)) s.folders.set(userId, new Map());
  return s.folders.get(userId);
}

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || null;
}

function cleanTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const tag = String(t || "").trim().toLowerCase().replace(/^#/, "");
    if (!tag || tag.length > MAX_TAG_LEN || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function publicItem(it) {
  return {
    id: it.id,
    kind: it.kind,
    refId: it.refId,
    title: it.title,
    url: it.url,
    author: it.author,
    excerpt: it.excerpt,
    mediaType: it.mediaType,
    folderId: it.folderId,
    tags: [...it.tags],
    note: it.note,
    state: it.state,
    sourceLens: it.sourceLens,
    savedAt: it.savedAt,
    updatedAt: it.updatedAt,
    readAt: it.readAt || null,
  };
}

export default function registerSavedMacros(register) {
  // --------------------------------------------------------------------
  // saved.add — save any item (post / dtu / article / artifact / link).
  // input: { kind, refId?, title, url?, author?, excerpt?, mediaType?,
  //          folderId?, tags?, note?, sourceLens? }
  // --------------------------------------------------------------------
  register("saved", "add", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const p = input || {};
      const kind = VALID_KINDS.includes(p.kind) ? p.kind : "other";
      const title = String(p.title || "").trim().slice(0, MAX_TITLE_LEN);
      if (!title && !p.refId && !p.url) {
        return { ok: false, error: "need_title_or_ref" };
      }
      const items = userItems(userId);
      const refId = p.refId ? String(p.refId) : null;
      // Dedupe by (kind, refId) when a refId is supplied.
      if (refId) {
        for (const existing of items.values()) {
          if (existing.kind === kind && existing.refId === refId) {
            return { ok: true, result: { item: publicItem(existing), deduped: true } };
          }
        }
      }
      const folders = userFolders(userId);
      const folderId = p.folderId && folders.has(p.folderId) ? p.folderId : null;
      const now = new Date().toISOString();
      const item = {
        id: uid("svd"),
        kind,
        refId,
        title: title || (p.url ? String(p.url).slice(0, MAX_TITLE_LEN) : "Untitled"),
        url: p.url ? String(p.url).slice(0, 1000) : null,
        author: p.author ? String(p.author).slice(0, 200) : null,
        excerpt: p.excerpt ? String(p.excerpt).slice(0, 1000) : null,
        mediaType: p.mediaType ? String(p.mediaType).slice(0, 40) : "text",
        folderId,
        tags: cleanTags(p.tags),
        note: p.note ? String(p.note).slice(0, MAX_NOTE_LEN) : "",
        state: VALID_STATES.includes(p.state) ? p.state : "unread",
        sourceLens: p.sourceLens ? String(p.sourceLens).slice(0, 60) : null,
        savedAt: now,
        updatedAt: now,
        readAt: null,
      };
      items.set(item.id, item);
      persist();
      return { ok: true, result: { item: publicItem(item), deduped: false } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "save any item (post/dtu/article/artifact/link) for the caller" });

  // --------------------------------------------------------------------
  // saved.remove — delete a saved item.  input: { id }
  // --------------------------------------------------------------------
  register("saved", "remove", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const id = String(input?.id || "");
      if (!id) return { ok: false, error: "need_id" };
      const items = userItems(userId);
      if (!items.has(id)) return { ok: false, error: "not_found" };
      items.delete(id);
      persist();
      return { ok: true, result: { removed: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "remove a saved item by id" });

  // --------------------------------------------------------------------
  // saved.update — patch an item (folder, tags, note, state, title…).
  // input: { id, ...patch }
  // --------------------------------------------------------------------
  register("saved", "update", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const id = String(input?.id || "");
      if (!id) return { ok: false, error: "need_id" };
      const items = userItems(userId);
      const item = items.get(id);
      if (!item) return { ok: false, error: "not_found" };
      const p = input || {};
      if (typeof p.title === "string") {
        item.title = p.title.trim().slice(0, MAX_TITLE_LEN) || item.title;
      }
      if (typeof p.note === "string") item.note = p.note.slice(0, MAX_NOTE_LEN);
      if (Array.isArray(p.tags)) item.tags = cleanTags(p.tags);
      if ("folderId" in p) {
        const folders = userFolders(userId);
        item.folderId = p.folderId && folders.has(p.folderId) ? p.folderId : null;
      }
      if (p.state && VALID_STATES.includes(p.state)) {
        item.state = p.state;
        item.readAt = p.state === "read" || p.state === "archived"
          ? new Date().toISOString()
          : null;
      }
      item.updatedAt = new Date().toISOString();
      persist();
      return { ok: true, result: { item: publicItem(item) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "patch a saved item (folder/tags/note/state/title)" });

  // --------------------------------------------------------------------
  // saved.list — search / sort / filter the caller's saved items.
  // input: { query?, kind?, mediaType?, folderId?, tag?, state?,
  //          sortBy? ('savedAt'|'title'|'author'|'updatedAt'),
  //          order? ('asc'|'desc'), limit?, offset? }
  // --------------------------------------------------------------------
  register("saved", "list", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const p = input || {};
      const badNum = badNumericField(p, ["limit", "offset"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      let rows = [...userItems(userId).values()];
      const total = rows.length;

      const query = String(p.query || "").trim().toLowerCase();
      if (query) {
        rows = rows.filter((it) => {
          const hay = [
            it.title, it.author, it.excerpt, it.note, it.url,
            it.tags.join(" "),
          ].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(query);
        });
      }
      if (p.kind && VALID_KINDS.includes(p.kind)) {
        rows = rows.filter((it) => it.kind === p.kind);
      }
      if (p.mediaType) {
        rows = rows.filter((it) => it.mediaType === p.mediaType);
      }
      if ("folderId" in p) {
        if (p.folderId === null || p.folderId === "__none__") {
          rows = rows.filter((it) => !it.folderId);
        } else if (p.folderId) {
          rows = rows.filter((it) => it.folderId === p.folderId);
        }
      }
      if (p.tag) {
        const tag = String(p.tag).trim().toLowerCase().replace(/^#/, "");
        rows = rows.filter((it) => it.tags.includes(tag));
      }
      if (p.state && VALID_STATES.includes(p.state)) {
        rows = rows.filter((it) => it.state === p.state);
      }

      const matched = rows.length;
      const sortBy = ["savedAt", "title", "author", "updatedAt"].includes(p.sortBy)
        ? p.sortBy : "savedAt";
      const order = p.order === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const av = a[sortBy] || "";
        const bv = b[sortBy] || "";
        if (av < bv) return -1 * order;
        if (av > bv) return 1 * order;
        return 0;
      });

      const offset = Math.max(0, parseInt(p.offset, 10) || 0);
      const limit = Math.min(500, Math.max(1, parseInt(p.limit, 10) || 100));
      const page = rows.slice(offset, offset + limit);

      return {
        ok: true,
        result: {
          items: page.map(publicItem),
          total,
          matched,
          offset,
          limit,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "search/sort/filter the caller's saved items" });

  // --------------------------------------------------------------------
  // saved.stats — counts for the lens header (by state / kind / folder).
  // --------------------------------------------------------------------
  register("saved", "stats", (ctx, _input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const rows = [...userItems(userId).values()];
      const byState = { unread: 0, read: 0, archived: 0 };
      const byKind = {};
      const byMediaType = {};
      for (const it of rows) {
        byState[it.state] = (byState[it.state] || 0) + 1;
        byKind[it.kind] = (byKind[it.kind] || 0) + 1;
        byMediaType[it.mediaType] = (byMediaType[it.mediaType] || 0) + 1;
      }
      return {
        ok: true,
        result: {
          total: rows.length,
          folders: userFolders(userId).size,
          byState,
          byKind,
          byMediaType,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "saved-item counts by state/kind/mediaType for the lens header" });

  // --------------------------------------------------------------------
  // saved.tags — distinct tags with usage counts, for tag chips/filter.
  // --------------------------------------------------------------------
  register("saved", "tags", (ctx, _input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const counts = new Map();
      for (const it of userItems(userId).values()) {
        for (const t of it.tags) counts.set(t, (counts.get(t) || 0) + 1);
      }
      const tags = [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      return { ok: true, result: { tags } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "distinct tags with usage counts" });

  // --------------------------------------------------------------------
  // FOLDERS / COLLECTIONS
  // --------------------------------------------------------------------
  register("saved", "folderCreate", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const name = String(input?.name || "").trim().slice(0, 120);
      if (!name) return { ok: false, error: "need_name" };
      const folders = userFolders(userId);
      for (const f of folders.values()) {
        if (f.name.toLowerCase() === name.toLowerCase()) {
          return { ok: false, error: "duplicate_name" };
        }
      }
      const now = new Date().toISOString();
      const folder = {
        id: uid("fld"),
        name,
        color: input?.color ? String(input.color).slice(0, 20) : "amber",
        description: input?.description
          ? String(input.description).slice(0, 400) : "",
        createdAt: now,
      };
      folders.set(folder.id, folder);
      persist();
      return { ok: true, result: { folder } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "create a saved-items collection/folder" });

  register("saved", "folderUpdate", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const id = String(input?.id || "");
      if (!id) return { ok: false, error: "need_id" };
      const folders = userFolders(userId);
      const folder = folders.get(id);
      if (!folder) return { ok: false, error: "not_found" };
      if (typeof input.name === "string" && input.name.trim()) {
        folder.name = input.name.trim().slice(0, 120);
      }
      if (typeof input.color === "string") {
        folder.color = input.color.slice(0, 20);
      }
      if (typeof input.description === "string") {
        folder.description = input.description.slice(0, 400);
      }
      persist();
      return { ok: true, result: { folder } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "rename/recolour a collection" });

  register("saved", "folderDelete", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const id = String(input?.id || "");
      if (!id) return { ok: false, error: "need_id" };
      const folders = userFolders(userId);
      if (!folders.has(id)) return { ok: false, error: "not_found" };
      folders.delete(id);
      // Unfile any items that referenced it.
      let unfiled = 0;
      for (const it of userItems(userId).values()) {
        if (it.folderId === id) {
          it.folderId = null;
          it.updatedAt = new Date().toISOString();
          unfiled++;
        }
      }
      persist();
      return { ok: true, result: { deleted: id, unfiled } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "delete a collection and unfile its items" });

  register("saved", "folderList", (ctx, _input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const items = [...userItems(userId).values()];
      const folders = [...userFolders(userId).values()].map((f) => ({
        ...f,
        itemCount: items.filter((it) => it.folderId === f.id).length,
      }));
      folders.sort((a, b) => a.name.localeCompare(b.name));
      const unfiledCount = items.filter((it) => !it.folderId).length;
      return { ok: true, result: { folders, unfiledCount } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "list collections with per-folder item counts" });

  // --------------------------------------------------------------------
  // saved.export — full dump of the caller's saved list (JSON or CSV).
  // input: { format? ('json'|'csv') }
  // --------------------------------------------------------------------
  register("saved", "export", (ctx, input = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_user" };
      const items = [...userItems(userId).values()]
        .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
        .map(publicItem);
      const folders = [...userFolders(userId).values()];
      const format = input?.format === "csv" ? "csv" : "json";
      const exportedAt = new Date().toISOString();

      if (format === "csv") {
        const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const header = [
          "id", "kind", "title", "author", "url", "mediaType",
          "folderId", "tags", "state", "savedAt", "note",
        ];
        const lines = [header.join(",")];
        for (const it of items) {
          lines.push([
            it.id, it.kind, it.title, it.author, it.url, it.mediaType,
            it.folderId, it.tags.join("|"), it.state, it.savedAt, it.note,
          ].map(esc).join(","));
        }
        return {
          ok: true,
          result: {
            format: "csv",
            filename: `saved-${exportedAt.slice(0, 10)}.csv`,
            content: lines.join("\n"),
            count: items.length,
            exportedAt,
          },
        };
      }

      return {
        ok: true,
        result: {
          format: "json",
          filename: `saved-${exportedAt.slice(0, 10)}.json`,
          content: JSON.stringify({ exportedAt, folders, items }, null, 2),
          count: items.length,
          exportedAt,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "export the caller's saved list as JSON or CSV" });
}
