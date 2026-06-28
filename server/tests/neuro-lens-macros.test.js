// Behavioral macro tests for the neuro (EEG/MEG) lens — the PHASE-2
// LENS-DRIVEN GAP layer. These pin the EXACT field contract the live
// frontend surfaces drive, so a green test can never coexist with a
// dead-in-production calculator (the welding failure mode: a handler-ideal
// shape test passes while the rendered component reads undefined fields).
//
// Two real channels, both routed through the same /api/lens/run dispatch:
//   • NeuroActionPanel.tsx → callMacro(action, { artifact: { data } })
//       → apiHelpers.lens.runDomain('neuro', action, { input }) → dispatch
//       peels the redundant artifact wrapper → handler reads art.data.*.
//       Drives: frequencyAnalysis, connectivityAnalysis, erpAnalysis.
//   • EegWorkbench.tsx → lensRun('neuro', action, params) → handler reads
//       params (the STATE-backed EEGLAB-parity surface): importSignal,
//       listRecordings, waveformWindow, topographicMap, preprocess,
//       epochData, timeFrequency, sourceLocalization, statisticalTest.
//
// This file asserts, with the EXACT input each surface sends and the EXACT
// fields its result cards render (cross-checked field-for-field against
// components/neuro/{NeuroActionPanel,EegWorkbench}.tsx after the 2026-06-28
// alignment fix):
//   - frequencyAnalysis: channels[].{channel,peakFrequency,bands.*.{label,
//     relativePower,association},dominantBand.{name,relativePower,association},
//     indices.{alphaBetaRatio,thetaBetaRatio,arousalLevel,attentionIndex}}
//   - connectivityAnalysis: significantConnections[].{from,to,correlation},
//     networkMetrics.density (was DEAD: card read result.connections — the
//     handler returns significantConnections; every connectivity render was
//     blank in production).
//   - erpAnalysis from a CONTINUOUS signal + eventOnset (NeuroActionPanel's
//     actErp): returns epochCount/peakAmplitude/snr/snrQuality/baselineRms/
//     peaks[]/identifiedComponents[] (was DEAD twice over: the handler only
//     accepted artifact.data.epochs so a `signal` payload returned the
//     "No epoch data." error, AND the card read peakAmplitudeMicroV/
//     peakLatencyMs/component/baseline — none of which the handler returns).
//   - erpAnalysis from epochs (EegWorkbench's doErp path): identifiedComponents
//     + snrQuality.
//   - VALIDATION-REJECTION: <2 channels for connectivity, empty CSV import,
//     <2 numeric obs per group for the t-test.
//   - DEGRADE-GRACEFUL: the pure calculators compute even with STATE gone
//     (never throw); the STATE-backed macros fail-soft ("Recording not found").
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc"): no
//     NaN/Infinity leaks into any rendered number, no crash.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNeuroActions from "../domains/neuro.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "neuro", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read
// artifact.data) and the STATE-backed macros (read params) see the same input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`neuro.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "neuro", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper NeuroActionPanel.callMacro builds before dispatch:
//   runDomain('neuro', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the double-wrap
// the component sends is correctly unwrapped end-to-end.
function callViaPanel(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerNeuroActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "neuro_a", id: "neuro_a" }, userId: "neuro_a" };

