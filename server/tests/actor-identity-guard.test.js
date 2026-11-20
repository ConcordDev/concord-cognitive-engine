// tests/actor-identity-guard.test.js
//
// The acting account on a write is the signed-in account (lib/actor-identity.js).
// Pins the 2026-11-19 fix for the confirmed theft path: POST
// /api/economic/marketplace/buy debited whatever account body.odId named.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { actorIdentityGuard, claimedActors, normalisePath } from "../lib/actor-identity.js";

function serve(authMode, user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) req.user = { id: user }; next(); });
  app.use(actorIdentityGuard({ authMode }));
  app.all(/.*/, (req, res) => res.json({ ok: true, reached: req.path }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
async function call(server, method, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

describe("actor identity — the payer is the signed-in account", () => {
  it("refuses buying as someone else, allows buying as yourself", async () => {
    const s = await serve("hybrid", "alice");
    try {
      const spoof = await call(s, "POST", "/api/economic/marketplace/buy", { odId: "victim", listingId: "l1" });
      assert.equal(spoof.status, 403);
      assert.equal(spoof.body.error, "not_your_account");
      assert.equal((await call(s, "POST", "/api/economic/marketplace/buy", { odId: "alice", listingId: "l1" })).status, 200);
      // the same holds for each money / ownership route family
      for (const [path, field] of [
        ["/api/artistry/marketplace/purchase", "buyerId"],
        ["/api/artistry/studio/projects", "ownerId"],
        ["/api/creative-commerce/marketplace/purchase", "buyerId"],
        ["/api/canonical/x1/rights/transfer", "fromUserId"],
        ["/api/atlas/rights/transfer", "fromUserId"],
        ["/api/billing/keys", "userId"],
        ["/api/creative-marketplace/artifacts/a1/purchase", "buyerId"],
        ["/api/connective-tissue/dtu/purchase", "buyerId"],
        ["/api/realm/sync", "odId"],
        ["/api/marketplace/orders", "userId"],
      ]) {
        assert.equal((await call(s, "POST", path, { [field]: "victim" })).status, 403, `${path} ${field}`);
        assert.equal((await call(s, "POST", path, { [field]: "alice" })).status, 200, `${path} self`);
      }
      // an actor field in the query string is checked too
      assert.equal((await call(s, "POST", "/api/economic/subscribe?odId=victim", {})).status, 403);
    } finally { s.close(); }
  });

  it("signed out, a claimed actor is refused (401) except in single-user public mode", async () => {
    const s = await serve("hybrid", null);
    const p = await serve("public", null);
    try {
      assert.equal((await call(s, "POST", "/api/economic/marketplace/buy", { odId: "victim", listingId: "l1" })).status, 401);
      assert.equal((await call(p, "POST", "/api/economic/marketplace/buy", { odId: "me", listingId: "l1" })).status, 200);
    } finally { s.close(); p.close(); }
  });

  it("leaves reads, target fields and unlisted routes alone", async () => {
    const s = await serve("hybrid", "alice");
    try {
      assert.equal((await call(s, "GET", "/api/realm/local?odId=bob")).status, 200, "reads are not actions");
      assert.equal((await call(s, "POST", "/api/artistry/distribution/follow", { followerId: "alice", followedId: "bob" })).status, 200, "followedId is a target");
      assert.equal((await call(s, "POST", "/api/connective-tissue/tip", { creatorId: "bob" })).status, 200, "a tip's creator is the recipient");
      assert.equal((await call(s, "POST", "/api/economic/webhook", { odId: "x" })).status, 200, "the Stripe webhook is signature-checked, not session-checked");
      assert.equal((await call(s, "POST", "/api/lens/run", { userId: "bob" })).status, 200, "unlisted route");
    } finally { s.close(); }
    assert.deepEqual(claimedActors("POST", "/api/economic/marketplace/buy", { odId: "" }, {}), [], "an empty field claims nothing");
  });

  it("cannot be bypassed by casing or a trailing slash (Express routes both to the same handler)", async () => {
    const s = await serve("hybrid", "alice");
    try {
      for (const [path, field] of [
        ["/api/Economic/marketplace/buy", "odId"],
        ["/API/economic/marketplace/buy", "odId"],
        ["/api/economic/marketplace/buy/", "odId"],
        ["/api/atlas/rights/transfer/", "fromUserId"],
        ["/api/atlas/rights/Transfer", "fromUserId"],
        ["/api/atlas/rights/transfer//", "fromUserId"],
        ["/api/Artistry/marketplace/purchase", "buyerId"],
        ["/api/canonical/X1/Rights/Transfer/", "fromUserId"],
        ["/api/Lens-Culture/purchase/", "userId"],
      ]) {
        const r = await call(s, "POST", path, { [field]: "victim" });
        assert.equal(r.status, 403, `${path} ${field} must be refused`);
        assert.equal(r.body.error, "not_your_account");
        assert.equal((await call(s, "POST", path, { [field]: "alice" })).status, 200, `${path} self`);
      }
      // the Stripe webhook exclusion survives normalisation (still not session-checked)
      assert.equal((await call(s, "POST", "/api/Economic/Webhook/", { odId: "x" })).status, 200);
    } finally { s.close(); }
    assert.equal(normalisePath("/api/Atlas/Rights/Transfer///"), "/api/atlas/rights/transfer");
    assert.equal(normalisePath("/"), "/");
  });

  it("covers one-tap purchase: POST /api/lens-culture/purchase userId is the payer", async () => {
    const s = await serve("hybrid", "alice");
    const out = await serve("hybrid", null);
    try {
      const spoof = await call(s, "POST", "/api/lens-culture/purchase", { userId: "victim", artifactId: "a1" });
      assert.equal(spoof.status, 403);
      assert.equal(spoof.body.error, "not_your_account");
      assert.equal((await call(s, "POST", "/api/lens-culture/purchase", { userId: "alice", artifactId: "a1" })).status, 200);
      assert.equal((await call(out, "POST", "/api/lens-culture/purchase", { userId: "victim", artifactId: "a1" })).status, 401);
    } finally { s.close(); out.close(); }
  });

  it("is mounted in the real middleware chain, after auth and CSRF", () => {
    const src = fs.readFileSync(new URL("../middleware/index.js", import.meta.url), "utf8");
    const auth = src.indexOf("app.use(authMiddleware)");
    const csrf = src.indexOf("app.use(csrfMiddleware)");
    const guard = src.indexOf("app.use(actorIdentityGuard(");
    assert.ok(auth > 0 && csrf > auth && guard > csrf, "the guard runs after authentication resolves req.user");
  });
});
