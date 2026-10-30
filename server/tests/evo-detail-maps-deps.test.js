// server/tests/evo-detail-maps-deps.test.js
// Q51/A#31 — the detail_maps refinement pass used to run only if a
// caller injected vision/image-gen deps, and the governor injected an
// async()=>null stub for image gen, so the pass NEVER ran. These tests
// pin the real adapter (lib/evo-asset/detail-maps-deps.js) that bridges
// generatePollinationsImage's contract to the pass's, plus an
// end-to-end run of the pass itself with fakes (no network, no GPU).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { makeDetailMapsImageGen } = await import("../lib/evo-asset/detail-maps-deps.js");

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");

describe("detail-maps image-gen adapter", () => {
  it("maps the pass's size string to generator width/height and returns bytes", async () => {
    let seen = null;
    const gen = makeDetailMapsImageGen(async (opts) => {
      seen = opts;
      return { ok: true, imageB64: PNG_B64, provider: "local_gpu_flux" };
    });
    const out = await gen({ prompt: "rough stone", size: "512x768", quality: "hd" });
    assert.equal(seen.width, 512);
    assert.equal(seen.height, 768);
    assert.equal(seen.prompt, "rough stone");
    assert.equal(out.ok, true);
    assert.equal(out.imageB64, PNG_B64);
  });

  it("defaults a missing/garbled size to 1024x1024", async () => {
    let seen = null;
    const gen = makeDetailMapsImageGen(async (opts) => {
      seen = opts;
      return { ok: true, imageB64: PNG_B64 };
    });
    await gen({ prompt: "x" });
    assert.equal(seen.width, 1024);
    assert.equal(seen.height, 1024);
  });

  it("ok-but-byte-less results (URL-only fallback) become an honest skip", async () => {
    const gen = makeDetailMapsImageGen(async () => ({ ok: true, url: "https://image.pollinations.ai/prompt/x", provider: "pollinations" }));
    const out = await gen({ prompt: "x", size: "1024x1024" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_image_bytes");
  });

  it("generator failures pass through as ok:false with their reason", async () => {
    const gen = makeDetailMapsImageGen(async () => ({ ok: false, reason: "gpu_busy", error: "busy" }));
    const out = await gen({ prompt: "x" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "gpu_busy");
  });
});

describe("detail-maps image-gen adapter — background-tick safety (fix-it #59)", () => {
  it("passes a bounded timeout (60 s default, env override), not the 5-minute generator default", async () => {
    let seen = null;
    const gen = makeDetailMapsImageGen(async (opts) => { seen = opts; return { ok: false, reason: "gpu_busy" }; });
    await gen({ prompt: "x" });
    assert.equal(seen.timeoutMs, 60_000);
    process.env.CONCORD_EVO_DETAIL_GEN_TIMEOUT_MS = "15000";
    try { await gen({ prompt: "x" }); } finally { delete process.env.CONCORD_EVO_DETAIL_GEN_TIMEOUT_MS; }
    assert.equal(seen.timeoutMs, 15_000);
  });

  it("with the GPU unreachable, the default adapter makes NO external fetch and skips", async () => {
    const { callImageGen } = await import("../lib/evo-asset/detail-maps-deps.js");
    const realFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(String(u)); throw new Error("connect ECONNREFUSED"); };
    try {
      const out = await callImageGen({ prompt: "weathered brick", size: "1024x1024" });
      assert.equal(out.ok, false);
      assert.ok(!/pollinations\.ai/.test(JSON.stringify(out)), "no pollinations result");
    } finally { globalThis.fetch = realFetch; }
    assert.ok(urls.every((u) => !/pollinations\.ai/.test(u)), "no request to image.pollinations.ai: " + urls.join(","));
  });

  it("the Pollinations fallback's reachability HEAD now carries a timeout signal", async () => {
    const { generatePollinationsFallback } = await import("../lib/pollinations-image.js");
    const realFetch = globalThis.fetch;
    let init = null;
    globalThis.fetch = async (_u, i) => { init = i; return { ok: true }; };
    try { await generatePollinationsFallback({ prompt: "x" }); } finally { globalThis.fetch = realFetch; }
    assert.equal(init.method, "HEAD");
    assert.ok(init.signal, "HEAD must have an abort signal");
  });
});

// The end-to-end pass tests live in evo-detail-maps-pass.test.js —
// refinement-passes.js pulls @gltf-transform/core (glb-bridge), which
// needs installed node_modules; the adapter tests above do not.
