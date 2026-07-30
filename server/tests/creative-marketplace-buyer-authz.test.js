/**
 * server/tests/creative-marketplace-buyer-authz.test.js
 *
 * Security audit 2026-07-30 — same wallet-drain IDOR class already fixed on
 * POST /api/connective-tissue/dtu/purchase (see
 * connective-tissue-funds-source-authz.test.js), found in the same targeted
 * re-grep for req.body identity fields used as a money source.
 *
 * POST /api/artifacts/:id/purchase read `buyerId` straight off the request
 * body. The router's own `authForWrites` middleware guarantees SOME session
 * is valid on every non-GET request, but nothing checked that the session
 * belonged to the buyerId footing the bill — so any authenticated caller
 * could force an arbitrary victim's wallet to fund a "purchase" that pays
 * the seller (or, via wash trading, the attacker themselves).
 *
 * Fixed with an inline check mirroring connective-tissue.js's requireSelf:
 * reject 403 when buyerId is supplied and doesn't match req.user.id,
 * fail-open only when req.user is genuinely absent (AUTH_MODE=public).
 *
 * This test uses a throwing db stub to prove the reject path never reaches
 * purchaseArtifact() at all (zero DB interaction on a mismatch), and that a
 * self-matching buyerId is let through past the identity check specifically
 * (the full purchase-economy schema is exercised separately by
 * tests/creative-marketplace.test.js — this test only pins the new gate).
 *
 * Run: node --test server/tests/creative-marketplace-buyer-authz.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createCreativeMarketplaceRouter from "../routes/creative-marketplace.js";

function throwingDb() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("db must not be touched when the identity check rejects the request");
      },
    }
  );
}

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    if (uid) req.user = { id: uid };
    next();
  });
  const requireAuth = () => (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
    next();
  };
  app.use("/api", createCreativeMarketplaceRouter({ db, requireAuth, detectWashTrading: null }));
  return app;
}

async function post(app, path, body, callerId) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = { "content-type": "application/json" };
    if (callerId) headers["x-test-user-id"] = callerId;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("POST /api/artifacts/:id/purchase — buyerId must be the caller", () => {
  it("401s a fully anonymous caller (authForWrites gates all non-GET methods)", async () => {
    const app = makeApp(throwingDb());
    const { status } = await post(app, "/api/artifacts/art1/purchase", { buyerId: "victim" });
    assert.equal(status, 401);
  });

  it("rejects buyerId != caller with 403, and never touches the db", async () => {
    const app = makeApp(throwingDb());
    const { status, body } = await post(
      app,
      "/api/artifacts/art1/purchase",
      { buyerId: "victim" },
      "attacker"
    );
    assert.equal(status, 403);
    assert.match(body.error, /unauthorized/);
  });

  it("a self-matching buyerId passes the identity gate (proceeds to the real handler)", async () => {
    const app = makeApp(throwingDb());
    const { status, body } = await post(
      app,
      "/api/artifacts/art1/purchase",
      { buyerId: "attacker" },
      "attacker"
    );
    // Not 403/401 — the identity check let it through; it then 500s because
    // the stub db throws the instant purchaseArtifact touches it, which is
    // exactly the proof this test wants (past the gate, not a functional
    // claim about the purchase economy itself).
    assert.notEqual(status, 403);
    assert.notEqual(status, 401);
    assert.equal(status, 500, `expected the stub db's throw to surface as a 500, got ${status} ${JSON.stringify(body)}`);
  });

  it("omitting buyerId entirely is not blocked by this gate (existing missing_buyer_id validation applies downstream)", async () => {
    const app = makeApp(throwingDb());
    const { status } = await post(app, "/api/artifacts/art1/purchase", {}, "attacker");
    assert.notEqual(status, 403, "an absent buyerId must not trip the identity mismatch check");
  });
});
