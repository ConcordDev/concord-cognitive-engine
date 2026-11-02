// Quality gate for user memory (must pass before each phase ships): recall the right preference, never surface
// stale or irrelevant memories, never leak across users. Deterministic fixtures, no LLM.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/495_user_memory.js";
import * as M from "../lib/user-memory.js";

const ENV = { CONCORD_USER_MEMORY: "1" };
function world() {
  const db = new Database(":memory:");
  up(db);
  for (const u of ["alice", "bob"]) M.setEnabled(db, u, true);
  return db;
}
const say = (db, u, text, ctx = {}) => M.captureFromMessage(db, u, text, { env: ENV, ...ctx });
const vals = (db, u, q = {}) => M.recall(db, u, q).map((r) => r.value);

describe("eval: recall the right memory", () => {
  const db = world();
  say(db, "alice", "I prefer tabs for indentation");
  say(db, "alice", "Remember that my project is Orbit Planner", { projectId: "orbit" });
  say(db, "alice", "Remember that the orbit planner deploys on fridays", { projectId: "orbit" });
  say(db, "alice", "Remember that the garden app uses postgres", { projectId: "garden" });

  it("preference is recalled with no query match needed", () => {
    assert.ok(vals(db, "alice", { queryText: "anything" }).some((v) => /tabs/.test(v)));
  });
  it("project question retrieves that project's memory", () => {
    assert.ok(vals(db, "alice", { projectId: "orbit", queryText: "when does orbit planner deploy" }).some((v) => /fridays/.test(v)));
  });
  it("irrelevant project memory is not surfaced", () => {
    assert.ok(!vals(db, "alice", { projectId: "orbit", queryText: "orbit planner" }).some((v) => /postgres/.test(v)));
  });
  it("an off-topic query still ranks the always-on preference first and never pulls another project's memory", () => {
    const r = vals(db, "alice", { projectId: "orbit", queryText: "quantum chromodynamics lecture" });
    assert.match(r[0], /tabs/);
    assert.ok(!r.some((v) => /postgres/.test(v)));
  });
});

describe("eval: no stale memories", () => {
  it("after a contradicting preference only the newest is recalled; history is still visible", () => {
    const db = world();
    say(db, "alice", "I prefer tabs for indentation", { now: 1000 });
    say(db, "alice", "I prefer spaces for indentation", { now: 2000 });
    const r = vals(db, "alice", { now: 3000 });
    assert.equal(r.length, 1);
    assert.match(r[0], /spaces/);
    const f = M.listFacts(db, "alice", { status: "superseded" });
    assert.equal(f.length, 1);
    assert.match(f[0].value, /tabs/);
  });
  it("a forgotten memory never comes back", () => {
    const db = world();
    say(db, "alice", "I prefer short answers");
    const id = M.listFacts(db, "alice")[0].id;
    M.forgetFact(db, "alice", id);
    assert.deepEqual(vals(db, "alice"), []);
  });
});

describe("eval: no cross-user leakage", () => {
  it("bob gets nothing of alice's across every read surface, whatever he asks", () => {
    const db = world();
    say(db, "alice", "Remember that my codename is bluefinch");
    say(db, "alice", "I prefer short answers");
    for (const q of ["bluefinch", "codename", "short answers", "alice"]) {
      assert.deepEqual(vals(db, "bob", { queryText: q }), [], q);
      assert.deepEqual(vals(db, "bob", { queryText: q, queryEmbedding: [1, 0, 0] }), [], q);
    }
    assert.deepEqual(M.listFacts(db, "bob", { search: "bluefinch" }), []);
    assert.ok(!JSON.stringify(M.exportMemory(db, "bob")).includes("bluefinch"));
  });
});

describe("eval: secrets are never remembered", () => {
  it("none of the sensitive inputs is stored or recalled", () => {
    const db = world();
    for (const t of ["remember my password is hunter2", "remember sk-abcdefghijklmnopqrstuvwxyz", "remember card 4111 1111 1111 1111"]) say(db, "alice", t);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM user_memory_facts").get().c, 0);
  });
});
