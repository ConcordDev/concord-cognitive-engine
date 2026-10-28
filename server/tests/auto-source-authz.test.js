// Phase 9a review fixes: auto-source never runs for signed-out callers, the
// enabled gate is honoured, a status read exposes caps/usage, and Publish
// trusts only the server-set ownerId (never client-writable meta.userId) and
// refuses quarantined drafts. No network: handlers are captured from the
// research domain registrar and driven with stub contexts.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerResearchActions from "../domains/research.js";
import { publishAutoSourceSummary, _resetAutoSourceForTests, autoSourceUsage, recordAutoSourceRun } from "../lib/auto-source.js";

const handlers = new Map();
registerResearchActions((domain, name, fn) => { handlers.set(`${domain}.${name}`, fn); });
const call = (name, ctx, params) => handlers.get(`research.${name}`)(ctx, null, params);
const anon = { actor: null };
const member = (id = "u-authz-1") => ({ actor: { userId: id, role: "member" }, macro: { run: async () => ({ ok: true, dtus: [] }) }, log: () => {} });

let prevEnabled;
beforeEach(() => { _resetAutoSourceForTests(); prevEnabled = process.env.CONCORD_AUTOSOURCE_ENABLED; delete process.env.CONCORD_AUTOSOURCE_ENABLED; delete process.env.AUTH_MODE; });
afterEach(() => { if (prevEnabled === undefined) delete process.env.CONCORD_AUTOSOURCE_ENABLED; else process.env.CONCORD_AUTOSOURCE_ENABLED = prevEnabled; });

test("signed-out callers are refused even when enabled; nothing is counted", async () => {
  process.env.CONCORD_AUTOSOURCE_ENABLED = "1";
  const r = await call("auto-source", anon, { topic: "wetlands" });
  assert.equal(r.ok, false);
  assert.notEqual(r.error, "auto_source_disabled");
  assert.equal(autoSourceUsage(null).usedToday, 0);
  const p = await call("auto-source-publish", anon, { summaryId: "x" });
  assert.equal(p.ok, false);
});

test("disabled by default: a signed-in run gets auto_source_disabled", async () => {
  const r = await call("auto-source", member(), { topic: "wetlands" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "auto_source_disabled");
  assert.equal(autoSourceUsage(null).usedToday, 0);
});

test("status reports enabled flag, caps and usage", async () => {
  let s = await call("auto-source-status", anon, {});
  assert.equal(s.ok, true);
  assert.equal(s.result.enabled, false);
  assert.equal(s.result.signedIn, false);
  assert.equal(s.result.dailyCap, 200);
  assert.equal(s.result.perUserHourly, 5);
  assert.equal(s.result.usedThisHour, undefined);
  process.env.CONCORD_AUTOSOURCE_ENABLED = "1";
  recordAutoSourceRun("u-authz-1");
  s = await call("auto-source-status", member(), {});
  assert.equal(s.result.enabled, true);
  assert.equal(s.result.signedIn, true);
  assert.equal(s.result.usedToday, 1);
  assert.equal(s.result.usedThisHour, 1);
  assert.equal(s.result.remainingThisHour, 4);
});

test("publish: forged meta.userId without matching ownerId is refused", async () => {
  const store = new Map([["s1", { id: "s1", ownerId: "victim", visibility: "private", meta: { kind: "auto-source", userId: "attacker", citationIds: [] } }]]);
  let flipped = false;
  const r = await publishAutoSourceSummary({ summaryId: "s1", userId: "attacker" }, { getDtu: async (id) => store.get(id) || null, setVisibility: () => { flipped = true; return true; } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_author");
  assert.equal(flipped, false);
});

test("publish: quarantined drafts are refused", async () => {
  const store = new Map([["s2", { id: "s2", ownerId: "u1", visibility: "private", tags: ["quarantine:spam"], meta: { kind: "auto-source", citationIds: [] } }]]);
  let flipped = false;
  const r = await publishAutoSourceSummary({ summaryId: "s2", userId: "u1" }, { getDtu: async (id) => store.get(id) || null, setVisibility: () => { flipped = true; return true; } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "quarantined");
  assert.equal(flipped, false);
});
