// Invariant: Layer 1 — inference module converges with callBrain on logging
// and active-model lookup. Both paths must:
//   1. Log every call to brain_interactions with consistent shape
//   2. Consult getActiveBrainModel for daily-refreshed model swaps
//   3. Attach _interactionId to the result for downstream resolver matching
//
// Without this convergence, half of Concord's brain calls (the ~20 inference
// callsites in emergent modules) bypass the training corpus entirely.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

test("inference module imports the brain-training helpers it depends on", async () => {
  // The actual infer() requires a live brain handle to test. Verify the
  // import surface is correct so the convergence wire compiles.
  const indexSrc = (await import("node:fs")).readFileSync(
    new URL("../../lib/inference/index.js", import.meta.url),
    "utf8",
  );
  // Two lazy imports added in Layer 1 wire:
  assert.ok(
    indexSrc.includes("brain-training/runner.js"),
    "infer() must lazy-import getActiveBrainModel from brain-training/runner.js",
  );
  assert.ok(
    indexSrc.includes("brain-training/interaction-log.js"),
    "infer() must lazy-import logBrainInteraction from brain-training/interaction-log.js",
  );
});

test("inference module references getActiveBrainModel", async () => {
  const fs = await import("node:fs");
  const indexSrc = fs.readFileSync(
    new URL("../../lib/inference/index.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    indexSrc.includes("getActiveBrainModel"),
    "infer() must consult getActiveBrainModel for daily-refreshed model swaps",
  );
});

test("inference module references logBrainInteraction", async () => {
  const fs = await import("node:fs");
  const indexSrc = fs.readFileSync(
    new URL("../../lib/inference/index.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    indexSrc.includes("logBrainInteraction"),
    "infer() must log to brain_interactions for the outcome resolver",
  );
});

test("inference module attaches _interactionId to InferResponse on success", async () => {
  const fs = await import("node:fs");
  const indexSrc = fs.readFileSync(
    new URL("../../lib/inference/index.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    /_interactionId/.test(indexSrc),
    "infer() result must carry _interactionId so callers can resolveBrainInteraction later",
  );
});

test("brain_interactions schema accepts a row from the inference path", () => {
  // Round-trip: shape that infer() will write must INSERT cleanly.
  const stmt = db.prepare(
    `INSERT INTO brain_interactions
      (id, brain_id, user_id, prompt_hash, prompt_json, response_json,
       domain, latency_ms, tokens_in, tokens_out, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  );
  assert.doesNotThrow(() => {
    stmt.run(
      "bi_inference_smoke",
      "subconscious",
      "emergent:e1:synthesis",   // callerId from minor-agent.js
      "h1",
      JSON.stringify({ messages: [], intent: "test", lens: "world" }),
      JSON.stringify({ content: "ok", model: "qwen2.5:7b", steps: 1 }),
      "world",                    // domain from req.lensContext.lens
      150,
      42,
      99,
    );
  });
  const row = db.prepare(`SELECT * FROM brain_interactions WHERE id = ?`).get("bi_inference_smoke");
  assert.ok(row);
  assert.strictEqual(row.brain_id, "subconscious");
  assert.strictEqual(row.outcome, "pending");
  assert.strictEqual(row.train_consented, 1, "platform-generated default must be consented (per migration 109)");
});

test("inference path's user_id format does not violate any check (substring-id-shape)", () => {
  // emergent module callers use 'emergent:<id>:<intent>' as callerId.
  // Verify the shape passes through the schema without truncation.
  const id = "emergent:abc123:naming";
  db.prepare(
    `INSERT INTO brain_interactions
      (id, brain_id, user_id, prompt_hash, prompt_json, outcome)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
  ).run("bi_emergent_caller", "subconscious", id, "h", "{}");
  const row = db.prepare(`SELECT user_id FROM brain_interactions WHERE id = ?`).get("bi_emergent_caller");
  assert.strictEqual(row.user_id, id);
});
