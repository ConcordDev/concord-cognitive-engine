#!/usr/bin/env node
/**
 * fetch-godot.mjs — acquire a verified Godot engine binary for `world-lens-godot/`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `world-lens-godot/` used to be validated by `gdtoolkit` parse/lint only, because
 * nothing here had ever run in a real engine. gdlint cannot see cross-file call
 * signatures, scene/resource resolution, or runtime type errors — the first real
 * engine run found all three. This script makes the engine a reproducible part of
 * the repo so `docs/GODOT_RUNTIME.md`'s validation commands are runnable by anyone.
 *
 * HONESTY CONTRACT
 * ----------------
 *   - Every acquisition path is checksum-verified. An unverifiable download is a
 *     FAILURE, never a silent pass.
 *   - On failure this prints a machine-readable `{ok:false, reason, ...}` line with
 *     the real HTTP status / blocked host and exits non-zero. It never pretends.
 *   - It never disables TLS verification and never unsets HTTPS_PROXY.
 *
 * USAGE
 *   node scripts/fetch-godot.mjs                 # fetch + verify into .godot-runtime/bin
 *   node scripts/fetch-godot.mjs --check         # verify an existing binary, fetch nothing
 *   node scripts/fetch-godot.mjs --source oci    # force a specific source
 *   node scripts/fetch-godot.mjs --dest <dir>
 *
 *   node scripts/fetch-godot.mjs --export-templates
 *       Opt-in, SEPARATE, much larger fetch (1.12 GiB download) of the matching
 *       export templates, needed only to run `--export-release`. Not part of the
 *       default fetch: the engine alone validates import/parse/run/tests, and
 *       templates cost ~10x the disk. See --templates-subset if disk is tight.
 *   node scripts/fetch-godot.mjs --export-templates --check
 *   node scripts/fetch-godot.mjs --export-templates --templates-subset linux,web
 *   node scripts/fetch-godot.mjs --export-templates --templates-dest <dir>
 *
 * Network is done via `curl` on purpose: Node's core https client does NOT honour
 * HTTPS_PROXY, and sandboxed/self-host environments frequently require it. curl also
 * picks up the system CA store without extra configuration.
 */

// execFileSync ONLY — never execSync. Every external command here takes a
// network-derived or caller-derived path/pattern, and a shell string would let
// `$(...)`/backticks in one of them execute. Quoting is NOT a fix: JSON.stringify
// emits double quotes, and a shell still performs command substitution inside
// double quotes. Argv form is the fix, because no shell is involved at all.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The version is derived from world-lens-godot/project.godot's
 * `config/features` rather than hardcoded, so the engine can never silently
 * drift away from the project it is meant to validate.
 */
const PROJECT_GODOT = path.join(REPO_ROOT, "world-lens-godot", "project.godot");

/**
 * Known-good checksums for the EXTRACTED linux x86_64 engine binary.
 *
 * `4.4-stable` was measured from the binary this repo validated with, and it was
 * corroborated two independent ways (see docs/GODOT_RUNTIME.md § Provenance):
 *   1. the official release zip's SHA512 matched Godot's own published
 *      SHA512-SUMS.txt for 4.4-stable, and
 *   2. the binary extracted from the OCI fallback is byte-identical to the one
 *      extracted from that officially-verified zip.
 */
const PINNED = {
  "4.4-stable": {
    sha256: "de53241695d40c42031a6ae5030f91150592668f257ff8bcf51fa51637f3d72a",
    bytes: 126615056,
    versionString: "4.4.stable.official.4c311cbee",
  },
};

