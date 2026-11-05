// S2 / F3 pins — waveformWindow must report the RENDERED window.
//
// The pass (2026-10-31) imported a 0.5 s recording, left WINDOW at the
// shipped 4 s, and the header read "0s –4.0s" while the axis ran
// 0–0.49 s: the handler clamped endIdx to the recording but returned
// the REQUESTED startSec/windowSec, and the header printed the request
// echoed back. These pins drive the real handler over a short
// recording: startSec/windowSec in the result must describe the data
// rendered; the request survives only under requested* names.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNeuroActions from "../domains/neuro.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`neuro.${name}`);
  if (!fn) throw new Error(`neuro.${name} not registered`);
  return fn(ctx, { id: null, domain: "neuro", data: params, meta: {} }, params);
}

before(() => { registerNeuroActions(register); });
beforeEach(() => {
  if (globalThis._concordSTATE) globalThis._concordSTATE.neuroLens = { recordings: new Map() };
});

const ctx = { actor: { userId: "neuro_window_user" }, userId: "neuro_window_user" };

// The pass's own shape: 3 channels, 100 Hz, 50 samples = 0.5 s.
function importShort(ctxU = ctx) {
  const rows = ["Fz,Cz,Pz"];
  for (let i = 0; i < 50; i++) {
    const t = i / 100;
    rows.push(`${Math.sin(2 * Math.PI * 10 * t).toFixed(5)},${(0.5 * Math.sin(2 * Math.PI * 10 * t)).toFixed(5)},0`);
  }
  const r = call("importSignal", ctxU, { format: "csv", name: "short", text: rows.join("\n"), sampleRate: 100 });
  assert.equal(r.ok, true, r.error);
  return r.result.recordingId;
}

describe("neuro.waveformWindow — rendered-window truth (S2)", () => {
  it("an over-long requested window reports the rendered span, not the request", () => {
    const id = importShort();
    const r = call("waveformWindow", ctx, { recordingId: id, startSec: 0, windowSec: 4, maxPoints: 1200 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.startSec, 0);
    assert.equal(r.result.windowSec, 0.5, `rendered window must be the 0.5 s recording, got ${r.result.windowSec}`);
    assert.equal(r.result.requestedWindowSec, 4);
    // the last rendered point sits inside the reported window
    const lastT = Math.max(...r.result.traces[0].points.map((p) => p.t));
    assert.ok(lastT <= r.result.startSec + r.result.windowSec, `last point ${lastT} beyond reported window`);
    assert.ok(lastT >= 0.49, `expected points out to ~0.49 s, got ${lastT}`);
  });

  it("a start beyond the data clamps to the rendered start", () => {
    const id = importShort();
    const r = call("waveformWindow", ctx, { recordingId: id, startSec: 0.3, windowSec: 4 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.startSec, 0.3);
    assert.ok(Math.abs(r.result.windowSec - 0.2) < 1e-9, `rendered span from 0.3 s is 0.2 s, got ${r.result.windowSec}`);
    assert.equal(r.result.requestedStartSec, 0.3);
  });

  it("a window inside the recording reports itself unchanged", () => {
    const id = importShort();
    const r = call("waveformWindow", ctx, { recordingId: id, startSec: 0, windowSec: 0.25 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.windowSec, 0.25);
  });
});
