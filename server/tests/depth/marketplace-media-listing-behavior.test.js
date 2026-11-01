// P0 media upload → Market: a member lists their OWN uploaded media DTU at
// price 0 (listen-only) and it appears in the listings the Market lens
// reads. Money stays off: paid listing is refused, listen-only listings
// cannot be purchased, and private uploads cannot be listed.
import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/marketplace-media-listing-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createMediaDTU } from "../../lib/media-dtu.js";
import { macroRuntime } from "./_harness.js";

let rt, owner, other;

function upload(ownerId, extra = {}) {
  const r = createMediaDTU(rt.STATE, {
    authorId: ownerId, title: `Track ${randomUUID().slice(0, 6)}`, mediaType: "audio",
    mimeType: "audio/mpeg", fileSize: 1000, originalFilename: "t.mp3", privacy: "public", tags: ["lofi"], ...extra,
  });
  assert.equal(r.ok, true);
  return r.mediaDTU;
}

describe("media DTU → Market listing (free, listen-only)", () => {
  before(async () => {
    rt = await macroRuntime("media-listing-owner");
    owner = rt.ctx;
    other = (await macroRuntime("media-listing-other")).ctx;
  });

  it("the owner lists their uploaded public media DTU at price 0 and it shows in the Market listings", async () => {
    const m = upload(owner.actor.userId);
    assert.equal(m.scope, "global", "uploads are global/user scope, never personal");
    const r = await rt.runMacro("marketplace", "list", { dtuId: m.id }, owner);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.listing.price, 0);
    assert.equal(r.listing.listenOnly, true);

    // The Market lens Listings tab reads marketplace.browse (GET /api/marketplace/listings).
    const b = await rt.runMacro("marketplace", "browse", {}, other);
    assert.equal(b.ok, true);
    const row = b.listings.find((l) => l.id === m.id);
    assert.ok(row, "listed media DTU is in the Listings payload");
    assert.equal(row.price, 0);
    assert.equal(row.listenOnly, true);
    assert.equal(row.streamUrl, `/api/media/${m.id}/stream`);
    assert.ok(b.mediaListings.some((l) => l.id === m.id));
  });

  it("an unlisted upload does not appear", async () => {
    const m = upload(owner.actor.userId);
    const b = await rt.runMacro("marketplace", "browse", {}, other);
    assert.equal(b.listings.some((l) => l.id === m.id), false);
  });

  it("someone else cannot list it", async () => {
    const m = upload(owner.actor.userId);
    const r = await rt.runMacro("marketplace", "list", { dtuId: m.id }, other);
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_your_dtu");
  });

  it("a paid listing is refused (real-money trading is off)", async () => {
    const m = upload(owner.actor.userId);
    const r = await rt.runMacro("marketplace", "list", { dtuId: m.id, price: 9.99 }, owner);
    assert.equal(r.ok, false);
    assert.equal(r.error, "paid_media_listing_disabled");
    assert.equal(m.marketplace, undefined);
  });

  it("a private upload cannot be listed", async () => {
    const m = upload(owner.actor.userId, { privacy: "private" });
    const r = await rt.runMacro("marketplace", "list", { dtuId: m.id }, owner);
    assert.equal(r.ok, false);
    assert.equal(r.error, "media_must_be_public");
  });

  it("a listen-only listing cannot be purchased through either purchase macro", async () => {
    const m = upload(owner.actor.userId);
    await rt.runMacro("marketplace", "list", { dtuId: m.id }, owner);
    const a = await rt.runMacro("marketplace", "purchase", { dtuId: m.id }, other);
    assert.equal(a.ok, false);
    assert.equal(a.error, "listen_only_listing");
    const b = await rt.runMacro("marketplace", "purchaseWithRoyalties", { dtuId: m.id }, other);
    assert.equal(b.ok, false);
    assert.equal(b.error, "listen_only_listing");
  });
});
