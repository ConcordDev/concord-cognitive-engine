#!/usr/bin/env npx tsx
/**
 * Lens Health Auditor.
 *
 * Static-scans every lens page (and key shared components) for the
 * patterns that gave us shipped-vaporware before:
 *
 *   1. Dead buttons — onClick handlers whose body is only
 *      showToast / alert / console.log / a no-op arrow.
 *   2. Media placeholders — files that import MediaUpload, the
 *      UniversalPlayer Video/AudioPlayer, an icon placeholder where
 *      an artifact should render, or call /api/media/upload without
 *      branching on success.
 *   3. Fetch-to-nowhere — frontend api.post / api.get to a path
 *      that has no matching backend route registration.
 *   4. Feature-strings without wiring — copy like "Buy" / "Purchase"
 *      / "Remix Rights" / "Subscribe" that has no matching mutation
 *      or onClick that actually calls a backend macro.
 *
 * The output is a single Markdown table grouped by lens, with one
 * row per finding. CI runs it advisory-only (exit 0) so it never
 * blocks a deploy, but a PR's diff against the previous run flags
 * regressions.
 *
 * Usage:
 *   npx tsx scripts/audit-lens-health.ts
 *   npx tsx scripts/audit-lens-health.ts --strict   # exit 1 on any finding
 *   npx tsx scripts/audit-lens-health.ts --json     # machine-readable
 */

import { readFileSync, readdirSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..");
const LENSES_DIR = join(ROOT, "app/lenses");
const COMPONENTS_DIR = join(ROOT, "components");
const SERVER_DIR = join(ROOT, "..", "server");

type Severity = "error" | "warn" | "info";
interface Finding {
  lens: string;
  file: string;
  line: number;
  severity: Severity;
  rule: string;
  message: string;
}

const findings: Finding[] = [];

function add(f: Finding) {
  findings.push(f);
}

function lensIdFromPath(p: string): string {
  const rel = relative(LENSES_DIR, p);
  const segs = rel.split(/[\\/]/);
  return segs[0] || "shared";
}

function walk(dir: string, files: string[] = []): string[] {
  // Single-syscall directory read with file-type info attached. Using
  // withFileTypes avoids the stat()→read() TOCTOU race CodeQL flags as
  // js/file-system-race; the kind comes back attached to each Dirent.
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "coverage") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function listBackendRoutes(): Set<string> {
  // Collect every literal path ever registered with app.{get,post,put,delete,patch}(...)
  // or router.{get,post,...}(...) in the server tree. A lens that posts to a path
  // not in this set is a fetch-to-nowhere.
  const routes = new Set<string>();
  const re = /\b(?:app|router|app2)\.(?:get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/g;
  function collect(dir: string) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "data") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else if (entry.isFile() && /\.(jsx?|tsx?)$/.test(entry.name)) {
        let src;
        try { src = readFileSync(full, "utf8"); } catch { continue; }
        let m;
        while ((m = re.exec(src))) routes.add(m[1]);
      }
    }
  }
  collect(SERVER_DIR);
  return routes;
}

