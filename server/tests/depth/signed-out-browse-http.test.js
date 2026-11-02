// GB-0664 (Ramaj): signed-out visitors may browse Music + Market with 30 s previews.
// Backend half, over HTTP against the real app (real middleware order): anonymous reads return
// PUBLIC items only with whitelisted fields (no owner ids / licence holders / storage paths),
// anonymous writes are refused, and members still get their own data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signed-out-"));
process.env.ARTIFACT_DIR = path.join(tmp, "artifacts");
process.env.DB_PATH = process.env.DB_PATH || path.join(tmp, "t.db");

import http from "node:http";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { load, macroRuntime } from "./_harness.js";

let srv, base, owner, ownerId, rt;
const mp3 = (n) => Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), crypto.randomBytes(n - 10)]);

async function register(tag) {
  const n = `${tag}_${crypto.randomBytes(3).toString("hex")}`;
  const r = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: n, email: `${n}@private-mail.test`, password: "TestPass123!", dateOfBirth: "1990-01-01" }) });
  const j = await r.json();
  assert.ok(j.token, JSON.stringify(j));
  return { token: j.token, id: j.user?.id || j.userId, email: `${n}@private-mail.test` };
}
const as = (u) => (u ? { authorization: `Bearer ${u.token}` } : {});
async function upload(user, { privacy, title }) {
  const q = new URLSearchParams({ title, filename: "a.mp3", duration: "100", privacy });
  const r = await fetch(`${base}/api/media/upload-raw?${q}`, { method: "POST", headers: { ...as(user), "content-type": "audio/mpeg" }, body: mp3(5000) });
  const j = await r.json();
  assert.equal(r.status, 201, JSON.stringify(j));
  return j.mediaDTU.id;
}
const get = async (p, user) => { const r = await fetch(`${base}${p}`, { headers: as(user) }); return { status: r.status, text: await r.text() }; };
const jget = async (p, user) => { const r = await get(p, user); return { status: r.status, body: JSON.parse(r.text || "{}"), text: r.text }; };

