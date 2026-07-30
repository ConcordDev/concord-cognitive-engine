/**
 * server/tests/ingest-tier-role-derivation.test.js
 *
 * Security audit 2026-07-30 (follow-on to the ingest-engine SSRF fix).
 *
 * POST /api/ingest/submit used to read `tier` straight off the request body
 * (`req.body?.tier || "free"`). TIERS.SOVEREIGN bypasses the ingest queue for
 * immediate processing, waives the domain blocklist, and lifts the per-day
 * page cap to Infinity — so any caller could self-declare "sovereign" and
 * get all three, independent of who they actually were (the tier-gated
 * request schema doesn't even recognize the engine's real tier strings, but
 * that was incidental, not a deliberate control).
 *
 * Fix: routes/operations.js now derives tier from the real authenticated
 * user's role via the exported `ingestTierForRole()` helper — the request
 * body's tier field is never read again. Only owner/admin/founder/sovereign
 * roles get TIERS.SOVEREIGN; everyone else (including anonymous callers)
 * gets TIERS.FREE, with no "paid"/"researcher" tier backed by any real user
 * field today.
 *
 * Two layers pinned here:
 *  1. `ingestTierForRole()` directly — the pure decision function.
 *  2. The real HTTP route, hermetically mounted, proving a caller's own
 *     `tier` claim in the request body is never consulted — a guest posting
 *     `tier: "global"` (a value the request schema even accepts) still ends
 *     up queued at the FREE tier, not "global" and not "sovereign".
 *     Deliberately never exercises the owner/sovereign path through the real
 *     HTTP route, since that path performs an immediate live content fetch —
 *     `ingestTierForRole()` covers that branch directly instead.
 *
 * Run: node --test server/tests/ingest-tier-role-derivation.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerOperationRoutes, { ingestTierForRole } from "../routes/operations.js";
import { getIngestStatus } from "../emergent/ingest-engine.js";

describe("ingestTierForRole — pure role-to-tier decision", () => {
  it("grants sovereign only to the sovereign-family roles", () => {
    for (const role of ["owner", "admin", "founder", "sovereign"]) {
      assert.equal(ingestTierForRole(role), "sovereign", `role ${role} should be sovereign`);
    }
  });

  it("everyone else — including guests and unrecognized roles — gets free", () => {
    for (const role of ["guest", "member", "paid", "researcher", "moderator", undefined, ""]) {
      assert.equal(ingestTierForRole(role), "free", `role ${JSON.stringify(role)} should be free`);
    }
  });
});

function makeApp() {
  const app = express();
  app.use(express.json());
  // Test-only auth shim, same convention as chat-session-ownership-gate.test.js
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    const role = req.get("x-test-user-role");
    if (uid) req.user = { id: uid, role: role || undefined };
    next();
  });

  registerOperationRoutes(app, {
    STATE: { queues: {} },
    makeCtx: () => ({}),
    runMacro: async () => ({ ok: true }),
    _withAck: (x) => x,
    ensureOrganRegistry: () => {},
    ensureQueues: () => {},
    userVisibleDTUs: () => [],
    uid: (prefix) => `${prefix}_test_${Math.random().toString(36).slice(2)}`,
    sha256Hex: () => "stub",
    nowISO: () => new Date().toISOString(),
    saveStateDebounced: () => {},
    requireRole: () => (_req, _res, next) => next(),
    PIPE: {},
    TEMPORAL_FRAMES: {},
    pipeListProposals: () => [],
    computeAbstractionSnapshot: () => ({}),
    maybeRunLocalUpgrade: () => {},
    runAutoPromotion: () => {},
    tryLoadSeedDTUs: () => {},
    toOptionADTU: (x) => x,
    SEED_INFO: {},
    kernelTick: () => {},
    uiJson: (res, body) => res.json(body),
  });
  return app;
}

async function postSubmit(app, body, opts = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = { "content-type": "application/json" };
    if (opts.userId) headers["x-test-user-id"] = opts.userId;
    if (opts.role) headers["x-test-user-role"] = opts.role;
    const res = await fetch(`http://127.0.0.1:${port}/api/ingest/submit`, {
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

describe("POST /api/ingest/submit — tier comes from role, never the request body", () => {
  it("a guest claiming tier: 'global' in the body still gets queued at FREE, not 'global'", async () => {
    const app = makeApp();
    // "global" is one of the request schema's own accepted enum values —
    // proving even a schema-legal tier claim is ignored, not just an
    // out-of-schema one like a literal "sovereign" would have been.
    const { status, body } = await postSubmit(app, {
      url: "https://en.wikipedia.org/wiki/Special:Random",
      tier: "global",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.ingestId);

    const job = getIngestStatus(body.ingestId);
    assert.ok(job, "job must be recorded");
    assert.equal(job.tier, "free");
    assert.equal(job.status, "queued", "non-sovereign tier must queue, never process immediately");
  });

  it("an authenticated non-privileged user also gets FREE regardless of body tier", async () => {
    const app = makeApp();
    const { status, body } = await postSubmit(
      app,
      { url: "https://en.wikipedia.org/wiki/Special:Random", tier: "regional" },
      { userId: "u-member-1", role: "member" }
    );
    assert.equal(status, 200);
    const job = getIngestStatus(body.ingestId);
    assert.equal(job.tier, "free");
  });
});
