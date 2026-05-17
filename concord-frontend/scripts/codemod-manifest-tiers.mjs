#!/usr/bin/env node
// concord-frontend/scripts/codemod-manifest-tiers.mjs
//
// Phase 2 of the 10-dimension UX completeness sprint.
//
// Backfills `dataTier: '...'` into every LENS_MANIFESTS entry in
// concord-frontend/lib/lenses/manifest.ts, reading the tier from
// server/lib/integration-registry.js. Idempotent: skips entries that
// already declare dataTier.
//
// Usage:
//   node scripts/codemod-manifest-tiers.mjs --dry    # preview
//   node scripts/codemod-manifest-tiers.mjs           # apply
//
// Writes a ledger to audit/codemod-reports/manifest-tiers-${ts}.json.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const MANIFEST_PATH = resolve(REPO_ROOT, "concord-frontend/lib/lenses/manifest.ts");
const REGISTRY_PATH = resolve(REPO_ROOT, "server/lib/integration-registry.js");
const REPORT_DIR = resolve(REPO_ROOT, "audit/codemod-reports");

const DRY = process.argv.includes("--dry");

async function loadRegistry() {
  const url = pathToFileURL(REGISTRY_PATH).href;
  const mod = await import(url);
  return mod.REGISTRY;
}

function isoTs() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Find every `{ domain: 'foo', ...,  category: 'X' }` block in the manifest
 * and inject `dataTier: '...'` BEFORE the closing brace IF:
 *   - the entry has a category (i.e. it's a real manifest entry, not a comment)
 *   - the entry doesn't already have a dataTier field
 *
 * The pattern is line-anchored so we don't accidentally rewrite the
 * `dataTier?:` declaration in the interface.
 */
function injectTiers(source, registry) {
  const lines = source.split("\n");
  const out = [];
  const ledger = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);

    // Look for a manifest entry opening: a line that introduces a literal
    // `{` followed within ~30 lines by `domain: '...'` and `category: '...'`.
    if (/^\s*\{\s*$/.test(line)) {
      // Peek ahead to find the closing brace + domain.
      let braceDepth = 1;
      let j = i + 1;
      let domain = null;
      let hasDataTier = false;
      let categoryLine = -1;
      while (j < lines.length && braceDepth > 0) {
        const l = lines[j];
        for (const ch of l) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        const dm = l.match(/^\s*domain:\s*['"]([^'"]+)['"]/);
        if (dm) domain = dm[1];
        if (/^\s*dataTier:\s*['"]/.test(l)) hasDataTier = true;
        if (/^\s*category:\s*['"]/.test(l)) categoryLine = j;
        if (braceDepth === 0) break;
        j++;
      }
      // j is the line with the closing brace.
      if (domain && categoryLine !== -1 && !hasDataTier) {
        const tier = registry[domain]?.tier
          || registry[domain.replace(/-/g, "_")]?.tier
          || registry[domain.replace(/_/g, "-")]?.tier;
        if (tier) {
          // Copy lines (i+1 .. j) but insert dataTier AFTER categoryLine.
          for (let k = i + 1; k <= j; k++) {
            out.push(lines[k]);
            if (k === categoryLine) {
              // Match the leading whitespace of the category line.
              const indent = (lines[k].match(/^(\s*)/) || [, ""])[1];
              out.push(`${indent}dataTier: '${tier}',`);
              ledger.push({ domain, tier, line: k + 1 });
            }
          }
          i = j + 1;
          continue;
        } else {
          ledger.push({ domain, tier: null, reason: "no_registry_entry" });
        }
      }
    }
    i++;
  }
  return { source: out.join("\n"), ledger };
}

async function main() {
  const [registry, manifestSrc] = await Promise.all([
    loadRegistry(),
    readFile(MANIFEST_PATH, "utf8"),
  ]);

  const { source: nextSrc, ledger } = injectTiers(manifestSrc, registry);

  const injected = ledger.filter(l => l.tier).length;
  const skipped = ledger.filter(l => !l.tier).length;

  if (DRY) {
    console.log(`[dry-run] would inject dataTier into ${injected} manifest entries (${skipped} skipped — no registry match)`);
    for (const row of ledger) {
      const status = row.tier ? `tier=${row.tier}` : `SKIP (${row.reason})`;
      console.log(`  ${row.domain.padEnd(40)} ${status}`);
    }
    return;
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = resolve(REPORT_DIR, `manifest-tiers-${isoTs()}.json`);
  await writeFile(reportPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    injected, skipped, ledger,
  }, null, 2));

  if (nextSrc === manifestSrc) {
    console.log(`[done] manifest already complete — no changes (ledger: ${reportPath})`);
    return;
  }

  await writeFile(MANIFEST_PATH, nextSrc);
  console.log(`[done] injected dataTier into ${injected} manifest entries (${skipped} skipped)`);
  console.log(`[done] ledger: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
