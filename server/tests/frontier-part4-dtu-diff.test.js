import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createFrontierRoutesPart4 from "../routes/frontier-part4.js";

function startApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", createFrontierRoutesPart4({}));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe("POST /api/dtu/diff — honest-by-construction (no fabricated diff)", () => {
  let app;
  beforeEach(async () => { app = await startApp(); });
  afterEach(async () => { await app.close(); });

  it("returns an honest failure instead of a fabricated field-count/similarity", async () => {
    const res = await fetch(`${app.url}/api/dtu/diff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dtuIdA: "dtu-a", dtuIdB: "dtu-b" }),
    });
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, "not_yet_wired");
    assert.equal(body.diff, undefined);
  });

  it("still validates required params before the honest-failure branch", async () => {
    const res = await fetch(`${app.url}/api/dtu/diff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dtuIdA: "dtu-a" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
  });
});

describe("GET /api/dtu/diff-history/:dtuId — no seeded mock history", () => {
  let app;
  beforeEach(async () => { app = await startApp(); });
  afterEach(async () => { await app.close(); });

  it("returns an honestly-empty history for a never-diffed DTU, never the old 3-entry mock seed", async () => {
    const res = await fetch(`${app.url}/api/dtu/diff-history/some-dtu-id`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 0);
    assert.deepEqual(body.history, []);
  });
});
