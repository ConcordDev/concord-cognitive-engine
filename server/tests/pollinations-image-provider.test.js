// Provider rules for lib/pollinations-image.js: the self-hosted GPU gen server
// is primary; Pollinations is used ONLY when that server is absent. A real GPU
// generation error is reported, never silently swapped for a watermarked image.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generatePollinationsImage } from "../lib/pollinations-image.js";

function startGen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const out = handler(req.url, body ? JSON.parse(body) : null);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

describe("pollinations-image provider selection", () => {
  const saved = { gen: process.env.CONCORD_GEN_URL, data: process.env.DATA_DIR, keep: process.env.CONCORD_GPU_ART_KEEP };
  let dataDir;
  before(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-art-"));
    process.env.DATA_DIR = dataDir;
  });
  after(() => {
    for (const [k, v] of [["CONCORD_GEN_URL", saved.gen], ["DATA_DIR", saved.data], ["CONCORD_GPU_ART_KEEP", saved.keep]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("falls back to Pollinations when the gen server is unreachable", async () => {
    process.env.CONCORD_GEN_URL = "http://127.0.0.1:9"; // nothing listens on discard port
    const r = await generatePollinationsImage({ prompt: "a red cube" });
    assert.equal(r.ok, true);
    assert.equal(r.provider, "pollinations");
    assert.equal(r.watermark, true);
    assert.equal(r.gpu_miss_reason, "local_gpu_unreachable");
  });

  it("reports a real GPU error instead of swapping providers", async () => {
    const srv = await startGen((url) => (url === "/health" ? { ok: true } : { ok: false, reason: "cuda_oom", error: "out of memory" }));
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const r = await generatePollinationsImage({ prompt: "a red cube" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "cuda_oom");
      assert.equal(r.provider_attempted, "local_gpu_flux");
      assert.equal(JSON.stringify(r).includes("pollinations.ai"), false);
    } finally { srv.close(); }
  });

  it("returns the GPU image and keeps only the newest saved copies", async () => {
    const png = Buffer.from("fake-png-bytes-for-test-0123456789").toString("base64");
    const srv = await startGen((url) => (url === "/health" ? { ok: true } : { ok: true, png_b64: png, seconds: 1.2 }));
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      process.env.CONCORD_GPU_ART_KEEP = "2";
      let r;
      for (let i = 0; i < 4; i++) {
        r = await generatePollinationsImage({ prompt: `cube ${i}`, seed: i });
        await new Promise((res) => setTimeout(res, 3)); // distinct Date.now() names
      }
      assert.equal(r.ok, true);
      assert.equal(r.provider, "local_gpu_flux");
      assert.equal(r.watermark, false);
      assert.equal(r.imageB64, png);
      assert.ok(r.url.startsWith("data:image/png;base64,"));
      const files = fs.readdirSync(path.join(dataDir, "gpu-art"));
      assert.equal(files.length, 2);
    } finally { srv.close(); }
  });
});
