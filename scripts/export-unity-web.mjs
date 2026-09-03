#!/usr/bin/env node
/**
 * export-unity-web.mjs — Unity 6 WebGL → the same serving shape as Godot.
 *
 *   1. batchmode Concordia.Editor.ConcordiaWebExport.Export
 *   2. copy wasm/data/framework/loader into public/unity-client/
 *   3. leave index.html in .unity-web-staging/ for the nonce route
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = path.join(REPO_ROOT, "apps", "concordia-living-world", "unity-client");
const STAGING = path.join(REPO_ROOT, "concord-frontend", ".unity-web-staging");
const OUT_DIR = path.join(REPO_ROOT, "concord-frontend", "public", "unity-client");
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
    hint: "Install Unity 6000.5.9f1 or set UNITY_EDITOR to the editor binary",
    looked: UNITY_MAC,
  });
}

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
    { stdio: ["ignore", "inherit", "inherit"] },
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

fs.mkdirSync(OUT_DIR, { recursive: true });
const buildDir = path.join(STAGING, "Build");
if (!fs.existsSync(buildDir)) {
  fail("unity_web_build_dir_missing", { buildDir, logFile });
}

for (const f of fs.readdirSync(STAGING)) {
  if (f === "index.html") continue;
  fs.cpSync(path.join(STAGING, f), path.join(OUT_DIR, f), { recursive: true });
}

log(JSON.stringify({
  ok: true,
  servedAt: "/unity-client/index.html",
  staticDir: OUT_DIR,
  stagedIndex,
}));