// --------------------------------------------------------------------------
// tiny arg parsing
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { dest: path.join(REPO_ROOT, ".godot-runtime", "bin"), source: "auto", check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--dest") out.dest = path.resolve(argv[++i]);
    else if (a === "--source") out.source = argv[++i];
    else if (a === "--version") out.version = argv[++i];
    else if (a === "--export-templates") out.exportTemplates = true;
    else if (a === "--templates-dest") out.templatesDest = path.resolve(argv[++i]);
    else if (a === "--templates-subset") out.templatesSubset = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function fail(reason, extra = {}) {
  console.log(JSON.stringify({ ok: false, reason, ...extra }));
  process.exit(1);
}

function log(msg) {
  process.stderr.write(`[fetch-godot] ${msg}\n`);
}

// --------------------------------------------------------------------------
// version discovery
// --------------------------------------------------------------------------
function detectVersion() {
  if (!fs.existsSync(PROJECT_GODOT)) return null;
  const txt = fs.readFileSync(PROJECT_GODOT, "utf8");
  // config/features=PackedStringArray("4.4", "Forward Plus")
  const m = txt.match(/config\/features\s*=\s*PackedStringArray\(([^)]*)\)/);
  if (!m) return null;
  const first = m[1].match(/"(\d+\.\d+(?:\.\d+)?)"/);
  return first ? `${first[1]}-stable` : null;
}

// --------------------------------------------------------------------------
// network helpers (curl — honours HTTPS_PROXY + system CA)
// --------------------------------------------------------------------------
function curlTo(url, outFile, headers = []) {
  const args = ["-sSL", "--max-time", "1800", "-w", "%{http_code}", "-o", outFile];
  for (const h of headers) args.push("-H", h);
  args.push(url);
  try {
    const code = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 1 << 20 }).trim();
    return { code: Number(code) || 0, error: null };
  } catch (e) {
    // curl exit 56 / 35 etc: tunnel refused by the egress proxy, TLS failure, ...
    const stderr = (e.stderr || "").toString().trim();
    return { code: 0, error: stderr || e.message };
  }
}

