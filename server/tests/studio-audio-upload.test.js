// server/tests/studio-audio-upload.test.js
//
// Recorded takes are uploaded as WAV files so a project opens with its audio
// on any device. Chunked PUT, owner-only GET, WAV-only, offset checks.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

let server, base, tmp;
const USERS = { "tok-a": { id: "u_artist" }, "tok-b": { id: "u_other" } };

function wav(bytes) {
  const b = Buffer.alloc(bytes);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(bytes - 8, 4);
  b.write("WAVE", 8, "ascii");
  for (let i = 12; i < bytes; i++) b[i] = i % 251;
  return b;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-audio-"));
  process.env.DATA_DIR = tmp;
  globalThis._concordSTATE = { studioLens: { projects: new Map([["u_artist", new Map([["proj_1", { id: "proj_1" }]])]]) } };
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  const { default: createStudioRouter } = await import("../routes/studio.js");
  const requireAuth = () => (req, res, next) => {
    const u = USERS[String(req.headers.authorization || "").replace("Bearer ", "")];
    if (!u) return res.status(401).json({ ok: false });
    req.user = u;
    next();
  };
  const app = express();
  app.use("/api/studio", createStudioRouter({ db, requireAuth }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/studio`;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const put = (url, body, tok = "tok-a") => fetch(url, { method: "PUT", body, headers: { authorization: `Bearer ${tok}`, "content-type": "application/octet-stream" } });

describe("studio audio upload", () => {
  it("uploads in chunks and downloads byte-identical", async () => {
    const file = wav(300000);
    const chunk = 128 * 1024;
    let last;
    for (let off = 0; off < file.length; off += chunk) {
      const r = await put(`${base}/audio/proj_1/take_1?offset=${off}&total=${file.length}`, file.subarray(off, off + chunk));
      assert.equal(r.status, 200);
      last = await r.json();
    }
    assert.equal(last.complete, true);
    const g = await fetch(`${base}/audio/proj_1/take_1`, { headers: { authorization: "Bearer tok-a" } });
    assert.equal(g.status, 200);
    assert.equal(g.headers.get("content-type"), "audio/wav");
    assert.ok(Buffer.from(await g.arrayBuffer()).equals(file));
  });

  it("rejects other users, bad ids, non-WAV and out-of-order chunks", async () => {
    const file = wav(1000);
    assert.equal((await put(`${base}/audio/proj_1/t2?offset=0&total=1000`, file, "tok-b")).status, 404);
    assert.equal((await fetch(`${base}/audio/proj_1/take_1`, { headers: { authorization: "Bearer tok-b" } })).status, 404);
    assert.equal((await fetch(`${base}/audio/proj_1/take_1`)).status, 401);
    assert.equal((await put(`${base}/audio/proj_1/..%2Fx?offset=0&total=1000`, file)).status, 400);
    assert.equal((await put(`${base}/audio/proj_1/t3?offset=0&total=10`, Buffer.from("not a wav!"))).status, 415);
    assert.equal((await put(`${base}/audio/proj_1/t4?offset=500&total=1000`, file.subarray(500))).status, 409);
  });
});
