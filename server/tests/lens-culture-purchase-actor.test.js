// tests/lens-culture-purchase-actor.test.js
//
// POST /api/lens-culture/purchase debits the ledger balance of the buyer it is
// given (economy/lens-culture.js oneTapPurchase -> purchaseArtifact). The buyer
// must be the signed-in account, never body.userId (2026-11-19, PR #2396 review).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createLensCultureRouter from "../routes/lens-culture.js";

// A db stub that records which account the balance check ran for. The artifact
// exists and costs 5 CC; every balance is 0, so the purchase stops at
// insufficient_balance before anything is written.
function stubDb() {
  const balanceChecks = [];
  const db = {
    prepare(sql) {
      return {
        get: (...args) => {
          if (/FROM creative_artifacts/i.test(sql)) return { id: args[0], price: 5, creator_id: "seller", tags_json: "[]", license_json: "{}" };
          if (/FROM economy_ledger/i.test(sql)) { balanceChecks.push(args[0]); return { balance: 0 }; }
          return undefined;
        },
        all: () => [],
        run: () => { throw new Error("no writes expected"); },
      };
    },
    exec() {},
    transaction: (fn) => fn,
  };
  return { db, balanceChecks };
}

function serve(db, user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) req.user = { id: user }; next(); });
  app.use("/api/lens-culture", createLensCultureRouter({ db }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
async function post(server, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("lens-culture one-tap purchase — the buyer is the session", () => {
  it("charges the signed-in account even when the body names someone else", async () => {
    const { db, balanceChecks } = stubDb();
    const s = await serve(db, "alice");
    try {
      const r = await post(s, "/api/lens-culture/purchase", { userId: "victim", artifactId: "a1" });
      assert.equal(r.body.error, "insufficient_balance");
      assert.deepEqual(balanceChecks, ["alice"], "the balance checked (and debited) is the session's, not body.userId");
    } finally { s.close(); }
  });

  it("needs no userId in the body when signed in", async () => {
    const { db, balanceChecks } = stubDb();
    const s = await serve(db, "alice");
    try {
      const r = await post(s, "/api/lens-culture/purchase", { artifactId: "a1" });
      assert.equal(r.body.error, "insufficient_balance");
      assert.deepEqual(balanceChecks, ["alice"]);
    } finally { s.close(); }
  });

  it("with no session (public single-user mode) falls back to the body userId", async () => {
    const { db, balanceChecks } = stubDb();
    const s = await serve(db, null);
    try {
      await post(s, "/api/lens-culture/purchase", { userId: "local", artifactId: "a1" });
      assert.deepEqual(balanceChecks, ["local"]);
    } finally { s.close(); }
  });
});
