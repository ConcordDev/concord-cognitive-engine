// CB-0078: GET /api/lens/:domain/export/download streams the shared export as a
// real attachment (Content-Disposition) so the browser lands a file even where
// client-built blob URLs do not (Review 4 seat).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createUniversalExportRouter from "../routes/universal-export.js";

const ROWS = [
  { id: "a1", type: "craft", title: "Iron sword", createdAt: "t1", updatedAt: "u1", data: {} },
  { id: "a2", type: "craft", title: 'Oak "bow"', createdAt: "t2", updatedAt: "u2", data: {} },
];

describe("GET /api/lens/:domain/export/download", () => {
  let server; let base; let rows = ROWS;
  before(async () => {
    const runMacro = async (domain, action) => {
      assert.equal(domain, "lens"); assert.equal(action, "list");
      return { ok: true, artifacts: rows, total: rows.length };
    };
    const app = express();
    app.use(createUniversalExportRouter({}, runMacro, () => ({ actor: { userId: "u1" } })));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  it("json: attachment with a dated filename, nosniff, no-store, full rows", async () => {
    rows = ROWS;
    const res = await fetch(`${base}/api/lens/crafting/export/download?format=json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /^attachment; filename="crafting-export-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.match(res.headers.get("content-type"), /^application\/json/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = JSON.parse(await res.text());
    assert.deepEqual(body.map((r) => r.id), ["a1", "a2"]);
  });

  it("csv: same columns/quoting as the client path", async () => {
    rows = ROWS;
    const res = await fetch(`${base}/api/lens/crafting/export/download?format=csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /\.csv"$/);
    assert.match(res.headers.get("content-type"), /^text\/csv/);
    const lines = (await res.text()).split("\n");
    assert.equal(lines[0], "id,title,type,createdAt,updatedAt");
    assert.equal(lines[1], '"a1","Iron sword","craft","t1","u1"');
    assert.equal(lines[2], '"a2","Oak \\"bow\\"","craft","t2","u2"');
  });

  it("an empty export is a 404 nothing_to_export, never an empty file", async () => {
    rows = [];
    const res = await fetch(`${base}/api/lens/crafting/export/download?format=json`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { ok: false, error: "nothing_to_export" });
    assert.equal(res.headers.get("content-disposition"), null);
  });

  it("rejects bad domain / format", async () => {
    rows = ROWS;
    assert.equal((await fetch(`${base}/api/lens/bad..name/export/download`)).status, 400);
    assert.equal((await fetch(`${base}/api/lens/crafting/export/download?format=xml`)).status, 400);
  });

  it("AUTH_REQUIRED for anonymous export/download (export-leak hotfix)", async () => {
    const runMacro = async () => ({ ok: true, artifacts: ROWS, total: ROWS.length });
    const app = express();
    app.use(createUniversalExportRouter({}, runMacro, () => ({ actor: { userId: "anon" } })));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const url = `http://127.0.0.1:${srv.address().port}/api/lens/meditation/export/download?format=json`;
    const res = await fetch(url);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code || body.error, "AUTH_REQUIRED");
    await new Promise((r) => srv.close(r));
  });

});
