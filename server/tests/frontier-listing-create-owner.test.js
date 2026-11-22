/**
 * server/tests/frontier-listing-create-owner.test.js
 *
 * CB-1279 ticket C: router.post("/marketplace/listings") in
 * server/routes/frontier-part2.js read userId from the request body
 * and stored the listing under it — any signed-in caller could
 * create a listing owned by any user id they named. This route is
 * mounted in front of the durable route for the same path, so it is
 * the create the live site reaches first.
 *
 * The fix: the seller is the session caller (req.user), never the
 * body. A body-supplied userId is ignored and no longer required;
 * there is no create-on-behalf capability in this route family, so
 * an admin likewise owns the listing they create. The handler also
 * refuses 401 itself when it is ever reached without a session user,
 * instead of falling back to the body.
 *
 * Harness: node:test, a real express app mounting
 * createFrontierRoutesPart2 the way production wires it — a global
 * session layer populates req.user on every request, and the
 * factory's requireAuth gate refuses signed-out callers 401 on the
 * routes that carry it. A second app uses a pass-through requireAuth
 * to prove the handler's own 401 leg.
 *
 * Run: node --test server/tests/frontier-listing-create-owner.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const OWNER = "owner-1";
const OTHER = "other-2";
const ADMIN = "ops-9";

let server;
let baseUrl;
let server2;
let baseUrl2;

// Mirrors production wiring: a global session layer populates
// req.user on every request (the read routes read it without their
// own auth middleware), and the factory's requireAuth gate rejects
// signed-out callers on the routes that carry it.
function populateUser(req, res, next) {
  const id = req.headers["x-test-user"];
  req.user = id ? { id, role: req.headers["x-test-role"] || "member" } : null;
  next();
}

function sessionAuth(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ ok: false, error: "authentication_required" });
  next();
}

function passThroughAuth(req, res, next) {
  next();
}

async function create(base, { user, role, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-test-user"] = user;
  if (role) headers["x-test-role"] = role;
  const res = await fetch(`${base}/marketplace/listings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function listListings(base, { user, role } = {}) {
  const headers = {};
  if (user) headers["x-test-user"] = user;
  if (role) headers["x-test-role"] = role;
  const res = await fetch(`${base}/marketplace/listings`, { headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

before(async () => {
  const { default: createFrontierRoutesPart2 } = await import("../routes/frontier-part2.js");

  const app = express();
  app.use(express.json());
  app.use(populateUser);
  app.use(createFrontierRoutesPart2({ requireAuth: sessionAuth }));
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  const app2 = express();
  app2.use(express.json());
  app2.use(populateUser);
  app2.use(createFrontierRoutesPart2({ requireAuth: passThroughAuth }));
  await new Promise((resolve) => {
    server2 = app2.listen(0, () => {
      baseUrl2 = `http://127.0.0.1:${server2.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (server2) await new Promise((r) => server2.close(r));
});

describe("POST /marketplace/listings (frontier) — seller is the session caller (CB-1279 C)", () => {
  it("a signed-in caller creates a listing owned by themselves", async () => {
    const r = await create(baseUrl, {
      user: OWNER,
      body: { title: "Caller listing", category: "tools", price: 25 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.listing.userId, OWNER);
  });

  it("a body-supplied userId is ignored: the spoof does not change the seller", async () => {
    const r = await create(baseUrl, {
      user: OWNER,
      body: { title: "Spoof attempt", category: "tools", price: 10, userId: OTHER },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.listing.userId, OWNER, "the listing is owned by the session caller, not the body's id");
    // The stored row agrees: the signed-in by-id read returns the full
    // listing (the list view strips owner ids by design, GB-0664).
    const got = await fetch(`${baseUrl}/marketplace/listings/${r.json.listing.id}`, {
      headers: { "x-test-user": OWNER },
    });
    const gotJson = await got.json();
    assert.equal(got.status, 200, JSON.stringify(gotJson));
    assert.equal(gotJson.listing.userId, OWNER);
    const list = await listListings(baseUrl, { user: OWNER });
    assert.ok(!(list.json.listings || []).some((l) => l.userId === OTHER), "no listing was created for the spoofed user");
  });

  it("a signed-out caller gets 401 and no listing is created", async () => {
    const r = await create(baseUrl, {
      body: { title: "Signed-out listing", category: "tools", price: 5, userId: OTHER },
    });
    assert.equal(r.status, 401, JSON.stringify(r.json));
    const list = await listListings(baseUrl, { user: OWNER });
    assert.ok(!(list.json.listings || []).some((l) => l.title === "Signed-out listing"), "nothing was created");
  });

  it("an admin-class caller passes, and owns the listing they create (no on-behalf create)", async () => {
    const r = await create(baseUrl, {
      user: ADMIN,
      role: "admin",
      body: { title: "Admin listing", category: "tools", price: 40, userId: OTHER },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.listing.userId, ADMIN);
  });

  it("reached without a session user, the handler itself refuses 401 (no body fallback)", async () => {
    const r = await create(baseUrl2, {
      body: { title: "No-session listing", category: "tools", price: 5, userId: OTHER },
    });
    assert.equal(r.status, 401, JSON.stringify(r.json));
  });

  it("field validation is preserved: a signed-in create without a category still 400s", async () => {
    const r = await create(baseUrl, {
      user: OWNER,
      body: { title: "No category", price: 5 },
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
  });
});
