// tests/artifact-waveform-honesty.test.js
//
// Pins the honest-by-construction contract of artifact-store.js's waveform
// extraction (verification-audit campaign). The previous implementation read
// Int16LE at `i*step + 44` on ANY audio buffer — for a compressed mp3/aac/ogg/
// flac file that reads encoded bytes as if they were PCM samples, fabricating a
// curve with no relationship to the audio. The fix computes REAL peaks only for
// genuine 16-bit PCM WAV (parsed via the RIFF chunk table) and returns null for
// everything else, so the UI shows an honest empty state instead of a fake wave.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { extractWaveformPeaks, parseWavPcm16 } from "../lib/artifact-store.js";

// ── Minimal WAV builder ──────────────────────────────────────────────────────

/**
 * Build a canonical 44-byte-header WAV around `samples` (Int16 array),
 * with configurable format so we can exercise the non-PCM16 reject paths.
 */
function buildWav(samples, { audioFormat = 1, numChannels = 1, bitsPerSample = 16 } = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(audioFormat, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(44100, 24);                                   // sampleRate
  buf.writeUInt32LE(44100 * numChannels * bytesPerSample, 28);    // byteRate
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);            // blockAlign
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  // Only write real 16-bit samples (the reject-path tests don't inspect bytes).
  if (bitsPerSample === 16) {
    for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buf;
}

let db; // eslint parity with sibling suites; unused here
beforeEach(() => { db = null; });
afterEach(() => { db = null; void db; });

// ── parseWavPcm16 ────────────────────────────────────────────────────────────

describe("parseWavPcm16", () => {
  it("locates the data chunk + blockAlign for a mono 16-bit PCM WAV", () => {
    const wav = buildWav([100, -200, 300, -400]);
    const parsed = parseWavPcm16(wav);
    assert.ok(parsed, "expected a parse result for real PCM16 WAV");
    assert.equal(parsed.dataStart, 44);
    assert.equal(parsed.dataEnd, 44 + 8); // 4 samples * 2 bytes
    assert.equal(parsed.blockAlign, 2);   // mono 16-bit
  });

  it("reports blockAlign 4 for stereo 16-bit PCM", () => {
    const wav = buildWav([1, 2, 3, 4], { numChannels: 2 });
    const parsed = parseWavPcm16(wav);
    assert.ok(parsed);
    assert.equal(parsed.blockAlign, 4);
  });

  it("returns null for a non-RIFF (compressed) buffer", () => {
    // An mp3 frame header starts with 0xFF 0xFB — never "RIFF".
    const mp3ish = Buffer.from([0xff, 0xfb, 0x90, 0x00, ...new Array(200).fill(0x42)]);
    assert.equal(parseWavPcm16(mp3ish), null);
  });

  it("returns null for IEEE-float WAV (audioFormat 3)", () => {
    const wav = buildWav([1, 2, 3, 4], { audioFormat: 3 });
    assert.equal(parseWavPcm16(wav), null);
  });

  it("returns null for 24-bit PCM WAV (not Int16-readable)", () => {
    const wav = buildWav([1, 2, 3, 4], { bitsPerSample: 24 });
    assert.equal(parseWavPcm16(wav), null);
  });

  it("returns null for a buffer too short to be a WAV", () => {
    assert.equal(parseWavPcm16(Buffer.alloc(10)), null);
    assert.equal(parseWavPcm16(null), null);
  });
});

// ── extractWaveformPeaks ─────────────────────────────────────────────────────

describe("extractWaveformPeaks", () => {
  it("computes REAL peaks from genuine PCM16 WAV samples", () => {
    // A loud sample near full-scale must surface as a peak near 1.0.
    const samples = new Array(4000).fill(0);
    samples[10] = 32000;   // ~0.976 of full scale
    samples[2000] = -16000; // ~0.488
    const wav = buildWav(samples);

    const peaks = extractWaveformPeaks(wav, 200);
    assert.ok(Array.isArray(peaks));
    assert.equal(peaks.length, 200);
    for (const p of peaks) assert.ok(p >= 0 && p <= 1, `peak ${p} out of [0,1]`);

    const max = Math.max(...peaks);
    assert.ok(max > 0.9, `expected a near-full-scale peak, got ${max}`);
    // The loud sample sits in the first bucket; a later bucket is quieter — so
    // the curve genuinely tracks the samples, it isn't a flat/constant fake.
    assert.ok(peaks[0] > peaks[199], "first bucket (loud) should exceed the silent tail");
  });

  it("returns null for compressed audio (no fabricated curve)", () => {
    const oggish = Buffer.from("OggS" + "x".repeat(400), "ascii");
    assert.equal(extractWaveformPeaks(oggish, 200), null);
  });

  it("returns null for float/24-bit WAV rather than misreading bytes", () => {
    assert.equal(extractWaveformPeaks(buildWav([1, 2, 3], { audioFormat: 3 }), 200), null);
    assert.equal(extractWaveformPeaks(buildWav([1, 2, 3], { bitsPerSample: 24 }), 200), null);
  });

  it("a silent PCM16 WAV yields real all-zero peaks (not null)", () => {
    // Silence is real data — it must produce a real (zero) curve, not a reject.
    const peaks = extractWaveformPeaks(buildWav(new Array(1000).fill(0)), 200);
    assert.ok(Array.isArray(peaks));
    assert.equal(peaks.length, 200);
    assert.ok(peaks.every((p) => p === 0));
  });
});
