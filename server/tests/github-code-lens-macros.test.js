/**
 * Tier-2 contract tests for GH-1 (Sovereign GitHub Code-Lens Loop, urgent
 * unit): the 4 new real macros in server/domains/github.js —
 * repo-tree / file-get / file-commit / branch-create — built on the SAME
 * SSRF-guarded connectorFetch chokepoint (server/lib/connector-client.js) and
 * per-user OAuth token layer (server/lib/connector-tokens.js) as the existing
 * repos/issues/issue-create macros. No parallel git-shell/execSync path, no
 * shared/hardcoded credential.
 *
 * Structure mirrors the established pattern in this repo
 * (connector-refresh-hardening.test.js / connector-extra-paths.test.js):
 *   - lib-function tests exercise the real API shapes end-to-end via the
 *     opts.fetchImpl seam (no live egress);
 *   - a dedicated per-user-token-isolation suite proves two different users'
 *     calls resolve to two different tokens and never cross or fall back;
 *   - a macro-level suite exercises registerLensAction's param-validation +
 *     no-token guard paths (the macros themselves never accept an injectable
 *     fetchImpl in production — that seam only exists at the connectorFetch
 *     boundary, which the lib-function tests already cover end-to-end).
 *
 * Run: node --test server/tests/github-code-lens-macros.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken, getConnectorToken } from "../lib/connector-tokens.js";
import {
  getGitHubRepoTree,
  getGitHubFileContent,
  commitGitHubFile,
  createGitHubBranch,
} from "../lib/connector-client.js";
import registerGithubActions from "../domains/github.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}
function seedToken(db, userId, accessToken = "at-1") {
  persistConnectorToken(db, userId, "github", { access_token: accessToken, scope: "repo" });
}
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

function buildMacros(register) {
  const map = new Map();
  register((domain, name, fn) => map.set(`${domain}.${name}`, fn));
  return map;
}
function callMacro(map, key, ctx, params) {
  const fn = map.get(key);
  assert.ok(fn, `${key} registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

// ── repo-tree ────────────────────────────────────────────────────────────────
describe("getGitHubRepoTree (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "u1"); });
  afterEach(() => { db.close(); });

  it("resolves the real default branch when ref is omitted, then fetches the recursive tree", async () => {
    let calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      if (url === "https://api.github.com/repos/me/repo") {
        return resp({ default_branch: "main" });
      }
      assert.match(url, /\/repos\/me\/repo\/git\/trees\/main\?recursive=1$/);
      assert.match(init.headers["User-Agent"], /concord/);
      return resp({ sha: "tree-sha-1", truncated: false, tree: [
        { path: "server.js", type: "blob", sha: "b1", size: 1234, mode: "100644" },
        { path: "server", type: "tree", sha: "t1" },
      ] });
    };
    const r = await getGitHubRepoTree(db, "u1", "me/repo", {}, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.ref, "main");
    assert.equal(r.sha, "tree-sha-1");
    assert.equal(r.truncated, false);
    assert.equal(r.tree.length, 2);
    assert.equal(r.tree[0].path, "server.js");
    assert.equal(calls.length, 2, "one call to resolve default_branch, one for the tree");
  });

  it("skips default-branch resolution when a ref is explicitly given", async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      calls += 1;
      assert.match(url, /\/git\/trees\/feature-x\?recursive=1$/);
      return resp({ sha: "s2", tree: [] });
    };
    const r = await getGitHubRepoTree(db, "u1", "me/repo", { ref: "feature-x" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.ref, "feature-x");
    assert.equal(calls, 1, "no default-branch lookup when ref is supplied");
  });

  it("requires repo", async () => {
    const r = await getGitHubRepoTree(db, "u1", null, {}, { fetchImpl: async () => resp({}) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_repo");
  });
});

// ── file-get ─────────────────────────────────────────────────────────────────
describe("getGitHubFileContent (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "u1"); });
  afterEach(() => { db.close(); });

  it("decodes real base64 content and returns the blob sha", async () => {
    const raw = "console.log('hello world');\n";
    const b64 = Buffer.from(raw, "utf8").toString("base64");
    let captured = null;
    const fetchImpl = async (url) => {
      captured = url;
      return resp({ type: "file", path: "src/index.js", sha: "blob-sha-1", size: raw.length, content: b64, encoding: "base64", html_url: "https://github.com/me/repo/blob/main/src/index.js" });
    };
    const r = await getGitHubFileContent(db, "u1", "me/repo", "src/index.js", {}, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.content, raw, "base64 decoded back to the exact original bytes");
    assert.equal(r.sha, "blob-sha-1");
    assert.match(captured, /\/repos\/me\/repo\/contents\/src\/index\.js$/);
  });

  it("percent-encodes each path segment individually (not the slashes)", async () => {
    let captured = null;
    const fetchImpl = async (url) => { captured = url; return resp({ type: "file", path: "a b/c.txt", sha: "s", content: "", encoding: "base64" }); };
    await getGitHubFileContent(db, "u1", "me/repo", "a b/c.txt", {}, { fetchImpl });
    assert.match(captured, /\/contents\/a%20b\/c\.txt$/);
  });

  it("appends ?ref= when a ref is given", async () => {
    let captured = null;
    const fetchImpl = async (url) => { captured = url; return resp({ type: "file", path: "x", sha: "s", content: "", encoding: "base64" }); };
    await getGitHubFileContent(db, "u1", "me/repo", "x", { ref: "feature-x" }, { fetchImpl });
    assert.match(captured, /\?ref=feature-x$/);
  });

  it("honest not_a_file when the path resolves to a directory listing", async () => {
    const fetchImpl = async () => resp([{ type: "file", name: "a" }, { type: "dir", name: "b" }]);
    const r = await getGitHubFileContent(db, "u1", "me/repo", "src", {}, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_a_file");
  });

  it("honest 404 -> provider_error/status 404 (R1-3 vocabulary, not a fabricated empty file)", async () => {
    const fetchImpl = async () => resp({ message: "Not Found" }, 404);
    const r = await getGitHubFileContent(db, "u1", "me/repo", "missing.txt", {}, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "provider_error");
    assert.equal(r.status, 404);
  });
});

// ── file-commit ──────────────────────────────────────────────────────────────
describe("commitGitHubFile (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "u1"); });
  afterEach(() => { db.close(); });

  it("create path: PUTs base64 content with NO sha in the body", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return resp({ commit: { sha: "commit-sha-1" }, content: { sha: "file-sha-1", path: "docs/new.md", html_url: "u" } }, 201);
    };
    const r = await commitGitHubFile(db, "u1", "me/repo", "docs/new.md", { content: "# New\n", message: "add doc" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.commitSha, "commit-sha-1");
    assert.equal(r.fileSha, "file-sha-1");
    assert.equal(captured.method, "PUT");
    assert.ok(!("sha" in captured.body), "create must NOT send a sha");
    assert.equal(captured.body.content, Buffer.from("# New\n", "utf8").toString("base64"));
    assert.equal(captured.body.message, "add doc");
  });

  it("update path: PUTs the caller-supplied sha verbatim", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = JSON.parse(init.body);
      return resp({ commit: { sha: "commit-sha-2" }, content: { sha: "file-sha-2", path: "docs/new.md" } });
    };
    const r = await commitGitHubFile(db, "u1", "me/repo", "docs/new.md", { content: "# Updated\n", message: "update doc", sha: "file-sha-1", branch: "feature-x" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.fileSha, "file-sha-2");
    assert.equal(captured.sha, "file-sha-1", "update must send the exact caller-supplied sha");
    assert.equal(captured.branch, "feature-x");
  });

  it("requires content, message, path (validated before any network call)", async () => {
    let hit = false;
    const fetchImpl = async () => { hit = true; return resp({}); };
    const r1 = await commitGitHubFile(db, "u1", "me/repo", "x", { message: "m" }, { fetchImpl }); // no content
    const r2 = await commitGitHubFile(db, "u1", "me/repo", "x", { content: "c" }, { fetchImpl }); // no message
    const r3 = await commitGitHubFile(db, "u1", "me/repo", null, { content: "c", message: "m" }, { fetchImpl }); // no path
    assert.equal(r1.ok, false); assert.equal(r1.reason, "missing_content");
    assert.equal(r2.ok, false); assert.equal(r2.reason, "missing_message");
    assert.equal(r3.ok, false); assert.equal(r3.reason, "missing_path");
    assert.equal(hit, false, "no network call for invalid input");
  });

  it("honest provider_error (e.g. sha mismatch/conflict) is never coerced into a fake success", async () => {
    const fetchImpl = async () => resp({ message: "sha does not match" }, 409);
    const r = await commitGitHubFile(db, "u1", "me/repo", "x", { content: "c", message: "m", sha: "stale-sha" }, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "provider_error");
    assert.equal(r.status, 409);
  });
});

// ── branch-create ────────────────────────────────────────────────────────────
describe("createGitHubBranch (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "u1"); });
  afterEach(() => { db.close(); });

  it("resolves fromRef's real tip commit sha, then POSTs refs/heads/<name>", async () => {
    let calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      if (url === "https://api.github.com/repos/me/repo/commits/main") {
        return resp({ sha: "base-commit-sha" });
      }
      assert.match(url, /\/repos\/me\/repo\/git\/refs$/);
      const body = JSON.parse(init.body);
      assert.equal(body.ref, "refs/heads/feature-y");
      assert.equal(body.sha, "base-commit-sha");
      return resp({ ref: "refs/heads/feature-y", object: { sha: "base-commit-sha" } }, 201);
    };
    const r = await createGitHubBranch(db, "u1", "me/repo", { branchName: "feature-y", fromRef: "main" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.ref, "refs/heads/feature-y");
    assert.equal(r.sha, "base-commit-sha");
    assert.equal(calls.length, 2);
  });

  it("resolving fromRef works uniformly for a tag or sha (not just a branch name)", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/commits/v1.2.3")) return resp({ sha: "tag-commit-sha" });
      return resp({ ref: "refs/heads/from-tag", object: { sha: "tag-commit-sha" } }, 201);
    };
    const r = await createGitHubBranch(db, "u1", "me/repo", { branchName: "from-tag", fromRef: "v1.2.3" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.sha, "tag-commit-sha");
  });

  it("honestly fails when fromRef cannot be resolved (404), never fabricating a branch", async () => {
    let refCallMade = false;
    const fetchImpl = async (url) => {
      if (url.includes("/git/refs")) refCallMade = true;
      return resp({ message: "No commit found for the ref does-not-exist" }, 404);
    };
    const r = await createGitHubBranch(db, "u1", "me/repo", { branchName: "x", fromRef: "does-not-exist" }, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "provider_error");
    assert.equal(r.status, 404);
    assert.equal(refCallMade, false, "must never attempt to create the branch when the base ref didn't resolve");
  });

  it("requires branchName and fromRef", async () => {
    const r1 = await createGitHubBranch(db, "u1", "me/repo", { fromRef: "main" }, { fetchImpl: async () => resp({}) });
    const r2 = await createGitHubBranch(db, "u1", "me/repo", { branchName: "x" }, { fetchImpl: async () => resp({}) });
    assert.equal(r1.ok, false); assert.equal(r1.reason, "missing_branch_name");
    assert.equal(r2.ok, false); assert.equal(r2.reason, "missing_from_ref");
  });
});

// ── Per-user token isolation — the real security-relevant assertion ────────
describe("per-user OAuth token isolation across all 4 new GitHub lib functions", () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); });

  it("repo-tree: two users' calls each carry ONLY their own Authorization token, never the other's", async () => {
    seedToken(db, "u1", "u1-secret-token");
    seedToken(db, "u2", "u2-secret-token");
    const seenAuth = [];
    const fetchImpl = async (url, init) => {
      seenAuth.push(init.headers.Authorization);
      if (url.endsWith("/repos/me/repo")) return resp({ default_branch: "main" });
      return resp({ sha: "s", tree: [] });
    };
    const rU1 = await getGitHubRepoTree(db, "u1", "me/repo", {}, { fetchImpl });
    const rU2 = await getGitHubRepoTree(db, "u2", "me/repo", {}, { fetchImpl });
    assert.equal(rU1.ok, true);
    assert.equal(rU2.ok, true);
    assert.ok(seenAuth.slice(0, 2).every((a) => a === "Bearer u1-secret-token"), "u1's calls used ONLY u1's token");
    assert.ok(seenAuth.slice(2, 4).every((a) => a === "Bearer u2-secret-token"), "u2's calls used ONLY u2's token");
  });

  it("file-get: user A's fetch never observes user B's token even when both are seeded", async () => {
    seedToken(db, "alice", "alice-token");
    seedToken(db, "bob", "bob-token");
    let authForAlice = null, authForBob = null;
    const fetchImpl = async (url, init) => resp({ type: "file", path: "x", sha: "s", content: "", encoding: "base64" });
    const capture = (label) => async (url, init) => {
      if (label === "alice") authForAlice = init.headers.Authorization;
      else authForBob = init.headers.Authorization;
      return fetchImpl(url, init);
    };
    await getGitHubFileContent(db, "alice", "me/repo", "x", {}, { fetchImpl: capture("alice") });
    await getGitHubFileContent(db, "bob", "me/repo", "x", {}, { fetchImpl: capture("bob") });
    assert.equal(authForAlice, "Bearer alice-token");
    assert.equal(authForBob, "Bearer bob-token");
    assert.notEqual(authForAlice, authForBob, "distinct users must never share a resolved token");
  });

  it("file-commit: a write from user B is never authenticated with user A's token, and vice versa", async () => {
    seedToken(db, "u1", "u1-write-token");
    seedToken(db, "u2", "u2-write-token");
    const seenAuth = [];
    const fetchImpl = async (url, init) => {
      seenAuth.push(init.headers.Authorization);
      return resp({ commit: { sha: "c" }, content: { sha: "f", path: "x" } });
    };
    await commitGitHubFile(db, "u1", "me/repo", "x", { content: "a", message: "m" }, { fetchImpl });
    await commitGitHubFile(db, "u2", "me/repo", "x", { content: "b", message: "m" }, { fetchImpl });
    assert.equal(seenAuth[0], "Bearer u1-write-token");
    assert.equal(seenAuth[1], "Bearer u2-write-token");
  });

  it("a user with NO stored token gets an honest no_token — never silently borrows another connected user's token", async () => {
    seedToken(db, "u1", "u1-secret-token"); // only u1 is connected
    let networkHit = false;
    const fetchImpl = async () => { networkHit = true; return resp({}); };
    const r = await getGitHubRepoTree(db, "u2", "me/repo", {}, { fetchImpl }); // u2 never connected
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_token");
    assert.equal(networkHit, false, "must never reach the network with someone else's credential");
    // Confirm u1's token really is on file (so this isn't a false negative from a broken seed).
    assert.ok(getConnectorToken(db, "u1", "github"));
    assert.equal(getConnectorToken(db, "u2", "github"), null);
  });
});

// ── Macro layer: registration + guard/param-validation (registerLensAction) ─
describe("github domain macros — repo-tree / file-get / file-commit / branch-create", () => {
  let db, gh;
  beforeEach(() => { db = freshDb(); gh = buildMacros(registerGithubActions); });
  afterEach(() => { db.close(); });
  const ctx = (userId = "u1") => ({ db, actor: { userId } });

  it("all 4 macros are registered under the github domain", () => {
    for (const name of ["github.repo-tree", "github.file-get", "github.file-commit", "github.branch-create"]) {
      assert.ok(gh.has(name), `${name} must be registered`);
    }
  });

  it("repo-tree: no token -> honest no_token, requires repo param", async () => {
    const noRepo = await callMacro(gh, "github.repo-tree", ctx(), {});
    assert.equal(noRepo.ok, false);
    assert.match(noRepo.error, /repo/);
    const noToken = await callMacro(gh, "github.repo-tree", ctx(), { repo: "me/repo" });
    assert.equal(noToken.ok, false);
    assert.equal(noToken.reason, "no_token");
  });

  it("file-get: requires repo + path, honest no_token otherwise", async () => {
    const noPath = await callMacro(gh, "github.file-get", ctx(), { repo: "me/repo" });
    assert.equal(noPath.ok, false);
    assert.match(noPath.error, /path/);
    const noToken = await callMacro(gh, "github.file-get", ctx(), { repo: "me/repo", path: "x" });
    assert.equal(noToken.ok, false);
    assert.equal(noToken.reason, "no_token");
  });

  it("file-commit: requires repo + path + content + message, honest no_token otherwise", async () => {
    const noContent = await callMacro(gh, "github.file-commit", ctx(), { repo: "me/repo", path: "x", message: "m" });
    assert.equal(noContent.ok, false);
    assert.match(noContent.error, /content/);
    const noMessage = await callMacro(gh, "github.file-commit", ctx(), { repo: "me/repo", path: "x", content: "c" });
    assert.equal(noMessage.ok, false);
    assert.match(noMessage.error, /message/);
    const noToken = await callMacro(gh, "github.file-commit", ctx(), { repo: "me/repo", path: "x", content: "c", message: "m" });
    assert.equal(noToken.ok, false);
    assert.equal(noToken.reason, "no_token");
  });

  it("branch-create: requires repo + branchName + fromRef, honest no_token otherwise", async () => {
    const noBranch = await callMacro(gh, "github.branch-create", ctx(), { repo: "me/repo", fromRef: "main" });
    assert.equal(noBranch.ok, false);
    assert.match(noBranch.error, /branchName/);
    const noFromRef = await callMacro(gh, "github.branch-create", ctx(), { repo: "me/repo", branchName: "x" });
    assert.equal(noFromRef.ok, false);
    assert.match(noFromRef.error, /fromRef/);
    const noToken = await callMacro(gh, "github.branch-create", ctx(), { repo: "me/repo", branchName: "x", fromRef: "main" });
    assert.equal(noToken.ok, false);
    assert.equal(noToken.reason, "no_token");
  });

  it("macros resolve the token strictly from ctx.actor.userId — u1 having a token doesn't let u2's uncredentialed call through", async () => {
    seedToken(db, "u1", "u1-token");
    const asU2 = await callMacro(gh, "github.repo-tree", ctx("u2"), { repo: "me/repo" });
    assert.equal(asU2.ok, false);
    assert.equal(asU2.reason, "no_token", "u2 must not inherit u1's connected token");
  });
});
