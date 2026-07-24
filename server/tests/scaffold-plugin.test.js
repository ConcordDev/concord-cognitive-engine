// server/tests/scaffold-plugin.test.js
//
// Acceptance tests for scripts/scaffold-plugin.mjs (the plugin scaffolder).
//
// Every generation test runs the scaffolder against an ISOLATED temp
// directory via --root, so the real repo's server/plugins/installed/ is
// never touched by a test run. --validate is exercised directly against
// generated files inside that same temp directory.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "scaffold-plugin.mjs");
const REAL_INSTALLED_DIR = path.join(REPO_ROOT, "server", "plugins", "installed");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-plugin-test-"));
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

test("scaffolds a plugin end-to-end that passes all 4 validatePlugin gates", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["my-plugin", "--root", root]);
  assert.equal(res.code, 0, `scaffolder should exit 0; stderr:\n${res.stderr}\nstdout:\n${res.stdout}`);

  const pluginFile = path.join(root, "server", "plugins", "installed", "my-plugin", "index.js");
  assert.ok(fs.existsSync(pluginFile), "plugin file should be written");

  // Syntactic validity — a real syntax check, not a string-contains assertion.
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ["--check", pluginFile], { stdio: "pipe" });
  }, "generated plugin file must pass `node --check`");

  // The scaffolder's own self-check output should report all 4 gates passing.
  assert.match(res.stdout, /\[PASS\] Gate: shape/);
  assert.match(res.stdout, /\[PASS\] Gate: namespace/);
  assert.match(res.stdout, /\[PASS\] Gate: patterns/);
  assert.match(res.stdout, /\[PASS\] Gate: dependencies/);
  assert.match(res.stdout, /OVERALL: valid/);

  // Real shape, not a TODO stub.
  const src = fs.readFileSync(pluginFile, "utf8");
  assert.match(src, /export const id = "authored\.my-plugin";/);
  assert.match(src, /export async function init\(ctx\)/);
  assert.match(src, /export function destroy\(\)/);
  assert.match(src, /"my-plugin\.ping": async \(ctx, input = \{\}\) => \{/);
  assert.match(src, /ctx\.log\(/);
  assert.match(src, /ctx\.callMacro\(/);
  assert.match(src, /ctx\.store\.get\(/);
  assert.match(src, /ctx\.store\.set\(/);
  assert.match(src, /export const manifest = \{/);
  assert.match(src, /apiVersion: "1\.0\.0"/);
  assert.doesNotMatch(src, /^\s*import\s/m, "generated plugin file must contain zero import statements (the sandbox linker rejects any import)");
  assert.doesNotMatch(src, /\/\/\s*TODO\b/i, "generated macro must be real, not a TODO placeholder");

  // Never touches the real repo's installed/ directory.
  assert.ok(!fs.existsSync(path.join(REAL_INSTALLED_DIR, "my-plugin")));
});

test("--validate against the generated plugin file reports all 4 gates passing", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const gen = runScaffolder(["weather-tracker", "--root", root]);
  assert.equal(gen.code, 0, `generation should succeed; stderr:\n${gen.stderr}`);

  const pluginFile = path.join(root, "server", "plugins", "installed", "weather-tracker", "index.js");
  const val = runScaffolder(["--validate", pluginFile]);
  assert.equal(val.code, 0, `--validate should exit 0; stdout:\n${val.stdout}\nstderr:\n${val.stderr}`);

  assert.match(val.stdout, /\[PASS\] Gate: shape/);
  assert.match(val.stdout, /\[PASS\] Gate: namespace/);
  assert.match(val.stdout, /\[PASS\] Gate: patterns/);
  assert.match(val.stdout, /\[PASS\] Gate: dependencies/);
  assert.match(val.stdout, /OVERALL: valid/);
});

test("--validate reports FAIL gates against a deliberately broken plugin file", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const brokenDir = path.join(root, "broken-plugin");
  fs.mkdirSync(brokenDir, { recursive: true });
  const brokenFile = path.join(brokenDir, "index.js");
  // Missing init/destroy, bad id format, and a prohibited eval() call —
  // should fail shape + patterns gates.
  fs.writeFileSync(
    brokenFile,
    [
      'export const id = "not-a-valid-id";',
      'export const name = "Broken";',
      'export const version = "1.0.0";',
      "export const macros = {",
      '  "broken.run": (ctx, input) => { eval("1+1"); return { ok: true }; },',
      "};",
    ].join("\n"),
    "utf8",
  );

  const val = runScaffolder(["--validate", brokenFile]);
  assert.equal(val.code, 1, "broken plugin must fail validation with a non-zero exit code");
  assert.match(val.stdout, /\[FAIL\] Gate: shape/);
  assert.match(val.stdout, /\[FAIL\] Gate: patterns/);
  assert.match(val.stdout, /OVERALL: INVALID/);
});

test("refuses to overwrite an existing plugin file without --force", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = runScaffolder(["dupe-plugin", "--root", root]);
  assert.equal(first.code, 0);

  const second = runScaffolder(["dupe-plugin", "--root", root]);
  assert.equal(second.code, 1, "second run without --force must fail");
  assert.match(second.stderr, /refusing to overwrite/);

  // --force is accepted and overwrites cleanly, still passing validation.
  const third = runScaffolder(["dupe-plugin", "--root", root, "--force"]);
  assert.equal(third.code, 0, `--force re-run should succeed; stderr:\n${third.stderr}`);
});

test("--dry-run touches no files at all", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["dry-run-plugin", "--root", root, "--dry-run"]);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /\[dry-run\] would write/);
  assert.ok(!fs.existsSync(path.join(root, "server", "plugins", "installed", "dry-run-plugin")));
});

test("rejects an invalid plugin-name and a reserved --namespace before writing anything", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const badName = runScaffolder(["BadName", "--root", root]);
  assert.equal(badName.code, 1);
  assert.match(badName.stderr, /kebab-case/);

  const reservedNs = runScaffolder(["fine-name", "--root", root, "--namespace", "system"]);
  assert.equal(reservedNs.code, 1);
  assert.match(reservedNs.stderr, /reserved/);

  assert.ok(!fs.existsSync(path.join(root, "server", "plugins", "installed", "bad-name")));
  assert.ok(!fs.existsSync(path.join(root, "server", "plugins", "installed", "fine-name")));
});

test("custom --namespace and display name are honored", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["stock-alerts", "Stock Alerts Pro", "--root", root, "--namespace", "acme"]);
  assert.equal(res.code, 0, `stderr:\n${res.stderr}`);

  const pluginFile = path.join(root, "server", "plugins", "installed", "stock-alerts", "index.js");
  const src = fs.readFileSync(pluginFile, "utf8");
  assert.match(src, /export const id = "acme\.stock-alerts";/);
  assert.match(src, /export const name = "Stock Alerts Pro";/);
});
