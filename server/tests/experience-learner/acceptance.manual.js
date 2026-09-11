// server/tests/experience-learner/acceptance.manual.js
//
// H.5 — Independent evaluator for Experience-to-Learning organ.
//
// Run with: node server/tests/experience-learner/acceptance.manual.js

import assert from "node:assert/strict";

const BACKEND = process.env.CONCORD_BACKEND || "http://127.0.0.1:5050";
const ORGAN = "experience-learner";

async function callMCP(tool, args = {}) {
  const r = await fetch(`${BACKEND}/mcp/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(180_000),
  });
  return await r.json();
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log(`${ORGAN} — Independent Evaluator`);
console.log(`Backend: ${BACKEND}\n`);

console.log("Section A — Compress (3 tests)");

await test("A1: experience_compress scans all organs and creates chunks", async () => {
  const r = await callMCP("experience_compress", { since_minutes: 1440 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.chunks_created === "number");
  assert.ok(typeof obs.organs_scanned === "number");
  assert.ok(obs.organs_scanned >= 1, "should scan at least 1 organ");
});

await test("A2: dry_run does NOT persist chunks", async () => {
  const before = await callMCP("experience_stats");
  const beforeCount = before.result.observation.chunks_total;
  const dry = await callMCP("experience_compress", { since_minutes: 1440, dry_run: true });
  assert.equal(dry.result.observation.dry_run, true);
  const after = await callMCP("experience_stats");
  assert.equal(after.result.observation.chunks_total, beforeCount,
    "dry_run must NOT increase chunk count");
});

await test("A3: chunks have required schema (organ, kind, hour_bucket, count)", async () => {
  const r = await callMCP("experience_compress", { since_minutes: 1440 });
  const chunks = r.result.observation.chunks;
  if (chunks.length === 0) {
    console.log("    (skipped — no chunks)");
    return;
  }
  for (const ch of chunks) {
    assert.ok(typeof ch.organ === "string");
    assert.ok(typeof ch.kind === "string");
    assert.ok(typeof ch.hour_bucket === "string");
    assert.ok(typeof ch.count === "number");
    assert.ok(ch.count >= 1);
  }
});

console.log("\nSection B — Distill + Consolidate (3 tests)");

await test("B1: experience_distill finds patterns from chunks", async () => {
  const r = await callMCP("experience_distill", { min_occurrences: 2 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.candidates_found === "number");
  assert.ok(typeof obs.min_occurrences_threshold === "number");
});

await test("B2: experience_consolidate creates memories", async () => {
  const r = await callMCP("experience_consolidate", { ttl_days: 30 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.memories_created === "number");
  assert.ok(typeof obs.memories_updated === "number");
  assert.ok(typeof obs.organs_touched === "object");
  assert.ok(typeof obs.batch_id === "string");
});

await test("B3: experience_consolidate is idempotent (running twice doesn't explode)", async () => {
  const r1 = await callMCP("experience_consolidate", { ttl_days: 30 });
  assert.equal(r1.ok, true);
  const r2 = await callMCP("experience_consolidate", { ttl_days: 30 });
  assert.equal(r2.ok, true);
  // Second run should update existing memories, not crash
});

console.log("\nSection C — List + Get Memories (3 tests)");

await test("C1: experience_list_memories returns with filters", async () => {
  const r = await callMCP("experience_list_memories", { limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(Array.isArray(obs.memories));
  for (const mem of obs.memories) {
    assert.ok(typeof mem.memory_id === "string");
    assert.ok(typeof mem.organ === "string");
    assert.ok(typeof mem.pattern === "string");
    assert.ok(typeof mem.frequency === "number");
    assert.ok(typeof mem.confidence === "number");
    assert.ok(mem.confidence >= 0 && mem.confidence <= 1);
  }
});

await test("C2: experience_get_memory returns full memory with lineage", async () => {
  const list = await callMCP("experience_list_memories", { limit: 1 });
  if (list.result.observation.count === 0) {
    console.log("    (skipped — no memories)");
    return;
  }
  const id = list.result.observation.memories[0].id;
  const r = await callMCP("experience_get_memory", { id });
  assert.equal(r.ok, true);
  const mem = r.result.observation.memory;
  assert.ok(mem.id === id);
  assert.ok(Array.isArray(mem.source_chunk_ids), "lineage required");
});

await test("C3: experience_list_memories with organ filter", async () => {
  const r = await callMCP("experience_list_memories", { organ: "sentinel-organ", limit: 10 });
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  for (const m of obs.memories) {
    assert.equal(m.organ, "sentinel-organ");
  }
});

console.log("\nSection D — Stats (2 tests)");

await test("D1: experience_stats returns full inventory", async () => {
  const r = await callMCP("experience_stats");
  assert.equal(r.ok, true);
  const obs = r.result.observation;
  assert.ok(typeof obs.chunks_total === "number");
  assert.ok(typeof obs.memories_total === "number");
  assert.ok(typeof obs.memories_active === "number");
  assert.ok(typeof obs.chunks_by_organ === "object");
  assert.ok(typeof obs.source_organ_counts === "object");
});

await test("D2: experience_stats source_organ_counts covers configured source organs", async () => {
  const r = await callMCP("experience_stats");
  const src = r.result.observation.source_organ_counts;
  // Must cover at least the organs whose DBs exist at test time
  assert.ok(typeof src === "object");
  // Check that organs with persistent DBs are present
  assert.ok(src["browser-organ"] !== undefined);
  assert.ok(src["sentinel-organ"] !== undefined);
  assert.ok(src["incident-engine"] !== undefined);
  assert.ok(src["a2a-boundary"] !== undefined);
  // Count how many of the configured organs are reported (allows -1 for missing DBs)
  let reported = 0;
  for (const k of Object.keys(src)) {
    if (src[k] !== -1 && src[k] !== undefined) reported++;
  }
  assert.ok(reported >= 3, `should report at least 3 organs, got ${reported}`);
});

console.log("\nSection E — No Forget (1 test)");

await test("E1: NO experience_forget tool exists (memories are append-only)", async () => {
  const r = await callMCP("experience_forget", { id: 1 });
  assert.equal(r.ok, false, "experience_forget must NOT exist");
});

console.log("\nResults:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);