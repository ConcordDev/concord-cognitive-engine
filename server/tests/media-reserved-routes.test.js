// GB-0489 (d): GET /api/media/feed returned 404 "Media not found" because `GET /:id` was registered before it
// and matched "feed" as an id. /metrics and /constants had the same shadowing. Real ids still route to /:id.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import createMediaRouter from "../routes/media.js";

describe("media router reserved single-segment GET paths", () => {
  let server; let port;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/media", createMediaRouter({ STATE: {} }));
    // surface errors as JSON so a 404/500 from the router is visible
    app.use((err, _req, res, _next) => res.status(err.status || err.statusCode || 500).json({ ok: false, error: String(err.message || err) }));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(async () => { await new Promise((r) => server.close(r)); });
  const get = async (p) => { const res = await fetch(`http://127.0.0.1:${port}${p}`); return { status: res.status, body: await res.json().catch(() => null) }; };

  it("GET /feed?tab=trending reaches the feed handler (200), not the /:id 404", async () => {
    const r = await get("/api/media/feed?tab=trending&limit=20");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body.feed ?? r.body.items ?? []), JSON.stringify(r.body).slice(0, 200));
  });

  it("GET /metrics and /constants are reachable", async () => {
    const m = await get("/api/media/metrics");
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const c = await get("/api/media/constants");
    assert.equal(c.status, 200);
    assert.ok(c.body.mediaTypes);
  });

  it("a real id path still goes to GET /:id (unknown id is a 404 from that handler)", async () => {
    const r = await get("/api/media/dtu_does_not_exist");
    assert.equal(r.status, 404);
  });

  it("source pin: /:id carries the reserved-segment guard", () => {
    const src = fs.readFileSync(new URL("../routes/media.js", import.meta.url), "utf8");
    assert.match(src, /router\.get\("\/:id", _skipReservedMediaSegment,/);
    assert.match(src, /RESERVED_MEDIA_SEGMENTS = new Set\(\["feed", "metrics", "constants"\]\)/);
  });
});