function curlJson(url, headers = []) {
  const tmp = path.join(os.tmpdir(), `godot-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const res = curlTo(url, tmp, headers);
  if (res.code !== 200) {
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, http: res.code, error: res.error };
  }
  try {
    const body = JSON.parse(fs.readFileSync(tmp, "utf8"));
    return { ok: true, body };
  } catch (e) {
    return { ok: false, http: res.code, error: `unparseable JSON: ${e.message}` };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function sha256File(file) {
  const h = createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function sha512File(file) {
  const h = createHash("sha512");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

// --------------------------------------------------------------------------
// SOURCE A — official godotengine/godot-builds release asset (preferred)
// --------------------------------------------------------------------------
function tryOfficial(version, workDir) {
  const base = `https://github.com/godotengine/godot-builds/releases/download/${version}`;
  const zipName = `Godot_v${version}_linux.x86_64.zip`;
  const zipUrl = `${base}/${zipName}`;
  const sumsUrl = `${base}/SHA512-SUMS.txt`;

  log(`source=official  ${zipUrl}`);

  const sumsFile = path.join(workDir, "SHA512-SUMS.txt");
  const sumsRes = curlTo(sumsUrl, sumsFile);
  let expectedSha512 = null;
  if (sumsRes.code === 200) {
    const line = fs
      .readFileSync(sumsFile, "utf8")
      .split("\n")
      .find((l) => l.trim().endsWith(zipName));
    if (line) expectedSha512 = line.trim().split(/\s+/)[0].toLowerCase();
  }

  const zipFile = path.join(workDir, zipName);
  const zipRes = curlTo(zipUrl, zipFile);
  if (zipRes.code !== 200) {
    return {
      ok: false,
      source: "official",
      http: zipRes.code,
      host: "github.com",
      error: zipRes.error,
      detail: `release asset download failed (SHA512-SUMS.txt http=${sumsRes.code})`,
    };
  }

  // Refuse an unverifiable download rather than trusting it.
  if (!expectedSha512) {
    return {
      ok: false,
      source: "official",
      http: 200,
      error: `downloaded ${zipName} but SHA512-SUMS.txt was unavailable (http=${sumsRes.code}) — refusing to use an unverifiable binary`,
    };
  }
  const actual = sha512File(zipFile);
  if (actual !== expectedSha512) {
    return { ok: false, source: "official", error: `SHA512 mismatch: expected ${expectedSha512}, got ${actual}` };
  }
  log(`official SHA512 verified against the release's own SHA512-SUMS.txt`);

  execFileSync("unzip", ["-o", "-q", zipFile, "-d", workDir]);
  const bin = path.join(workDir, `Godot_v${version}_linux.x86_64`);
  if (!fs.existsSync(bin)) {
    return { ok: false, source: "official", error: `zip did not contain the expected binary ${path.basename(bin)}` };
  }
  return { ok: true, source: "official", binary: bin, verifiedBy: "SHA512-SUMS.txt" };
}

// --------------------------------------------------------------------------
// SOURCE B — OCI registry fallback (barichello/godot-ci)
//
// The image's own Dockerfile downloads the SAME official release zip from
// godot-builds and unpacks it to /usr/local/bin/godot, so the binary is the
// official artifact. Registry blobs are CONTENT-ADDRESSED: the layer digest in
// the manifest is a sha256 of the exact bytes, so this path is cryptographically
// verified end to end even though it is not the vendor's own host.
//
// This exists because some locked-down environments allow a container registry
// but block github.com release assets.
// --------------------------------------------------------------------------
const REGISTRIES = [
  { name: "mirror.gcr.io", host: "https://mirror.gcr.io", tokenUrl: (r) => `https://mirror.gcr.io/v2/token?scope=repository:${r}:pull&service=mirror.gcr.io` },
  { name: "docker.io", host: "https://registry-1.docker.io", tokenUrl: (r) => `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${r}:pull` },
];

function tryOci(version, workDir) {
  const shortVer = version.replace(/-stable$/, ""); // 4.4-stable -> 4.4 (the image tag)
  const repo = "barichello/godot-ci";
  const attempts = [];

  for (const reg of REGISTRIES) {
    log(`source=oci  registry=${reg.name} image=${repo}:${shortVer}`);

    const tok = curlJson(reg.tokenUrl(repo));
    if (!tok.ok) {
      attempts.push({ registry: reg.name, stage: "token", http: tok.http, error: tok.error });
      continue;
    }
    const bearer = `Authorization: Bearer ${tok.body.token || tok.body.access_token}`;
    const accept =
      "Accept: application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json";

    const man = curlJson(`${reg.host}/v2/${repo}/manifests/${shortVer}`, [bearer, accept]);
    if (!man.ok || !man.body.layers) {
      attempts.push({ registry: reg.name, stage: "manifest", http: man.http, error: man.error });
      continue;
    }

    const cfg = curlJson(`${reg.host}/v2/${repo}/blobs/${man.body.config.digest}`, [bearer]);
    if (!cfg.ok) {
      attempts.push({ registry: reg.name, stage: "config", http: cfg.http, error: cfg.error });
      continue;
    }

    // Find the layer built by the step that downloads Godot, instead of
    // hardcoding an index that would rot on the next image rebuild.
    const nonEmpty = (cfg.body.history || []).filter((h) => !h.empty_layer);
    let idx = nonEmpty.findIndex((h) => /godot-builds\/releases\/download/.test(h.created_by || ""));
    if (idx < 0) {
      attempts.push({ registry: reg.name, stage: "layer-locate", error: "no layer's build command references a godot-builds release download" });
      continue;
    }
    const layer = man.body.layers[idx];

    // Sanity-check that this image really is the version we asked for.
    const buildCmd = nonEmpty[idx].created_by || "";
    if (!buildCmd.includes(`GODOT_VERSION=${shortVer}`)) {
      attempts.push({ registry: reg.name, stage: "version-check", error: `image tag ${shortVer} does not declare GODOT_VERSION=${shortVer}` });
      continue;
    }

    const blobFile = path.join(workDir, "godot-layer.tar.gz");
    log(`downloading layer ${layer.digest.slice(0, 19)}… (${(layer.size / 1e6).toFixed(1)} MB)`);
    const blob = curlTo(`${reg.host}/v2/${repo}/blobs/${layer.digest}`, blobFile, [bearer]);
    if (blob.code !== 200) {
      attempts.push({ registry: reg.name, stage: "blob", http: blob.code, error: blob.error, note: "registry blob CDN may be blocked separately from the registry API" });
      continue;
    }

    // Content-addressed verification: the digest IS the checksum.
    const digestActual = `sha256:${sha256File(blobFile)}`;
    if (digestActual !== layer.digest) {
      return { ok: false, source: "oci", error: `layer digest mismatch: manifest ${layer.digest}, downloaded ${digestActual}` };
    }
    log(`layer sha256 matches the manifest digest (content-addressed verification OK)`);

    execFileSync("tar", ["-xzf", blobFile, "-C", workDir, "usr/local/bin/godot"]);
    const bin = path.join(workDir, "usr", "local", "bin", "godot");
    if (!fs.existsSync(bin)) {
      return { ok: false, source: "oci", error: "layer did not contain usr/local/bin/godot" };
    }
    try { fs.unlinkSync(blobFile); } catch {}
    return { ok: true, source: `oci:${reg.name}`, binary: bin, verifiedBy: "OCI layer digest (sha256, content-addressed)" };
  }

  return { ok: false, source: "oci", error: "all registries failed", attempts };
}

// --------------------------------------------------------------------------
// EXPORT TEMPLATES (opt-in, --export-templates)
//
// Templates are what `godot --export-release` links the game against; without
// them export cannot run at all. They are a separate, much larger artefact
// (1.12 GiB download / 1.84 GiB extracted, all platforms) than the 57.7 MiB
// engine, which is why this is opt-in rather than part of the default fetch.
//
// Same honesty contract as the engine path: the .tpz is SHA512-verified against
// the release's own SHA512-SUMS.txt before a single byte is extracted, and an
// unverifiable download is deleted rather than used.
// --------------------------------------------------------------------------

/**
 * Where the engine looks for templates. Godot resolves this from its editor
 * data dir, NOT from the project — so templates are shared across projects.
 *
 * NOTE ON COVERAGE: only the Linux branch has actually been executed in this
 * repo. The darwin/win32 paths are Godot's documented locations, but they are
 * unexercised here; pass --templates-dest explicitly on those platforms if the
 * default turns out to be wrong.
 */
function godotTemplatesRoot() {
  if (process.env.GODOT_TEMPLATE_DIR) return path.resolve(process.env.GODOT_TEMPLATE_DIR);
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Godot", "export_templates");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Godot", "export_templates");
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, "godot", "export_templates");
}

