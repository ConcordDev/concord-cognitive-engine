#!/usr/bin/env node
/**
 * export-godot-web.mjs — produce the browser-servable Godot Web export and
 * drop it where the frontend already serves large static binaries from.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/GODOT_RUNTIME.md` §3.6 proved the Web export builds and boots (a
 * manual, one-time `--export-release "Web" /tmp/web/index.html` run) — but
 * nothing in the repo actually reproduces that artefact into a servable
 * location. `concord-frontend/public/` already ships large committed
 * binaries (157MB of meshes, 18MB of models) with zero extra server config,
 * and both `nginx/conf.d/default.conf` and
 * `infra/cloudflare/cloudflared.yml.example` already fall through any
 * unmatched path straight to the frontend — so `public/godot-client/` is
 * servable the instant a build lands there, with no new infra changes.
 *
 * This script is the missing "make the build land there" step, chaining the
 * exact sequence docs/GODOT_RUNTIME.md already validated by hand:
 *   1. engine present + checksum-verified   (scripts/fetch-godot.mjs)
 *   2. Web export templates present         (scripts/fetch-godot.mjs --export-templates --templates-subset web)
 *   3. a SEPARATE import pass               (godotengine/godot#77508 — importing
 *      and exporting in the same invocation leaves `.godot/imported/`
 *      half-written; see launch-godot-client.sh's identical comment)
 *   4. `--export-release "Web"` into concord-frontend/public/godot-client/
 *
 * HONESTY CONTRACT
 * ----------------
 * Every step's exit code is checked; a failure at any step aborts with a
 * machine-readable `{ok:false, ...}` line and non-zero exit, never a silent
 * partial build. Nothing here fabricates success.
 *
 * USAGE
 *   node scripts/export-godot-web.mjs
 *   npm run export:web          (from the repo root — see package.json)
 *
 * OUT OF SCOPE (deliberately): a lens page that <iframe>-embeds the exported
 * bundle. No iframe-embed convention exists anywhere in this repo today;
 * that is new UI ground and a separate feature decision, not a serving fix.
 * This script's job ends at "the bundle exists at a URL the frontend already
 * serves" — index.html is directly reachable at /godot-client/index.html.
 */

// execFileSync ONLY, argv form, never a shell string — same rule as
// fetch-godot.mjs (a network- or project-derived path/pattern reaching a
// shell string would let command substitution execute).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GODOT_PROJECT_DIR = path.join(REPO_ROOT, "world-lens-godot");
const GODOT_BIN = path.join(REPO_ROOT, ".godot-runtime", "bin", "godot");
const OUT_DIR = path.join(REPO_ROOT, "concord-frontend", "public", "godot-client");
const OUT_FILE = path.join(OUT_DIR, "index.html");

function log(msg) {
  process.stderr.write(`[export-godot-web] ${msg}\n`);
}

function fail(reason, extra = {}) {
  console.log(JSON.stringify({ ok: false, reason, ...extra }));
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function main() {
  // 1. Engine — checksum-verified, reused if already present/valid.
  log("ensuring the pinned Godot engine binary is present…");
  try {
    run("node", [path.join(REPO_ROOT, "scripts", "fetch-godot.mjs")]);
  } catch (e) {
    fail("engine_fetch_failed", { detail: e.message });
  }
  if (!fs.existsSync(GODOT_BIN)) {
    fail("engine_binary_missing_after_fetch", { expected: GODOT_BIN });
  }

  // 2. Web export templates — separate, much larger opt-in fetch; only the
  // "web" subset is needed here (see fetch-godot.mjs's --templates-subset).
  log("ensuring Web export templates are present (subset=web)…");
  try {
    run("node", [
      path.join(REPO_ROOT, "scripts", "fetch-godot.mjs"),
      "--export-templates",
      "--templates-subset", "web",
    ]);
  } catch (e) {
    fail("export_templates_fetch_failed", { detail: e.message });
  }

  // 3. Import — ALWAYS a separate pass from export (godotengine/godot#77508:
  // combining them leaves .godot/imported/ half-written on the very first run).
  log("running project import (idempotent; fast if already up to date)…");
  try {
    run(GODOT_BIN, ["--headless", "--path", GODOT_PROJECT_DIR, "--import"]);
  } catch (e) {
    fail("import_failed", { detail: e.message });
  }

  // 4. Export.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log(`exporting "Web" preset -> ${OUT_FILE}`);
  try {
    run(GODOT_BIN, [
      "--headless", "--path", GODOT_PROJECT_DIR,
      "--export-release", "Web", OUT_FILE,
    ]);
  } catch (e) {
    fail("export_failed", { detail: e.message });
  }

  const expectedFiles = ["index.html", "index.js", "index.pck", "index.wasm"];
  const missing = expectedFiles.filter((f) => !fs.existsSync(path.join(OUT_DIR, f)));
  if (missing.length) {
    fail("export_artefact_incomplete", { outDir: OUT_DIR, missing });
  }

  const sizes = Object.fromEntries(
    expectedFiles.map((f) => [f, fs.statSync(path.join(OUT_DIR, f)).size])
  );

  console.log(JSON.stringify({
    ok: true,
    action: "exported",
    outDir: OUT_DIR,
    servedAt: "/godot-client/index.html",
    files: sizes,
    note: "index.html is now servable by whatever already serves concord-frontend/public/ "
      + "(Next.js static file serving; both nginx/conf.d/default.conf and "
      + "infra/cloudflare/cloudflared.yml.example fall through unmatched paths to the "
      + "frontend already — no new infra rule was needed). No in-app lens page embeds "
      + "it yet (out of scope for this script — see the file header).",
  }, null, 2));
}

main();
