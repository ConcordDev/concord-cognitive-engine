// GET /health carries `buildSha` (40-hex git sha of the running tree) so the
// lens walker's sha gate can prove which build it is verifying. Resolved once
// at boot: env CONCORD_BUILD_SHA wins, else `git rev-parse HEAD`, else null —
// never a crash, never a non-200.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBuildSha } from "../lib/build-sha.js";
import registerSystemRoutes from "../routes/system.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";

test("resolveBuildSha: env CONCORD_BUILD_SHA wins and git is never called", () => {
  let called = false;
  const got = resolveBuildSha({ env: { CONCORD_BUILD_SHA: SHA.toUpperCase() }, exec: () => { called = true; return OTHER; } });
  assert.equal(got, SHA);
  assert.equal(called, false);
});

test("resolveBuildSha: falls back to git rev-parse HEAD", () => {
  let args;
  const got = resolveBuildSha({ env: {}, exec: (cmd, a) => { args = [cmd, ...a]; return OTHER + "\n"; } });
  assert.equal(got, OTHER);
  assert.deepEqual(args, ["git", "rev-parse", "HEAD"]);
});

test("resolveBuildSha: git missing => null (no throw)", () => {
  const got = resolveBuildSha({ env: {}, exec: () => { throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }); } });
  assert.equal(got, null);
});

test("resolveBuildSha: garbage env and garbage git output are rejected", () => {
  assert.equal(resolveBuildSha({ env: { CONCORD_BUILD_SHA: "not-a-sha" }, exec: () => "also not a sha" }), null);
  assert.equal(resolveBuildSha({ env: { CONCORD_BUILD_SHA: "abc123" }, exec: () => OTHER }), OTHER); // short env ignored, git used
  assert.equal(resolveBuildSha({ env: {}, exec: () => "" }), null);
});

test("resolveBuildSha: real checkout yields 40-hex or null, nothing else", () => {
  const got = resolveBuildSha({ env: {} });
  assert.ok(got === null || /^[0-9a-f]{40}$/.test(got), String(got));
});

function mountHealth() {
  const routes = new Map();
  const app = new Proxy({}, {
    get: (_t, method) => (routePath, ...handlers) => {
      if (typeof routePath === "string") routes.set(`${String(method).toUpperCase()} ${routePath}`, handlers[handlers.length - 1]);
    },
  });
  const passthrough = () => (_req, _res, next) => next?.();
  registerSystemRoutes(app, {
    STATE: { dtus: new Map(), sessions: new Map() },
    requireRole: passthrough, rateLimiter: passthrough, helmet: passthrough,
    makeCtx: () => ({}), runMacro: async () => ({}), MACROS: new Map(), db: null,
  });
  return routes.get("GET /health");
}

function callHealth(handler) {
  return new Promise((resolve, reject) => {
    const res = { _code: 200, status(c) { this._code = c; return this; }, json(j) { resolve({ code: this._code, body: j }); } };
    handler({ headers: {} }, res, (e) => reject(e || new Error("next() called")));
  });
}

test("GET /health: buildSha is the env value, status 200", async (t) => {
  const prev = process.env.CONCORD_BUILD_SHA;
  process.env.CONCORD_BUILD_SHA = SHA;
  t.after(() => { if (prev === undefined) delete process.env.CONCORD_BUILD_SHA; else process.env.CONCORD_BUILD_SHA = prev; });
  const { code, body } = await callHealth(mountHealth());
  assert.equal(code, 200);
  assert.equal(body.buildSha, SHA);
  assert.match(body.buildSha, /^[0-9a-f]{40}$/);
});

test("GET /health: no env and no git on PATH => buildSha null, still 200", async (t) => {
  const prevSha = process.env.CONCORD_BUILD_SHA;
  const prevPath = process.env.PATH;
  delete process.env.CONCORD_BUILD_SHA;
  process.env.PATH = "/nonexistent-dir-for-test";
  t.after(() => {
    process.env.PATH = prevPath;
    if (prevSha !== undefined) process.env.CONCORD_BUILD_SHA = prevSha;
  });
  const handler = mountHealth(); // resolved at registration, with git unreachable
  process.env.PATH = prevPath;
  const { code, body } = await callHealth(handler);
  assert.equal(code, 200);
  assert.equal(body.buildSha, null);
  assert.equal(body.status, "healthy");
});

test("GET /health: payload exposes only the bare sha (no branch/path/env fields)", async (t) => {
  process.env.CONCORD_BUILD_SHA = SHA;
  t.after(() => { delete process.env.CONCORD_BUILD_SHA; });
  const { body } = await callHealth(mountHealth());
  const keys = Object.keys(body);
  for (const k of ["branch", "gitBranch", "repoPath", "cwd", "env"]) assert.ok(!keys.includes(k), k);
  assert.ok(!JSON.stringify(body).includes("CONCORD_BUILD_SHA"));
});