/**
 * `4.4-stable` (the release tag) is NOT the directory name Godot expects —
 * that is `4.4.stable`, and it is authoritative inside the archive's own
 * templates/version.txt. We read it from the archive rather than transforming
 * the tag by hand, so a naming change upstream cannot silently misplace them.
 */
function readTemplateVersionFromArchive(tpz, workDir) {
  execFileSync("unzip", ["-o", "-q", tpz, "templates/version.txt", "-d", workDir]);
  return fs.readFileSync(path.join(workDir, "templates", "version.txt"), "utf8").trim();
}

const SUBSET_PATTERNS = {
  linux: ["templates/linux_*"],
  web: ["templates/web_*"],
  windows: ["templates/windows_*"],
  macos: ["templates/macos.zip"],
  android: ["templates/android_*"],
  ios: ["templates/ios.zip"],
};

function fetchExportTemplates(version, args) {
  const root = args.templatesDest || godotTemplatesRoot();

  // Resolve the on-disk version dir. If templates are already installed we can
  // detect it without downloading 1.12 GiB, by checking the conventional name.
  const conventional = version.replace(/-/g, ".");
  const existingDir = path.join(root, conventional);
  const existingVersionFile = path.join(existingDir, "version.txt");
  if (fs.existsSync(existingVersionFile)) {
    const installed = fs.readFileSync(existingVersionFile, "utf8").trim();
    const present = fs.readdirSync(existingDir).filter((f) => f !== "version.txt");
    console.log(JSON.stringify({
      ok: true, action: "already-present", kind: "export-templates",
      version: installed, dir: existingDir, templateCount: present.length,
    }, null, 2));
    return;
  }
  if (args.check) {
    fail("export_templates_absent", {
      version, expectedDir: existingDir,
      detail: "run `node scripts/fetch-godot.mjs --export-templates` to acquire them",
    });
  }

  const base = `https://github.com/godotengine/godot-builds/releases/download/${version}`;
  const tpzName = `Godot_v${version}_export_templates.tpz`;
  log(`source=official  ${base}/${tpzName}  (1.12 GiB — this is the large one)`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-godot-tpl-"));
  try {
    // 1. expected checksum FIRST — refuse to even keep an unverifiable archive.
    const sumsFile = path.join(workDir, "SHA512-SUMS.txt");
    const sumsRes = curlTo(`${base}/SHA512-SUMS.txt`, sumsFile);
    let expected = null;
    if (sumsRes.code === 200) {
      const line = fs.readFileSync(sumsFile, "utf8").split("\n").find((l) => l.trim().endsWith(` ${tpzName}`));
      if (line) expected = line.trim().split(/\s+/)[0].toLowerCase();
    }
    if (!expected) {
      fail("export_templates_checksum_unavailable", {
        version, http: sumsRes.code, host: "github.com",
        detail: `SHA512-SUMS.txt did not yield a line for ${tpzName} — refusing to download an unverifiable 1.12 GiB archive`,
      });
    }

    // 2. download
    const tpz = path.join(workDir, tpzName);
    const dl = curlTo(`${base}/${tpzName}`, tpz);
    if (dl.code !== 200) {
      fail("export_templates_download_failed", {
        version, http: dl.code, host: "github.com", error: dl.error, url: `${base}/${tpzName}`,
      });
    }

    // 3. verify before extracting anything
    const actual = sha512File(tpz);
    if (actual !== expected) {
      try { fs.unlinkSync(tpz); } catch {}
      fail("export_templates_sha512_mismatch", { version, expected, actual, detail: "archive deleted" });
    }
    log(`tpz SHA512 verified against the release's own SHA512-SUMS.txt`);

    // 4. extract
    const tplVersion = readTemplateVersionFromArchive(tpz, workDir);
    const destDir = path.join(root, tplVersion);
    fs.mkdirSync(destDir, { recursive: true });

    let patterns = ["templates/*"];
    if (args.templatesSubset) {
      const keys = args.templatesSubset.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const unknown = keys.filter((k) => !SUBSET_PATTERNS[k]);
      if (unknown.length) {
        fail("unknown_templates_subset", { unknown, known: Object.keys(SUBSET_PATTERNS) });
      }
      patterns = ["templates/version.txt", ...keys.flatMap((k) => SUBSET_PATTERNS[k])];
    }
    log(`extracting ${args.templatesSubset ? `subset [${args.templatesSubset}]` : "all platforms"} -> ${destDir}`);
    // argv form, no shell: `patterns` are unzip's own glob patterns and MUST reach
    // unzip unexpanded. A shell string would let the caller's --templates-subset
    // value reach a shell, and would also let the shell eat the globs first.
    execFileSync("unzip", ["-o", "-q", tpz, ...patterns, "-d", workDir]);
    const staged = path.join(workDir, "templates");
    for (const f of fs.readdirSync(staged)) {
      fs.renameSync(path.join(staged, f), path.join(destDir, f));
    }

    // 5. the 1.12 GiB archive has served its purpose — do not leave it on disk.
    fs.unlinkSync(tpz);

    const installed = fs.readdirSync(destDir).filter((f) => f !== "version.txt");
    if (!installed.length) {
      fail("export_templates_empty_after_extract", { destDir, detail: "archive extracted but no template files landed" });
    }
    console.log(JSON.stringify({
      ok: true, action: "fetched", kind: "export-templates",
      version: tplVersion, dir: destDir,
      subset: args.templatesSubset || "all",
      templateCount: installed.length,
      bytesOnDisk: installed.reduce((n, f) => n + fs.statSync(path.join(destDir, f)).size, 0),
      verifiedBy: "SHA512-SUMS.txt",
    }, null, 2));
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

// --------------------------------------------------------------------------
// verification of the final binary
// --------------------------------------------------------------------------
function verifyBinary(bin, version) {
  const pin = PINNED[version];
  const stat = fs.statSync(bin);
  const sha = sha256File(bin);

  let versionString = null;
  try {
    versionString = execFileSync(bin, ["--headless", "--version"], { encoding: "utf8", timeout: 120000 }).trim();
  } catch (e) {
    return { ok: false, reason: "binary_does_not_run", error: e.message, sha256: sha };
  }

  const result = { sha256: sha, bytes: stat.size, versionString };

  if (!pin) {
    // Honest: we ran it, but we have no recorded pin to compare against.
    result.pinned = false;
    result.note = `no pinned checksum recorded for ${version}; the binary runs and self-reports "${versionString}", but this run did not compare it to a previously trusted value`;
    return { ok: true, ...result };
  }

  result.pinned = true;
  if (sha !== pin.sha256) {
    return { ok: false, reason: "pinned_sha256_mismatch", expected: pin.sha256, ...result };
  }
  if (!versionString.startsWith(pin.versionString)) {
    return { ok: false, reason: "version_string_mismatch", expected: pin.versionString, ...result };
  }
  return { ok: true, ...result };
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0] + "*/\n");
    return;
  }

  const version = args.version || detectVersion();
  if (!version) {
    fail("cannot_determine_version", {
      detail: `could not read config/features from ${PROJECT_GODOT}; pass --version 4.4-stable explicitly`,
    });
  }
  log(`target version: ${version} (from ${args.version ? "--version" : "project.godot config/features"})`);

  // Export templates are a separate artefact with its own (much larger) cost,
  // so it gets its own subcommand rather than being folded into the engine fetch.
  if (args.exportTemplates) {
    fetchExportTemplates(version, args);
    return;
  }

  const destBin = path.join(args.dest, "godot");

  if (fs.existsSync(destBin)) {
    const v = verifyBinary(destBin, version);
    if (v.ok) {
      log("existing binary verified — nothing to do");
      console.log(JSON.stringify({ ok: true, action: "already-present", path: destBin, version, ...v }));
      return;
    }
    if (args.check) fail(v.reason, { path: destBin, ...v });
    log(`existing binary failed verification (${v.reason}) — refetching`);
  } else if (args.check) {
    fail("binary_absent", { path: destBin, detail: "run `node scripts/fetch-godot.mjs` to acquire it" });
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-godot-"));
  const failures = [];
  try {
    const order = args.source === "auto" ? ["official", "oci"] : [args.source];
    let got = null;
    for (const src of order) {
      const r = src === "official" ? tryOfficial(version, workDir) : tryOci(version, workDir);
      if (r.ok) { got = r; break; }
      log(`source ${src} failed: ${r.error || r.detail}`);
      failures.push(r);
    }

    if (!got) {
      fail("all_sources_failed", {
        version,
        failures,
        hint: "every source is checksum-gated; an unverifiable download is refused on purpose. Check egress policy for github.com / release-asset and container-registry blob hosts.",
      });
    }

    fs.mkdirSync(args.dest, { recursive: true });
    fs.copyFileSync(got.binary, destBin);
    fs.chmodSync(destBin, 0o755);

    const v = verifyBinary(destBin, version);
    if (!v.ok) {
      fs.unlinkSync(destBin);
      fail(v.reason, { version, source: got.source, ...v, detail: "binary removed; refusing to leave an unverified engine on disk" });
    }

    console.log(JSON.stringify({
      ok: true,
      action: "fetched",
      path: destBin,
      version,
      source: got.source,
      verifiedBy: got.verifiedBy,
      ...v,
      softFailures: failures.length ? failures : undefined,
    }, null, 2));
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

main();
