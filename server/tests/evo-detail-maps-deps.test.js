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

// The end-to-end pass tests live in evo-detail-maps-pass.test.js —
// refinement-passes.js pulls @gltf-transform/core (glb-bridge), which
// needs installed node_modules; the adapter tests above do not.
