// Every per-session agent_marathon.* macro is owner-only; research job status too.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import registerAgentMarathonMacros from "../domains/agent-marathon.js";
import { startMarathon, getMarathon } from "../lib/agent-marathon.js";
import { startLongTask, longTaskStatus } from "../lib/long-task.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db); upMig379(db); upMig387(db); upMig394(db);
  const macros = new Map();
  registerAgentMarathonMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  const call = (name, actor, input) => macros.get(`agent_marathon.${name}`)({ db, actor, runMacro: async () => ({ ok: true }), lensActions: new Map() }, input);
  return { db, call };
}

describe("agent_marathon owner checks", () => {
  it("another user and an anonymous caller can't get, tick, pause, abandon, digest or revoke", async () => {
    const { db, call } = setup();
    const m = startMarathon(db, "owner", { goal: "g", title: "t" });
    for (const name of ["get", "tick", "pause", "abandon", "digest", "revoke"]) {
      const other = await call(name, { userId: "mallory" }, { sessionId: m.sessionId });
      assert.equal(other.ok, false, `${name} other`);
      assert.match(String(other.reason), /not_owner|missing_inputs/, `${name} other reason`);
      const anon = await call(name, {}, { sessionId: m.sessionId });
      assert.equal(anon.ok, false, `${name} anon`);
    }
    assert.equal(getMarathon(db, m.sessionId).status, "pending", "untouched");
  });

  it("the owner still can", async () => {
    const { db, call } = setup();
    const m = startMarathon(db, "owner", { goal: "g", title: "t" });
    assert.equal((await call("get", { userId: "owner" }, { sessionId: m.sessionId })).ok, true);
    assert.equal((await call("digest", { userId: "owner" }, { sessionId: m.sessionId })).ok !== false, true);
    assert.equal((await call("abandon", { userId: "owner" }, { sessionId: m.sessionId })).ok, true);
    assert.equal(getMarathon(db, m.sessionId).status, "abandoned");
    assert.equal((await call("get", { userId: "owner" }, { sessionId: "mar_nope" })).reason, "not_found");
  });

  it("research/long-task job status is owner-only", () => {
    const { db } = setup();
    const j = startLongTask(db, { userId: "owner", goal: "research servos and write me a report" });
    assert.equal(longTaskStatus(db, "owner", j.jobId).ok, true);
    assert.equal(longTaskStatus(db, "mallory", j.jobId).reason, "job_not_found");
    assert.equal(longTaskStatus(db, null, j.jobId).ok, false);
  });
});
