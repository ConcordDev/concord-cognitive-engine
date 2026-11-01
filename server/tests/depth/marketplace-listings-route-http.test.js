// P0 follow-up: GET /api/marketplace/listings through the REAL app mount order.
// routes/frontier-part2.js registers the same path before the plugin-browse alias in
// server.js, so a macro-level test (marketplace.browse) cannot see whether a listed
// media DTU reaches the route the Market lens calls. This one does.
import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/marketplace-listings-http-${process.pid}-${Date.now()}.db`;

import http from "node:http";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createMediaDTU } from "../../lib/media-dtu.js";
import { load, macroRuntime } from "./_harness.js";

let srv, base, rt, owner;

before(async () => {
  const t = await load();
  rt = await macroRuntime("listings-http-owner");
  owner = rt.ctx;
  srv = await new Promise((r) => { const s = http.createServer(t.app); s.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv?.close(); });

function upload(extra = {}) {
  const r = createMediaDTU(rt.STATE, {
    authorId: owner.actor.userId, title: `Track ${randomUUID().slice(0, 6)}`, mediaType: "audio",
    mimeType: "audio/mpeg", fileSize: 1000, originalFilename: "t.mp3", privacy: "public", tags: ["lofi"], ...extra,
  });
  assert.equal(r.ok, true);
  return r.mediaDTU;
}

describe("GET /api/marketplace/listings (real app)", () => {
  it("returns a listed media DTU as a free listen-only row, and not an unlisted one", async () => {
    const listed = upload();
    const unlisted = upload();
    const l = await rt.runMacro("marketplace", "list", { dtuId: listed.id }, owner);
    assert.equal(l.ok, true, JSON.stringify(l));

    const r = await fetch(`${base}/api/marketplace/listings`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    const row = body.listings.find((x) => x.id === listed.id);
    assert.ok(row, "listed media DTU must be in GET /api/marketplace/listings");
    assert.equal(row.price, 0);
    assert.equal(row.listenOnly, true);
    assert.equal(row.mediaType, "audio");
    assert.equal(row.streamUrl, `/api/media/${listed.id}/stream`);
    assert.ok(body.mediaListings.some((x) => x.id === listed.id));
    assert.equal(body.listings.some((x) => x.id === unlisted.id), false);
  });

  it("keeps returning the service-marketplace rows (existing behaviour)", async () => {
    const r = await fetch(`${base}/api/marketplace/listings`);
    const body = await r.json();
    assert.ok(Array.isArray(body.listings));
    assert.ok(Array.isArray(body.mediaListings));
  });
});
