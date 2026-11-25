// CB-1357(b) — POST /api/marketplace/orders (server/routes/frontier-part2.js)
// must take the buyer from the authenticated session (req.user), never from
// a userId in the request body. Before the fix the handler destructured
// userId from req.body, so anyone could place an order recorded under
// another user's id. This mirrors the CB-1279-C create-route suite: the app
// is wired the way production wires it (a global session layer populates
// req.user; the factory's requireAuth gates the route), and a second app
// with a pass-through requireAuth proves the handler refuses signed-out
// callers itself. Listing setup sends the seller as BOTH the session user
// and the body userId, so the setup behaves identically whether or not the
// CB-1279-C create fix is present.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createFrontierRoutesPart2 from "../routes/frontier-part2.js";

// Stands in for the global session layer: req.user exists only for an
// authenticated caller. The literal id "anon" models a session layer that
// reports an anonymous principal.
const populateUser = (req, _res, next) => {
  const id = req.headers["x-test-user"];
  if (id) req.user = { id: String(id), role: req.headers["x-test-role"] || "member" };
  next();
};

// Production-shaped requireAuth: refuses when there is no session user.
const requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "authentication_required" });
  next();
};
const passThroughAuth = (_req, _res, next) => next();

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const asUser = (id, role) => ({
  "content-type": "application/json",
  "x-test-user": id,
  ...(role ? { "x-test-role": role } : {}),
});

async function createListing(app, seller, title) {
  const created = await json(`${app.url}/api/marketplace/listings`, {
    method: "POST",
    headers: asUser(seller),
    body: JSON.stringify({ userId: seller, title, description: "d", category: "ai", price: 10 }),
  });
  assert.equal(created.status, 201, `setup listing for ${seller}`);
  return created.body.listing.id;
}

const placeOrder = (app, headers, body) =>
  json(`${app.url}/api/marketplace/orders`, { method: "POST", headers, body: JSON.stringify(body) });

const ordersOf = async (app, user) => {
  const res = await json(`${app.url}/api/marketplace/orders/${user}`, { headers: asUser(user) });
  assert.equal(res.status, 200);
  return res.body.orders;
};

describe("POST /api/marketplace/orders — buyer comes from the session", () => {
  let app;
  let openApp;
  let listingId;
  let systemListingId;
  before(async () => {
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use(populateUser);
    expressApp.use("/api", createFrontierRoutesPart2({ requireAuth }));
    app = await listen(expressApp);

    const open = express();
    open.use(express.json());
    open.use(populateUser);
    open.use("/api", createFrontierRoutesPart2({ requireAuth: passThroughAuth }));
    openApp = await listen(open);

    listingId = await createListing(app, "alice", "Alice's DTU");
    systemListingId = await createListing(app, "system", "System DTU");
  });
  after(async () => {
    await app.close();
    await openApp.close();
  });

  it("records the order under the session caller, no body userId needed", async () => {
    const res = await placeOrder(app, asUser("bob"), { listingId });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.userId, "bob");
    const mine = await ordersOf(app, "bob");
    assert.ok(mine.some((o) => o.id === res.body.order.id));
  });

  it("ignores a body-supplied userId (spoof does not change the buyer)", async () => {
    const res = await placeOrder(app, asUser("bob"), { userId: "mallory", listingId });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.userId, "bob");
    const mallorys = await ordersOf(app, "mallory");
    assert.equal(mallorys.some((o) => o.id === res.body.order.id), false);
  });

  it("refuses a signed-out caller (production wiring)", async () => {
    const res = await placeOrder(app, { "content-type": "application/json" }, { userId: "bob", listingId });
    assert.equal(res.status, 401);
  });

  it("refuses signed-out and anon callers at the handler itself", async () => {
    const noSession = await placeOrder(openApp, { "content-type": "application/json" }, { userId: "buyer", listingId });
    assert.equal(noSession.status, 401);
    assert.equal(noSession.body.error, "authentication_required");
    const anon = await placeOrder(openApp, asUser("anon"), { listingId });
    assert.equal(anon.status, 401);
  });

  it("lets an admin order, recorded under the admin's own id", async () => {
    const res = await placeOrder(app, asUser("root", "admin"), { userId: "alice", listingId });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.userId, "root");
  });

  it("still 404s a missing listing for a signed-in buyer", async () => {
    const res = await placeOrder(app, asUser("bob"), { listingId: "does-not-exist" });
    assert.equal(res.status, 404);
    assert.equal(res.body.reason, "listing_not_found");
  });

  it("still refuses a system listing with 403 system_listing", async () => {
    const res = await placeOrder(app, asUser("bob"), { listingId: systemListingId });
    assert.equal(res.status, 403);
    assert.equal(res.body.reason, "system_listing");
  });

  it("keeps the listingId validation (400 when absent)", async () => {
    const res = await placeOrder(app, asUser("bob"), {});
    assert.equal(res.status, 400);
  });
});