const ids = {};
before(async () => {
  const t = await load();
  rt = await macroRuntime("signed-out-rt");
  srv = await new Promise((r) => { const s = http.createServer(t.app); s.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
  owner = await register("own");
  ownerId = owner.id;
  ids.pub = await upload(owner, { privacy: "public", title: "Public Song" });
  ids.priv = await upload(owner, { privacy: "private", title: "Private Song" });
  ids.fol = await upload(owner, { privacy: "followers-only", title: "Followers Song" });
  // list the public one in the Market (free, listen-only) through the real macro path
  const ctx = { actor: { userId: ownerId, id: ownerId }, userId: ownerId };
  const listed = await rt.runMacro("marketplace", "list", { dtuId: ids.pub }, ctx);
  assert.equal(listed.ok, true, JSON.stringify(listed));
  // a service listing with an owner id on it
  const svc = await fetch(`${base}/api/marketplace/listings`, { method: "POST", headers: { "content-type": "application/json", ...as(owner) }, body: JSON.stringify({ userId: ownerId, title: "Mixing service", description: "I mix", category: "audio", price: 20 }) });
  ids.svc = (await svc.json()).listing?.id;
  assert.ok(ids.svc, "service listing created");
});
after(() => { srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe("signed-out reads: public items only, whitelisted fields", () => {
  it("GET /api/media/public-feed works anonymously and lists only the public item", async () => {
    const r = await jget("/api/media/public-feed?mediaType=audio");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    const found = r.body.items.map((i) => i.id);
    assert.ok(found.includes(ids.pub));
    assert.ok(!found.includes(ids.priv), "private never appears");
    assert.ok(!found.includes(ids.fol), "followers-only never appears");
    const item = r.body.items.find((i) => i.id === ids.pub);
    assert.equal(item.streamUrl, `/api/media/${ids.pub}/stream`);
    assert.equal(item.previewSeconds, 30);
    assert.equal(item.title, "Public Song");
  });

  it("the public feed exposes no owner id, email, licence holder, storage path or price", async () => {
    const r = await jget("/api/media/public-feed");
    for (const forbidden of [ownerId, owner.email, "licensedUserIds", "storageRef", "artifactRef", "diskPath", "privacy", "tiers", "author\""]) {
      assert.ok(!r.text.includes(forbidden), `public feed must not contain ${forbidden}`);
    }
    assert.deepEqual(Object.keys(r.body.items[0]).sort(), [
      "authorName", "createdAt", "description", "duration", "id", "likes", "mediaType", "mimeType", "previewSeconds", "streamUrl", "tags", "title", "views",
    ]);
  });

  it("GET /api/marketplace/listings anonymous: media + service listings, with no owner/seller identity", async () => {
    const r = await jget("/api/marketplace/listings");
    assert.equal(r.status, 200);
    const media = r.body.listings.find((l) => l.id === ids.pub);
    const svc = r.body.listings.find((l) => l.id === ids.svc);
    assert.ok(media, "the listed public track is browsable");
    assert.ok(svc, "service listings are browsable");
    assert.equal(media.listenOnly, true);
    assert.equal(svc.title, "Mixing service");
    for (const row of [media, svc]) {
      for (const k of ["userId", "sellerId", "seller", "owner_user_id", "email"]) assert.equal(k in row, false, `${k} hidden from visitors`);
    }
    assert.ok(!r.text.includes(ownerId), "the owner's id appears nowhere in an anonymous listings response");
    assert.ok(!r.text.includes(owner.email));
  });

  it("the byline is a profile display name only: never a user id, and never an email-shaped name", async () => {
    const social = rt.STATE._social || (rt.STATE._social = { profiles: new Map(), follows: new Map() });
    const prior = social.profiles.get(ownerId);
    try {
      social.profiles.set(ownerId, { displayName: "Ada Lovelace" });
      let r = await jget("/api/media/public-feed");
      assert.equal(r.body.items.find((i) => i.id === ids.pub).authorName, "Ada Lovelace");
      social.profiles.set(ownerId, { displayName: owner.email });
      r = await jget("/api/media/public-feed");
      assert.equal(r.body.items.find((i) => i.id === ids.pub).authorName, null);
      assert.ok(!r.text.includes(owner.email));
      social.profiles.delete(ownerId);
      r = await jget("/api/media/public-feed");
      assert.equal(r.body.items.find((i) => i.id === ids.pub).authorName, null, "no profile -> no byline (not the raw id)");
    } finally { if (prior) social.profiles.set(ownerId, prior); else social.profiles.delete(ownerId); }
  });

  it("a member still gets the full row (no regression for signed-in callers)", async () => {
    const r = await jget("/api/marketplace/listings", owner);
    const svc = r.body.listings.find((l) => l.id === ids.svc);
    assert.equal(svc.userId, ownerId);
  });

  it("the public catalog is the same for a member as for a visitor (cannot leak more to members)", async () => {
    const a = await jget("/api/media/public-feed");
    const b = await jget("/api/media/public-feed", owner);
    assert.deepEqual(a.body.items.map((i) => i.id), b.body.items.map((i) => i.id));
    assert.ok(!b.body.items.some((i) => i.id === ids.priv), "even the owner's private item is not in the public catalog");
  });

  it("the anonymous stream is the 30 s preview, and private media stays closed", async () => {
    const ok = await fetch(`${base}/api/media/${ids.pub}/stream`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-concord-preview"), "true");
    const priv = await fetch(`${base}/api/media/${ids.priv}/stream`);
    assert.ok([401, 404].includes(priv.status), `private stream got ${priv.status}`);
  });
});

describe("signed-out writes are refused", () => {
  const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body || {}) });
  const cases = [
    ["upload a track", "/api/media/upload-raw?title=x", null],
    ["like media", () => `/api/media/${ids.pub}/like`, {}],
    ["comment on media", () => `/api/media/${ids.pub}/comment`, { text: "hi" }],
    ["create a Market listing", "/api/marketplace/listings", { userId: "x", title: "t", category: "c", price: 1 }],
    ["buy (royalty-aware purchase)", "/api/marketplace/purchaseWithRoyalties", { dtuId: "x" }],
    ["list a DTU", "/api/marketplace/submit", { dtuId: "x", price: 0 }],
    ["place an order", "/api/marketplace/orders", { userId: "x", listingId: "y" }],
  ];
  for (const [label, p, body] of cases) {
    it(`anonymous cannot ${label} (401)`, async () => {
      const url = typeof p === "function" ? p() : p;
      const r = await post(url, body);
      assert.equal(r.status, 401, `${label}: ${r.status}`);
    });
  }
});
