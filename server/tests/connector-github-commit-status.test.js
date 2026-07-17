/**
 * Tier-2 contract tests for `writeGitHubCommitStatus`
 * (server/lib/connector-client.js) — the real GitHub commit-status writer
 * cloned from the proven `createGitHubIssue` shape (same SSRF-guarded,
 * per-user-OAuth connectorFetch chokepoint). The provider network is mocked
 * via the opts.fetchImpl seam (no live egress); a valid token is seeded so
 * the helper runs end-to-end through the real POST /repos/{repo}/statuses/{sha}
 * shape. No-token / invalid-state paths are exercised offline and MUST
 * return an honest reason — never a fabricated "posted" success.
 *
 * Run: node --test server/tests/connector-github-commit-status.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import { writeGitHubCommitStatus } from "../lib/connector-client.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}
function seedToken(db, connectorId = "github") {
  persistConnectorToken(db, "u1", connectorId, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "repo" });
}
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

describe("writeGitHubCommitStatus (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db); });
  afterEach(() => { db.close(); });

  it("POSTs to the real /repos/{repo}/statuses/{sha} endpoint with the requested state", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url, method: init.method, headers: init.headers, body: JSON.parse(init.body) };
      return resp({ id: 123456, state: "success", target_url: null });
    };
    const r = await writeGitHubCommitStatus(db, "u1", "me/repo", "abc123def", "success", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.id, 123456);
    assert.equal(r.state, "success");
    assert.equal(captured.method, "POST");
    assert.match(captured.url, /\/repos\/me\/repo\/statuses\/abc123def$/);
    assert.equal(captured.body.state, "success");
    assert.match(captured.headers["User-Agent"], /concord/); // GitHub requires UA (GITHUB_HEADERS)
  });

  it("posts a failure state verbatim (no coercion toward success)", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => { captured = JSON.parse(init.body); return resp({ id: 2, state: "failure" }); };
    const r = await writeGitHubCommitStatus(db, "u1", "me/repo", "sha2", "failure", {
      fetchImpl, context: "concord/dx-detectors", description: "2 blocking findings",
    });
    assert.equal(r.ok, true);
    assert.equal(r.state, "failure");
    assert.equal(captured.state, "failure");
    assert.equal(captured.context, "concord/dx-detectors");
    assert.equal(captured.description, "2 blocking findings");
  });

  it("includes target_url when supplied", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => { captured = JSON.parse(init.body); return resp({ id: 3, state: "pending" }); };
    await writeGitHubCommitStatus(db, "u1", "me/repo", "sha3", "pending", { fetchImpl, targetUrl: "https://concord-os.org/dx" });
    assert.equal(captured.target_url, "https://concord-os.org/dx");
  });

  it("rejects an unrecognized state BEFORE any network call", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return resp({}); };
    const r = await writeGitHubCommitStatus(db, "u1", "me/repo", "sha4", "totally_made_up", { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_state");
    assert.equal(called, false, "must not hit the network with an invalid state");
  });

  it("requires repo and sha", async () => {
    const r1 = await writeGitHubCommitStatus(db, "u1", "", "sha", "success", {});
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, "missing_repo");
    const r2 = await writeGitHubCommitStatus(db, "u1", "me/repo", "", "success", {});
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "missing_sha");
  });

  it("surfaces an honest no_token reason when the user has never connected GitHub — never a faked success", async () => {
    const freshUserDb = db; // same db, different (unconnected) user
    let called = false;
    const fetchImpl = async () => { called = true; return resp({ id: 1 }); };
    const r = await writeGitHubCommitStatus(freshUserDb, "u_never_connected", "me/repo", "sha5", "success", { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_token");
    assert.equal(called, false, "must not hit the network without a token");
  });

  it("surfaces a provider_error honestly on a non-2xx GitHub response (e.g. no repo write access)", async () => {
    const fetchImpl = async () => resp({ message: "Not Found" }, 404);
    const r = await writeGitHubCommitStatus(db, "u1", "me/repo", "sha6", "success", { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "provider_error");
    assert.equal(r.status, 404);
  });
});
