// Draft episodes stay on the creator's desk: another account cannot list
// them, and the attached media is unreadable until the episode is published.
// durationSec is filled from the media probe when the client sends 0.
// episodeNumber advances instead of repeating.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { durationFromAudioBuffer, resolveAudioDurationSec } from "../lib/artifact-transcoder.js";
import { createMediaDTU } from "../lib/media-dtu.js";
import { createErrorMiddleware } from "../lib/async-handler.js";
import registerPodcastActions from "../domains/podcast.js";

const tmpArtifacts = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-draft-media-"));
process.env.ARTIFACT_DIR = tmpArtifacts;
const { default: createMediaRouter } = await import("../routes/media.js");

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`podcast.${name}`);
  assert.ok(fn, `podcast.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function pcmWav({ seconds = 1, sampleRate = 8000 } = {}) {
  const channels = 1;
  const bits = 16;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * channels * (bits / 8);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  buf.writeUInt16LE(channels * (bits / 8), 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function freshState() {
  const STATE = { dtus: new Map() };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  return STATE;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

before(() => { registerPodcastActions(register); });
after(() => { fs.rmSync(tmpArtifacts, { recursive: true, force: true }); });

describe("audio duration probe", () => {
  it("reads WAV duration from the header and keeps an explicit duration", async () => {
    const wav = pcmWav({ seconds: 1, sampleRate: 8000 });
    const parsed = durationFromAudioBuffer(wav, "audio/wav");
    assert.ok(parsed > 0.9 && parsed < 1.1, `wav duration ${parsed}`);
    assert.equal(await resolveAudioDurationSec({ buffer: wav, mimeType: "audio/wav", declared: 0 }), 1);
    assert.equal(await resolveAudioDurationSec({ buffer: wav, mimeType: "audio/wav", declared: 42 }), 42);
  });

  it("estimates MP3 duration from the first frame bitrate", () => {
    const buf = Buffer.alloc(16000);
    buf[0] = 0xff;
    buf[1] = 0xfb;
    buf[2] = 0x90; // 128 kbps, 44100
    const sec = durationFromAudioBuffer(buf, "audio/mpeg");
    assert.ok(sec > 0.9 && sec < 1.1, `mp3 duration ${sec}`);
  });
});

describe("podcast episode numbers", () => {
  it("assigns the next number when omitted and when the requested number is taken", () => {
    freshState();
    const show = call("show-add", ctxA, { title: "Desk" }).result.show;
    const first = call("episode-add", ctxA, { showId: show.id, title: "One", durationSec: 10 });
    const second = call("episode-add", ctxA, { showId: show.id, title: "Two", durationSec: 10 });
    const repeated = call("episode-add", ctxA, { showId: show.id, title: "Again", durationSec: 10, episodeNumber: 1 });
    const explicit = call("episode-add", ctxA, { showId: show.id, title: "Seven", durationSec: 10, episodeNumber: 7 });
    const otherSeason = call("episode-add", ctxA, {
      showId: show.id, title: "Season two pilot", durationSec: 10, seasonNumber: 2, episodeNumber: 1,
    });
    assert.equal(first.result.episode.episodeNumber, 1);
    assert.equal(second.result.episode.episodeNumber, 2);
    assert.equal(repeated.result.episode.episodeNumber, 3);
    assert.equal(explicit.result.episode.episodeNumber, 7);
    assert.equal(otherSeason.result.episode.episodeNumber, 1);
    assert.equal(otherSeason.result.episode.seasonNumber, 2);
  });
});

describe("podcast draft privacy", () => {
  it("hides drafts from other accounts and keeps draft media private until publish", async () => {
    const STATE = freshState();
    const created = createMediaDTU(STATE, {
      authorId: "user_a",
      title: "pilot audio",
      mediaType: "audio",
      mimeType: "audio/wav",
      duration: 12.4,
      privacy: "public",
      fileSize: 100,
    });
    assert.equal(created.ok, true);
    const mediaId = created.mediaDTU.id;

    const show = call("show-add", ctxA, { title: "Private Desk" }).result.show;
    const draft = call("episode-add", ctxA, {
      showId: show.id, title: "Unreleased", durationSec: 0, mediaId, status: "draft",
    });
    assert.equal(draft.ok, true);
    assert.equal(draft.result.episode.mediaId, mediaId);
    assert.ok(draft.result.episode.durationSec > 0, "duration filled from the media probe");
    assert.equal(draft.result.episode.durationSec, 12);
    assert.equal(STATE._media.mediaDTUs.get(mediaId).privacy, "private");

    const published = call("episode-add", ctxA, {
      showId: show.id, title: "Live", durationSec: 30, status: "published",
    });
    assert.equal(published.ok, true);

    const asCreator = call("episode-list", ctxA, { showId: show.id });
    assert.ok(asCreator.result.episodes.some((e) => e.title === "Unreleased"));
    const asOther = call("episode-list", ctxB, { showId: show.id });
    assert.equal(asOther.result.episodes.some((e) => e.title === "Unreleased"), false);
    assert.ok(asOther.result.episodes.some((e) => e.title === "Live"));
    assert.equal(call("episode-detail", ctxB, { id: draft.result.episode.id }).ok, false);
    assert.equal(call("episode-set-status", ctxB, { episodeId: draft.result.episode.id, status: "published" }).ok, false);
    call("show-subscribe", ctxB, { id: show.id });
    const fresh = call("new-episodes", ctxB, {});
    assert.equal(fresh.result.episodes.some((e) => e.id === draft.result.episode.id), false);

    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use((req, _res, next) => {
      const id = req.header("x-test-user");
      if (id) req.user = { id };
      next();
    });
    app.use("/api/media", createMediaRouter({ STATE }));
    app.use(createErrorMiddleware(() => {}));
    const server = await listen(app);
    const port = server.address().port;
    try {
      const blocked = await fetch(`http://127.0.0.1:${port}/api/media/${mediaId}`, {
        headers: { "x-test-user": "user_b" },
      });
      assert.ok(blocked.status === 403 || blocked.status === 404, `B saw draft media (${blocked.status})`);
      const owner = await fetch(`http://127.0.0.1:${port}/api/media/${mediaId}`, {
        headers: { "x-test-user": "user_a" },
      });
      assert.equal(owner.status, 200);

      const flipped = call("episode-set-status", ctxA, { episodeId: draft.result.episode.id, status: "published" });
      assert.equal(flipped.ok, true);
      assert.equal(STATE._media.mediaDTUs.get(mediaId).privacy, "public");
      const after = await fetch(`http://127.0.0.1:${port}/api/media/${mediaId}`, {
        headers: { "x-test-user": "user_b" },
      });
      assert.equal(after.status, 200);
      const listed = call("episode-list", ctxB, { showId: show.id });
      assert.ok(listed.result.episodes.some((e) => e.id === draft.result.episode.id));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("upload stores probed WAV duration when the client omits it", async () => {
    const STATE = freshState();
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use((req, _res, next) => {
      req.user = { id: "user_a" };
      next();
    });
    app.use("/api/media", createMediaRouter({ STATE }));
    app.use(createErrorMiddleware(() => {}));
    const server = await listen(app);
    const port = server.address().port;
    try {
      const wav = pcmWav({ seconds: 1, sampleRate: 8000 });
      const res = await fetch(`http://127.0.0.1:${port}/api/media/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "probe me",
          mediaType: "audio",
          mimeType: "audio/wav",
          fileSize: wav.length,
          originalFilename: "probe.wav",
          privacy: "public",
          data: wav.toString("base64"),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.ok(body.mediaDTU.duration > 0, "upload response duration");
      const show = call("show-add", ctxA, { title: "Probed" }).result.show;
      const ep = call("episode-add", ctxA, {
        showId: show.id, title: "From probe", durationSec: 0, mediaId: body.mediaDTU.id,
      });
      assert.ok(ep.result.episode.durationSec > 0);
      assert.equal(ep.result.episode.mediaId, body.mediaDTU.id);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
