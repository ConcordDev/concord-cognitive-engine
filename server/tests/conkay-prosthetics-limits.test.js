// server/tests/conkay-prosthetics-limits.test.js
// Q50 review HOLD: (1) POST /api/conkay/prosthetics/{toolpath,run} took
// outDir from req.body, so any signed-in user could make the server create
// directories and write .gcode/telemetry anywhere the backend user can
// (CodeQL js/path-injection); (2) slicing is O(triangles × layers) on the
// request thread with segments/stacks/layerHeight uncapped (131k tris ×
// 1200 layers measured 2.9 s; unbounded beyond that). These tests pin the
// server-chosen output dir and the slicing caps.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  SLICER_LIMITS,
  checkSocketParams,
  buildParametricSocket,
  emitBioprintToolpath,
} from "../lib/conkay/verticals/prosthetics.js";

describe("prosthetics slicer limits (lib)", () => {
  it("accepts the default socket and rejects oversized or non-integer resolutions", () => {
    assert.equal(checkSocketParams({}), null);
    assert.equal(checkSocketParams({ segments: 256, stacks: 256 }), null);
    for (const bad of [{ segments: 257 }, { stacks: 257 }, { segments: 1024, stacks: 1024 }, { segments: 2 }, { stacks: 0 }, { segments: 24.5 }, { segments: "24" }]) {
      assert.equal(checkSocketParams(bad)?.code, "SOCKET_TOO_LARGE", JSON.stringify(bad));
    }
  });

  it("refuses a slice past the layer cap before touching the disk", () => {
    const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-lim-")), "never-created");
    const { mesh } = buildParametricSocket({}); // 120 mm tall
    const tool = emitBioprintToolpath(mesh, { outDir, layerHeight: SLICER_LIMITS.minLayerHeight }); // 2400 layers
    assert.equal(tool.ok, false);
    assert.equal(tool.code, "SLICE_TOO_LARGE");
    assert.equal(tool.layers, 2400);
    assert.equal(fs.existsSync(outDir), false, "no directory may be created for a refused slice");
    fs.rmSync(path.dirname(outDir), { recursive: true, force: true });
  });

  it("refuses triangles × layers past the work budget (the measured 2.9 s case)", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-lim-"));
    const { mesh } = buildParametricSocket({ segments: 256, stacks: 256 }); // 131,072 triangles
    const tool = emitBioprintToolpath(mesh, { outDir, layerHeight: 0.1 }); // 1200 layers
    assert.equal(tool.ok, false);
    assert.equal(tool.code, "SLICE_TOO_LARGE");
    assert.equal(tool.triangles, 256 * 256 * 2);
    assert.ok(tool.triangles * tool.layers > SLICER_LIMITS.maxTriangleLayers);
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("refuses a zero, negative or non-numeric layer height instead of looping forever", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-lim-"));
    const { mesh } = buildParametricSocket({});
    for (const layerHeight of [0, -1, 0.01, Number.NaN, "0.2"]) {
      assert.equal(emitBioprintToolpath(mesh, { outDir, layerHeight }).code, "BAD_LAYER_HEIGHT", String(layerHeight));
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("the largest accepted slice stays well under a second", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-lim-"));
    // 120 × 120 × 2 = 28,800 triangles × 600 layers = 17.3M ≤ 20M budget.
    const { mesh } = buildParametricSocket({ segments: 120, stacks: 120 });
    const t0 = Date.now();
    const tool = emitBioprintToolpath(mesh, { outDir, layerHeight: 0.2 });
    const ms = Date.now() - t0;
    assert.equal(tool.ok, true);
    assert.ok(ms < 2000, `largest accepted slice took ${ms} ms`);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});

describe("prosthetics routes (output dir is server-chosen, caps return 400)", () => {
  let base, server, home, prevHome, evilDir;

  before(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-home-"));
    evilDir = fs.mkdtempSync(path.join(os.tmpdir(), "prosthetics-evil-"));
    prevHome = process.env.HOME;
    process.env.HOME = home; // the route's output root is computed from os.homedir() at import
    const { default: createConkayVerticalsRouter } = await import("../routes/conkay-verticals.js");
    const app = express();
    app.use(express.json());
    const requireAuth = (req, _res, next) => { req.user = { id: req.get("x-test-user") || "u1" }; next(); };
    app.use("/api/conkay", createConkayVerticalsRouter({ requireAuth }));
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(evilDir, { recursive: true, force: true });
  });

  const post = (p, body, user) => fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
  const outRoot = () => path.join(home, ".zuko", "remaining-work", "conkay-prosthetics-out");

  it("toolpath ignores body.outDir and writes under the caller's own directory", async () => {
    const target = path.join(evilDir, "pwned");
    const r = await post("/api/conkay/prosthetics/toolpath", { outDir: target, layerHeight: 12 }, "alice");
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.toolpath.ok, true);
    assert.equal(fs.existsSync(target), false, "caller-supplied outDir must never be created");
    assert.equal(path.dirname(j.toolpath.gcodePath), path.join(outRoot(), "alice"));
    assert.ok(fs.existsSync(j.toolpath.gcodePath));
  });

  it("run ignores body.outDir too", async () => {
    const target = path.join(evilDir, "pwned-run");
    const r = await post("/api/conkay/prosthetics/run", { outDir: target }, "bob");
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(fs.existsSync(target), false);
    assert.equal(path.dirname(j.toolpath.gcodePath), path.join(outRoot(), "bob"));
  });

  it("a user id with path characters cannot climb out of the output root", async () => {
    const r = await post("/api/conkay/prosthetics/toolpath", { layerHeight: 12 }, "../../../escape");
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    const dir = path.dirname(j.toolpath.gcodePath);
    assert.ok(dir.startsWith(outRoot() + path.sep), dir);
    assert.equal(path.dirname(dir), outRoot());
  });

  it("oversized socket resolution is a 400, not seconds of blocked event loop", async () => {
    const r = await post("/api/conkay/prosthetics/toolpath", { segments: 1024, stacks: 1024, layerHeight: 0.01 });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "SOCKET_TOO_LARGE");
  });

  it("too many layers is a 400", async () => {
    const r = await post("/api/conkay/prosthetics/toolpath", { height: 100000, layerHeight: 0.2 });
    const j = await r.json();
    assert.equal(r.status, 400);
    assert.equal(j.toolpath.code, "SLICE_TOO_LARGE");
  });

  it("a zero layer height is a 400", async () => {
    const r = await post("/api/conkay/prosthetics/toolpath", { layerHeight: 0 });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).toolpath.code, "BAD_LAYER_HEIGHT");
  });
});
