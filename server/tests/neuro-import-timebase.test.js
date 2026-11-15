// Behavior test for FIX-neuro-008: a CSV time column (time_s) was
// imported as an EEG channel, so preprocess/ICA treated the time
// ramp as signal. Pins: time_s is recognised as the timebase (2 real
// channels, duration from the timebase span, timebase named in the
// result); a header without a time column imports unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
globalThis._concordSTATE = {};
const registerNeuroActions = (await import("../domains/neuro.js")).default;
const actions = new Map();
registerNeuroActions((domain, action, handler) => actions.set(`${domain}:${action}`, handler));
const importSignal = actions.get("neuro:importSignal");
assert.ok(importSignal, "importSignal registered");
const ctx = { actor: { userId: "user-a" } };

function csvWithTime() {
  const lines = ["time_s,Fp1,Fp2"];
  for (let i = 0; i < 512; i++) lines.push(`${(i / 256).toFixed(4)},0.5,-0.25`);
  return lines.join("\n");
}

test("a time_s column is the timebase, not a third channel", async () => {
  const out = await importSignal(ctx, null, { format: "csv", name: "walk", text: csvWithTime(), sampleRate: 256 });
  assert.equal(out.ok, true);
  assert.equal(out.result.channelCount, 2);
  assert.deepEqual(out.result.channelNames, ["Fp1", "Fp2"]);
  assert.equal(out.result.timebase?.label, "time_s");
  assert.ok(Math.abs(out.result.durationSec - 1.996) < 0.01, `duration from timebase, got ${out.result.durationSec}`);
});

test("a CSV without a time column imports every column as a channel", async () => {
  const lines = ["Fp1,Fp2"];
  for (let i = 0; i < 512; i++) lines.push(`0.5,-0.25`);
  const out = await importSignal(ctx, null, { format: "csv", name: "plain", text: lines.join("\n"), sampleRate: 256 });
  assert.equal(out.ok, true);
  assert.equal(out.result.channelCount, 2);
  assert.equal(out.result.timebase, null);
  assert.equal(out.result.durationSec, 2);
});
