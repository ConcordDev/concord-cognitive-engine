// server/tests/concordia/hub-kit.test.js
//
//   cd server && node --test tests/concordia/hub-kit.test.js
//
// Pins the Unburned Court hub kit: every MANIFEST file exists, starts with
// glTF magic, and is copied to Unity StreamingAssets + the web hub folder.

import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CANON = path.join(REPO, "content", "concordia-assets", "hub");
const UNITY = path.join(
  REPO,
  "apps",
  "concordia-living-world",
  "unity-client",
  "Assets",
  "StreamingAssets",
  "HubKit",
);
const WEB = path.join(REPO, "concord-frontend", "public", "models", "hub");
const VITE = path.join(REPO, "apps", "concordia-living-world", "public", "models", "kenney");
const MAGIC = Buffer.from("glTF", "ascii");

function readManifest() {
  const p = path.join(CANON, "MANIFEST.json");
  assert.equal(existsSync(p), true, "content/concordia-assets/hub/MANIFEST.json must exist");
  return JSON.parse(readFileSync(p, "utf8"));
}

test("hub kit manifest names the Unburned Court pack", () => {
  const m = readManifest();
  assert.equal(m.id, "unburned-court-hub-kit");
  assert.ok(Array.isArray(m.files) && m.files.length >= 40, "hub kit is a real pack, not a stub");
  assert.ok(Array.isArray(m.aliases) && m.aliases.length >= 8);
});

test("every hub-kit GLB exists, is self-contained glTF-binary, and is copied to all three presenters", () => {
  const m = readManifest();
  const aliases = new Set(m.aliases.map((a) => a.to));
  const stems = new Set(m.files.map((f) => f.stem));
  for (const a of m.aliases) {
    assert.ok(stems.has(a.to), `alias ${a.from} → ${a.to} must resolve to a real stem`);
  }
  for (const entry of m.files) {
    const canon = path.join(CANON, entry.file);
    const unity = path.join(UNITY, entry.file);
    const web = path.join(WEB, entry.file);
    assert.equal(existsSync(canon), true, canon);
    assert.equal(existsSync(unity), true, unity);
    assert.equal(existsSync(web), true, web);
    const buf = readFileSync(canon);
    assert.ok(buf.length > 64, `${entry.file} is not an empty placeholder`);
    assert.ok(buf.subarray(0, 4).equals(MAGIC), `${entry.file} must start with glTF magic`);
    assert.equal(statSync(unity).size, buf.length, `${entry.file} Unity copy drifted`);
    assert.equal(statSync(web).size, buf.length, `${entry.file} web copy drifted`);
  }
  assert.ok(aliases.size > 0);
});

test("Vite KenneyField can load the hub trees from /models/kenney/", () => {
  for (const name of ["tree_oak.glb", "tree_simple.glb", "tree_default.glb", "rock_smallA.glb"]) {
    const p = path.join(VITE, name);
    assert.equal(existsSync(p), true, p);
    const buf = readFileSync(p);
    assert.ok(buf.subarray(0, 4).equals(MAGIC), name);
  }
});

test("KayKit forge and tower are in the kit so the Court is not Kenney-only cubes", () => {
  const m = readManifest();
  const stems = new Set(m.files.map((f) => f.stem));
  assert.ok(stems.has("forge"));
  assert.ok(stems.has("tower"));
});
