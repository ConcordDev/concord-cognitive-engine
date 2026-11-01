// Brief F: the gate as a service — modes, applying outcomes, retention batches, no deletion, metrics.
import test from "node:test";
import assert from "node:assert/strict";
import { createVerifyGateService, verifyGateMode, candidateOf } from "../lib/verify-gate/service.js";

function fakeStore(dtus) {
  const map = new Map(dtus.map((d) => [d.id, d]));
  const log = [];
  let cursor = 0;
  return {
    map, log,
    get: (id) => map.get(id) || null,
    annotate: (id, v) => { map.get(id).meta = { ...(map.get(id).meta || {}), verification: v }; log.push(["annotate", id, v.outcome]); },
    demote: (id, o) => { const d = map.get(id); d.meta = { ...(d.meta || {}), demotedFrom: o.from }; d.tier = o.tier; d.tags = [...(d.tags || []), o.tag]; log.push(["demote", id, o.tier, o.tag]); },
    quarantine: (id, why) => { const d = map.get(id); d.tags = [...(d.tags || []), `quarantine:${why}`]; log.push(["quarantine", id]); },
    scan: (max) => { const all = [...map.values()]; const slice = all.slice(cursor, cursor + max); cursor = cursor + max >= all.length ? 0 : cursor + max; return { examined: slice.length, found: slice.filter((d) => d.tier === "mega" || d.tier === "hyper") }; },
  };
}
const mega = (id, claims, extra = {}) => ({ id, tier: "mega", title: `MEGA — ${id}`, core: { claims }, tags: [], meta: {}, ...extra });
const deps = { dtuExists: async () => true };

test("mode defaults to observe; off and enforce are read; junk falls back to observe", () => {
  assert.equal(verifyGateMode({}), "observe");
  assert.equal(verifyGateMode({ CONCORD_VERIFY_GATE_MODE: "ENFORCE" }), "enforce");
  assert.equal(verifyGateMode({ CONCORD_VERIFY_GATE_MODE: "off" }), "off");
  assert.equal(verifyGateMode({ CONCORD_VERIFY_GATE_MODE: "yes please" }), "observe");
});

test("candidateOf gathers title, claims, definitions and body", () => {
  const c = candidateOf({ id: "d", title: "MEGA — Beams", core: { claims: ["6 * 7 = 42 is true."], definitions: ["A synthesis."] }, cretiHuman: "Members: 3." });
  assert.equal(c.title, "MEGA — Beams");
  assert.match(c.body, /^Beams\n6 \* 7 = 42/);
});

test("observe: the receipt is attached to the DTU, but nothing is demoted or hidden, even for a refuted claim", async () => {
  const store = fakeStore([mega("m1", ["We find 6 * 7 = 43 here in the data."])]);
  const svc = createVerifyGateService({ store, deps, mode: "observe" });
  assert.equal(svc.submit("m1").queued, true);
  await svc.cycle();
  const d = store.map.get("m1");
  assert.equal(d.meta.verification.outcome, "REFUTED");
  assert.equal(d.meta.verification.mode, "observe");
  assert.equal(d.tier, "mega");
  assert.deepEqual(d.tags, []);
  assert.deepEqual(store.log.map((l) => l[0]), ["annotate"]);
});

test("enforce: VERIFIED stays, PARTIAL and UNTESTABLE are demoted with a label, REFUTED is quarantined, nothing is deleted", async () => {
  const store = fakeStore([
    mega("ok", ["We find 6 * 7 = 42 here in the data."]),
    mega("part", ["We find 6 * 7 = 42 here in the data.", "The measured stress is 99 MPa at the joint."]),
    mega("vague", ["The council met and talked for a long while."]),
    mega("bad", ["We find 6 * 7 = 43 here in the data."]),
  ]);
  const svc = createVerifyGateService({ store, deps, mode: "enforce" });
  for (const id of ["ok", "part", "vague", "bad"]) svc.submit(id);
  await svc.cycle();
  const m = store.map;
  assert.equal(m.get("ok").meta.verification.outcome, "VERIFIED");
  assert.equal(m.get("ok").tier, "mega");
  assert.equal(m.get("part").meta.verification.outcome, "PARTIAL");
  assert.deepEqual([m.get("part").tier, m.get("part").tags], ["regular", ["hypothesis"]]);
  assert.equal(m.get("part").meta.verification.unverified[0].result, "unchecked");
  assert.deepEqual([m.get("vague").meta.verification.outcome, m.get("vague").tier, m.get("vague").tags], ["UNTESTABLE", "regular", ["speculative"]]);
  assert.equal(m.get("bad").meta.verification.outcome, "REFUTED");
  assert.ok(m.get("bad").tags.includes("quarantine:unverified-refuted"));
  assert.equal(m.size, 4, "nothing was deleted");
  assert.equal(m.get("part").meta.demotedFrom, "mega");
});

