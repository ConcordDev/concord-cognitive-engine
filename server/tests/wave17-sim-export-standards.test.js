// POST /api/world/sim/export renders a stored DTU; POST /api/standards/check
// evaluates caller-supplied measurements against the domain's coded rules.
// In-memory only: no server.js, no real database.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createWorldRoutes from "../routes/world.js";
import createFrontierRoutesPart4 from "../routes/frontier-part4.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function post(app, path, user, body) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-user-id"] = user;
  const res = await fetch(`${app.url}${path}`, { method: "POST", headers, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json() };
}

const userMw = (req, _res, next) => {
  const id = req.headers["x-user-id"];
  if (id) req.user = { id: String(id) };
  next();
};

function mkDtu(id, owner, extra = {}) {
  return {
    id, title: `Title ${id}`, domain: "test", ownerId: owner, tags: ["t"],
    human: { summary: `Summary of ${id}`, bullets: [] }, core: { claims: ["c1"] }, machine: {},
    createdAt: "2026-01-01T00:00:00Z", ...extra,
  };
}

describe("POST /api/world/sim/export", () => {
  let app;
  before(async () => {
    const dtuStore = new Map([
      ["mine", mkDtu("mine", "alice", { visibility: "private" })],
      ["bobs-private", mkDtu("bobs-private", "bob", { visibility: "private" })],
      ["bobs-public", mkDtu("bobs-public", "bob", { visibility: "public" })],
      ["bobs-market", mkDtu("bobs-market", "bob", { visibility: "marketplace" })],
      ["bobs-shadow", mkDtu("bobs-shadow", "bob", { visibility: "public", tier: "shadow" })],
      ["bobs-quarantine", mkDtu("bobs-quarantine", "bob", { visibility: "public", status: "quarantine:x" })],
      ["bobs-personal", mkDtu("bobs-personal", "bob", { visibility: "public", scope: "personal" })],
      ["bobs-meta-personal", mkDtu("bobs-meta-personal", "bob", { visibility: "public", meta: { scope: "personal" } })],
      ["bobs-userscope", mkDtu("bobs-userscope", "bob", { visibility: "public", scope: "user" })],
      ["bobs-followers", mkDtu("bobs-followers", "bob", { visibility: "public", privacy: "followers-only" })],
      ["huge", mkDtu("huge", "alice", { visibility: "private", human: { summary: "x".repeat(11 * 1024 * 1024), bullets: [] } })],
    ]);
    const e = express();
    e.use(express.json({ limit: "1mb" }));
    e.use(userMw);
    e.use("/api/world", createWorldRoutes({ requireAuth: (_q, _r, n) => n(), dtuStore }));
    app = await listen(e);
  });
  after(async () => { await app.close(); });

  const exp = (user, dtuId, format) => post(app, "/api/world/sim/export", user, { dtuId, format });

  it("reviewer: meta personal scope, user scope and followers-only are 404 for non-owners", async () => {
    for (const id of ["bobs-meta-personal", "bobs-userscope", "bobs-followers"]) {
      const r = await exp("alice", id, "json");
      assert.equal(r.status, 404, id);
      assert.equal(r.body.content, undefined);
      const own = await exp("bob", id, "json");
      assert.equal(own.status, 200, `owner ${id}`);
    }
  });

  it("owner exports own private DTU with true byte length", async () => {
    const r = await exp("alice", "mine", "json");
    assert.equal(r.status, 200);
    assert.equal(r.body.mimeType, "application/json");
    assert.equal(r.body.encoding, "base64");
    const buf = Buffer.from(r.body.content, "base64");
    assert.equal(r.body.bytes, buf.length);
    assert.equal(JSON.parse(buf.toString("utf-8")).id, "mine");
    assert.match(r.body.filename, /\.json$/);
  });

  it("renders markdown and a real PDF", async () => {
    const md = await exp("alice", "mine", "md");
    assert.equal(md.status, 200);
    assert.match(Buffer.from(md.body.content, "base64").toString(), /Summary of mine/);
    const pdf = await exp("alice", "mine", "pdf");
    assert.equal(pdf.status, 200);
    const buf = Buffer.from(pdf.body.content, "base64");
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
    assert.equal(pdf.body.bytes, buf.length);
  });

  it("other user's private DTU is 404 and leaks nothing", async () => {
    const r = await exp("alice", "bobs-private", "json");
    assert.equal(r.status, 404);
    assert.deepEqual(Object.keys(r.body).sort(), ["error", "ok"]);
    const unknown = await exp("alice", "nope", "json");
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, r.body);
  });

  it("public DTU of another user exports; marketplace/shadow/quarantine/personal do not", async () => {
    assert.equal((await exp("alice", "bobs-public", "json")).status, 200);
    for (const id of ["bobs-market", "bobs-shadow", "bobs-quarantine", "bobs-personal"]) {
      assert.equal((await exp("alice", id, "json")).status, 404, id);
    }
    // the owner still can
    assert.equal((await exp("bob", "bobs-market", "json")).status, 200);
  });

  it("unsupported format is 400 listing supported ones", async () => {
    const r = await exp("alice", "mine", "docx");
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "unsupported_format");
    assert.ok(r.body.supportedFormats.includes("pdf"));
  });

  it("refuses oversized renders with 413 instead of truncating", async () => {
    const r = await exp("alice", "huge", "md");
    assert.equal(r.status, 413);
    assert.equal(r.body.error, "export_too_large");
    assert.ok(r.body.bytes > r.body.maxBytes);
    assert.equal(Object.hasOwn(r.body, "content"), false);
  });
});

