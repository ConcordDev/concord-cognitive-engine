/**
 * P0 media upload → DTU: the raw transport round-trips real bytes, every
 * common audio/video format is accepted with its canonical stream
 * Content-Type, and the legacy base64-JSON path refuses a truncated body
 * instead of storing 7,500 bytes and answering 201.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "media-raw-"));
process.env.ARTIFACT_DIR = path.join(tmp, "artifacts");
process.env.DATA_DIR = tmp;

const { default: express } = await import("express");
const { default: createMediaRouter } = await import("../routes/media.js");

let server, base;
const STATE = { dtus: new Map() };

before(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => { req.user = { id: "user-1", role: "member" }; next(); });
  app.use("/api/media", createMediaRouter({ STATE }));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// Leading bytes that really are each format, padded with random content.
const HEADS = {
  mp3: Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0])]),
  mp3frame: Buffer.from([0xff, 0xfa, 0x90, 0x00]),
  wav: Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVEfmt ")]),
  flac: Buffer.from("fLaC"),
  ogg: Buffer.from("OggS"),
  mp4: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom")]),
  mov: Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  ")]),
  aac: Buffer.from([0xff, 0xf1, 0x50, 0x80]),
  webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
};
const file = (head, size) => Buffer.concat([head, crypto.randomBytes(size - head.length)]);

async function uploadRaw(buf, { type, filename = "x.bin", title = "t" } = {}) {
  const q = new URLSearchParams({ title, filename });
  const r = await fetch(`${base}/api/media/upload-raw?${q}`, {
    method: "POST",
    headers: type === undefined ? {} : { "content-type": type },
    body: buf,
  });
  return { status: r.status, body: await r.json() };
}
const stream = (id, range) => fetch(`${base}/api/media/${id}/stream`, { headers: range ? { range } : {} });

describe("raw upload round-trip", () => {
  for (const mb of [1.5, 9.6]) {
    it(`a ${mb} MB mp3 stores every byte and streams it back identical`, async () => {
      const buf = file(HEADS.mp3, Math.round(mb * 1024 * 1024));
      const up = await uploadRaw(buf, { type: "audio/mpeg", filename: "song.mp3" });
      assert.equal(up.status, 201, JSON.stringify(up.body));
      const dtu = up.body.mediaDTU;
      assert.equal(dtu.fileSize, buf.length);
      assert.equal(dtu.storageRef.artifactRef.sizeBytes, buf.length, "stored size must equal the file size");
      const r = await stream(dtu.id);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "audio/mpeg");
      assert.ok(Buffer.from(await r.arrayBuffer()).equals(buf), "stream bytes must equal the upload");
      const part = await stream(dtu.id, "bytes=100-1123");
      assert.equal(part.status, 206);
      assert.ok(Buffer.from(await part.arrayBuffer()).equals(buf.subarray(100, 1124)));
    });
  }
});

describe("format matrix", () => {
  // [label, head, declared types a browser may send, filename, canonical]
  const MATRIX = [
    ["mp3", HEADS.mp3, ["audio/mpeg", "audio/mp3", ""], "a.mp3", "audio/mpeg"],
    ["mp3 (bare frame)", HEADS.mp3frame, ["audio/mpeg"], "a.mp3", "audio/mpeg"],
    ["wav", HEADS.wav, ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"], "a.wav", "audio/wav"],
    ["flac", HEADS.flac, ["audio/flac", "audio/x-flac"], "a.flac", "audio/flac"],
    ["m4a", HEADS.mp4, ["audio/mp4", "audio/x-m4a"], "a.m4a", "audio/mp4"],
    ["aac", HEADS.aac, ["audio/aac", "audio/x-aac"], "a.aac", "audio/aac"],
    ["ogg/opus", HEADS.ogg, ["audio/ogg", "audio/opus"], "a.ogg", "audio/ogg"],
    ["webm audio", HEADS.webm, ["audio/webm"], "a.weba", "audio/webm"],
    ["mp4", HEADS.mp4, ["video/mp4"], "a.mp4", "video/mp4"],
    ["mov", HEADS.mov, ["video/quicktime"], "a.mov", "video/quicktime"],
    ["m4v", HEADS.mp4, ["video/x-m4v"], "a.m4v", "video/x-m4v"],
    ["webm video", HEADS.webm, ["video/webm"], "a.webm", "video/webm"],
  ];
  for (const [label, head, types, filename, canonical] of MATRIX) {
    for (const type of types) {
      it(`${label}: declared "${type || "(empty)"}" is accepted and streams as ${canonical}`, async () => {
        const buf = file(head, 4096);
        const up = await uploadRaw(buf, { type, filename });
        assert.equal(up.status, 201, JSON.stringify(up.body));
        assert.equal(up.body.mediaDTU.mimeType, canonical);
        const r = await stream(up.body.mediaDTU.id);
        assert.equal(r.headers.get("content-type"), canonical);
        assert.ok(Buffer.from(await r.arrayBuffer()).equals(buf));
      });
    }
  }

  it("octet-stream with a .mov extension is decided by the extension", async () => {
    const up = await uploadRaw(file(HEADS.mov, 2048), { type: "application/octet-stream", filename: "IMG_1.MOV" });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.mediaDTU.mimeType, "video/quicktime");
  });

  it("no type and no useful extension: magic bytes decide (wav)", async () => {
    const up = await uploadRaw(file(HEADS.wav, 2048), { type: "", filename: "recording" });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.mediaDTU.mimeType, "audio/wav");
  });

  it("a declared audio type whose bytes are something else is rejected", async () => {
    const up = await uploadRaw(file(HEADS.ogg, 2048), { type: "audio/flac", filename: "a.flac" });
    assert.equal(up.status, 400);
    assert.match(up.body.error, /magic bytes mismatch/);
  });
});

describe("legacy base64-JSON path never stores a truncated file", () => {
  it("a body cut to 10,000 chars while fileSize says more is refused with 413", async () => {
    const real = file(HEADS.mp3, 900_000);
    const cut = real.toString("base64").slice(0, 10_000); // what the global sanitizer does
    const r = await fetch(`${base}/api/media/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", mimeType: "audio/mpeg", fileSize: real.length, data: cut }),
    });
    const body = await r.json();
    assert.equal(r.status, 413);
    assert.equal(body.error, "upload_truncated");
    assert.equal(body.receivedBytes, 7500);
  });

  it("a small file whose bytes all arrive still works and reports its real size", async () => {
    const small = file(HEADS.wav, 3000);
    const r = await fetch(`${base}/api/media/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", mimeType: "audio/x-wav", fileSize: small.length, data: small.toString("base64") }),
    });
    const body = await r.json();
    assert.equal(r.status, 201, JSON.stringify(body));
    assert.equal(body.mediaDTU.mimeType, "audio/wav");
    assert.equal(body.mediaDTU.storageRef.artifactRef.sizeBytes, small.length);
  });
});
