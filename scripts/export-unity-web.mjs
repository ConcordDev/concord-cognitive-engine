#!/usr/bin/env node
/**
 * export-unity-web.mjs — Unity 6 WebGL → the same serving shape as Godot.
 *
 *   1. batchmode Concordia.Editor.ConcordiaWebExport.Export
 *   2. copy wasm/data/framework/loader into public/unity-client/ (committed)
 *   3. full-bleed + decompressionFallback on index.html
 *   4. copy index to public/unity-client/export-index.html (committed;
 *      nonce-injected at request time) and leave a copy in
 *      .unity-web-staging/ (gitignored)
 *
 * Honest: missing Unity, failed batchmode, or empty output → {ok:false}
 * and exit 1. Never copies a partial Build/ over a previous good export.
 *
 *   node scripts/export-unity-web.mjs
 *   npm run export:unity-web
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyUnityWebEmbed } from "./lib/unity-web-embed.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT =
  process.env.CONCORD_UNITY_PROJECT ||
  path.join(REPO_ROOT, "apps", "concordia-living-world", "unity-client");
const STAGING =
  process.env.CONCORD_UNITY_STAGING ||
  path.join(REPO_ROOT, "concord-frontend", ".unity-web-staging");
const OUT_DIR =
  process.env.CONCORD_UNITY_OUT ||
  path.join(REPO_ROOT, "concord-frontend", "public", "unity-client");
const COMMITTED_INDEX = path.join(
  REPO_ROOT,
  "concord-frontend",
  "public",
  "unity-client",
  "export-index.html",
);
const UNITY_MAC =
  "/Applications/Unity/Hub/Editor/6000.5.9f1/Unity.app/Contents/MacOS/Unity";

function fail(reason, extra = {}) {
  process.stderr.write(JSON.stringify({ ok: false, reason, ...extra }) + "\n");
  process.exit(1);
}

function log(msg) {
  process.stderr.write(`[export-unity-web] ${msg}\n`);
}

function findUnity() {
  if (process.env.UNITY_EDITOR && fs.existsSync(process.env.UNITY_EDITOR)) {
    return process.env.UNITY_EDITOR;
  }
  if (fs.existsSync(UNITY_MAC)) return UNITY_MAC;
  return null;
}

const unity = findUnity();
if (!unity) {
  fail("unity_editor_not_found", {
    hint: "This Mac's licensed editor is 6000.5.9f1; set UNITY_EDITOR if it moved",
    looked: UNITY_MAC,
  });
}

log(`editor ${unity}`);
log(`project ${PROJECT}`);

if (!fs.existsSync(path.join(PROJECT, "ProjectSettings", "ProjectVersion.txt"))) {
  fail("unity_project_missing", { project: PROJECT });
}

const logFile = path.join(os.tmpdir(), `concord-unity-webgl-${Date.now()}.log`);
log(`batchmode → ${logFile}`);

try {
  execFileSync(
    unity,
    [
      "-batchmode",
      "-nographics",
      "-quit",
      "-projectPath",
      PROJECT,
      "-executeMethod",
      "Concordia.Editor.ConcordiaWebExport.Export",
      "-logFile",
      logFile,
    ],
    { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, CONCORD_UNITY_STAGING: STAGING } },
  );
} catch (e) {
  fail("unity_batchmode_failed", {
    message: String(e?.message || e),
    logFile,
  });
}

const stagedIndex = path.join(STAGING, "index.html");
if (!fs.existsSync(stagedIndex)) {
  fail("unity_web_index_missing", {
    hint: "ConcordiaWebExport.Export should write .unity-web-staging/index.html",
    stagedIndex,
    logFile,
  });
}

// Unity names wasm/loader after the output folder (the default staging is a
// dotfolder, so files would be `.unity-web-staging.wasm.unityweb`, which
// Next/nginx hide). Rename them to the stable `concordia.*` names the site
// serves, whatever CONCORD_UNITY_STAGING is called.
undotBuildNames(STAGING);
fs.writeFileSync(stagedIndex, applyUnityWebEmbed(fs.readFileSync(stagedIndex, "utf8")));

fs.mkdirSync(OUT_DIR, { recursive: true });
const buildDir = path.join(STAGING, "Build");
if (!fs.existsSync(buildDir)) {
  fail("unity_web_build_dir_missing", { buildDir, logFile });
}

for (const f of fs.readdirSync(STAGING)) {
  if (f === "index.html") continue;
  if (f.endsWith("_DoNotShip") || f.endsWith("_BackUpThisFolder_ButDontShipItWithYourGame")) continue;
  copyTree(path.join(STAGING, f), path.join(OUT_DIR, f));
}

// The export ships ~3 GB of HubKit. On APFS (the Mac) `cp -c` clones blocks
// instead of duplicating them, so the second copy costs no disk; elsewhere,
// or if cloning fails, fall back to a plain recursive copy.
function copyTree(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (process.platform === "darwin") {
    try {
      execFileSync("cp", ["-cR", src, dest], { stdio: "ignore" });
      return;
    } catch { /* not APFS or cp failed: plain copy below */ }
  }
  fs.cpSync(src, dest, { recursive: true });
}

fs.mkdirSync(path.dirname(COMMITTED_INDEX), { recursive: true });
fs.copyFileSync(stagedIndex, COMMITTED_INDEX);

log(JSON.stringify({
  ok: true,
  servedAt: "/unity-client/index.html",
  staticDir: OUT_DIR,
  stagedIndex,
  committedIndex: COMMITTED_INDEX,
}));

function undotBuildNames(stagingDir) {
  const stem = `${path.basename(stagingDir)}.`;
  if (stem === "concordia.") return;
  const dir = path.join(stagingDir, "Build");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(stem)) continue;
    const dest = `concordia.${f.slice(stem.length)}`;
    fs.renameSync(path.join(dir, f), path.join(dir, dest));
  }
  const index = path.join(stagingDir, "index.html");
  if (!fs.existsSync(index)) return;
  const html = fs.readFileSync(index, "utf8").replaceAll(stem, "concordia.");
  fs.writeFileSync(index, html);
}
