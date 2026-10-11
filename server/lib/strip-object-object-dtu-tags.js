// Dry-run-by-default removal of the "[object object]" DTU tag.
// Case-insensitive. Only that tag is removed. No other column is written.

import { isObjectCoercionTag } from "./dtu-tags.js";

function tableExists(db, name) {
  return !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name);
}

function columnSet(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

function parseArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stripList(tags) {
  if (!Array.isArray(tags)) return { next: tags, removed: 0 };
  const next = [];
  let removed = 0;
  for (const t of tags) {
    if (isObjectCoercionTag(t)) removed += 1;
    else next.push(t);
  }
  return { next, removed };
}

function titleOf(row, dataObj) {
  if (typeof row?.title === "string" && row.title) return row.title;
  if (typeof dataObj?.title === "string" && dataObj.title) return dataObj.title;
  return null;
}

function consider(hits, table, id, title, ...lists) {
  if (lists.some((list) => list.removed > 0)) {
    hits.push({ table, id, title });
  }
}

function collect(db) {
  const hits = [];

  if (tableExists(db, "dtu_store")) {
    const cols = columnSet(db, "dtu_store");
    const select = ["id"];
    if (cols.has("title")) select.push("title");
    if (cols.has("tags")) select.push("tags");
    if (cols.has("data")) select.push("data");
    const rows = db.prepare(`SELECT ${select.join(", ")} FROM dtu_store`).all();
    for (const row of rows) {
      let dataObj = null;
      if (cols.has("data") && typeof row.data === "string") {
        try { dataObj = JSON.parse(row.data); } catch { dataObj = null; }
      }
      const tagList = cols.has("tags") ? parseArray(row.tags) : null;
      const dataTags = dataObj && Array.isArray(dataObj.tags) ? dataObj.tags : null;
      consider(
        hits,
        "dtu_store",
        row.id,
        titleOf(row, dataObj),
        stripList(tagList),
        stripList(dataTags),
      );
    }
  }

  if (tableExists(db, "dtus")) {
    const cols = columnSet(db, "dtus");
    const select = ["id"];
    if (cols.has("title")) select.push("title");
    if (cols.has("tags_json")) select.push("tags_json");
    if (cols.has("data")) select.push("data");
    const rows = db.prepare(`SELECT ${select.join(", ")} FROM dtus`).all();
    for (const row of rows) {
      let dataObj = null;
      if (cols.has("data") && typeof row.data === "string") {
        try { dataObj = JSON.parse(row.data); } catch { dataObj = null; }
      }
      const tagList = cols.has("tags_json") ? parseArray(row.tags_json) : null;
      const dataTags = dataObj && Array.isArray(dataObj.tags) ? dataObj.tags : null;
      consider(
        hits,
        "dtus",
        row.id,
        titleOf(row, dataObj),
        stripList(tagList),
        stripList(dataTags),
      );
    }
  }

  return hits;
}

function rewriteJsonTags(raw, apply) {
  if (typeof raw !== "string" || !raw) return { sql: null, removed: 0 };
  let obj;
  try { obj = JSON.parse(raw); } catch { return { sql: null, removed: 0 }; }
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.tags)) return { sql: null, removed: 0 };
  const stripped = stripList(obj.tags);
  if (!stripped.removed || !apply) return { sql: null, removed: stripped.removed };
  obj.tags = stripped.next;
  return { sql: JSON.stringify(obj), removed: stripped.removed };
}

function rewriteArrayColumn(raw, apply) {
  const list = parseArray(raw);
  const stripped = stripList(list);
  if (!stripped.removed || !apply) return { sql: null, removed: stripped.removed };
  return { sql: JSON.stringify(stripped.next), removed: stripped.removed };
}

function applyOne(db, hit) {
  if (hit.table === "dtu_store") {
    const cols = columnSet(db, "dtu_store");
    const select = [];
    if (cols.has("tags")) select.push("tags");
    if (cols.has("data")) select.push("data");
    if (!select.length) return false;
    const row = db.prepare(`SELECT ${select.join(", ")} FROM dtu_store WHERE id = ?`).get(hit.id);
    if (!row) return false;
    const sets = [];
    const params = [];
    if (cols.has("tags")) {
      const next = rewriteArrayColumn(row.tags, true);
      if (next.sql != null) { sets.push("tags = ?"); params.push(next.sql); }
    }
    if (cols.has("data")) {
      const next = rewriteJsonTags(row.data, true);
      if (next.sql != null) { sets.push("data = ?"); params.push(next.sql); }
    }
    if (!sets.length) return false;
    params.push(hit.id);
    db.prepare(`UPDATE dtu_store SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return true;
  }

  if (hit.table === "dtus") {
    const cols = columnSet(db, "dtus");
    const select = [];
    if (cols.has("tags_json")) select.push("tags_json");
    if (cols.has("data")) select.push("data");
    if (!select.length) return false;
    const row = db.prepare(`SELECT ${select.join(", ")} FROM dtus WHERE id = ?`).get(hit.id);
    if (!row) return false;
    const sets = [];
    const params = [];
    if (cols.has("tags_json")) {
      const next = rewriteArrayColumn(row.tags_json, true);
      if (next.sql != null) { sets.push("tags_json = ?"); params.push(next.sql); }
    }
    if (cols.has("data")) {
      const next = rewriteJsonTags(row.data, true);
      if (next.sql != null) { sets.push("data = ?"); params.push(next.sql); }
    }
    if (!sets.length) return false;
    params.push(hit.id);
    db.prepare(`UPDATE dtus SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return true;
  }

  return false;
}

/**
 * List DTUs carrying the coercion tag. Writes nothing unless apply is set,
 * and then only the tag arrays that contain it.
 */
export function stripObjectObjectTags(db, { apply = false } = {}) {
  const dtus = collect(db);
  if (!apply) return { dryRun: true, count: dtus.length, applied: 0, dtus };
  const applied = db.transaction((items) => {
    let n = 0;
    for (const item of items) if (applyOne(db, item)) n += 1;
    return n;
  })(dtus);
  return { dryRun: false, count: dtus.length, applied, dtus };
}
