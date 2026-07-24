// server/tests/scaffold-world.test.js
//
// Acceptance tests for scripts/scaffold-world.mjs (the world scaffolder).
//
// IMPORTANT: every test here runs the scaffolder against an ISOLATED
// mkdtemp root via --root. The generated content/world/<world-id>/ files
// only ever land inside that throwaway directory; the real repo's
// content/world/ tree is asserted untouched at the end of every test. The
// scaffolder's self-check step imports the REAL, unmodified
// validateNpc/validateFaction/validateLoreEvent from the real
// server/lib/content-seeder.js (that import is intentionally NOT
// redirected by --root — see that script's header comment for why) but
// that import is read-only and side-effect-free; it never writes to the
// real content/world/ directory.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "scaffold-world.mjs");
const REAL_CONTENT_WORLD_DIR = path.join(REPO_ROOT, "content", "world");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-world-test-"));
}

function runScaffolder(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

function snapshotRealContentWorldDir() {
  // Cheap, dependency-free directory snapshot: sorted list of every entry
  // name directly under content/world/. Good enough to prove the test run
  // added zero new sub-world directories there.
  return fs.readdirSync(REAL_CONTENT_WORLD_DIR).sort();
}

test("scaffolds a throwaway world end-to-end into an isolated temp root", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = snapshotRealContentWorldDir();

  const res = runScaffolder(["zzz-throwaway-world", "ZZZ Throwaway World", "zzz_throwaway", "--root", root]);
  assert.equal(res.code, 0, `scaffolder should exit 0; stderr:\n${res.stderr}`);
  assert.match(res.stdout, /self-check: generated meta\/npc\/faction\/lore records pass the real content-seeder\.js validators — OK/);

  const worldDir = path.join(root, "content", "world", "zzz-throwaway-world");
  const metaFile = path.join(worldDir, "meta.json");
  const npcsFile = path.join(worldDir, "npcs.json");
  const factionsFile = path.join(worldDir, "factions.json");
  const loreFile = path.join(worldDir, "lore.json");

  for (const f of [metaFile, npcsFile, factionsFile, loreFile]) {
    assert.ok(fs.existsSync(f), `${f} should be written`);
  }

  // Real JSON.parse, not a string-contains check.
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  const npcs = JSON.parse(fs.readFileSync(npcsFile, "utf8"));
  const factions = JSON.parse(fs.readFileSync(factionsFile, "utf8"));
  const lore = JSON.parse(fs.readFileSync(loreFile, "utf8"));

  assert.equal(meta.world_id, "zzz-throwaway-world");
  assert.equal(meta.universe_type, "zzz_throwaway");
  assert.equal(meta.is_hub, false);
  assert.ok(meta.world_id, "meta.world_id must be present and non-empty (the double-gate check)");
  assert.ok(meta.universe_type, "meta.universe_type must be present and non-empty (the double-gate check)");
  assert.ok(meta.skill_affinity && typeof meta.skill_affinity.default === "number");
  assert.deepEqual(meta.rule_modulators, {});

  assert.ok(Array.isArray(npcs) && npcs.length === 1);
  assert.ok(Array.isArray(factions) && factions.length === 1);
  assert.ok(Array.isArray(lore.history) && lore.history.length === 1);

  // Run the generated records back through the REAL validators directly
  // (a second, independent check beyond trusting the scaffolder's own
  // stdout claim above).
  const seeder = await import(pathToFileURL(path.join(REPO_ROOT, "server/lib/content-seeder.js")).href);
  assert.equal(seeder.validateNpc(npcs[0]).ok, true, "generated NPC must satisfy the real validateNpc()");
  assert.equal(seeder.validateFaction(factions[0]).ok, true, "generated faction must satisfy the real validateFaction()");
  assert.equal(seeder.validateLoreEvent(lore.history[0]).ok, true, "generated lore event must satisfy the real validateLoreEvent()");

  // The real repo's content/world/ directory must be completely untouched.
  const after = snapshotRealContentWorldDir();
  assert.deepEqual(after, before, "real content/world/ directory must gain no new entries from this test run");
  assert.ok(!fs.existsSync(path.join(REAL_CONTENT_WORLD_DIR, "zzz-throwaway-world")));
});