describe("POST /api/standards/check", () => {
  let app;
  let ids;
  before(async () => {
    const e = express();
    e.use(express.json());
    e.use(userMw);
    e.use("/api", createFrontierRoutesPart4({}));
    app = await listen(e);
    const listed = await (await fetch(`${app.url}/api/standards`)).json();
    ids = Object.fromEntries(listed.standards.map((s) => [s.code, s.id]));
  });
  after(async () => { await app.close(); });

  const check = (standard, data) => post(app, "/api/standards/check", "alice", { targetId: "t1", standardId: ids[standard], data });

  it("real pass and fail from supplied measurements", async () => {
    const pass = await check("ASCE 7", { windSpeedMph: 120, sdsG: 1.2 });
    assert.equal(pass.status, 200);
    assert.equal(pass.body.verdict, "compliant");
    assert.equal(pass.body.passedCount, 2);
    const fail = await check("ASCE 7", { windSpeedMph: 85, sdsG: 1.2 });
    assert.equal(fail.body.verdict, "non-compliant");
    assert.equal(fail.body.failedCount, 1);
    const wind = fail.body.results.find((r) => r.field === "windSpeedMph");
    assert.equal(wind.status, "fail");
    assert.equal(wind.passed, false);
    assert.equal(wind.actual, "85 mph");
  });

  it("missing measurement is not_measured (null), not pass/fail", async () => {
    const r = await check("ASCE 7", { windSpeedMph: 100 });
    assert.equal(r.status, 200);
    const sds = r.body.results.find((x) => x.field === "sdsG");
    assert.equal(sds.status, "not_measured");
    assert.equal(sds.passed, null);
    assert.equal(sds.actual, null);
    assert.equal(r.body.notMeasuredCount, 1);
    assert.equal(r.body.verdict, "incomplete");
    const none = await check("ASCE 7", undefined);
    assert.equal(none.body.notMeasuredCount, 2);
    assert.equal(none.body.passedCount, 0);
    assert.equal(none.body.failedCount, 0);
  });

  it("non-numeric strings are not coerced into a measurement", async () => {
    const r = await check("ASCE 7", { windSpeedMph: "120", sdsG: 1 });
    assert.equal(r.body.results.find((x) => x.field === "windSpeedMph").status, "not_measured");
  });

  it("standard without coded rules stays 501 with a specific missing", async () => {
    const r = await check("IEEE 802.11", { x: 1 });
    assert.equal(r.status, 501);
    assert.equal(r.body.reason, "compliance_not_measured");
    assert.match(r.body.missing, /IEEE 802\.11/);
  });

  it("unknown standard id is an error, not a score", async () => {
    const r = await post(app, "/api/standards/check", "alice", { targetId: "t1", standardId: "nope", data: {} });
    assert.ok(r.status >= 400);
    assert.equal(r.body.ok, false);
  });
});
