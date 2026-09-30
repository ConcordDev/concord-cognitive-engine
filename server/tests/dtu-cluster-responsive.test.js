// server/tests/dtu-cluster-responsive.test.js
//
// dtu.cluster (the consolidation pass the heartbeat runs every 30 ticks) must
// (1) produce the same topic clusters, never crossing a scope/world partition,
// and (2) not hold the event loop. Profiled 2026-09-27 on ~2.2K DTUs it
// blocked 0.8-0.97 s per run — re-tokenizing inside its O(n²) inner loop —
// which stalled every player and request on the box.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";

let runMacro, STATE, ctx;
before(async () => { ({ runMacro, STATE, ctx } = await macroRuntime("dtu-cluster")); });

function seed(id, title, tags, world) {
  STATE.dtus.set(id, { id, title, tags, tier: "regular", scope: "global", world_id: world, human: { summary: title } });
}

test("clusters by topic inside one partition, exactly as before", async () => {
  const W = "cluster-test-world";
  seed("ct_a1", "beam deflection steel", ["beam", "steel"], W);
  seed("ct_a2", "steel beam deflection limits", ["beam", "steel"], W);
  seed("ct_a3", "beam steel deflection calculation", ["beam", "steel"], W);
  seed("ct_b1", "sourdough bread starter", ["bread"], W);
  seed("ct_b2", "bread starter sourdough feeding", ["bread"], W);
  seed("ct_c1", "quantum entanglement", ["physics"], W);
  seed("ct_x1", "beam deflection steel", ["beam", "steel"], "another-world"); // same topic, other world
  const r = await runMacro("dtu", "cluster", {}, ctx);
  assert.equal(r.ok, true);
  const mine = r.clusters.filter((c) => c.ids.some((id) => id.startsWith("ct_"))).map((c) => c.ids.filter((id) => id.startsWith("ct_")).sort().join(","));
  assert.ok(mine.includes("ct_a1,ct_a2,ct_a3"), JSON.stringify(mine));
  assert.ok(mine.includes("ct_b1,ct_b2"), JSON.stringify(mine));
  assert.ok(mine.includes("ct_c1"), JSON.stringify(mine));
  assert.ok(!mine.some((c) => c.includes("ct_x1") && c.includes("ct_a")), "never clusters across worlds");
});

test("a large pass keeps the event loop responsive", async () => {
  // Mostly-distinct topics (the realistic worst case): few merge, so nearly
  // every pair is compared — ~1.1M comparisons for 1500 DTUs.
  for (let i = 0; i < 1500; i++) {
    seed("big_" + i, `topic${i}alpha topic${i}beta topic${i}gamma shared${i % 5}`, [`tag${i}`], "cluster-load-world");
  }
  let last = Date.now(), maxGap = 0;
  const tick = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 5);
  const t0 = Date.now();
  const r = await runMacro("dtu", "cluster", {}, ctx);
  maxGap = Math.max(maxGap, Date.now() - last); // a blocking pass never lets the ticker fire at all
  clearInterval(tick);
  assert.equal(r.ok, true);
  assert.ok(r.clusters.length > 0);
  assert.ok(maxGap < 250, `event loop blocked ${maxGap} ms during a ${Date.now() - t0} ms cluster pass`);
});
