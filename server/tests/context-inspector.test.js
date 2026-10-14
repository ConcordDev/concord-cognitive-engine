/**
 * Auth-scoped GET /api/context/inspector aggregate (Debug Context panel).
 *
 * Pins: real context-engine data for the caller; second account cannot see
 * the first account's sessions / pins / profile rows.
 *
 * Run:
 *   NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs \
 *     --test-timeout=300000 tests/context-inspector.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  processQuery,
  updateUserProfile,
  getContextInspector,
} from "../emergent/context-engine.js";

function freshSTATE() {
  return {
    __emergent: {},
    dtus: new Map([
      ["dtu_alpha", { id: "dtu_alpha", title: "Alpha Claim", tags: ["alpha", "context"], tier: "regular" }],
      ["dtu_beta", { id: "dtu_beta", title: "Beta Note", tags: ["beta"], tier: "regular" }],
      ["dtu_secret", { id: "dtu_secret", title: "Acct1 Secret", tags: ["secret"], tier: "regular" }],
    ]),
    shadowDtus: new Map(),
  };
}

describe("getContextInspector — auth-scoped aggregate", () => {
  let STATE;

  beforeEach(() => {
    STATE = freshSTATE();
  });

  it("rejects missing userId", () => {
    const r = getContextInspector(STATE, null);
    assert.equal(r.ok, false);
    assert.equal(r.error, "auth_required");
  });

  it("returns 200-shaped empty inspector for a user with no sessions", () => {
    const r = getContextInspector(STATE, "user_a");
    assert.equal(r.ok, true);
    assert.equal(r.workingSet.totalSize, 0);
    assert.deepEqual(r.pinnedDtus, []);
    assert.deepEqual(r.coActivationPatterns, []);
    assert.deepEqual(r.userProfiles, []);
    assert.equal(r.engine.activeSessions, 0);
    assert.equal(r.engine.userProfileCount, 0);
    assert.equal(typeof r.metrics.queriesProcessed, "number");
  });

  it("surfaces the caller's real working set, pins, co-activation, and profile", () => {
    processQuery(STATE, "sess_a1", {
      query: "alpha context",
      userId: "user_a",
      pinnedIds: ["dtu_alpha"],
      lens: "chat",
    });
    updateUserProfile(STATE, "user_a", "sess_a1");

    const r = getContextInspector(STATE, "user_a");
    assert.equal(r.ok, true);
    assert.ok(r.workingSet.totalSize >= 1, "working set should include activated DTUs");
    assert.ok(r.pinnedDtus.some((p) => p.dtuId === "dtu_alpha" && p.title === "Alpha Claim"));
    assert.ok(r.coActivationPatterns.some((c) => c.sessionId === "sess_a1" && c.trackedDtus >= 1));
    assert.equal(r.userProfiles.length, 1);
    assert.equal(r.userProfiles[0].label, "you");
    assert.ok(r.userProfiles[0].topDtus.some((t) => t.dtuId === "dtu_alpha"));
    assert.equal(r.engine.activeSessions, 1);
    assert.equal(r.engine.userProfileCount, 1);
  });

  it("two-account isolation: acct2 cannot see acct1 sessions, pins, or profile DTUs", () => {
    processQuery(STATE, "sess_a_secret", {
      query: "secret",
      userId: "user_a",
      pinnedIds: ["dtu_secret"],
      retrievalHits: [{ dtuId: "dtu_secret", score: 0.9 }],
      lens: "research",
    });
    updateUserProfile(STATE, "user_a", "sess_a_secret");

    processQuery(STATE, "sess_b1", {
      query: "beta",
      userId: "user_b",
      pinnedIds: ["dtu_beta"],
      retrievalHits: [{ dtuId: "dtu_beta", score: 0.8 }],
      lens: "chat",
    });

    const a = getContextInspector(STATE, "user_a");
    const b = getContextInspector(STATE, "user_b");

    assert.equal(a.ok, true);
    assert.equal(b.ok, true);

    // acct1 sees own pin + profile; not acct2's
    assert.ok(a.pinnedDtus.some((p) => p.dtuId === "dtu_secret"));
    assert.ok(!a.pinnedDtus.some((p) => p.dtuId === "dtu_beta"));
    assert.ok(a.coActivationPatterns.every((c) => c.sessionId === "sess_a_secret"));
    assert.ok(
      !JSON.stringify(a).includes("dtu_beta") ||
        a.pinnedDtus.every((p) => p.dtuId !== "dtu_beta"),
    );

    // acct2 sees own pin; not acct1's secret
    assert.ok(b.pinnedDtus.some((p) => p.dtuId === "dtu_beta"));
    assert.ok(!b.pinnedDtus.some((p) => p.dtuId === "dtu_secret"));
    assert.ok(!b.coActivationPatterns.some((c) => c.sessionId === "sess_a_secret"));
    assert.ok(
      !(b.userProfiles[0]?.topDtus || []).some((t) => t.dtuId === "dtu_secret"),
    );
    assert.ok(!JSON.stringify(b.pinnedDtus).includes("dtu_secret"));
    assert.ok(!JSON.stringify(b.coActivationPatterns).includes("sess_a_secret"));
    assert.ok(!JSON.stringify(b.userProfiles).includes("dtu_secret"));
  });
});