// ── Signal generators mirroring the panel + a clean test signal ──────────
// A pure 10 Hz sine sampled at 256 Hz — alpha-dominant by construction, so
// the band-power assertion is a TRUE computed value, not a tautology.
function sine(freqHz, n = 1024, sr = 256, amp = 1) {
  return Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * freqHz * (i / sr)));
}
function panelChannels() {
  // Two correlated channels: ch2 = ch1 scaled → Pearson ~ 1.0 → a real edge.
  const ch1 = sine(10, 1024, 256, 1);
  const ch2 = ch1.map((v) => 0.8 * v + 0.1 * Math.sin(2 * Math.PI * 2 * 0));
  return [
    { name: "Fz", samples: ch1, sampleRate: 256 },
    { name: "Pz", samples: ch2, sampleRate: 256 },
  ];
}

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);
function assertNoNonFinite(obj, path = "result") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `${path} leaked a non-finite number: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFinite(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) assertNoNonFinite(v, `${path}.${k}`);
  }
}

/* ───────── registration: every macro both lens channels drive ───────── */

describe("neuro lens — registration of the driven macros", () => {
  it("registers every macro the page + NeuroActionPanel + EegWorkbench call", () => {
    const driven = [
      // NeuroActionPanel pure calculators
      "frequencyAnalysis", "connectivityAnalysis", "erpAnalysis", "train",
      // EegWorkbench EEGLAB-parity surface
      "importSignal", "listRecordings", "deleteRecording", "waveformWindow",
      "topographicMap", "preprocess", "epochData", "timeFrequency",
      "sourceLocalization", "statisticalTest",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing neuro.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("neuro lens — NeuroActionPanel { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a frequencyAnalysis call sent the way NeuroActionPanel sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would see
    // artifact.data.channels === undefined → "No signal data" error (the
    // silent-dead class). Drive it through the exact double-wrap and assert the
    // REAL channels landed (2 analyzed), not the empty-signal rejection.
    const r = callViaPanel("frequencyAnalysis", ctxA, { channels: panelChannels() });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.channelCount, 2, "both channels must reach the handler through the double-wrap");
  });
});

/* ───────── frequencyAnalysis — EXACT rendered field contract ───────── */

describe("neuro.frequencyAnalysis — exact fields NeuroActionPanel renders, with real band power", () => {
  it("returns the per-channel band/dominant/indices shape the card maps over", () => {
    const r = callViaPanel("frequencyAnalysis", ctxA, { channels: panelChannels() });
    assert.equal(r.ok, true, r.error);
    assert.ok(Array.isArray(r.result.channels));
    const ch = r.result.channels[0];

    // header line: ch.channel · peak {ch.peakFrequency} Hz
    assert.equal(ch.channel, "Fz");
    assert.ok(isFiniteNum(ch.peakFrequency));

    // dominant: {name} ({relativePower}%) — {association}
    assert.ok(ch.dominantBand && typeof ch.dominantBand.name === "string");
    assert.ok(isFiniteNum(ch.dominantBand.relativePower));
    assert.equal(typeof ch.dominantBand.association, "string");

    // band bars: each band has {label, relativePower}
    for (const name of ["delta", "theta", "alpha", "beta", "gamma"]) {
      const b = ch.bands[name];
      assert.ok(b, `missing band ${name}`);
      assert.equal(typeof b.label, "string");
      assert.ok(isFiniteNum(b.relativePower));
    }

    // indices footer: α/β {alphaBetaRatio} · θ/β {thetaBetaRatio} · arousal/attention
    assert.ok(isFiniteNum(ch.indices.alphaBetaRatio));
    assert.ok(isFiniteNum(ch.indices.thetaBetaRatio));
    assert.equal(typeof ch.indices.arousalLevel, "string");
    assert.equal(typeof ch.indices.attentionIndex, "string");
  });

  it("a pure 10 Hz signal is correctly alpha-dominant (TRUE computed value)", () => {
    const r = callViaPanel("frequencyAnalysis", ctxA, {
      channels: [{ name: "CH1", samples: sine(10, 1024, 256), sampleRate: 256 }],
    });
    assert.equal(r.ok, true, r.error);
    const ch = r.result.channels[0];
    assert.equal(ch.dominantBand.name, "alpha", "10 Hz lives in the alpha band (8-13 Hz)");
    // peak frequency must land within the alpha band, not some arbitrary bin
    assert.ok(ch.peakFrequency >= 8 && ch.peakFrequency <= 13, `peak ${ch.peakFrequency} Hz not in alpha`);
    assertNoNonFinite(r.result);
  });
});

/* ───────── connectivityAnalysis — the FIELD-NAME DEAD-SURFACE fix ───────── */

describe("neuro.connectivityAnalysis — exact fields NeuroActionPanel renders", () => {
  it("returns significantConnections (what the card reads), NOT a bare `connections`", () => {
    const r = callViaPanel("connectivityAnalysis", ctxA, { channels: panelChannels() });
    assert.equal(r.ok, true, r.error);
    // the card reads r.result.significantConnections — the prior code read
    // r.result.connections which the handler never returns (dead surface).
    assert.ok(Array.isArray(r.result.significantConnections), "significantConnections must exist for the render");
    assert.equal(r.result.connections, undefined, "handler does not return `connections` — render must not depend on it");
    // the two highly-correlated channels produce at least one edge
    assert.ok(r.result.significantConnections.length >= 1, "a real correlated pair must surface an edge");
    const c = r.result.significantConnections[0];
    assert.equal(typeof c.from, "string");
    assert.equal(typeof c.to, "string");
    assert.ok(isFiniteNum(c.correlation));
    assert.ok(Math.abs(c.correlation) <= 1.0001, "Pearson correlation must be in [-1,1]");
    // density footer the card shows
    assert.ok(r.result.networkMetrics && isFiniteNum(r.result.networkMetrics.density));
    assertNoNonFinite(r.result);
  });

  it("VALIDATION-REJECTION: a single channel cannot form connectivity", () => {
    const r = callViaPanel("connectivityAnalysis", ctxA, { channels: [panelChannels()[0]] });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2 channels/i);
  });
});

/* ───────── erpAnalysis — the CONTINUOUS-SIGNAL dead path + render fields ───────── */

describe("neuro.erpAnalysis — NeuroActionPanel's continuous-signal path", () => {
  it("accepts a single signal + eventOnset (the actErp payload) and returns a real ERP", () => {
    // EXACT payload NeuroActionPanel.actErp sends: { signal: channels[0], eventOnset: 0.5 }.
    // Pre-fix the handler only read artifact.data.epochs → returned "No epoch
    // data." for this payload (dead in production).
    const signal = { name: "Fz", samples: sine(10, 1024, 256), sampleRate: 256 };
    const r = callViaPanel("erpAnalysis", ctxA, { signal, eventOnset: 0.5 });
    assert.equal(r.ok, true, r.error);
    // EXACT fields the ERP card renders after alignment:
    assert.ok(isFiniteNum(r.result.epochCount));
    assert.ok(r.result.epochCount >= 1, "the onset window must yield at least one epoch");
    assert.ok(isFiniteNum(r.result.peakAmplitude));
    assert.ok(isFiniteNum(r.result.snr));
    assert.equal(typeof r.result.snrQuality, "string");
    assert.ok(isFiniteNum(r.result.baselineRms));
    assert.ok(Array.isArray(r.result.peaks));
    assert.ok(Array.isArray(r.result.identifiedComponents));
    // the fields the OLD dead card read must not be what we depend on:
    assert.equal(r.result.peakAmplitudeMicroV, undefined);
    assert.equal(r.result.peakLatencyMs, undefined);
    assertNoNonFinite(r.result);
  });

  it("EegWorkbench epochs path still works (identifiedComponents + snrQuality)", () => {
    // EegWorkbench.doErp drives { epochs, sampleRate }. Build epochs with a
    // strong positive deflection ~300 ms (P300 window) so a component is named.
    const sr = 256;
    const epochLen = Math.round(sr * 1.0);
    const onsetIdx = Math.round(0.3 * sr); // 300 ms
    const mkEpoch = (jitter) => {
      const s = new Array(epochLen).fill(0);
      // baseline noise tiny + a Gaussian bump at ~300 ms
      for (let i = 0; i < epochLen; i++) {
        const d = i - (onsetIdx + jitter);
        s[i] = 5 * Math.exp(-(d * d) / (2 * 6 * 6));
      }
      return { samples: s, onset: 0 };
    };
    const epochs = [mkEpoch(-2), mkEpoch(0), mkEpoch(2), mkEpoch(-1), mkEpoch(1)];
    const r = callViaPanel("erpAnalysis", ctxA, { epochs, sampleRate: sr });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.epochCount, 5);
    assert.equal(typeof r.result.snrQuality, "string");
    // the 300 ms positive bump should be classified P300
    const comps = r.result.identifiedComponents.map((c) => c.component);
    assert.ok(comps.includes("P300"), `expected P300 in ${JSON.stringify(comps)}`);
    assertNoNonFinite(r.result);
  });

  it("VALIDATION-REJECTION: no signal and no epochs → honest error", () => {
    const r = callViaPanel("erpAnalysis", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /no epoch data|signal/i);
  });
});

/* ───────── EegWorkbench STATE-backed surface: import → analyze → degrade ───────── */

describe("neuro EegWorkbench — import + the analysis surface it drives", () => {
  it("importSignal (CSV) returns the recordingId + channelNames the workbench reads", () => {
    // EXACT shape EegWorkbench.doImport sends for CSV.
    const text = "Fz,Cz,Pz\n0.1,-0.2,0.3\n0.2,-0.1,0.25\n0.15,-0.15,0.2\n0.05,-0.05,0.1";
    const r = call("importSignal", ctxA, { format: "csv", name: "rest", sampleRate: 256, text, events: [] });
    assert.equal(r.ok, true, r.error);
    assert.equal(typeof r.result.recordingId, "string");
    assert.deepEqual(r.result.channelNames, ["Fz", "Cz", "Pz"]);
    assert.equal(r.result.channelCount, 3);
    assert.ok(isFiniteNum(r.result.durationSec));
  });

  it("VALIDATION-REJECTION: empty CSV import is rejected, not silently accepted", () => {
    const r = call("importSignal", ctxA, { format: "csv", text: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /empty/i);
  });

  it("topographicMap renders the electrode + grid + range fields the scalp-map card reads", () => {
    // Import a 10-20-named recording so electrodes match the montage.
    const sr = 256;
    const mkCh = (f) => sine(f, 512, sr).map((v) => v.toFixed(4));
    // CSV: Fz/Cz/Pz/Oz montage names
    const rows = [];
    rows.push("Fz,Cz,Pz,Oz");
    const a = sine(10, 512, sr), b = sine(8, 512, sr), c = sine(12, 512, sr), d = sine(6, 512, sr);
    for (let i = 0; i < 512; i++) rows.push([a[i], b[i], c[i], d[i]].map((x) => x.toFixed(5)).join(","));
    void mkCh;
    const imp = call("importSignal", ctxA, { format: "csv", name: "topo", sampleRate: sr, text: rows.join("\n") });
    assert.equal(imp.ok, true, imp.error);
    const r = call("topographicMap", ctxA, { recordingId: imp.result.recordingId, gridSize: 28 });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.mappedChannels >= 4, "all 4 montage channels mapped");
    const e = r.result.electrodes[0];
    assert.ok(isFiniteNum(e.x) && isFiniteNum(e.y) && isFiniteNum(e.value) && isFiniteNum(e.normalized));
    assert.ok(Array.isArray(r.result.grid) && r.result.grid.length === r.result.gridSize);
    assert.ok(isFiniteNum(r.result.range.min) && isFiniteNum(r.result.range.max));
    assertNoNonFinite(r.result.range);
  });

  it("statisticalTest returns the Welch t-test shape the stats card renders", () => {
    // EXACT shape EegWorkbench.doStats sends.
    const r = call("statisticalTest", ctxA, {
      groupA: [1.2, 0.9, 1.5, 1.1, 1.3],
      groupB: [0.4, 0.6, 0.3, 0.5, 0.45],
    });
    assert.equal(r.ok, true, r.error);
    for (const k of ["tStatistic", "degreesOfFreedom", "pValue", "cohensD", "meanDifference"]) {
      assert.ok(isFiniteNum(r.result[k]), `${k} must be finite`);
    }
    assert.equal(typeof r.result.significance, "string");
    assert.equal(typeof r.result.effectSize, "string");
    assert.equal(typeof r.result.significant, "boolean");
    assert.ok(r.result.groupA && isFiniteNum(r.result.groupA.mean));
    assert.ok(r.result.pValue >= 0 && r.result.pValue <= 1, "p-value must be in [0,1]");
    // these clearly-separated groups must be significant — a TRUE computed result
    assert.equal(r.result.significant, true);
    assertNoNonFinite(r.result);
  });

  it("VALIDATION-REJECTION: a group with <2 observations is rejected", () => {
    const r = call("statisticalTest", ctxA, { groupA: [1], groupB: [2, 3] });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2/i);
  });

  it("DEGRADE-GRACEFUL: an analysis on a missing recording fails soft, never throws", () => {
    // With STATE freshly wiped, no recording exists. The macro must return a
    // clean { ok:false } — not throw, not crash the dispatcher.
    for (const m of ["waveformWindow", "topographicMap", "preprocess", "epochData", "timeFrequency", "sourceLocalization"]) {
      const r = call(m, ctxA, { recordingId: "does_not_exist", steps: [{ kind: "lowpass", cutoff: 40 }] });
      assert.equal(r.ok, false, `${m} should fail soft on a missing recording`);
      assert.match(r.error, /not found/i, `${m} error: ${r.error}`);
    }
  });
});

/* ───────── fail-closed on poisoned numerics ───────── */

describe("neuro lens — fail-closed on poisoned numerics (no NaN/Infinity leak, no crash)", () => {
  it("frequencyAnalysis with NaN/Infinity/string samples never leaks a non-finite rendered number", () => {
    const poisoned = [NaN, Infinity, -Infinity, "abc", null, undefined, 0.5, 1, "1e9999"]
      .concat(sine(10, 64, 256));
    const r = callViaPanel("frequencyAnalysis", ctxA, {
      channels: [{ name: "CH1", samples: poisoned, sampleRate: 256 }],
    });
    // It may compute or reject — but it must NOT throw, and if ok it must not
    // surface NaN/Infinity into any number the card renders.
    assert.equal(typeof r.ok, "boolean");
    if (r.ok) {
      const ch = r.result.channels[0];
      // every rendered band relativePower must be finite
      for (const name of Object.keys(ch.bands)) {
        assert.ok(Number.isFinite(ch.bands[name].relativePower), `${name}.relativePower leaked non-finite`);
      }
      assert.ok(Number.isFinite(ch.peakFrequency));
      // the ratios are clamped to a finite sentinel — never Infinity in the render
      assert.ok(Number.isFinite(ch.indices.alphaBetaRatio), "alphaBetaRatio must be finite (clamped)");
      assert.ok(Number.isFinite(ch.indices.thetaBetaRatio), "thetaBetaRatio must be finite (clamped)");
    }
  });

  it("statisticalTest filters non-finite observations (Number.isFinite) before the t-test", () => {
    // EegWorkbench parses with .filter(Number.isFinite); the handler also filters.
    const r = call("statisticalTest", ctxA, {
      groupA: [1.2, NaN, 0.9, Infinity, 1.5, "abc", 1.1],
      groupB: [0.4, 0.6, -Infinity, 0.3, 0.5],
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.groupA.n, 4, "non-finite group-A observations must be dropped");
    assert.equal(r.result.groupB.n, 4, "non-finite group-B observations must be dropped");
    assertNoNonFinite(r.result);
  });

  it("importSignal coerces non-finite CSV cells to 0 (no NaN persisted)", () => {
    const text = "Fz,Cz\nabc,1.2\nNaN,0.5\n0.3,xyz";
    const r = call("importSignal", ctxA, { format: "csv", text, sampleRate: 256 });
    assert.equal(r.ok, true, r.error);
    // round-trip through waveform to prove no NaN was stored
    const w = call("waveformWindow", ctxA, { recordingId: r.result.recordingId, startSec: 0, windowSec: 1 });
    assert.equal(w.ok, true, w.error);
    assertNoNonFinite(w.result.traces);
  });
});
