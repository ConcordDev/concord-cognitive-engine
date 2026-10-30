// server/tests/evo-detail-maps-pass.test.js
// Q51/A#31 — end-to-end run of the detail_maps refinement pass with the
// real adapter (lib/evo-asset/detail-maps-deps.js) and fake
// vision/generator functions. No network, no GPU. Needs installed
// node_modules (refinement-passes → glb-bridge → @gltf-transform/core),
// so this suite runs where deps are installed (Mac/CI).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.EVO_ASSET_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evo-detail-"));

const { makeDetailMapsImageGen } = await import("../lib/evo-asset/detail-maps-deps.js");
const { runDetailMapsPass } = await import("../lib/evo-asset/refinement-passes.js");

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");

describe("runDetailMapsPass with the real adapter", () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "evo-src-"));
  const src = path.join(srcDir, "texture.png");
  fs.writeFileSync(src, Buffer.from(PNG_B64, "base64"));
  const vision = async () => ({ ok: true, content: "weathered oak planks, warm brown" });

  it("produces a detail_maps variant file end to end", async () => {
    const callImageGen = makeDetailMapsImageGen(async () => ({ ok: true, imageB64: PNG_B64 }));
    const result = await runDetailMapsPass("asset-q51", src, { callVision: vision, callImageGen });
    assert.ok(result, "pass should produce a variant");
    assert.equal(result.passKind, "detail_maps");
    assert.ok(fs.existsSync(result.localPath), "variant file written");
    assert.equal(fs.readFileSync(result.localPath).toString("base64"), PNG_B64);
  });

  it("skips (null) when generation can only offer a URL — GPU down", async () => {
    const callImageGen = makeDetailMapsImageGen(async () => ({ ok: true, url: "https://image.pollinations.ai/prompt/x" }));
    const result = await runDetailMapsPass("asset-q51", src, { callVision: vision, callImageGen });
    assert.equal(result, null);
  });

  it("skips (null) when vision fails", async () => {
    const callImageGen = makeDetailMapsImageGen(async () => ({ ok: true, imageB64: PNG_B64 }));
    const result = await runDetailMapsPass("asset-q51", src, {
      callVision: async () => ({ ok: false, error: "vision_down" }),
      callImageGen,
    });
    assert.equal(result, null);
  });
});