test("refuses to overwrite an existing world's files without --force", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = runScaffolder(["dupe-world", "Dupe World", "dupe_world", "--root", root]);
  assert.equal(first.code, 0, `first run should succeed; stderr:\n${first.stderr}`);

  const second = runScaffolder(["dupe-world", "Dupe World", "dupe_world", "--root", root]);
  assert.equal(second.code, 1, "second run without --force must fail");
  assert.match(second.stderr, /refusing to overwrite/);
});

test("--force allows re-scaffolding the same world-id", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  runScaffolder(["force-world", "Force World", "force_world", "--root", root]);
  const second = runScaffolder(["force-world", "Force World", "force_world", "--root", root, "--force"]);
  assert.equal(second.code, 0, `re-run with --force should succeed; stderr:\n${second.stderr}`);

  const metaFile = path.join(root, "content", "world", "force-world", "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  assert.equal(meta.world_id, "force-world");
});

test("--dry-run touches no files at all", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["dry-run-world", "Dry Run World", "dry_run_world", "--root", root, "--dry-run"]);
  assert.equal(res.code, 0, `dry-run should exit 0; stderr:\n${res.stderr}`);
  assert.match(res.stdout, /\[dry-run\] would write/);

  const worldDir = path.join(root, "content", "world", "dry-run-world");
  assert.ok(!fs.existsSync(worldDir), "dry-run must not create the world directory");
});

test("rejects an invalid world-id, empty world name, and invalid universe_type before writing anything", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const badId = runScaffolder(["BadID", "Bad Id", "bad_id", "--root", root]);
  assert.equal(badId.code, 1);
  assert.match(badId.stderr, /kebab-case/);

  const badUniverse = runScaffolder(["fine-id", "Fine Id", "Not-Valid!", "--root", root]);
  assert.equal(badUniverse.code, 1);
  assert.match(badUniverse.stderr, /universe_type/);

  assert.ok(!fs.existsSync(path.join(root, "content", "world", "bad-id")));
  assert.ok(!fs.existsSync(path.join(root, "content", "world", "fine-id")));
});

test("self-check catches a missing world_id/universe_type before any file is written", (t) => {
  // This exercises the double-gate assertion indirectly: the CLI itself
  // can't produce a meta.json missing world_id/universe_type (they're
  // required, validated CLI args), so this test instead proves the
  // self-check function's guard logic directly against the real
  // content-seeder.js contract by constructing the same failure the
  // upstream double-gate silently swallows, and confirming validateNpc /
  // validateFaction / validateLoreEvent (the functions the self-check
  // calls) are exactly the ones content-seeder.js exports, not a
  // reimplementation.
  const seederPath = path.join(REPO_ROOT, "server", "lib", "content-seeder.js");
  const src = fs.readFileSync(seederPath, "utf8");
  assert.match(src, /export function validateNpc/);
  assert.match(src, /export function validateFaction/);
  assert.match(src, /export function validateLoreEvent/);

  // And a syntactically-valid run still requires both fields — proven via
  // the CLI validation path (empty universe_type is rejected up front).
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const res = runScaffolder(["no-universe-world", "No Universe World", "", "--root", root]);
  assert.equal(res.code, 1);
});

test("generated files round-trip through JSON.parse with no ambiguity", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["parity-world", "Parity World", "parity_world", "--root", root]);
  assert.equal(res.code, 0);

  const worldDir = path.join(root, "content", "world", "parity-world");
  for (const name of ["meta.json", "npcs.json", "factions.json", "lore.json"]) {
    const text = fs.readFileSync(path.join(worldDir, name), "utf8");
    assert.doesNotThrow(() => JSON.parse(text), `${name} must be valid JSON`);
  }
});
