// server/domains/docs-databases.js
//
// Docs Sprint C — Notion-DB-style structured pages.
//
// Each database row lives in doc_database_rows.properties_json keyed
// by column id. The schema defines column types; the macro layer
// validates inserts against the schema so bad data never lands. Six
// column types: text, number, select, multi_select, date, checkbox.

import { randomUUID } from "node:crypto";
import { hasRole } from "../lib/docs/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const COLUMN_TYPES = new Set(["text","number","select","multi_select","date","checkbox","url","email"]);

function _validateSchema(schema) {
  if (!Array.isArray(schema)) return { ok: false, reason: "schema_must_be_array" };
  const seen = new Set();
  for (const col of schema) {
    if (!col?.id || !col?.name) return { ok: false, reason: "column_needs_id_and_name" };
    if (!COLUMN_TYPES.has(col.type)) return { ok: false, reason: `unknown_type_${col.type}` };
    if (seen.has(col.id)) return { ok: false, reason: `duplicate_column_id_${col.id}` };
    seen.add(col.id);
  }
  return { ok: true };
}

function _coerceValue(col, raw) {
  if (raw == null) return null;
  switch (col.type) {
    case "text": return String(raw).slice(0, 5000);
    case "number": { const n = Number(raw); return Number.isFinite(n) ? n : null; }
    case "checkbox": return !!raw;
    case "date": return String(raw).slice(0, 32);
    case "select": return String(raw).slice(0, 200);
    case "multi_select": {
      if (!Array.isArray(raw)) return [];
      return raw.map((x) => String(x).slice(0, 200)).slice(0, 50);
    }
    case "url":
    case "email":
      return String(raw).slice(0, 1000);
    default: return null;
  }
}

export default function registerDocsDatabasesMacros(register) {

  register("docs", "database_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const schema = Array.isArray(input.schema) && input.schema.length > 0 ? input.schema : [
      { id: "title", name: "Title", type: "text" },
      { id: "status", name: "Status", type: "select", options: ["Backlog", "In progress", "Done"] },
    ];
    const v = _validateSchema(schema);
    if (!v.ok) return v;
    const id = `dbase:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO doc_databases (id, document_id, owner_id, name, schema_json, view_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, documentId, userId,
        String(input.name || "Untitled database").slice(0, 120),
        JSON.stringify(schema),
        input.view ? JSON.stringify(input.view) : null,
        _now(), _now());
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Create a structured-data database inside a document" });

  register("docs", "database_update_schema", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT document_id FROM doc_databases WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (!hasRole(db, row.document_id, userId, "editor")) return { ok: false, reason: "forbidden" };
    if (input.schema) {
      const v = _validateSchema(input.schema);
      if (!v.ok) return v;
    }
    const updates = [];
    const args = [];
    if (input.schema) { updates.push("schema_json = ?"); args.push(JSON.stringify(input.schema)); }
    if (input.name) { updates.push("name = ?"); args.push(String(input.name).slice(0, 120)); }
    if (input.view) { updates.push("view_json = ?"); args.push(JSON.stringify(input.view)); }
    if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
    updates.push("updated_at = ?"); args.push(_now());
    args.push(id);
    db.prepare(`UPDATE doc_databases SET ${updates.join(", ")} WHERE id = ?`).run(...args);
    return { ok: true };
  }, { destructive: true, note: "Update a database's schema, name, or view (editor+)" });

  register("docs", "database_list_for_doc", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`SELECT * FROM doc_databases WHERE document_id = ? ORDER BY created_at`).all(documentId);
    return {
      ok: true,
      databases: rows.map((r) => ({
        ...r,
        schema: _safeJson(r.schema_json, []),
        view: _safeJson(r.view_json, null),
      })),
    };
  }, { note: "List all databases attached to a document" });

  register("docs", "database_row_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const databaseId = String(input.databaseId || "");
    if (!databaseId) return { ok: false, reason: "databaseId_required" };
    const dbase = db.prepare(`SELECT document_id, schema_json FROM doc_databases WHERE id = ?`).get(databaseId);
    if (!dbase) return { ok: false, reason: "not_found" };
    if (!hasRole(db, dbase.document_id, userId, "editor")) return { ok: false, reason: "forbidden" };
    const schema = _safeJson(dbase.schema_json, []);
    const props = {};
    const raw = input.properties || {};
    for (const col of schema) {
      if (raw[col.id] !== undefined) props[col.id] = _coerceValue(col, raw[col.id]);
    }
    const id = `drow:${randomUUID()}`;
    const sortKey = Number(input.sortKey) || _now();
    db.prepare(`
      INSERT INTO doc_database_rows (id, database_id, properties_json, sort_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, databaseId, JSON.stringify(props), sortKey, _now(), _now());
    return { ok: true, id, properties: props };
  }, { destructive: true, note: "Add a row to a structured database (validated against schema)" });

  register("docs", "database_row_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`
      SELECT r.properties_json, r.database_id, d.document_id, d.schema_json
      FROM doc_database_rows r INNER JOIN doc_databases d ON d.id = r.database_id
      WHERE r.id = ?
    `).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (!hasRole(db, row.document_id, userId, "editor")) return { ok: false, reason: "forbidden" };
    const schema = _safeJson(row.schema_json, []);
    const existing = _safeJson(row.properties_json, {});
    const updates = input.properties || {};
    for (const col of schema) {
      if (updates[col.id] !== undefined) existing[col.id] = _coerceValue(col, updates[col.id]);
    }
    db.prepare(`UPDATE doc_database_rows SET properties_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(existing), _now(), id);
    return { ok: true, properties: existing };
  }, { destructive: true, note: "Update a row's properties (validated against schema)" });

  register("docs", "database_row_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`
      SELECT d.document_id FROM doc_database_rows r
      INNER JOIN doc_databases d ON d.id = r.database_id WHERE r.id = ?
    `).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (!hasRole(db, row.document_id, userId, "editor")) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`DELETE FROM doc_database_rows WHERE id = ?`).run(id);
    return { ok: r.changes > 0 };
  }, { destructive: true, note: "Delete a database row" });

  register("docs", "database_rows", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const databaseId = String(input.databaseId || "");
    if (!databaseId) return { ok: false, reason: "databaseId_required" };
    const dbase = db.prepare(`SELECT document_id FROM doc_databases WHERE id = ?`).get(databaseId);
    if (!dbase) return { ok: false, reason: "not_found" };
    if (!hasRole(db, dbase.document_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const rows = db.prepare(`
      SELECT id, properties_json, sort_key, created_at, updated_at
      FROM doc_database_rows
      WHERE database_id = ?
      ORDER BY sort_key ASC, created_at ASC
      LIMIT ?
    `).all(databaseId, Math.min(Number(input.limit) || 500, 2000));
    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id,
        sortKey: r.sort_key,
        properties: _safeJson(r.properties_json, {}),
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    };
  }, { note: "List rows in a database (sorted by sort_key then created)" });
}
