/**
 * Tier-2 contract tests for Phase 13 Stage B — voice modality.
 *
 * Pins:
 *   - shouldMintVoiceCaptureDtu gate logic (opt-in, length, duration, room)
 *   - createReel admits audio-only entries via migration 201
 *   - createReel still validates duration + missing media
 *   - shapeReel surfaces mediaKind discriminator
 *   - initModalities flips MODALITY.* flags based on isExecutableFile probe
 *
 * Run: node --test server/tests/voice-modality-gating.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { writeFileSync, chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  shouldMintVoiceCaptureDtu,
  MIN_TRANSCRIPT_LEN,
  MIN_DURATION_S,
} from "../lib/voice-dtu-gate.js";
import { up as up199 } from "../migrations/199_reels.js";
import { up as up201 } from "../migrations/201_reels_audio_columns.js";
import { createReel, getReel } from "../lib/reels.js";

// ── shouldMintVoiceCaptureDtu ─────────────────────────────────────────────

describe("voice DTU gate — opt-in + thresholds", () => {
  it("default (mintAsDtu not set) → not_opted_in", () => {
    const r = shouldMintVoiceCaptureDtu({ transcript: "x".repeat(100), durationSeconds: 60 });
    assert.equal(r.mint, false);
    assert.equal(r.reason, "not_opted_in");
  });

  it("opted in but transcript < 20 chars → transcript_too_short", () => {
    const r = shouldMintVoiceCaptureDtu({
      mintAsDtu: true, transcript: "yes ok", durationSeconds: 60,
    });
    assert.equal(r.mint, false);
    assert.equal(r.reason, "transcript_too_short");
  });

  it("opted in + long transcript but duration < 3s → audio_too_short", () => {
    const r = shouldMintVoiceCaptureDtu({
      mintAsDtu: true, transcript: "x".repeat(MIN_TRANSCRIPT_LEN), durationSeconds: 2,
    });
    assert.equal(r.mint, false);
    assert.equal(r.reason, "audio_too_short");
  });

  it("inVoiceRoom: true blocks even with long transcript + duration", () => {
    const r = shouldMintVoiceCaptureDtu({
      mintAsDtu: true, transcript: "x".repeat(50), durationSeconds: 30, inVoiceRoom: true,
    });
    assert.equal(r.mint, false);
    assert.equal(r.reason, "in_voice_room");
  });

  it("all gates pass → mint: true", () => {
    const r = shouldMintVoiceCaptureDtu({
      mintAsDtu: true,
      transcript: "x".repeat(MIN_TRANSCRIPT_LEN),
      durationSeconds: MIN_DURATION_S,
    });
    assert.equal(r.mint, true);
    assert.equal(r.reason, null);
  });
});

// ── createReel — audio-only path (migration 201) ───────────────────────────

function setupReelsDb() {
  const db = new Database(":memory:");
  up199(db);
  up201(db);
  return db;
}

describe("createReel — audio-only entries", () => {
  it("admits audio-only reel (no videoUrl)", () => {
    const db = setupReelsDb();
    const r = createReel(db, {
      reelId: "reel:a1",
      postId: "post:a1",
      userId: "user:alice",
      audioUrl: "/api/artifact/x/stream",
      audioDurationSeconds: 12,
      durationSeconds: 12,
    });
    assert.equal(r.ok, true);
    assert.equal(r.reel.mediaKind, "audio");
    assert.equal(r.reel.audioUrl, "/api/artifact/x/stream");
    assert.equal(r.reel.videoUrl, null);
    assert.equal(r.reel.audioDurationSeconds, 12);
  });

  it("admits video reel (no audioUrl) — backwards compatible", () => {
    const db = setupReelsDb();
    const r = createReel(db, {
      reelId: "reel:v1",
      postId: "post:v1",
      userId: "user:alice",
      videoUrl: "/api/artifact/v/stream",
      durationSeconds: 30,
    });
    assert.equal(r.ok, true);
    assert.equal(r.reel.mediaKind, "video");
    assert.equal(r.reel.videoUrl, "/api/artifact/v/stream");
    assert.equal(r.reel.audioUrl, null);
  });

  it("rejects entry with neither videoUrl nor audioUrl", () => {
    const db = setupReelsDb();
    const r = createReel(db, {
      reelId: "reel:bad",
      postId: "post:bad",
      userId: "user:alice",
      durationSeconds: 12,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_media");
  });

  it("still enforces duration bounds (60s cap)", () => {
    const db = setupReelsDb();
    const r = createReel(db, {
      reelId: "reel:longboi",
      postId: "post:longboi",
      userId: "user:alice",
      audioUrl: "/x.webm",
      durationSeconds: 120,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "duration_out_of_range");
  });

  it("shapeReel mediaKind discriminator returns 'audio' for audio-only rows", () => {
    const db = setupReelsDb();
    createReel(db, {
      reelId: "reel:disc",
      postId: "post:disc",
      userId: "user:alice",
      audioUrl: "/x.webm",
      durationSeconds: 10,
    });
    const r = getReel(db, "reel:disc");
    assert.equal(r.ok, true);
    assert.equal(r.reel.mediaKind, "audio");
  });
});

// ── initModalities — boot probe ────────────────────────────────────────────

describe("initModalities — boot probe flips enabled flags", () => {
  before(() => {
    // Clear any env vars that might confuse the probe between tests.
    delete process.env.WHISPER_CPP_BIN;
    delete process.env.PIPER_BIN;
    delete process.env.ELEVENLABS_API_KEY;
  });

  it("detects ElevenLabs from API key presence (no binary needed)", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    // Reset module cache so MODALITY re-reads env. node:test runs each
    // describe in the same context; we explicitly re-import to get a
    // fresh module state.
    const moduleId = `../lib/modality-config.js?reset=${Date.now()}`;
    const { MODALITY } = await import(moduleId).catch(async () => {
      // ?reset query string isn't a real ESM feature; fall back to using
      // the cached module + the test-only override.
      const m = await import("../lib/modality-config.js");
      return m;
    });
    // Reset before probe — the cached MODALITY might have stale state.
    MODALITY.tts.elevenlabs.apiKey = process.env.ELEVENLABS_API_KEY;
    const { initModalities } = await import("../lib/init-modalities.js");
    const snap = await initModalities();
    assert.equal(snap.tts_elevenlabs, true);
    assert.equal(snap.ttsSource === "elevenlabs" || snap.ttsSource === "piper", true);
  });

  it("detects whisper.cpp from executable binary on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "concord-stt-probe-"));
    const bin = join(dir, "whisper");
    writeFileSync(bin, "#!/bin/sh\necho ok\n");
    chmodSync(bin, 0o755);
    process.env.WHISPER_CPP_BIN = bin;
    const { MODALITY } = await import("../lib/modality-config.js");
    MODALITY.stt.bin = bin;
    const { initModalities } = await import("../lib/init-modalities.js");
    const snap = await initModalities();
    assert.equal(snap.stt, true);
    assert.equal(snap.sttSource, "whisper_cpp");
  });

  it("non-executable file is not treated as an STT backend", async () => {
    const dir = mkdtempSync(join(tmpdir(), "concord-stt-noexec-"));
    const bin = join(dir, "whisper");
    writeFileSync(bin, "fake");
    chmodSync(bin, 0o644);
    process.env.WHISPER_CPP_BIN = bin;
    const { MODALITY } = await import("../lib/modality-config.js");
    MODALITY.stt.bin = bin;
    // Also clear ElevenLabs / Piper so this test sees a clean stt-only world.
    MODALITY.tts.piper.bin = "";
    MODALITY.tts.elevenlabs.apiKey = "";
    const { initModalities } = await import("../lib/init-modalities.js");
    const snap = await initModalities();
    assert.equal(snap.stt, false);
    assert.equal(snap.sttSource, "none");
  });
});
