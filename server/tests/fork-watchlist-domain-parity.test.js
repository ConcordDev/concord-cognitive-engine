// Contract tests for the fork lens — repo-watchlist substrate + GitHub
// events feed in server/domains/fork.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForkActions from "../domains/fork.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`fork.${name}`);
  assert.ok(fn, `fork.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerForkActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("fork.watchlist management", () => {
  it("adds a watched repo scoped per user", () => {
    call("watch-add", ctxA, { fullName: "nodejs/node", reason: "upstream" });
    assert.equal(call("watch-list", ctxA, {}).result.count, 1);
    assert.equal(call("watch-list", ctxB, {}).result.count, 0);
  });
  it("normalises a github URL and rejects a malformed name", () => {
    const r = call("watch-add", ctxA, { fullName: "https://github.com/vuejs/core.git" });
    assert.equal(r.result.repo.fullName, "vuejs/core");
    assert.equal(call("watch-add", ctxA, { fullName: "not-a-repo" }).ok, false);
  });
  it("rejects a duplicate repo", () => {
    call("watch-add", ctxA, { fullName: "a/b" });
    assert.equal(call("watch-add", ctxA, { fullName: "a/b" }).ok, false);
  });
  it("deletes a repo and aggregates the dashboard", () => {
    const repo = call("watch-add", ctxA, { fullName: "a/b", reason: "fork" }).result.repo;
    const d = call("watch-dashboard", ctxA, {});
    assert.equal(d.result.repos, 1);
    assert.equal(d.result.byReason.fork, 1);
    call("watch-delete", ctxA, { id: repo.id });
    assert.equal(call("watch-list", ctxA, {}).result.count, 0);
  });
});

describe("fork.feed — GitHub repo events → DTUs", () => {
  it("ingests recent repo events as DTUs and dedupes on re-run", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { id: "ev1", type: "PushEvent", actor: { login: "dev" }, created_at: "2026-05-20T00:00:00Z",
        payload: { commits: [{ message: "fix bug" }] } },
      { id: "ev2", type: "PullRequestEvent", actor: { login: "rev" }, created_at: "2026-05-20T01:00:00Z",
        payload: { action: "opened", pull_request: { number: 9, title: "Add feature" } } },
    ]) });
    const created = [];
    const ctx = {
      actor: { userId: "user_a" }, userId: "user_a",
      macro: { run: async (d, n, input) => { const dtu = { id: `dtu${created.length}`, ...input }; created.push(dtu); return { ok: true, dtu }; } },
    };
    const r = await call("feed", ctx, { fullName: "nodejs/node" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ingested, 2);
    assert.ok(created[0].tags.includes("github"));
    const again = await call("feed", ctx, { fullName: "nodejs/node" });
    assert.equal(again.result.ingested, 0);
    assert.equal(again.result.skipped, 2);
  });
});
