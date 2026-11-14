// Behavior tests for FIX-import-002 (universal drop route half): the
// row splitter that decides whether an uploaded data file imports per
// row. Pins the ticket's two shapes plus the honest fallbacks:
//   - a 2-item JSON array parses to its 2 rows (not one raw artifact)
//   - { rows: [...] } and { dtus: [...] } envelopes parse too
//   - a title,content CSV parses to row objects (quoted commas intact)
//   - freeform JSON / non-row content returns null → single-DTU path
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseImportRows } = await import("../routes/universal-export.js");

test("a JSON array file yields one row per element", () => {
  const rows = parseImportRows("items.json", JSON.stringify([{ title: "a", content: "1" }, { title: "b", content: "2" }]));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].title, "b");
});

test("rows/dtus envelopes yield their rows", () => {
  assert.equal(parseImportRows("x.json", JSON.stringify({ rows: [{ title: "a" }] })).length, 1);
  assert.equal(parseImportRows("x.json", JSON.stringify({ dtus: [{ title: "a" }, { title: "b" }] })).length, 2);
});

test("a title,content CSV yields row objects", () => {
  const rows = parseImportRows("data.csv", "title,content\nSolo,the one row\nQuoted,\"hello, world\"\n");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { title: "Solo", content: "the one row" });
  assert.equal(rows[1].content, "hello, world");
});

test("freeform content is not row-shaped", () => {
  assert.equal(parseImportRows("note.json", JSON.stringify({ hello: "world" })), null);
  assert.equal(parseImportRows("note.json", "{not json"), null);
  assert.equal(parseImportRows("note.txt", "title,content\na,b\n"), null);
  assert.equal(parseImportRows("empty.csv", "title,content\n"), null);
});
