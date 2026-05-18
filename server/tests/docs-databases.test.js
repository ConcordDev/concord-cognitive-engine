// server/tests/docs-databases.test.js
//
// Tier-2 contract tests for Notion-DB-style structured pages.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDocsMacros from "../domains/docs.js";
import registerDocsDatabasesMacros from "../domains/docs-databases.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const n of ["211_documents", "212_doc_ai", "213_doc_extensions"]) {
    const m = await import(`../migrations/${n}.js`);
    m.up(db);
  }
  registerDocsMacros(register);
  registerDocsDatabasesMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_db") { return { db, actor: { userId } }; }

async function makeDoc(userId = "u_db") {
  const r = await MACROS.get("create")(ctx(userId), { title: "Doc with DB" });
  return r.id;
}

describe("docs-databases: schema validation", () => {
  it("default schema applied when none given", async () => {
    const docId = await makeDoc();
    const r = await MACROS.get("database_create")(ctx(), { documentId: docId });
    assert.equal(r.ok, true);
    const list = await MACROS.get("database_list_for_doc")(ctx(), { documentId: docId });
    assert.equal(list.databases.length, 1);
    assert.ok(list.databases[0].schema.find((c) => c.name === "Title"));
  });

  it("rejects schema with unknown column type", async () => {
    const docId = await makeDoc();
    const r = await MACROS.get("database_create")(ctx(), {
      documentId: docId,
      schema: [{ id: "a", name: "A", type: "blob" }],
    });
    assert.equal(r.ok, false);
    assert.ok(r.reason.startsWith("unknown_type_"));
  });

  it("rejects schema with duplicate column ids", async () => {
    const docId = await makeDoc();
    const r = await MACROS.get("database_create")(ctx(), {
      documentId: docId,
      schema: [{ id: "a", name: "A", type: "text" }, { id: "a", name: "B", type: "text" }],
    });
    assert.equal(r.ok, false);
    assert.ok(r.reason.startsWith("duplicate_column_id"));
  });

  it("rejects rows without ids/names", async () => {
    const docId = await makeDoc();
    const r = await MACROS.get("database_create")(ctx(), {
      documentId: docId,
      schema: [{ id: "a", type: "text" }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "column_needs_id_and_name");
  });
});

describe("docs-databases: row operations", () => {
  let dbId, docId;
  before(async () => {
    docId = await makeDoc("u_rows");
    const c = await MACROS.get("database_create")(ctx("u_rows"), {
      documentId: docId,
      schema: [
        { id: "title", name: "Title", type: "text" },
        { id: "count", name: "Count", type: "number" },
        { id: "done", name: "Done", type: "checkbox" },
        { id: "tags", name: "Tags", type: "multi_select" },
      ],
    });
    dbId = c.id;
  });

  it("database_row_add coerces values to declared types", async () => {
    const r = await MACROS.get("database_row_add")(ctx("u_rows"), {
      databaseId: dbId,
      properties: { title: "First", count: "42", done: 1, tags: ["a", "b"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.properties.count, 42); // coerced to number
    assert.equal(r.properties.done, true); // coerced to boolean
    assert.deepEqual(r.properties.tags, ["a", "b"]);
  });

  it("database_row_add ignores unknown columns", async () => {
    const r = await MACROS.get("database_row_add")(ctx("u_rows"), {
      databaseId: dbId,
      properties: { title: "X", count: 1, NOT_A_COL: "ignored" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.properties.NOT_A_COL, undefined);
  });

  it("database_row_update merges with existing", async () => {
    const add = await MACROS.get("database_row_add")(ctx("u_rows"), {
      databaseId: dbId, properties: { title: "Orig", count: 1 },
    });
    const u = await MACROS.get("database_row_update")(ctx("u_rows"), {
      id: add.id, properties: { count: 5 },
    });
    assert.equal(u.ok, true);
    assert.equal(u.properties.title, "Orig"); // preserved
    assert.equal(u.properties.count, 5);
  });

  it("database_rows returns rows sorted by sort_key", async () => {
    const r = await MACROS.get("database_rows")(ctx("u_rows"), { databaseId: dbId });
    assert.ok(r.rows.length >= 3);
    for (let i = 1; i < r.rows.length; i++) {
      assert.ok(r.rows[i].sortKey >= r.rows[i - 1].sortKey);
    }
  });

  it("database_row_delete removes the row", async () => {
    const add = await MACROS.get("database_row_add")(ctx("u_rows"), {
      databaseId: dbId, properties: { title: "Doomed" },
    });
    const before = (await MACROS.get("database_rows")(ctx("u_rows"), { databaseId: dbId })).rows.length;
    const d = await MACROS.get("database_row_delete")(ctx("u_rows"), { id: add.id });
    assert.equal(d.ok, true);
    const after = (await MACROS.get("database_rows")(ctx("u_rows"), { databaseId: dbId })).rows.length;
    assert.equal(after, before - 1);
  });

  it("non-editor cannot add rows", async () => {
    const r = await MACROS.get("database_row_add")(ctx("u_outsider"), {
      databaseId: dbId, properties: { title: "Hacked" },
    });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});
