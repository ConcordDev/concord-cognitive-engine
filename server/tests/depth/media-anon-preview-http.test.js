// Founder ruling GB-0604: signed-out visitors get a 30-second preview of PUBLIC
// media; the full file needs sign-in. Enforced on the server, tested over HTTP
// against the real app (real mount order + the real auth middleware).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anon-preview-"));
process.env.ARTIFACT_DIR = path.join(tmp, "artifacts");
process.env.DB_PATH = process.env.DB_PATH || path.join(tmp, "t.db");

import http from "node:http";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_harness.js";

let srv, base, owner, member;

async function register(tag) {
  const n = `${tag}_${crypto.randomBytes(3).toString("hex")}`;
  const r = await fetch(`${base}/api/auth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: n, email: `${n}@test.invalid`, password: "TestPass123!", dateOfBirth: "1990-01-01" }),
  });
  const j = await r.json();
  assert.ok(j.token, `register failed: ${r.status} ${JSON.stringify(j)}`);
  return { token: j.token, id: j.user?.id || j.userId };
}
const auth = (u) => ({ authorization: `Bearer ${u.token}` });

async function upload(user, buf, { type, filename, duration, privacy = "public" }) {
  const q = new URLSearchParams({ title: "t", filename, privacy });
  if (duration !== undefined) q.set("duration", String(duration));
  const r = await fetch(`${base}/api/media/upload-raw?${q}`, {
    method: "POST", headers: { ...auth(user), "content-type": type }, body: buf,
  });
  const j = await r.json();
  assert.equal(r.status, 201, JSON.stringify(j));
  return j.mediaDTU.id;
}
const stream = (id, { user, range } = {}) =>
  fetch(`${base}/api/media/${id}/stream`, { headers: { ...(user ? auth(user) : {}), ...(range ? { range } : {}) } });

function wav(seconds, rate = 8000) {
  const data = crypto.randomBytes(seconds * rate * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const mp3 = (n) => Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), crypto.randomBytes(n - 10)]);

before(async () => {
  const t = await load();
  srv = await new Promise((r) => { const s = http.createServer(t.app); s.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
  owner = await register("own");
  member = await register("mem");
});
after(() => { srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe("signed-out: public media is a 30 s preview only", () => {
  it("mp3 with a known duration: first 30/100 of the bytes, flagged as preview", async () => {
    const full = mp3(1_000_000);
    const id = await upload(owner, full, { type: "audio/mpeg", filename: "a.mp3", duration: 100 });
    const r = await stream(id);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-concord-preview"), "true");
    assert.equal(r.headers.get("x-concord-preview-seconds"), "30");
    assert.equal(r.headers.get("x-concord-full-requires"), "sign-in");
    assert.match(r.headers.get("cache-control"), /no-store|private/);
    const body = Buffer.from(await r.arrayBuffer());
    assert.equal(body.length, 300_000);
    assert.ok(body.equals(full.subarray(0, 300_000)));
    // Repeating the request never yields more.
    const again = Buffer.from(await (await stream(id)).arrayBuffer());
    assert.equal(again.length, 300_000);
  });

  it("Range requests past the cutoff are refused; ranges inside it work", async () => {
    const id = await upload(owner, mp3(1_000_000), { type: "audio/mpeg", filename: "a.mp3", duration: 100 });
    const past = await stream(id, { range: "bytes=400000-500000" });
    assert.equal(past.status, 416);
    const open = await stream(id, { range: "bytes=299000-" });
    assert.equal(open.status, 206);
    assert.equal(open.headers.get("content-range"), "bytes 299000-299999/300000");
    const tail = await stream(id, { range: "bytes=-5000000" });
    assert.equal(Buffer.from(await tail.arrayBuffer()).length, 300_000);
  });

  it("wav is cut exactly at 30 s with a valid rebuilt header", async () => {
    const full = wav(60);
    const id = await upload(owner, full, { type: "audio/wav", filename: "a.wav", duration: 60 });
    const r = await stream(id);
    assert.equal(r.headers.get("x-concord-preview-method"), "wav-exact");
    const body = Buffer.from(await r.arrayBuffer());
    assert.equal(body.length, 44 + 30 * 8000 * 2);
    assert.equal(body.toString("ascii", 0, 4), "RIFF");
    assert.equal(body.readUInt32LE(40), 30 * 8000 * 2);
    assert.ok(body.subarray(44).equals(full.subarray(44, 44 + 30 * 8000 * 2)));
  });

  it("unknown duration: documented low-bitrate fallback (128 kbps audio => 480,000 bytes), never longer than 30 s of a 128 kbps file", async () => {
    const id = await upload(owner, mp3(1_000_000), { type: "audio/mpeg", filename: "a.mp3" });
    const r = await stream(id);
    const method = r.headers.get("x-concord-preview-method");
    const body = Buffer.from(await r.arrayBuffer());
    assert.ok(["fallback-bitrate", "duration"].includes(method), method);
    if (method === "fallback-bitrate") assert.equal(body.length, 480_000);
    assert.ok(body.length < 1_000_000, "the full file must not be served");
  });

  it("a file shorter than 30 s is served whole", async () => {
    const full = mp3(50_000);
    const id = await upload(owner, full, { type: "audio/mpeg", filename: "s.mp3", duration: 12 });
    const body = Buffer.from(await (await stream(id)).arrayBuffer());
    assert.ok(body.equals(full));
  });
});

describe("signed-in: full stream as before", () => {
  it("a member gets every byte, no preview flag, and a non-shared cache policy", async () => {
    const full = mp3(1_000_000);
    const id = await upload(owner, full, { type: "audio/mpeg", filename: "a.mp3", duration: 100 });
    const r = await stream(id, { user: member });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-concord-preview"), null);
    assert.match(r.headers.get("cache-control"), /^private/);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(full));
    const part = await stream(id, { user: member, range: "bytes=400000-500000" });
    assert.equal(part.status, 206);
  });
});

describe("private media stays private", () => {
  it("signed-out and non-owner members are refused; the owner streams it all", async () => {
    const full = mp3(200_000);
    const id = await upload(owner, full, { type: "audio/mpeg", filename: "p.mp3", duration: 100, privacy: "private" });
    const anon = await stream(id);
    assert.ok([401, 404].includes(anon.status), `anon got ${anon.status}`);
    const other = await stream(id, { user: member });
    assert.equal(other.status, 404);
    const mine = await stream(id, { user: owner });
    assert.equal(mine.status, 200);
    assert.ok(Buffer.from(await mine.arrayBuffer()).equals(full));
  });

  it("the anonymous bypass is only for /stream: other media routes still need sign-in", async () => {
    const id = await upload(owner, mp3(20_000), { type: "audio/mpeg", filename: "x.mp3", duration: 100 });
    const meta = await fetch(`${base}/api/media/${id}/comments`);
    assert.equal(meta.status, 401);
    const up = await fetch(`${base}/api/media/upload-raw?title=t`, { method: "POST", headers: { "content-type": "audio/mpeg" }, body: mp3(2000) });
    assert.equal(up.status, 401);
  });
});