test("PENDING (a checker is down) changes nothing and the candidate stays queued for retry", async () => {
  const store = fakeStore([mega("p", ["For all natural numbers n, n + 0 = n holds."])]);
  const svc = createVerifyGateService({ store, deps: {}, mode: "enforce" });
  svc.submit("p");
  await svc.cycle();
  assert.equal(store.map.get("p").meta.verification, undefined);
  assert.equal(svc.metrics().queueDepth, 1);
  assert.equal(store.map.get("p").tier, "mega");
});

test("off queues nothing; an unchanged, already verified DTU is not re-checked; an edited one is", async () => {
  const store = fakeStore([mega("a", ["We find 6 * 7 = 42 here in the data."])]);
  assert.equal(createVerifyGateService({ store, deps, mode: "off" }).submit("a").reason, "off");
  const svc = createVerifyGateService({ store, deps, mode: "observe" });
  svc.submit("a"); await svc.cycle();
  assert.equal(svc.submit("a").reason, "already verified");
  store.map.get("a").core.claims.push("We find 2 + 2 = 4 here as well.");
  assert.equal(svc.submit("a").queued, true);
  assert.equal(svc.submit("nope").reason, "not found");
});

test("retention: existing megas/hypers without a receipt are re-checked in small batches, never all at once", async () => {
  const dtus = [];
  for (let i = 0; i < 30; i++) dtus.push(mega(`m${i}`, [`We find ${i + 1} + ${i + 1} = ${2 * (i + 1)} here in the data.`]));
  dtus.push({ id: "reg", tier: "regular", title: "plain", core: { claims: ["We find 1 + 1 = 2 here."] } });
  const store = fakeStore(dtus);
  const svc = createVerifyGateService({ store, deps, mode: "observe", retention: { examinePerCycle: 10, submitPerCycle: 4 }, queueOpts: { perCycle: 4 } });
  const r = await svc.cycle();
  assert.equal(r.retention.examined, 10);
  assert.ok(r.retention.submitted <= 4);
  assert.ok(svc.metrics().queueDepth <= 4);
  for (let i = 0; i < 12; i++) await svc.cycle();
  const verified = [...store.map.values()].filter((d) => d.meta?.verification?.outcome === "VERIFIED").length;
  assert.equal(verified, 30, "after enough cycles every mega has a receipt");
  assert.equal(store.map.get("reg").meta?.verification, undefined, "regular DTUs are not part of the retention pass");
  assert.equal(svc.metrics().outcomes.VERIFIED, 30);
});

test("retention does not pile onto a long queue", async () => {
  const store = fakeStore([mega("x", ["We find 1 + 1 = 2 here in the data."])]);
  const svc = createVerifyGateService({ store, deps, mode: "observe", retention: { maxQueueForRetention: 0 } });
  assert.deepEqual(await svc.retentionBatch(), { submitted: 0 });
});

test("metrics report mode, queue depth, candidates/hour, outcomes, retention progress", async () => {
  const store = fakeStore([mega("a", ["We find 1 + 1 = 2 here in the data."]), mega("b", ["We find 1 + 1 = 3 here in the data."])]);
  const svc = createVerifyGateService({ store, deps, mode: "observe" });
  svc.submit("a"); svc.submit("b");
  await svc.cycle();
  const m = svc.metrics();
  assert.equal(m.mode, "observe");
  assert.equal(m.candidatesLastHour, 2);
  assert.deepEqual([m.outcomes.VERIFIED, m.outcomes.REFUTED], [1, 1]);
  assert.equal(m.applied.annotated, 2);
  assert.ok("leanLatencyMs" in m && "retention" in m);
  assert.equal(svc.rejected().length, 1);
});
