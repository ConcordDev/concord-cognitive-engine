#!/usr/bin/env npx tsx
/**
 * FE-016: Build-time route validation.
 *
 * Compares filesystem lens routes against the canonical lens registry.
 * Detects:
 *   - Routes on disk that have no registry entry (orphaned pages)
 *   - Registry entries with no corresponding route directory (dead references)
 *
 * Handles:
 *   - Nested lens IDs ("world-creator/anomalies") — checks the nested path.
 *   - Registry entries with paths outside /lenses/ (e.g. /hub, /global) —
 *     verified against app/<segment>/page.tsx.
 *   - Next.js dynamic-route folders ([param], [...catch]) — excluded; they
 *     are routing infrastructure, not lenses.
 *   - Parent dirs that hold registered nested lenses — excluded from orphans.
 *
 * Usage:
 *   npx tsx scripts/validate-routes.ts
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { LENS_REGISTRY } from '../lib/lens-registry';

const APP_DIR = join(__dirname, '..', 'app');
const LENSES_DIR = join(APP_DIR, 'lenses');

function isDynamicSegment(name: string): boolean {
  return name.startsWith('[');
}

function listTopLevelLensDirs(): string[] {
  return readdirSync(LENSES_DIR).filter((entry) => {
    if (isDynamicSegment(entry)) return false;
    return statSync(join(LENSES_DIR, entry)).isDirectory();
  });
}

function pageExists(absDir: string): boolean {
  return ['page.tsx', 'page.ts', 'page.jsx', 'page.js'].some((f) =>
    existsSync(join(absDir, f)),
  );
}

function registryPathToFsPath(p: string): string {
  // Registry paths look like '/lenses/world' or '/hub'. Map to app/<segments>.
  const trimmed = p.replace(/^\//, '');
  return join(APP_DIR, ...trimmed.split('/'));
}

function validate() {
  const fsTopLevel = new Set(listTopLevelLensDirs());
  const nestedLensParents = new Set<string>();
  const registryIds = new Set<string>();
  const dead: string[] = [];

  for (const entry of LENS_REGISTRY) {
    registryIds.add(entry.id);
    if (entry.id.includes('/')) nestedLensParents.add(entry.id.split('/')[0]);
    const fsPath = registryPathToFsPath(entry.path);
    if (!pageExists(fsPath)) dead.push(`${entry.id} (expected page at ${entry.path})`);
  }

  const orphaned: string[] = [];
  for (const dir of fsTopLevel) {
    if (registryIds.has(dir)) continue;
    if (nestedLensParents.has(dir)) continue; // parent of nested registered lenses
    orphaned.push(dir);
  }

  let exitCode = 0;

  if (orphaned.length > 0) {
    console.error('\n  ORPHANED ROUTES (on disk but missing from lens-registry.ts):');
    orphaned.forEach((r) => console.error(`    - app/lenses/${r}/`));
    exitCode = 1;
  }

  if (dead.length > 0) {
    console.error('\n  DEAD REGISTRY ENTRIES (no page on disk):');
    dead.forEach((r) => console.error(`    - ${r}`));
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.log(
      `  Route validation passed: ${fsTopLevel.size} top-level lens dirs, ${registryIds.size} registry entries. All in sync.`,
    );
  }

  process.exit(exitCode);
}

validate();
