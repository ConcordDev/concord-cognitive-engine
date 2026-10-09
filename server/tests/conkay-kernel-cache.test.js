// tests/conkay-kernel-cache.test.js
//
// The CAD kernel cache is trusted on read, so it must be private: created
// 0700, files 0600, and refused when the path is a symlink (or not ours).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePrivateDir, writePrivateFile, bodyCacheDir } from "../lib/conkay/cad/body-kernel.js";

const posix = process.platform !== "win32";

test("ensurePrivateDir creates a 0700 directory owned by this user", { skip: !posix }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conkay-cache-test-"));
  const dir = path.join(root, "a", "b");
  assert.equal(await ensurePrivateDir(dir), true);
  const st = fs.lstatSync(dir);
  assert.equal(st.mode & 0o777, 0o700);
  assert.equal(st.uid, process.getuid());
  await writePrivateFile(path.join(dir, "result.json"), "{}");
  assert.equal(fs.statSync(path.join(dir, "result.json")).mode & 0o777, 0o600);
  fs.rmSync(root, { recursive: true, force: true });
});

test("ensurePrivateDir refuses a symlinked cache path", { skip: !posix }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conkay-cache-test-"));
  fs.mkdirSync(path.join(root, "elsewhere"));
  fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, "link"));
  assert.equal(await ensurePrivateDir(path.join(root, "link")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the default cache is the user's cache directory, not a shared tmpdir path", () => {
  const saved = process.env.CONKAY_CAD_BODY_CACHE;
  delete process.env.CONKAY_CAD_BODY_CACHE;
  try {
    assert.ok(!bodyCacheDir().startsWith(os.tmpdir() + path.sep), bodyCacheDir());
    assert.equal(path.basename(bodyCacheDir()), "conkay-cad-body");
  } finally {
    if (saved !== undefined) process.env.CONKAY_CAD_BODY_CACHE = saved;
  }
});
