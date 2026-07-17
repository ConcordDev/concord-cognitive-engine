// Tests for dx-platform.postCommitStatus — the real GitHub commit-status
// write driven by the SAME real detector pass reviewDiff uses
// (parseAndScanDiff). Pins that the state posted to GitHub is NEVER
// hardcoded: 'failure' only when the real scan finds a blocking finding at
// or above the failOn threshold, 'success' only when it's clean. Egress is
// mocked via the __fetchImpl same-process test seam (identical idiom to
// connectorFetch's own opts.fetchImpl and domains/travel.js's Gmail-sync
// macro) — no live network, no fabricated "posted" success.
//
// Run: node --test server/tests/dx-platform-commit-status.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDxPlatformActions from "../domains/dx-platform.js";
import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";

const ACTIONS = new Map();
// Same shim contract as dx-platform-domain-macros.test.js — the domain
// registers through the canonical `register(domain, name, fn)` path, fn has
// the (ctx, input) signature runMacro drives.
function register(domain, name, fn) {
  assert.equal(domain, "dx-platform", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`dx-platform.${name} not registered`);
  return await fn(ctx, input);
}

before(() => { registerDxPlatformActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}
function seedToken(db, userId = "user_a") {
  persistConnectorToken(db, userId, "github", { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "repo" });
}
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

// Trips secret_leak (S5) — well above every failOn threshold.
const DIRTY_DIFF = [
  "--- a/src/auth.js",
  "+++ b/src/auth.js",
  "@@ -1,1 +1,2 @@",
  "+const apiKey = 'sk-abcdef1234567890';",
].join("\n");

// Trips nothing at all.
const CLEAN_DIFF = [
  "--- a/src/util.js",
  "+++ b/src/util.js",
  "@@ -1,1 +1,2 @@",
  "+export function add(a, b) { return a + b; }",
].join("\n");

// Trips only todo_marker (S1) — below the default 'error' gate (threshold 4)
// but at/above the 'any' gate (threshold 1).
const TODO_DIFF = [
  "--- a/src/f.js",
  "+++ b/src/f.js",
  "@@ -1,1 +1,2 @@",
  "+// TODO: fix this later",
].join("\n");

describe("dx-platform.postCommitStatus — argument guards (no network reached)", () => {
  const ctx = () => ({ db: freshDb(), actor: { userId: "user_a" } });

  it("requires auth", async () => {
    const out = await call("postCommitStatus", {}, { repo: "me/repo", commitSha: "s", diff: DIRTY_DIFF });
    assert.equal(out.ok, false);
    assert.equal(out.error, "auth_required");
  });
  it("requires repo", async () => {
    const out = await call("postCommitStatus", ctx(), { commitSha: "s", diff: DIRTY_DIFF });
    assert.equal(out.ok, false);
    assert.equal(out.error, "no_repo");
  });
  it("requires commitSha", async () => {
    const out = await call("postCommitStatus", ctx(), { repo: "me/repo", diff: DIRTY_DIFF });
    assert.equal(out.ok, false);
    assert.equal(out.error, "no_commit_sha");
  });
  it("requires diff", async () => {
    const out = await call("postCommitStatus", ctx(), { repo: "me/repo", commitSha: "s" });
    assert.equal(out.ok, false);
    assert.equal(out.error, "no_diff");
  });
});

describe("dx-platform.postCommitStatus — real analysis drives the posted state", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db); });
  afterEach(() => { db.close(); });
  const ctx = (userId = "user_a") => ({ db, actor: { userId } });

  it("posts 'failure' (never hardcoded success) when the real scan finds a blocking finding", async () => {
    let captured = null;
    const __fetchImpl = async (url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return resp({ id: 1, state: "failure" });
    };
    const out = await call("postCommitStatus", ctx(), {
      repo: "me/repo", commitSha: "deadbeef", diff: DIRTY_DIFF, __fetchImpl,
    });
    assert.equal(out.ok, true);
    assert.equal(out.result.state, "failure");
    assert.equal(out.result.passed, false);
    assert.ok(out.result.blockingCount >= 1, "secret_leak must count as blocking under the default gate");
    assert.equal(out.result.findingCount >= out.result.blockingCount, true);
    assert.match(captured.url, /\/repos\/me\/repo\/statuses\/deadbeef$/);
    assert.equal(captured.method, "POST");
    assert.equal(captured.body.state, "failure");
    assert.equal(captured.body.context, "concord/dx-detectors");
  });

  it("posts 'success' only when the real scan is clean", async () => {
    let captured = null;
    const __fetchImpl = async (url, init) => { captured = JSON.parse(init.body); return resp({ id: 2, state: "success" }); };
    const out = await call("postCommitStatus", ctx(), {
      repo: "me/repo", commitSha: "cafef00d", diff: CLEAN_DIFF, __fetchImpl,
    });
    assert.equal(out.ok, true);
    assert.equal(out.result.state, "success");
    assert.equal(out.result.passed, true);
    assert.equal(out.result.blockingCount, 0);
    assert.equal(captured.state, "success");
  });

  it("the SAME diff flips from success to failure purely by changing failOn — proves the verdict is computed, not fixed", async () => {
    const statesPosted = [];
    const passUnderError = await call("postCommitStatus", ctx(), {
      repo: "me/repo", commitSha: "sha1", diff: TODO_DIFF, failOn: "error",
      __fetchImpl: async (url, init) => { statesPosted.push(JSON.parse(init.body).state); return resp({ id: 3, state: "success" }); },
    });
    assert.equal(passUnderError.result.state, "success");
    assert.equal(passUnderError.result.passed, true);

    const failUnderAny = await call("postCommitStatus", ctx(), {
      repo: "me/repo", commitSha: "sha2", diff: TODO_DIFF, failOn: "any",
      __fetchImpl: async (url, init) => { statesPosted.push(JSON.parse(init.body).state); return resp({ id: 4, state: "failure" }); },
    });
    assert.equal(failUnderAny.result.state, "failure");
    assert.equal(failUnderAny.result.passed, false);
    assert.deepEqual(statesPosted, ["success", "failure"]);
  });

  it("returns an honest no_token failure — never a fabricated 'posted' success — when the user hasn't connected GitHub", async () => {
    let called = false;
    const out = await call("postCommitStatus", ctx("user_never_connected"), {
      repo: "me/repo", commitSha: "abc", diff: DIRTY_DIFF,
      __fetchImpl: async () => { called = true; return resp({ id: 99 }); },
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_token");
    assert.equal(called, false, "must never reach the network without a token");
  });

  it("propagates a real GitHub provider error honestly (e.g. no repo write access)", async () => {
    const out = await call("postCommitStatus", ctx(), {
      repo: "me/repo", commitSha: "sha9", diff: CLEAN_DIFF,
      __fetchImpl: async () => resp({ message: "Not Found" }, 404),
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "provider_error");
  });
});
