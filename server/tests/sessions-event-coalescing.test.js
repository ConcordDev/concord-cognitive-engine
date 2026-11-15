// FIX-kingdoms-005 — the session event log drowned its real
// transitions in duplicate raw rows: form fields merge state on every
// keystroke (WarCampaignSession's declare form calls update_state per
// change), and update_state appended a 'state_merged' event per call,
// so one editing burst at one step read as many identical
// 'state_merged → declare' rows. Consecutive merges at the same step
// now coalesce into the burst's first event; the state itself always
// merges. A merge at a NEW step (or after any other event kind) logs
// fresh.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migrate195 } from "../migrations/195_lens_sessions.js";
import registerSessionsMacros from "../domains/sessions.js";

function setup() {
  const db = new Database(":memory:");
  migrate195(db);
  const map = new Map();
  registerSessionsMacros((domain, name, handler) => map.set(`${domain}.${name}`, handler));
  const call = (name, ctx, input) => map.get(`sessions.${name}`)(ctx, input);
  return { db, call };
}
const AUTH = (db) => ({ db, actor: { userId: "alice" } });

describe("FIX-kingdoms-005 state_merged coalescing", () => {
  it("a burst of merges at one step logs one state_merged event; the state still accumulates", async () => {
    const { db, call } = setup();
    const ctx = AUTH(db);
    const started = await call("start", ctx, { lensId: "kingdoms", title: "War campaign · Home", initialStep: "declare", initialState: { kingdomId: "k1" } });
    const id = started.session.id;
    await call("update_state", ctx, { sessionId: id, statePatch: { target: "R" } });
    await call("update_state", ctx, { sessionId: id, statePatch: { target: "Ri" } });
    await call("update_state", ctx, { sessionId: id, statePatch: { target: "Riv", troops: 50 } });
    const got = await call("get", ctx, { sessionId: id });
    const kinds = got.events.map((e) => e.kind);
    assert.equal(kinds.filter((k) => k === "state_merged").length, 1);
    assert.equal(kinds.filter((k) => k === "started").length, 1);
    assert.equal(got.session.state.target, "Riv");
    assert.equal(got.session.state.troops, 50);
  });

  it("a merge after advancing to a new step logs a fresh event", async () => {
    const { db, call } = setup();
    const ctx = AUTH(db);
    const started = await call("start", ctx, { lensId: "kingdoms", initialStep: "declare", initialState: {} });
    const id = started.session.id;
    await call("update_state", ctx, { sessionId: id, statePatch: { target: "Riv" } });
    await call("advance", ctx, { sessionId: id, toStep: "muster" });
    await call("update_state", ctx, { sessionId: id, statePatch: { troops: 10 } });
    await call("update_state", ctx, { sessionId: id, statePatch: { troops: 20 } });
    const got = await call("get", ctx, { sessionId: id });
    const merges = got.events.filter((e) => e.kind === "state_merged");
    assert.equal(merges.length, 2);
    assert.deepEqual(merges.map((m) => m.toStep).sort(), ["declare", "muster"]);
    assert.equal(got.events.filter((e) => e.kind === "advanced").length, 1);
  });
});
