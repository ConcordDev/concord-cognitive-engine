#!/usr/bin/env npx tsx
/**
 * Lens Quality Gate Validator — Step 4 of the Core Lenses Roadmap.
 *
 * Hard rules that should fail CI in production:
 *
 *   ERROR (build fails):
 *     1. A product-status lens references MOCK_* constants anywhere, or SEED_* constants outside useLensData({ seed })
 *     2. A product-status lens has no persisted artifact in manifest
 *     3. A product-status lens has no create macro in manifest
 *
 *   WARNING (logged but does not fail):
 *     4. A deprecated lens still has showInSidebar=true
 *     5. Registry/status drift warnings (missing or orphaned status entries)
 *     6. Macro naming convention mismatches
 *     7. Hybrid lens CRUD incompleteness
 *
 * Usage:
 *   npx tsx scripts/validate-lens-quality.ts
 *   npx tsx scripts/validate-lens-quality.ts --strict   # Treat warnings as errors
 *
 * Add to CI pipeline to prevent regression.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

import { LENS_REGISTRY } from '../lib/lens-registry';
import { getLensManifest } from '../lib/lenses/manifest';
import { LENS_STATUS_MAP, type LensStatusEntry } from '../lib/lenses/lens-status';

// ── Configuration ───────────────────────────────────────────────

const LENSES_DIR = join(__dirname, '..', 'app', 'lenses');
const strict = process.argv.includes('--strict');

interface Violation {
  rule: string;
  severity: 'error' | 'warning';
  lensId: string;
  message: string;
}

const violations: Violation[] = [];

// ── Helpers ─────────────────────────────────────────────────────

function readLensPage(lensId: string): string | null {
  const pagePath = join(LENSES_DIR, lensId, 'page.tsx');
  if (!existsSync(pagePath)) return null;
  return readFileSync(pagePath, 'utf-8');
}

function getStatusEntry(lensId: string): LensStatusEntry | undefined {
  return LENS_STATUS_MAP.find(e => e.id === lensId);
}

function getRegistryEntry(lensId: string) {
  return LENS_REGISTRY.find(e => e.id === lensId);
}

function isWithinSeedOption(identifier: ts.Identifier): boolean {
  let current: ts.Node | undefined = identifier;
  while (current) {
    if (ts.isPropertyAssignment(current)) {
      const propertyName = current.name.getText();
      if (propertyName === 'seed' && current.initializer && current.initializer.pos <= identifier.pos && current.initializer.end >= identifier.end) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function findDisallowedMockSeedIdentifiers(sourceText: string): { mockIdentifiers: string[]; seedIdentifiers: string[] } {
  const sourceFile = ts.createSourceFile('page.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mockIdentifiers = new Set<string>();
  const seedIdentifiers = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      const name = node.text;

      if (name.startsWith('MOCK_')) {
        mockIdentifiers.add(name);
      }

      if (name.startsWith('SEED_') && !isWithinSeedOption(node)) {
        seedIdentifiers.add(name);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    mockIdentifiers: Array.from(mockIdentifiers).sort(),
    seedIdentifiers: Array.from(seedIdentifiers).sort(),
  };
}

// ── Rule Checks ─────────────────────────────────────────────────

function checkRule1_NoMockImportsInProducts() {
  const productLenses = LENS_STATUS_MAP.filter(e => e.status === 'product');

  for (const entry of productLenses) {
    const pageSource = readLensPage(entry.id);
    if (!pageSource) continue;

    const { mockIdentifiers, seedIdentifiers } = findDisallowedMockSeedIdentifiers(pageSource);

    if (mockIdentifiers.length > 0) {
      violations.push({
        rule: 'no_mock_imports',
        severity: 'error',
        lensId: entry.id,
        message: `Product lens "${entry.id}" references MOCK_* identifiers outside supported patterns: ${mockIdentifiers.join(', ')}. Replace with useLensData() or useArtifacts().`,
      });
    }

    if (seedIdentifiers.length > 0) {
      violations.push({
        rule: 'no_mock_imports',
        severity: 'error',
        lensId: entry.id,
        message: `Product lens "${entry.id}" references SEED_* identifiers outside useLensData({ seed }): ${seedIdentifiers.join(', ')}.`,
      });
    }
  }
}

function checkRule2_ProductLensHasArtifact() {
  const productLenses = LENS_STATUS_MAP.filter(e => e.status === 'product');

  for (const entry of productLenses) {
    const manifest = getLensManifest(entry.id);
    if (!manifest || manifest.artifacts.length === 0) {
      violations.push({
        rule: 'no_artifact_no_product',
        severity: 'error',
        lensId: entry.id,
        message: `Product lens "${entry.id}" has no artifacts in lens manifest. Add artifacts to LENS_MANIFESTS.`,
      });
    }
  }
}

function checkRule3_ProductLensHasWriteMacro() {
  const productLenses = LENS_STATUS_MAP.filter(e => e.status === 'product');

  for (const entry of productLenses) {
    const manifest = getLensManifest(entry.id);
    if (!manifest) {
      violations.push({
        rule: 'no_write_macro',
        severity: 'error',
        lensId: entry.id,
        message: `Product lens "${entry.id}" has no manifest entry at all. Add to LENS_MANIFESTS.`,
      });
      continue;
    }
    if (!manifest.macros.create) {
      violations.push({
        rule: 'no_write_macro',
        severity: 'error',
        lensId: entry.id,
        message: `Product lens "${entry.id}" has no create macro in manifest. Lens must be writable.`,
      });
    }
  }
}

function checkRule4_DeprecatedNotInSidebar() {
  const deprecatedLenses = LENS_STATUS_MAP.filter(e => e.status === 'deprecated');

  for (const entry of deprecatedLenses) {
    const regEntry = getRegistryEntry(entry.id);
    if (regEntry?.showInSidebar) {
      violations.push({
        rule: 'deprecated_in_sidebar',
        severity: 'warning',
        lensId: entry.id,
        message: `Deprecated lens "${entry.id}" still has showInSidebar=true. Set to false (merges into "${entry.mergeTarget}").`,
      });
    }
  }
}

function checkRule5_StatusMismatch() {
  // Check that every lens in the registry has a status entry
  for (const regEntry of LENS_REGISTRY) {
    const statusEntry = getStatusEntry(regEntry.id);
    if (!statusEntry) {
      violations.push({
        rule: 'missing_status',
        severity: 'warning',
        lensId: regEntry.id,
        message: `Lens "${regEntry.id}" is in registry but has no entry in lens-status.ts. Add a status classification.`,
      });
    }
  }

  // Check that every status entry has a registry entry
  for (const statusEntry of LENS_STATUS_MAP) {
    const regEntry = getRegistryEntry(statusEntry.id);
    if (!regEntry) {
      violations.push({
        rule: 'orphaned_status',
        severity: 'warning',
        lensId: statusEntry.id,
        message: `Lens "${statusEntry.id}" is in lens-status.ts but has no entry in lens-registry.ts.`,
      });
    }
  }
}

function checkRule6_UpgradeLaneLensHasManifest() {
  const upgradeLane = LENS_STATUS_MAP.filter(
    e => e.status === 'product' || e.status === 'hybrid' || e.status === 'viewer'
  );

  for (const entry of upgradeLane) {
    const manifest = getLensManifest(entry.id);
    if (!manifest) {
      violations.push({
        rule: 'upgrade_lane_no_manifest',
        severity: 'error',
        lensId: entry.id,
        message: `${entry.status} lens "${entry.id}" is in the upgrade lane but has no manifest. Add to LENS_MANIFESTS.`,
      });
    }
  }
}

function checkRule7_MacroNamingConvention() {
  const upgradeLane = LENS_STATUS_MAP.filter(
    e => e.status === 'product' || e.status === 'hybrid' || e.status === 'viewer'
  );

  for (const entry of upgradeLane) {
    const manifest = getLensManifest(entry.id);
    if (!manifest) continue;

    const expectedPrefix = `lens.${entry.id}.`;
    for (const [key, value] of Object.entries(manifest.macros)) {
      if (value && !value.startsWith(expectedPrefix)) {
        violations.push({
          rule: 'macro_naming_convention',
          severity: 'warning',
          lensId: entry.id,
          message: `Lens "${entry.id}" macro "${key}" is "${value}" but should start with "${expectedPrefix}".`,
        });
      }
    }
  }
}

function checkRule8_UpgradeLensHasFullCRUD() {
  const upgradeLane = LENS_STATUS_MAP.filter(
    e => e.status === 'product' || e.status === 'hybrid'
  );

  for (const entry of upgradeLane) {
    const manifest = getLensManifest(entry.id);
    if (!manifest) continue;

    const requiredMacros: (keyof typeof manifest.macros)[] = ['list', 'get', 'create', 'update', 'delete', 'run', 'export'];
    const missing = requiredMacros.filter(m => !manifest.macros[m]);

    if (missing.length > 0) {
      violations.push({
        rule: 'incomplete_crud',
        severity: entry.status === 'product' ? 'error' : 'warning',
        lensId: entry.id,
        message: `${entry.status} lens "${entry.id}" is missing macros: ${missing.join(', ')}. Competitor-level requires full CRUD + run + export.`,
      });
    }
  }
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  console.log('\n  Lens Quality Gate Validation');
  console.log('  ════════════════════════════\n');

  checkRule1_NoMockImportsInProducts();
  checkRule2_ProductLensHasArtifact();
  checkRule3_ProductLensHasWriteMacro();
  checkRule4_DeprecatedNotInSidebar();
  checkRule5_StatusMismatch();
  checkRule6_UpgradeLaneLensHasManifest();
  checkRule7_MacroNamingConvention();
  checkRule8_UpgradeLensHasFullCRUD();

  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');

  if (errors.length > 0) {
    console.error('  ERRORS (build-blocking):\n');
    for (const v of errors) {
      console.error(`    [${v.rule}] ${v.lensId}: ${v.message}`);
    }
  }

  if (warnings.length > 0) {
    console.warn('\n  WARNINGS:\n');
    for (const v of warnings) {
      console.warn(`    [${v.rule}] ${v.lensId}: ${v.message}`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('  All checks passed.\n');
  }

  console.log(`\n  Summary: ${errors.length} errors, ${warnings.length} warnings\n`);

  // Exit with error if there are errors, or if --strict and there are warnings
  if (errors.length > 0) {
    process.exit(1);
  }
  if (strict && warnings.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
