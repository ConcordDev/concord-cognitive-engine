#!/usr/bin/env node
// scripts/count-loc.mjs
//
// The single source of truth for "how big is Concord?" — so we stop quoting
// 1.36M / 2M / 444k from memory. Run it; cite the number it prints.
//
// It walks the repo (excluding the things that aren't authored source — git,
// dependencies, build output, generated artifacts, binaries) and reports lines
// in three honest buckets:
//
//   • source   — code we wrote (.js/.ts/.tsx/.jsx/.mjs/.cjs + .py/.sh/.sql/.css)
//   • content  — authored data that ships (content/**, JSON/YAML/MD docs)
//   • generated/excluded — node_modules, lockfiles, .next/dist/build, data DBs,
//     min.js, maps, SVG/PNG — counted as SKIPPED, never folded into "source".
//
// Why this matters here specifically: the headline LOC number is one of the
// claims people anchor on, and an inflated one (counting node_modules or
// generated bundles) is the same credibility tax as an oversold "✅ wired".
// This makes the number reproducible and breaks it down by area so nobody has
// to take it on faith.
//
// Usage:
//   node scripts/count-loc.mjs            # human table
//   node scripts/count-loc.mjs --json     # machine-readable
//   node scripts/count-loc.mjs --by-area  # add per-top-level-dir breakdown

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");
const BY_AREA = process.argv.includes("--by-area");

// Directories that never contain authored source.
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "out", "coverage",
  ".turbo", ".cache", "__pycache__", ".venv", "venv", "vendor",
  ".gradle", ".idea", "Pods", "DerivedData",
]);

// Data/artifact directories: real files, but not "source we wrote" — counted
// under content/excluded, never under source.
const DATA_DIRS = new Set(["data", "artifacts", "reports", "audit"]);

const SOURCE_EXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
  ".py", ".sh", ".bash", ".sql", ".css", ".scss", ".rs", ".go", ".java", ".kt", ".swift",
]);
const CONTENT_EXT = new Set([".json", ".yml", ".yaml", ".md", ".mdx", ".toml", ".graphql", ".proto"]);

// Files that are generated/derived even with a source-y extension.
const GENERATED_RE = /(?:\.min\.(?:js|css)|\.bundle\.js|\.d\.ts|-lock\.json|\.map|\.lock)$/;
const GENERATED_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

