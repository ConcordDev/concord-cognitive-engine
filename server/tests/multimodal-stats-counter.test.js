// The image endpoints call the vision model without callBrain; they must
// still count the call on BRAIN.multimodal.stats.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordBrainCall } from "../lib/brain/record-brain-call.js";

const SERVER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");
const fnBody = (sig) => {
  const i = SERVER.indexOf(sig);
  assert.ok(i >= 0, `${sig} not found`);
  return SERVER.slice(i, SERVER.indexOf("\n}", i));
};

describe("recordBrainCall", () => {
  it("counts a success: requests, totalMs, lastCallAt", () => {
    const brain = { stats: { requests: 0, totalMs: 0, errors: 0, lastCallAt: null } };
    recordBrainCall(brain, { ok: true, startedAt: 1000, now: 1250 });
    assert.equal(brain.stats.requests, 1);
    assert.equal(brain.stats.totalMs, 250);
    assert.equal(brain.stats.errors, 0);
    assert.equal(brain.stats.lastCallAt, new Date(1250).toISOString());
  });
  it("counts a failure as a request and an error", () => {
    const brain = { stats: { requests: 2, totalMs: 10, errors: 0 } };
    recordBrainCall(brain, { ok: false, startedAt: 0, now: 5 });
    assert.equal(brain.stats.requests, 3);
    assert.equal(brain.stats.errors, 1);
  });
  it("ignores a slot with no stats", () => {
    assert.doesNotThrow(() => recordBrainCall(undefined, { ok: true }));
    assert.doesNotThrow(() => recordBrainCall({}, { ok: true }));
  });
});

describe("image paths count on the multimodal slot", () => {
  it("analyzeImage (/api/vision/analyze) records success and the catch path", () => {
    const body = fnBody("async function analyzeImage(");
    const calls = body.match(/recordBrainCall\(BRAIN\.multimodal/g) || [];
    assert.equal(calls.length, 2);
    assert.ok(body.indexOf("recordBrainCall(BRAIN.multimodal") > body.indexOf("await callVision("));
  });
  it("multimodal.vision_analyze records the direct Ollama call", () => {
    const i = SERVER.indexOf('register("multimodal","vision_analyze"');
    const body = SERVER.slice(i, SERVER.indexOf('register("multimodal","image_generate"', i));
    assert.equal((body.match(/recordBrainCall\(BRAIN\.multimodal/g) || []).length, 2);
  });
  it("callVision does not count itself (no double count)", () => {
    const vi = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/vision-inference.js"), "utf8");
    assert.doesNotMatch(vi, /stats\.requests/);
  });
});
