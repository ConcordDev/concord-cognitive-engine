// Contract tests for server/domains/neuro.js — EEGLAB / MNE-Python
// parity workbench: signal import, waveform viewer, topographic scalp
// maps, the preprocessing pipeline, epoching, time-frequency analysis,
// source localization, statistical testing, plus the analysis primitives
// (frequencyAnalysis, connectivityAnalysis, erpAnalysis).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNeuroActions from "../domains/neuro.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact) {
  const fn = ACTIONS.get(`neuro.${name}`);
  if (!fn) throw new Error(`neuro.${name} not registered`);
  const art = artifact || { id: null, domain: "neuro", data: params, meta: {} };
  return fn(ctx, art, params);
}

before(() => { registerNeuroActions(register); });

const ctxA = { actor: { userId: "neuro_user_a" }, userId: "neuro_user_a" };
const ctxB = { actor: { userId: "neuro_user_b" }, userId: "neuro_user_b" };

// Build a deterministic 10-20-montage CSV with a real sinusoidal mix.
function makeCsv(channelNames, freqByChannel, n = 512, sr = 256) {
  const header = channelNames.join(",");
  const rows = [header];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    rows.push(channelNames.map((ch) => {
      const f = freqByChannel[ch] || 10;
      return (0.6 * Math.sin(2 * Math.PI * f * t)).toFixed(5);
    }).join(","));
  }
  return rows.join("\n");
}

// Import a recording for ctxA and return its id.
function importFixture(ctx = ctxA, events) {
  const csv = makeCsv(["Fz", "Cz", "Pz", "O1"], { Fz: 20, Cz: 10, Pz: 10, O1: 6 });
  const r = call("importSignal", ctx, {
    format: "csv", name: "fixture", text: csv, sampleRate: 256,
    events: events || [
      { label: "target", sampleIndex: 120, condition: "oddball" },
      { label: "target", sampleIndex: 280, condition: "oddball" },
      { label: "standard", sampleIndex: 200, condition: "standard" },
    ],
  });
  assert.equal(r.ok, true, r.error);
  return r.result.recordingId;
}

beforeEach(() => {
  // isolate per-test state
  if (globalThis._concordSTATE) globalThis._concordSTATE.neuroLens = { recordings: new Map() };
});

