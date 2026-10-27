// server/tests/sync-lens-persistence.test.js
//
// Sync lens history logs, conflict queue, devices and id counters live on
// globalThis._concordSTATE.syncLens. They used to be missing from
// LENS_STATE_KEYS, so a backend restart wiped them. This round-trips the bucket
// through serializeLensState -> JSON -> hydrateLensState into a fresh STATE and
// checks the Sync lens actions read the restored data back.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { serializeLensState, hydrateLensState, LENS_STATE_KEYS } from "../lib/lens-state-persistence.js";
import registerSyncActions from "../domains/sync.js";

const prevState = globalThis._concordSTATE;
after(() => { globalThis._concordSTATE = prevState; });

const actions = new Map();
registerSyncActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
const run = (name, userId, params = {}) => actions.get(`sync.${name}`)({ actor: { userId } }, null, params);

test("syncLens is registered for snapshot persistence", () => {
  assert.ok(LENS_STATE_KEYS.includes("syncLens"));
});

test("sync history, conflicts, devices and seq survive serialize -> hydrate", () => {
  globalThis._concordSTATE = { dtus: new Map() };
  const reg = run("register_device", "u1", { label: "Laptop" });
  assert.equal(reg.ok, true, JSON.stringify(reg));
  const devId = reg.result.device.id;
  const cf = run("report_conflict", "u1", { dtuId: "dtu_42", title: "Notes", localSummary: "a", remoteSummary: "b" });
  assert.equal(cf.ok, true, JSON.stringify(cf));

  const before = globalThis._concordSTATE.syncLens;
  const logsBefore = structuredClone(before.logs.get("u1"));
  const conflictsBefore = structuredClone(before.conflicts.get("u1"));
  assert.ok(logsBefore.length >= 2, "register + conflict each log an entry");
  const seqBefore = before.seq.get("u1");

  const blob = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  assert.ok(blob.syncLens, "syncLens is written to the snapshot");

  // "Restart": brand-new STATE, then hydrate from the persisted blob.
  const fresh = { dtus: new Map() };
  hydrateLensState(fresh, blob);
  globalThis._concordSTATE = fresh;
  const s = fresh.syncLens;
  assert.ok(s.devices instanceof Map && s.logs instanceof Map && s.conflicts instanceof Map && s.seq instanceof Map);
  assert.ok(s.devices.get("u1") instanceof Map, "per-user device registry is a Map again");
  assert.equal(s.devices.get("u1").get(devId)?.label, "Laptop");
  assert.deepEqual(s.logs.get("u1"), logsBefore);
  assert.deepEqual(s.conflicts.get("u1"), conflictsBefore);
  assert.deepEqual(s.seq.get("u1"), seqBefore);

  // The lazy initializer must reuse the hydrated object, not clobber it.
  const hist = run("sync_history", "u1", {});
  assert.equal(hist.ok, true);
  assert.equal(hist.result.timeline?.length ?? hist.result.entries?.length, logsBefore.length);
  const lc = run("list_conflicts", "u1");
  assert.equal(lc.result.open, 1);
  assert.equal(lc.result.conflicts[0].dtuId, "dtu_42");
  assert.equal(globalThis._concordSTATE.syncLens, s);

  // Ids keep counting after restart (no reuse of a pre-restart id).
  const cf2 = run("report_conflict", "u1", { dtuId: "dtu_43" });
  assert.ok(!conflictsBefore.some((c) => c.id === cf2.result.conflict.id), "new id after restart");
});
