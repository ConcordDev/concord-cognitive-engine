// P0-04 — asset rail pins (hermetic; drives the real CLIs as processes).
//
// The rail's contract is its command line (P0-18 step 1 runs
// `node scripts/assets/pull-assets.mjs`), so these pins exercise the
// scripts end to end against temp stores and temp trees:
//   (a) push, then pull into an EMPTY dir, reproduces sha256 for 100%
//       of rows (the P0-04 done-test);
//   (b) push is idempotent — a second push writes nothing;
//   (c) pull is idempotent — rows already present are not rewritten;
//   (d) a corrupt store object fails the pull BY NAME;
//   (e) push refuses a local file whose bytes contradict the manifest;
//   (f) a missing local file fails the push BY NAME;
//   (g) no store configured fails with the named P0-04 message;
//   (h) a manifest row outside the license_class enum is refused.
// Run: node --test server/tests/asset-rail.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../../scripts/assets/", import.meta.url));
const PULL = path.join(SCRIPTS, "pull-assets.mjs");
const PUSH = path.join(SCRIPTS, "push-assets.mjs");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function run(script, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd, env }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "asset-rail-"));
  const src = path.join(base, "src");
  const store = path.join(base, "store");
  const dest = path.join(base, "dest");
  const files = [
    { rel: "Assets/Concordia/Animations/Mixamo/Dive_Roll.fbx", body: Buffer.from([0, 1, 2, 3, 250, 251, 252]) },
    { rel: "Assets/Concordia/Animations/Mixamo/Dive_Roll.fbx.meta", body: Buffer.from("guid: 2de3ff1e\n") },
    { rel: "Assets/Concordia/Models/rock.glb", body: Buffer.from("glTF-fake-bytes") },
  ];
  const rows = [];
  for (const file of files) {
    const abs = path.join(src, file.rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.body);
    rows.push({
      path: file.rel,
      sha256: sha256(file.body),
      bytes: file.body.length,
      family: "test",
      source: "pin-fixture",
      license_class: "in_game_only",
      lod_tier: null,
    });
  }
  const manifestPath = path.join(base, "ASSET_MANIFEST.json");
  await writeFile(manifestPath, JSON.stringify({ version: 1, rows }, null, 2));
  return { base, src, store, dest, files, rows, manifestPath };
}

describe("P0-04 asset rail", () => {
  let fx;
  beforeEach(async () => {
    fx = await fixture();
  });

  it("(a) pull into an empty dir reproduces sha256 for 100% of rows; (b) push is idempotent", async () => {
    const push1 = await run(PUSH, ["--store", fx.store, "--manifest", fx.manifestPath, "--root", fx.src]);
    assert.equal(push1.code, 0, push1.stderr);
    assert.match(push1.stdout, /3 pushed/);
    const objects1 = await readdir(path.join(fx.store, "objects"));
    assert.equal(objects1.length, 3);

    const push2 = await run(PUSH, ["--store", fx.store, "--manifest", fx.manifestPath, "--root", fx.src]);
    assert.equal(push2.code, 0, push2.stderr);
    assert.match(push2.stdout, /0 pushed/);
    assert.match(push2.stdout, /3 already in store/);
    assert.deepEqual((await readdir(path.join(fx.store, "objects"))).sort(), objects1.sort());

    const pull = await run(PULL, ["--store", fx.store, "--manifest", fx.manifestPath, "--dest", fx.dest]);
    assert.equal(pull.code, 0, pull.stderr);
    assert.match(pull.stdout, /3 pulled/);
    for (const file of fx.files) {
      const got = await readFile(path.join(fx.dest, file.rel));
      assert.equal(sha256(got), sha256(file.body), `${file.rel} sha256 must reproduce`);
    }
  });

  it("(c) a second pull reports every row already present", async () => {
    await run(PUSH, ["--store", fx.store, "--manifest", fx.manifestPath, "--root", fx.src]);
    await run(PULL, ["--store", fx.store, "--manifest", fx.manifestPath, "--dest", fx.dest]);
    const again = await run(PULL, ["--store", fx.store, "--manifest", fx.manifestPath, "--dest", fx.dest]);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /0 pulled/);
    assert.match(again.stdout, /3 already present/);
  });

  it("(d) a corrupt store object fails the pull by name", async () => {
    await run(PUSH, ["--store", fx.store, "--manifest", fx.manifestPath, "--root", fx.src]);
    const victim = fx.rows[0];
    await writeFile(path.join(fx.store, "objects", victim.sha256), Buffer.from("corrupted"));
    const pull = await run(PULL, ["--store", fx.store, "--manifest", fx.manifestPath, "--dest", fx.dest]);
    assert.equal(pull.code, 1);
    assert.match(pull.stderr, new RegExp(victim.path.replace(/[/.]/g, "\\$&")));
  });

  it("(e) push refuses a local file that contradicts the manifest; (f) and a missing one, both by name", async () => {
    const tampered = fx.rows[1];
    await writeFile(path.join(fx.src, tampered.path), Buffer.from("not the manifest bytes"));
    await rm(path.join(fx.src, fx.rows[2].path));
    const push = await run(PUSH, ["--store", fx.store, "--manifest", fx.manifestPath, "--root", fx.src]);
    assert.equal(push.code, 1);
    assert.match(push.stderr, /Dive_Roll\.fbx\.meta.*refused/);
    assert.match(push.stderr, /rock\.glb.*missing/);
  });

  it("(g) no store configured fails with the named P0-04 message", async () => {
    const env = { ...process.env };
    delete env.CONCORDIA_ASSET_STORE;
    const pull = await run(PULL, ["--manifest", fx.manifestPath, "--dest", fx.dest], { env });
    assert.equal(pull.code, 2);
    assert.match(pull.stderr, /P0-04 asset rail: no asset store configured/);
  });

  it("(h) a manifest row outside the license_class enum is refused", async () => {
    const bad = { version: 1, rows: [{ ...fx.rows[0], license_class: "sellable" }] };
    const badPath = path.join(fx.base, "BAD_MANIFEST.json");
    await writeFile(badPath, JSON.stringify(bad));
    const pull = await run(PULL, ["--store", fx.store, "--manifest", badPath, "--dest", fx.dest]);
    assert.equal(pull.code, 2);
    assert.match(pull.stderr, /license_class/);
  });
});
