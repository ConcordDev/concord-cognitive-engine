import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import createFrontierRoutesPart4 from "../routes/frontier-part4.js";

function startApp(opts) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers["x-user-id"];
    if (id) req.user = { id: String(id) };
    next();
  });
  app.use("/api", createFrontierRoutesPart4(opts));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function call(app, path, { user, method = "GET", body } = {}) {
  const headers = {};
  if (user) headers["x-user-id"] = user;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${app.url}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

describe("DTU diff without a DTU store stays an honest 501", () => {
  let app;
  before(async () => { app = await startApp({}); });
  after(async () => { await app.close(); });

  it("501 not_wired with a missing description", async () => {
    const r = await call(app, "/api/dtu/diff", { method: "POST", body: { dtuIdA: "a", dtuIdB: "b" } });
    assert.equal(r.status, 501);
    assert.equal(r.body.reason, "not_wired");
    assert.ok(r.body.missing);
    assert.equal(r.body.diff, undefined);
  });

  it("still validates required params", async () => {
    const r = await call(app, "/api/dtu/diff", { method: "POST", body: { dtuIdA: "a" } });
    assert.equal(r.status, 400);
  });
});

describe("DTU diff over stored DTUs", () => {
  let app;
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (
      id TEXT PRIMARY KEY, title TEXT, type TEXT, creator_id TEXT,
      visibility TEXT, data TEXT, tags_json TEXT, embedding BLOB, created_at TEXT)`);
    const ins = db.prepare("INSERT INTO dtus VALUES (?,?,?,?,?,?,?,?,?)");
    ins.run("d1", "Beam", "note", "alice", "public", JSON.stringify({ text: "span 4m", n: 1 }), '["a","b"]', Buffer.from([1]), "t1");
    ins.run("d2", "Beam v2", "note", "alice", "public", JSON.stringify({ text: "span 6m", n: 1 }), '["a","c"]', Buffer.from([2]), "t2");
    ins.run("d1copy", "Beam", "note", "alice", "public", JSON.stringify({ text: "span 4m", n: 1 }), '["a","b"]', Buffer.from([9]), "t9");
    ins.run("secret", "Diary", "note", "bob", "private", JSON.stringify({ text: "mine" }), "[]", null, "t3");
    ins.run("personal", "Journal", "note", "bob", "public", JSON.stringify({ scope: "personal", text: "x" }), "[]", null, "t4");
    app = await startApp({ db });
  });
  after(async () => { await app.close(); db.close(); });

  const diff = (a, b, user = "alice") => call(app, "/api/dtu/diff", { method: "POST", user, body: { dtuIdA: a, dtuIdB: b } });

  it("same content is identical with similarity 1 (embedding/ids ignored)", async () => {
    const r = await diff("d1", "d1copy");
    assert.equal(r.status, 200);
    assert.equal(r.body.identical, true);
    assert.equal(r.body.fieldsChanged, 0);
    assert.equal(r.body.similarity, 1);
    assert.deepEqual(r.body.changes, []);
  });

  it("two different DTUs produce a real field-level diff", async () => {
    const r = await diff("d1", "d2");
    assert.equal(r.status, 200);
    assert.equal(r.body.identical, false);
    const byField = Object.fromEntries(r.body.changes.map((c) => [c.field, c]));
    assert.deepEqual(Object.keys(byField).sort(), ["data.text", "tags_json", "title"]);
    assert.equal(byField.title.a, "Beam");
    assert.equal(byField.title.b, "Beam v2");
    assert.equal(byField["data.text"].a, "span 4m");
    assert.equal(byField["data.text"].b, "span 6m");
    // compared: creator_id, data.n, data.text, tags_json, title, type, visibility = 7; 3 changed
    assert.equal(r.body.fieldsCompared, 7);
    assert.equal(r.body.fieldsUnchanged, 4);
    assert.equal(r.body.similarity, Math.round((4 / 7) * 1000) / 1000);
  });

  it("unknown id is 404 naming the id", async () => {
    const r = await diff("d1", "nope");
    assert.equal(r.status, 404);
    assert.equal(r.body.dtuId, "nope");
  });

  it("another user's private or personal DTU looks missing and leaks nothing", async () => {
    for (const id of ["secret", "personal"]) {
      const r = await diff("d1", id);
      assert.equal(r.status, 404);
      assert.equal(r.body.dtuId, id);
      assert.equal(JSON.stringify(r.body).includes("Diary"), false);
      assert.equal(JSON.stringify(r.body).includes("Journal"), false);
    }
    const anon = await diff("d1", "secret", null);
    assert.equal(anon.status, 404);
  });

  it("the owner can diff their own private DTU", async () => {
    const r = await diff("secret", "personal", "bob");
    assert.equal(r.status, 200);
  });

  it("history holds only this caller's computed diffs", async () => {
    await diff("d1", "d2", "alice");
    const mine = await call(app, "/api/dtu/diff-history/d1", { user: "alice" });
    assert.ok(mine.body.count >= 1);
    assert.equal(mine.body.history[0].dtuIdB === "d2" || mine.body.history[0].dtuIdB === "d1copy", true);
    const other = await call(app, "/api/dtu/diff-history/d1", { user: "carol" });
    assert.equal(other.body.count, 0);
    const anon = await call(app, "/api/dtu/diff-history/d1");
    assert.equal(anon.body.count, 0);
    const never = await call(app, "/api/dtu/diff-history/zzz", { user: "alice" });
    assert.deepEqual(never.body.history, []);
  });
});

describe("DTU diff only shows full content of public DTUs to non-owners", () => {
  let app;
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (
      id TEXT PRIMARY KEY, title TEXT, creator_id TEXT, visibility TEXT,
      tier TEXT, status TEXT, data TEXT, minted_by_model TEXT)`);
    const ins = db.prepare("INSERT INTO dtus VALUES (?,?,?,?,?,?,?,?)");
    ins.run("pub", "Open", "carol", "public", "regular", "active", '{"t":"a"}', "m1");
    ins.run("paid", "Paid", "carol", "marketplace", "regular", "active", '{"t":"paid body"}', "m1");
    ins.run("shadowed", "S", "carol", "public", "shadow", "active", '{"t":"s"}', "m1");
    ins.run("quar", "Q", "carol", "public", "regular", "quarantine:spam", '{"t":"q"}', "m1");
    app = await startApp({ db });
  });
  after(async () => { await app.close(); db.close(); });

  const diff = (a, b, user) => call(app, "/api/dtu/diff", { method: "POST", user, body: { dtuIdA: a, dtuIdB: b } });

  for (const id of ["paid", "shadowed", "quar"]) {
    it(`${id} is 404 for a non-owner and leaks nothing`, async () => {
      const r = await diff("pub", id, "dave");
      assert.equal(r.status, 404);
      assert.equal(r.body.dtuId, id);
      assert.equal(JSON.stringify(r.body).includes("paid body"), false);
      assert.equal(r.body.changes, undefined);
    });
  }

  it("the owner can diff their own marketplace DTU; provenance columns are not diffed", async () => {
    const r = await diff("pub", "paid", "carol");
    assert.equal(r.status, 200);
    assert.ok(r.body.changes.some((c) => c.field === "data.t"));
    assert.equal(r.body.changes.some((c) => c.field === "minted_by_model"), false);
  });
});
