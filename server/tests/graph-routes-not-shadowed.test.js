// frontier-part4 is mounted at /api before server.js registers the real graph
// routes. It used to define GET /graph/:projectId (a hardcoded fixture graph),
// which captured /api/graph/force and /api/graph/visual so the Graph lens drew
// fake nodes. Pin that the router no longer answers anything under /graph.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createFrontierRoutesPart4 from "../routes/frontier-part4.js";

describe("frontier-part4 doesn't shadow the real graph routes", () => {
  let server, url;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", createFrontierRoutesPart4({}));
    // Stand-ins registered after, in the same order server.js uses.
    app.get("/api/graph/force", (_req, res) => res.json({ ok: true, real: "force" }));
    app.get("/api/graph/visual", (_req, res) => res.json({ ok: true, real: "visual" }));
    await new Promise((r) => { server = app.listen(0, r); });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  for (const name of ["force", "visual"]) {
    it(`GET /api/graph/${name} reaches the real handler`, async () => {
      const j = await (await fetch(`${url}/api/graph/${name}`)).json();
      assert.equal(j.real, name);
    });
  }

  it("the fixture routes are gone", async () => {
    assert.equal((await fetch(`${url}/api/graph/some-project`)).status, 404);
    assert.equal((await fetch(`${url}/api/graph/royalty-flow/x`)).status, 404);
    const r = await fetch(`${url}/api/graph/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: "{\"projectId\":\"x\"}" });
    assert.equal(r.status, 404);
  });
});
