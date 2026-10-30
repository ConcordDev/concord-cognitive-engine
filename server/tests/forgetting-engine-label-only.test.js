// Owner rule (2026-10-29): the forgetting pass LABELS weak DTUs and ranks them lower; it never deletes or
// tombstones. Batch-limited, event-loop friendly, and labels clear when a DTU recovers.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runForgettingCycle, getStatus } from "../emergent/forgetting-engine.js";

const OLD = new Date("2000-01-01T00:00:00Z").toISOString();
const weak = (id) => ({ id, tier: "shadow", title: `T ${id}`, human: { summary: `summary ${id}` }, createdAt: OLD, updatedAt: OLD, tags: ["keepme"], authority: { score: 0 }, lineage: { parents: [], children: [] } });
const GRACE = 3;

describe("forgetting-engine — label, never tombstone", () => {
  let STATE;
  beforeEach(() => { STATE = { dtus: new Map() }; globalThis._concordSTATE = STATE; });
  afterEach(() => { delete globalThis._concordSTATE; });

  async function cycles(n, opts) { let r; for (let i = 0; i < n; i++) r = await runForgettingCycle(false, opts); return r; }

  it("fixtures end with labels, zero tombstones, zero deletions, unchanged count and readable content", async () => {
    for (let i = 0; i < 40; i++) STATE.dtus.set(`w${i}`, weak(`w${i}`));
    const before = STATE.dtus.size;
    const r = await cycles(GRACE + 2);
    assert.equal(STATE.dtus.size, before, "DTU count unchanged");
    assert.equal([...STATE.dtus.values()].filter((d) => d.type === "tombstone").length, 0);
    assert.equal([...STATE.dtus.keys()].filter((k) => k.startsWith("tomb_")).length, 0);
    assert.equal(r.forgottenCount, 0);
    assert.equal(r.mode, "label");
    const d = STATE.dtus.get("w7");
    assert.equal(d.meta.quality.label, "weak");
    assert.equal(d.meta.quality.by, "forgetting-engine");
    assert.match(d.meta.quality.reason, /retention_score=.*below_threshold/);
    assert.ok(d.meta.quality.labeledAt);
    assert.ok(d.meta.rankWeight > 0 && d.meta.rankWeight < 1, "ranked lower, not removed");
    assert.ok(d.tags.includes("quality:weak") && d.tags.includes("keepme"));
    assert.equal(d.human.summary, "summary w7", "content untouched");
    assert.equal(d.tier, "shadow");
    assert.equal(getStatus().lifetimeTombstones, 0);
    assert.ok(getStatus().lifetimeLabeled >= 40);
  });

  it("labels are batch-limited per cycle and a labeled DTU is not rewritten next cycle", async () => {
    for (let i = 0; i < 30; i++) STATE.dtus.set(`b${i}`, weak(`b${i}`));
    await cycles(GRACE);
    const r1 = await runForgettingCycle(false, { maxForget: 10 });
    assert.equal(r1.labeledCount, 10);
    const r2 = await runForgettingCycle(false, { maxForget: 10 });
    assert.equal(r2.labeledCount, 10, "the next batch labels different DTUs");
    const stamp = STATE.dtus.get([...STATE.dtus.keys()].find((k) => STATE.dtus.get(k).meta?.quality)).meta.quality.labeledAt;
    await runForgettingCycle(false, { maxForget: 10 });
    const same = [...STATE.dtus.values()].find((d) => d.meta?.quality?.labeledAt === stamp);
    assert.ok(same, "an existing label keeps its original timestamp");
  });

  it("a DTU that recovers loses the label; protected and user DTUs are never touched", async () => {
    STATE.dtus.set("r1", weak("r1"));
    STATE.dtus.set("p1", { ...weak("p1"), _pinned: true });
    STATE.dtus.set("u1", { ...weak("u1"), source: "user" });
    await cycles(GRACE + 1);
    assert.equal(STATE.dtus.get("r1").meta.quality.label, "weak");
    assert.equal(STATE.dtus.get("p1").meta, undefined);
    assert.equal(STATE.dtus.get("u1").meta, undefined);
    const d = STATE.dtus.get("r1");
    d.tier = "regular"; d.createdAt = new Date().toISOString(); d.updatedAt = new Date().toISOString(); d.authority = { score: 1 };
    const r = await runForgettingCycle(false);
    assert.equal(r.unlabeledCount, 1);
    assert.equal(d.meta.quality, undefined);
    assert.ok(!d.tags.includes("quality:weak"));
  });

  it("the tombstone path is refused without the explicit env opt-in", async () => {
    for (let i = 0; i < 5; i++) STATE.dtus.set(`t${i}`, weak(`t${i}`));
    const r = await cycles(GRACE + 1, { mode: "tombstone" });
    assert.equal(r.mode, "label");
    assert.equal(STATE.dtus.size, 5);
    assert.equal([...STATE.dtus.keys()].filter((k) => k.startsWith("tomb_")).length, 0);
  });

  it("a large store scores with event-loop yields (timers keep firing during the cycle)", async () => {
    for (let i = 0; i < 2600; i++) STATE.dtus.set(`l${i}`, weak(`l${i}`));
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 1);
    await runForgettingCycle(false);
    clearInterval(iv);
    assert.ok(ticks >= 1, "the loop was not blocked for the whole scoring walk");
    assert.equal(STATE.dtus.size, 2600);
  });
});