// A source-extension file this large that is overwhelmingly data literals is a
// data module, not code (e.g. server/dtus.js — a deprecated 145k-line
// `export const DTUS = [ …4,963 objects… ]` seed pack). Counting it as "source"
// inflates the headline by ~146k lines. Above this many lines we sample the
// data-ratio and, if it's mostly literals, count it as content instead.
const DATA_MODULE_MIN_LINES = 1500;
// Lines that contain an actual code construct. A data module (a big
// `export const X = [ …literals… ]`) has almost none of these even when its
// string values are long prose; real code is dense with them. We measure CODE
// density (not data density) so prose-heavy data like server/dtus.js — a
// deprecated 145k-line DTU seed pack — is still caught.
const CODE_RE = /=>|\bfunction\b|\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\breturn\b|\bimport\s|\bexport\s+(?!const\s+\w+\s*=\s*[[{])|\bclass\s|\brequire\s*\(|\bawait\b|\bconst\s+\w+\s*=\s*[^[{]|\blet\s|\bswitch\s*\(|\bthrow\b|\)\s*\{/;
const DATA_MODULE_MAX_CODE_DENSITY = 0.03; // <3% code-construct lines ⇒ data module

function analyzeFile(file) {
  const buf = readFileSync(file);
  if (buf.length === 0) return { lines: 0, codeDensity: 1 };
  let lines = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++;
  if (buf[buf.length - 1] !== 10) lines++;

  let codeDensity = 1; // assume code unless proven otherwise
  if (lines >= DATA_MODULE_MIN_LINES) {
    const text = buf.toString("utf8");
    let codeLines = 0, nonBlank = 0;
    for (const ln of text.split("\n")) {
      if (!ln.trim()) continue;
      nonBlank++;
      if (CODE_RE.test(ln)) codeLines++;
    }
    codeDensity = nonBlank ? codeLines / nonBlank : 1;
  }
  return { lines, codeDensity };
}

const totals = {
  source: { files: 0, lines: 0, byExt: {} },
  content: { files: 0, lines: 0, byExt: {} },
  skipped: { files: 0 },
};
const reclassified = []; // source-extension files reclassified as data modules
const byArea = {}; // topDir -> { sourceFiles, sourceLines, contentLines }

function areaOf(rel) {
  const top = rel.split(path.sep)[0];
  return top || "(root)";
}

function classify(file, rel) {
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  if (GENERATED_NAMES.has(base) || GENERATED_RE.test(base)) return "skipped";
  // Anything inside a data/artifact dir is content at best, never source.
  const inData = rel.split(path.sep).some((seg) => DATA_DIRS.has(seg));
  if (SOURCE_EXT.has(ext) && !inData) return "source";
  if (CONTENT_EXT.has(ext) || (inData && (SOURCE_EXT.has(ext) || CONTENT_EXT.has(ext)))) return "content";
  return "skipped";
}

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".github") {
      // hidden files/dirs (except .github) are config/noise for LOC purposes
      if (e.isDirectory()) continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full);
    } else if (e.isFile()) {
      const rel = path.relative(REPO_ROOT, full);
      let kind = classify(full, rel);
      if (kind === "skipped") { totals.skipped.files++; continue; }
      let lines = 0, codeDensity = 1;
      try { ({ lines, codeDensity } = analyzeFile(full)); } catch { totals.skipped.files++; continue; }
      // Reclassify a large, literal-dominated source file as a data module.
      if (kind === "source" && lines >= DATA_MODULE_MIN_LINES && codeDensity < DATA_MODULE_MAX_CODE_DENSITY) {
        reclassified.push({ file: rel, lines, codeDensity: Math.round(codeDensity * 1000) / 1000 });
        kind = "content";
      }
      const ext = path.extname(full).toLowerCase() || "(none)";
      totals[kind].files++;
      totals[kind].lines += lines;
      totals[kind].byExt[ext] = (totals[kind].byExt[ext] || 0) + lines;
      if (BY_AREA) {
        const a = areaOf(rel);
        byArea[a] = byArea[a] || { sourceFiles: 0, sourceLines: 0, contentLines: 0 };
        if (kind === "source") { byArea[a].sourceFiles++; byArea[a].sourceLines += lines; }
        else byArea[a].contentLines += lines;
      }
    }
  }
}

walk(REPO_ROOT);

const fmt = (n) => n.toLocaleString("en-US");
const result = {
  generatedAt: new Date().toISOString(),
  source: { files: totals.source.files, lines: totals.source.lines },
  content: { files: totals.content.files, lines: totals.content.lines },
  skippedFiles: totals.skipped.files,
  total_source_plus_content: totals.source.lines + totals.content.lines,
  topSourceExtensions: Object.entries(totals.source.byExt).sort((a, b) => b[1] - a[1]).slice(0, 10),
  reclassifiedDataModules: reclassified.sort((a, b) => b.lines - a.lines),
  ...(BY_AREA ? { byArea } : {}),
};

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} else {
  console.log("Concord LOC — authored source vs shipped content (node_modules/build/generated excluded)\n");
  console.log(`  SOURCE   ${fmt(totals.source.lines).padStart(10)} lines  ·  ${fmt(totals.source.files)} files`);
  console.log(`  CONTENT  ${fmt(totals.content.lines).padStart(10)} lines  ·  ${fmt(totals.content.files)} files  (authored JSON/YAML/MD/docs + data)`);
  console.log(`  ─────────────────────────`);
  console.log(`  TOTAL    ${fmt(result.total_source_plus_content).padStart(10)} lines  (source + content)`);
  console.log(`  (skipped ${fmt(totals.skipped.files)} generated/binary/lock files)\n`);
  console.log("  Top source languages:");
  for (const [ext, lines] of result.topSourceExtensions) {
    console.log(`    ${ext.padEnd(7)} ${fmt(lines).padStart(10)}`);
  }
  if (reclassified.length) {
    const recLines = reclassified.reduce((s, r) => s + r.lines, 0);
    console.log(`\n  Reclassified ${reclassified.length} data-module(s) out of source (counted as content, not code):`);
    for (const r of result.reclassifiedDataModules.slice(0, 8)) {
      console.log(`    ${r.file.padEnd(40)} ${fmt(r.lines).padStart(9)} lines  (${Math.round(r.codeDensity * 100)}% code)`);
    }
    console.log(`    → ${fmt(recLines)} lines kept OUT of the source total (honest count).`);
  }
  if (BY_AREA) {
    console.log("\n  By area (top-level dir):");
    const rows = Object.entries(byArea).sort((a, b) => b[1].sourceLines - a[1].sourceLines);
    for (const [area, v] of rows) {
      if (v.sourceLines + v.contentLines === 0) continue;
      console.log(`    ${area.padEnd(20)} src ${fmt(v.sourceLines).padStart(9)}  ·  content ${fmt(v.contentLines).padStart(9)}`);
    }
  }
}
