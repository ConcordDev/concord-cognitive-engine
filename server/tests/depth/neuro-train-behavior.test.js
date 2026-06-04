// tests/depth/neuro-train-behavior.test.js
//
// Behavioral coverage for neuro.train (lens-audit broken-wire closure). Two honest
// modes: REAL gradient-descent training when a dataset is attached (true decreasing
// BCE loss), and an explicitly-flagged deterministic PROJECTION otherwise (never
// passed off as a trained model).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

test("neuro.train really trains on an attached separable dataset (loss decreases)", async () => {
  // Linearly separable: label = 1 when feature0 high.
  const dataset = [];
  for (let i = 0; i < 40; i++) {
    const x = i < 20 ? [-1 - Math.random(), 0] : [1 + Math.random(), 0];
    dataset.push({ features: x, label: i < 20 ? 0 : 1 });
  }
  const r = await lensRun("neuro", "train", { data: { dataset, epochs: 50, optimizer: "adam" } });
  const res = r.result ?? r;
  assert.equal(res.mode, "trained");
  assert.equal(res.simulated, false);
  assert.equal(res.history.length, 50);
  assert.ok(res.history[49].loss < res.history[0].loss, "loss strictly decreased over training");
  assert.ok(res.accuracy >= 0.9, "learns the separable boundary");
});

test("neuro.train projects honestly (flagged simulated) when no dataset is attached", async () => {
  const r = await lensRun("neuro", "train", { data: { layers: 4, neurons: 128, samples: 5000, optimizer: "adam", epochs: 30 } });
  const res = r.result ?? r;
  assert.equal(res.mode, "projection");
  assert.equal(res.simulated, true, "must NOT be passed off as a real trained result");
  assert.equal(res.basis, "hyperparameter_projection");
  assert.match(res.note, /not a trained model/i);
  // monotone improving curve
  assert.ok(res.history[29].accuracy > res.history[0].accuracy);
  assert.ok(res.history[29].loss < res.history[0].loss);
});