function scanFile(path: string, backendRoutes: Set<string>) {
  const src = readFileSync(path, "utf8");
  const lens = lensIdFromPath(path);

  // Rule 1 — dead buttons
  // onClick handlers whose entire body is a toast/alert/log + nothing else.
  // We accept multi-line forms: onClick={() => { showToast(...); }}
  const deadBtn = /onClick=\{?\s*\(\s*[^)]*\)\s*=>\s*(?:\{?\s*)(showToast|toast|alert|console\.(?:log|debug|info|warn))\s*\(([^)]*)\)\s*\}?\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = deadBtn.exec(src))) {
    const lineNo = src.slice(0, m.index).split("\n").length;
    const tail = src.slice(m.index, m.index + 320);
    // Heuristic: only flag if there's nothing else inside the handler body
    // (a real handler typically has more than just one toast/log call).
    const next = src.slice(m.index + m[0].length, m.index + m[0].length + 50);
    if (next.trimStart().startsWith(";")) continue; // looks like a longer body
    if (m[1].startsWith("console.")) {
      add({ lens, file: relative(ROOT, path), line: lineNo, severity: "info", rule: "dead-button-console-log", message: `onClick only logs to console: ${tail.split("\n")[0]}` });
    } else {
      add({ lens, file: relative(ROOT, path), line: lineNo, severity: "warn", rule: "dead-button", message: `onClick fires only ${m[1]} — no backend mutation: ${tail.split("\n")[0]}` });
    }
  }

  // Rule 2 — fetch-to-nowhere
  // Scan literal paths in api.{get,post,put,delete}('/api/...') against backend route set.
  // Allow path-params via colon; we only check the prefix up to the first :param.
  const apiCall = /api\.(?:get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = apiCall.exec(src))) {
    const url = m[1];
    if (!url.startsWith("/api/")) continue;
    // Strip query string + any ${} template segment + trailing slash
    const literal = url.split("?")[0].split("$")[0].replace(/\/$/, "");
    // Match against backend prefixes (a backend prefix is a prefix iff
    // backend has a route whose literal-prefix-up-to-first-colon equals it).
    let matched = false;
    for (const r of backendRoutes) {
      const rPrefix = r.split(":")[0].replace(/\/$/, "");
      if (literal === rPrefix || literal.startsWith(rPrefix + "/") || rPrefix.startsWith(literal + "/")) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      const lineNo = src.slice(0, m.index).split("\n").length;
      add({ lens, file: relative(ROOT, path), line: lineNo, severity: "error", rule: "fetch-to-nowhere", message: `No backend route matches ${url}` });
    }
  }

  // Rule 3 — media placeholder without real element
  // If a file references mediaType: 'audio' / 'video' / 'image' OR uses
  // <UniversalPlayer> AND the file (or UniversalPlayer itself) lacks a
  // real <video>/<audio>/<img> element, flag.
  const usesMediaShape = /mediaType\s*:\s*['"](?:audio|video|image)['"]/.test(src) || /UniversalPlayer/.test(src);
  if (usesMediaShape) {
    const hasReal = /<(?:video|audio|img)\b/.test(src) || /HTMLVideoElement|HTMLAudioElement|new Audio\b/.test(src) || /<Image\b/.test(src);
    if (!hasReal && !path.endsWith("UniversalPlayer.tsx")) {
      add({
        lens,
        file: relative(ROOT, path),
        line: 1,
        severity: "warn",
        rule: "media-placeholder",
        message: "References media but renders no <video>/<audio>/<img>/<Image>",
      });
    }
  }

  // Rule 4 — feature strings without wiring
  // Scan for buy/purchase/subscribe/license labels; for each, look in a
  // window of 6000 chars around the label for any api.post / mutation /
  // marketplace / runMacro reference. If none, flag.
  const featurePhrases = [
    { phrase: "Purchase", rule: "buy-button-no-mutation" },
    { phrase: "Buy now", rule: "buy-button-no-mutation" },
    { phrase: "Subscribe", rule: "subscribe-button-no-mutation" },
    { phrase: "License", rule: "license-button-no-mutation" },
  ];
  for (const fp of featurePhrases) {
    const idx = src.indexOf(fp.phrase);
    if (idx < 0) continue;
    const window = src.slice(Math.max(0, idx - 3000), idx + 3000);
    const wired = /(api\.post|mutationFn|runMacro|marketplace|\/api\/marketplace|\/api\/economy)/.test(window);
    if (!wired) {
      const lineNo = src.slice(0, idx).split("\n").length;
      add({ lens, file: relative(ROOT, path), line: lineNo, severity: "warn", rule: fp.rule, message: `${fp.phrase} copy with no nearby mutation/macro call` });
    }
  }
}

function main() {
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");

  const backendRoutes = listBackendRoutes();
  const lensFiles = walk(LENSES_DIR);
  const sharedFiles = walk(join(COMPONENTS_DIR, "media"))
    .concat(walk(join(COMPONENTS_DIR, "music")))
    .concat(walk(join(COMPONENTS_DIR, "feeds")));
  for (const f of [...lensFiles, ...sharedFiles]) scanFile(f, backendRoutes);

  if (asJson) {
    process.stdout.write(JSON.stringify({ findings, total: findings.length }, null, 2));
    process.exit(strict && findings.some((f) => f.severity === "error") ? 1 : 0);
  }

  // Markdown report grouped by lens
  const byLens = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byLens.get(f.lens) || [];
    arr.push(f);
    byLens.set(f.lens, arr);
  }
  const sorted = [...byLens.entries()].sort((a, b) => b[1].length - a[1].length);

  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const infos = findings.filter((f) => f.severity === "info").length;

  console.log("");
  console.log("# Lens Health Audit");
  console.log("");
  console.log(`Total: ${findings.length} (errors: ${errors}, warnings: ${warns}, info: ${infos})`);
  console.log(`Backend routes scanned: ${backendRoutes.size}`);
  console.log(`Lens + shared files scanned: ${lensFiles.length + sharedFiles.length}`);
  console.log("");

  for (const [lens, arr] of sorted) {
    if (arr.length === 0) continue;
    console.log(`## ${lens} (${arr.length})`);
    console.log("");
    console.log("| sev | rule | file:line | detail |");
    console.log("|-----|------|-----------|--------|");
    for (const f of arr) {
      // Escape backslashes BEFORE pipes so a payload like "\\|" doesn't
      // turn into "\\\|" (the escaped pipe gets re-escaped as a literal).
      // CodeQL js/incomplete-sanitization on multi-character escapes.
      const detail = f.message
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .slice(0, 140);
      console.log(`| ${f.severity} | ${f.rule} | ${f.file}:${f.line} | ${detail} |`);
    }
    console.log("");
  }

  if (strict && errors > 0) {
    console.error(`\nFAIL: ${errors} error-level findings (--strict).`);
    process.exit(1);
  }
  process.exit(0);
}

main();
