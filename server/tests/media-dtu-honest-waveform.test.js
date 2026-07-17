/**
 * Honest waveform contract for media-dtu.js.
 *
 * `generateWaveform` used to synthesize a `Math.sin(...) + Math.random()`
 * curve with zero relationship to the uploaded audio and stamp it onto
 * every audio media DTU as if it were measured data — a fabricated
 * waveform presented as real (CLAUDE.md "honest by construction": a
 * decorative sensor-style readout presented as measured data is exactly
 * the violation that rule forbids).
 *
 * The server has no audio decoder, so it cannot compute real peaks from
 * compressed audio bytes (mp3/webm/ogg/flac). The honest fix is `null`:
 * consumers must render an honest empty/placeholder state, never another
 * fake curve. Real peaks are computed client-side (Web Audio
 * `decodeAudioData` + peak reduction) at record/upload time — see
 * `concord-frontend/lib/daw/engine.ts#generateWaveformPeaks` and the
 * daily/voice lens upload paths.
 *
 * This module holds its media state in a plain in-memory object (no
 * better-sqlite3 / DB_PATH involved), so no DB isolation setup is needed.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMediaDTU, getMediaDTU, getMediaFeed } from "../lib/media-dtu.js";

describe("media-dtu — honest waveform (no fabricated curve)", () => {
  let STATE;

  beforeEach(() => {
    STATE = {};
  });

  it("createMediaDTU stamps waveform: null on a new audio media DTU (never a fabricated array)", () => {
    const result = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Voice Memo",
      mediaType: "audio",
      mimeType: "audio/webm",
      duration: 42,
      fileSize: 500_000,
    });

    assert.ok(result.ok);
    assert.equal(result.mediaDTU.waveform, null);
    assert.equal(Array.isArray(result.mediaDTU.waveform), false);
  });

  it("holds for every audio MIME type in MEDIA_MIME_MAP.audio — the gap is universal, not format-specific", () => {
    const audioMimes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "audio/aac", "audio/webm"];
    for (const mimeType of audioMimes) {
      const result = createMediaDTU(STATE, {
        authorId: "user-1",
        title: `Track (${mimeType})`,
        mediaType: "audio",
        mimeType,
        fileSize: 1000,
      });
      assert.ok(result.ok, `createMediaDTU should succeed for ${mimeType}`);
      assert.equal(result.mediaDTU.waveform, null, `waveform must be null for ${mimeType}, not a fabricated array`);
    }
  });

  it("getMediaDTU (read path) still carries the honest null through — no fabrication happens on read either", () => {
    const created = createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Podcast Ep 1",
      mediaType: "audio",
      mimeType: "audio/mpeg",
      fileSize: 2_000_000,
    });
    const fetched = getMediaDTU(STATE, created.mediaDTU.id);
    assert.ok(fetched.ok);
    assert.equal(fetched.mediaDTU.waveform, null);
  });

  it("getMediaFeed surfaces waveform: null for audio items — consumers must render an honest placeholder, not this call inventing one", () => {
    createMediaDTU(STATE, {
      authorId: "user-1",
      title: "Live Set",
      mediaType: "audio",
      mimeType: "audio/mpeg",
      fileSize: 3_000_000,
      privacy: "public",
    });

    const feed = getMediaFeed(STATE, "user-1", { tab: "for-you" });
    assert.ok(feed.ok);
    assert.equal(feed.feed.length, 1);
    assert.equal(feed.feed[0].waveform, null);
  });

  it("non-audio media types are unaffected — waveform is null for video/image/document/stream as before", () => {
    for (const mediaType of ["video", "image", "document"]) {
      const result = createMediaDTU(STATE, {
        authorId: "user-1",
        title: `Item (${mediaType})`,
        mediaType,
        mimeType: mediaType === "video" ? "video/mp4" : mediaType === "image" ? "image/png" : "application/pdf",
        fileSize: 1000,
      });
      assert.ok(result.ok);
      assert.equal(result.mediaDTU.waveform, null);
    }
  });
});