describe("neuro.importSignal", () => {
  it("imports a CSV recording with header channel names", () => {
    const csv = makeCsv(["Fz", "Cz"], { Fz: 10, Cz: 12 }, 256);
    const r = call("importSignal", ctxA, { format: "csv", name: "rest", text: csv, sampleRate: 256 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.channelCount, 2);
    assert.equal(r.result.sampleCount, 256);
    assert.deepEqual(r.result.channelNames, ["Fz", "Cz"]);
    assert.ok(r.result.recordingId);
  });

  it("imports an edf-json payload", () => {
    const r = call("importSignal", ctxA, {
      format: "edf-json", name: "edf",
      payload: { sampleRate: 200, channels: [{ name: "C3", samples: [1, 2, 3, 4] }] },
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.sampleRate, 200);
    assert.equal(r.result.channelCount, 1);
  });

  it("rejects empty CSV and unsupported formats", () => {
    assert.equal(call("importSignal", ctxA, { format: "csv", text: "" }).ok, false);
    assert.equal(call("importSignal", ctxA, { format: "xyz", text: "a\n1" }).ok, false);
  });

  it("stores event markers", () => {
    const csv = makeCsv(["Fz"], { Fz: 10 }, 128);
    const r = call("importSignal", ctxA, {
      format: "csv", text: csv, sampleRate: 128,
      events: [{ label: "stim", sampleIndex: 40, condition: "go" }],
    });
    assert.equal(r.result.eventCount, 1);
  });
});

describe("neuro.listRecordings / deleteRecording", () => {
  it("lists imported recordings per user and isolates between users", () => {
    importFixture(ctxA);
    const a = call("listRecordings", ctxA, {});
    const b = call("listRecordings", ctxB, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.count, 1);
    assert.equal(b.result.count, 0);
  });

  it("deletes a recording", () => {
    const id = importFixture(ctxA);
    const del = call("deleteRecording", ctxA, { recordingId: id });
    assert.equal(del.ok, true);
    assert.equal(call("listRecordings", ctxA, {}).result.count, 0);
  });

  it("rejects deleting an unknown recording", () => {
    assert.equal(call("deleteRecording", ctxA, { recordingId: "nope" }).ok, false);
  });
});

describe("neuro.waveformWindow", () => {
  it("returns a decimated, window-bounded slice of channel traces", () => {
    const id = importFixture(ctxA);
    const r = call("waveformWindow", ctxA, { recordingId: id, startSec: 0, windowSec: 1, maxPoints: 200 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.channelCount, 4);
    assert.ok(r.result.traces[0].points.length > 0);
    assert.ok(r.result.traces[0].points.length <= 200);
  });

  it("surfaces events that fall inside the window", () => {
    const id = importFixture(ctxA);
    const r = call("waveformWindow", ctxA, { recordingId: id, startSec: 0, windowSec: 2 });
    assert.equal(r.ok, true);
    assert.ok(r.result.events.length >= 1);
  });

  it("rejects an unknown recording", () => {
    assert.equal(call("waveformWindow", ctxA, { recordingId: "x" }).ok, false);
  });
});

describe("neuro.topographicMap", () => {
  it("maps channels onto the 10-20 montage and interpolates a heat grid", () => {
    const id = importFixture(ctxA);
    const r = call("topographicMap", ctxA, { recordingId: id, gridSize: 16 });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.mappedChannels >= 4);
    assert.equal(r.result.grid.length, 16);
    assert.ok(r.result.electrodes.every((e) => e.normalized >= 0 && e.normalized <= 1));
  });

  it("supports band-specific power maps", () => {
    const id = importFixture(ctxA);
    const r = call("topographicMap", ctxA, { recordingId: id, band: "alpha" });
    assert.equal(r.ok, true, r.error);
    assert.match(r.result.metric, /alpha/);
  });
});

describe("neuro.preprocess", () => {
  it("applies a filtering pipeline and produces a new derived recording", () => {
    const id = importFixture(ctxA);
    const r = call("preprocess", ctxA, {
      recordingId: id,
      steps: [
        { kind: "bandpass", low: 1, high: 40 },
        { kind: "notch", freq: 50 },
        { kind: "reref", mode: "average" },
        { kind: "artifact-reject", threshold: 100 },
      ],
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.derivedFrom, id);
    assert.equal(r.result.stepCount, 4);
    assert.ok(Array.isArray(r.result.icaComponents));
    // the derived recording is also listed
    assert.equal(call("listRecordings", ctxA, {}).result.count, 2);
  });

  it("rejects an empty step list", () => {
    const id = importFixture(ctxA);
    assert.equal(call("preprocess", ctxA, { recordingId: id, steps: [] }).ok, false);
  });
});

describe("neuro.epochData", () => {
  it("segments continuous data around event markers", () => {
    const id = importFixture(ctxA);
    const r = call("epochData", ctxA, { recordingId: id, preMs: 100, postMs: 300, channel: "Cz" });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.epochCount >= 1);
    assert.equal(r.result.channel, "Cz");
    assert.equal(r.result.grandAverage.length, r.result.epochLength);
  });

  it("filters by condition", () => {
    const id = importFixture(ctxA);
    const r = call("epochData", ctxA, { recordingId: id, condition: "oddball", preMs: 100, postMs: 200 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.condition, "oddball");
  });

  it("rejects when the recording has no event markers", () => {
    const csv = makeCsv(["Fz"], { Fz: 10 }, 256);
    const noEv = call("importSignal", ctxA, { format: "csv", text: csv, sampleRate: 256 });
    assert.equal(call("epochData", ctxA, { recordingId: noEv.result.recordingId }).ok, false);
  });
});

describe("neuro.timeFrequency", () => {
  it("computes an STFT spectrogram", () => {
    const csv = makeCsv(["Fz"], { Fz: 12 }, 1024, 256);
    const imp = call("importSignal", ctxA, { format: "csv", text: csv, sampleRate: 256 });
    const r = call("timeFrequency", ctxA, { recordingId: imp.result.recordingId, maxFreq: 40 });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.frameCount > 0);
    assert.ok(r.result.frequencies.length > 0);
    assert.equal(r.result.spectrogram.length, r.result.frameCount);
  });

  it("rejects a too-short recording", () => {
    const csv = makeCsv(["Fz"], { Fz: 10 }, 32, 256);
    const imp = call("importSignal", ctxA, { format: "csv", text: csv, sampleRate: 256 });
    assert.equal(call("timeFrequency", ctxA, { recordingId: imp.result.recordingId }).ok, false);
  });
});

describe("neuro.sourceLocalization", () => {
  it("estimates cortical sources from the montage", () => {
    const id = importFixture(ctxA);
    const r = call("sourceLocalization", ctxA, { recordingId: id });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.sensorCount >= 3);
    assert.ok(r.result.peakSources.length > 0);
    assert.ok(r.result.peakSources.every((p) => typeof p.region === "string"));
  });

  it("rejects when too few montage channels match", () => {
    const csv = makeCsv(["X1", "X2"], { X1: 10, X2: 10 }, 256);
    const imp = call("importSignal", ctxA, { format: "csv", text: csv, sampleRate: 256 });
    assert.equal(call("sourceLocalization", ctxA, { recordingId: imp.result.recordingId }).ok, false);
  });
});

describe("neuro.statisticalTest", () => {
  it("runs a Welch t-test on two numeric groups", () => {
    const r = call("statisticalTest", ctxA, {
      groupA: [1.2, 1.5, 1.1, 1.4, 1.3],
      groupB: [0.4, 0.6, 0.3, 0.5, 0.45],
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.test, "Welch's two-sample t-test");
    assert.equal(r.result.significant, true);
    assert.ok(Math.abs(r.result.cohensD) > 0.8);
  });

  it("derives scalars from two epoch sets when raw values absent", () => {
    const r = call("statisticalTest", ctxA, {
      epochsA: [{ samples: [2, 2, 2, 2] }, { samples: [3, 3, 3, 3] }],
      epochsB: [{ samples: [0, 0, 0, 0] }, { samples: [0.5, 0.5, 0.5, 0.5] }],
      window: { startMs: 0, endMs: 10 }, sampleRate: 256,
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.groupA.n, 2);
  });

  it("rejects groups smaller than 2 observations", () => {
    assert.equal(call("statisticalTest", ctxA, { groupA: [1], groupB: [2] }).ok, false);
  });
});

describe("neuro analysis primitives (frequency / connectivity / erp)", () => {
  it("frequencyAnalysis decomposes a signal into EEG bands", () => {
    const n = 512, sr = 256;
    const samples = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 10 * (i / sr)));
    const r = call("frequencyAnalysis", ctxA, {}, { data: { signal: { samples, sampleRate: sr, channel: "Cz" } } });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.channels[0].dominantBand.name, "alpha");
  });

  it("connectivityAnalysis computes a correlation matrix", () => {
    const n = 256, sr = 256;
    const base = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 10 * (i / sr)));
    const r = call("connectivityAnalysis", ctxA, {}, {
      data: { channels: [
        { name: "Fz", samples: base, sampleRate: sr },
        { name: "Pz", samples: base.map((v) => v * 0.9), sampleRate: sr },
      ] },
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.channelCount, 2);
    assert.ok(r.result.correlationMatrix.matrix.length === 2);
  });

  it("erpAnalysis averages epochs and reports SNR", () => {
    const sr = 256, len = 256;
    const epochs = Array.from({ length: 8 }, () => ({
      onset: 0,
      samples: Array.from({ length: len }, (_, i) => Math.sin(2 * Math.PI * 3 * (i / sr))),
    }));
    const r = call("erpAnalysis", ctxA, {}, { data: { epochs, sampleRate: sr } });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.epochCount, 8);
    assert.ok(typeof r.result.snr === "number");
  });
});
