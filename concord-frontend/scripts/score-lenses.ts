#!/usr/bin/env npx tsx
/**
 * Lens Capability Scoring Script — Step 5 of the Core Lenses Roadmap.
 *
 * Scores each lens against the 7 Product Lens Gate capabilities:
 *   1. Primary artifact
 *   2. Persistence (uses real API, not MOCK/SEED)
 *   3. Editor/workspace UI
 *   4. Engine (server-side action)
 *   5. Pipeline (multi-step chain)
 *   6. Import/export
 *   7. DTU exhaust
 *
 * Score < 5/7 → lens is flagged as not public-ready.
 *
 * Usage:
 *   npx tsx scripts/score-lenses.ts
 *   npx tsx scripts/score-lenses.ts --json       # Output as JSON
 *   npx tsx scripts/score-lenses.ts --failing     # Only show failing lenses
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { getAllLensIds } from '../lib/lens-registry';
import { getLensManifest } from '../lib/lenses/manifest';
import { getLensStatus } from '../lib/lenses/lens-status';
import { GATE_PASS_THRESHOLD } from '../lib/lenses/product-lens-gate';

// ── Configuration ───────────────────────────────────────────────

const LENSES_DIR = join(__dirname, '..', 'app', 'lenses');
const ROADMAP_PATH = join(__dirname, '..', 'lib', 'lenses', 'productization-roadmap.ts');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const failingOnly = args.includes('--failing');

// ── Capability Checks ───────────────────────────────────────────

interface CapabilityResult {
  primary_artifact: boolean;
  persistence: boolean;
  editor_workspace: boolean;
  engine: boolean;
  pipeline: boolean;
  import_export: boolean;
  dtu_exhaust: boolean;
}

function readLensPageSource(lensId: string): string | null {
  // Standard location: app/lenses/<id>/page.tsx
  const pagePath = join(LENSES_DIR, lensId, 'page.tsx');
  if (existsSync(pagePath)) return readFileSync(pagePath, 'utf-8');
  // Fallback: top-level app/<id>/page.tsx (used by hub, settings-style routes)
  const topLevelPath = join(LENSES_DIR, '..', lensId, 'page.tsx');
  if (existsSync(topLevelPath)) return readFileSync(topLevelPath, 'utf-8');
  return null;
}

function checkCapabilities(lensId: string): CapabilityResult {
  const manifest = getLensManifest(lensId);
  const pageSource = readLensPageSource(lensId);

  // 1. Primary artifact: manifest declares artifacts[]
  const primary_artifact = !!(manifest && manifest.artifacts.length > 0);

  // 2. Persistence: page uses useLensData/useArtifacts, not MOCK_/SEED_
  let persistence = false;
  if (pageSource) {
    const usesHook = /useLensData|useArtifacts|useCreateArtifact/.test(pageSource);
    const usesMock = /MOCK_|SEED_/.test(pageSource);
    persistence = usesHook && !usesMock;
  }

  // 3. Editor/workspace: page has forms, editors, or interactive components
  let editor_workspace = false;
  if (pageSource) {
    const hasEditor = /form|Form|editor|Editor|input|Input|textarea|Textarea|onSubmit|handleCreate|handleSave|ContentEditable|Tiptap|monaco|Slider|Selector|Picker/.test(pageSource);
    const hasInteractive = /onClick=|<button|<Button|Dialog|Modal|Sheet|Popover|Drawer/.test(pageSource);
    editor_workspace = hasEditor || hasInteractive;
  }

  // 4. Engine: manifest declares actions[] with at least one entry
  const engine = !!(manifest && manifest.actions.length > 0);

  // 5. Pipeline: referenced in productization roadmap
  let pipeline = false;
  if (existsSync(ROADMAP_PATH)) {
    const roadmapSource = readFileSync(ROADMAP_PATH, 'utf-8');
    pipeline = roadmapSource.includes(`lensId: '${lensId}'`) && roadmapSource.includes('pipelines:');
  }

  // 6. Import/export: manifest declares exports[]
  const import_export = !!(manifest && manifest.exports.length > 0);

  // 7. DTU exhaust: server-side _lensEmitDTU is called for this domain
  // We check if the manifest has macros (which trigger DTU emission in the server)
  const dtu_exhaust = !!(manifest && manifest.macros.create);

  return {
    primary_artifact,
    persistence,
    editor_workspace,
    engine,
    pipeline,
    import_export,
    dtu_exhaust,
  };
}

// ── Scoring ─────────────────────────────────────────────────────

interface LensScoreResult {
  lensId: string;
  status: string;
  mergeTarget: string | null;
  capabilities: CapabilityResult;
  score: number;
  maxScore: number;
  passes: boolean;
  publicReady: boolean;
}

function scoreLens(lensId: string): LensScoreResult {
  const capabilities = checkCapabilities(lensId);
  const score = Object.values(capabilities).filter(Boolean).length;
  const statusEntry = getLensStatus(lensId);

  return {
    lensId,
    status: statusEntry?.status ?? 'unknown',
    mergeTarget: statusEntry?.mergeTarget ?? null,
    capabilities,
    score,
    maxScore: 7,
    passes: score >= GATE_PASS_THRESHOLD,
    publicReady: score >= GATE_PASS_THRESHOLD,
  };
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  const allLensIds = getAllLensIds();
  const results: LensScoreResult[] = allLensIds.map(id => scoreLens(id));

  if (failingOnly) {
    const failing = results.filter(r => !r.passes);
    if (jsonOutput) {
      console.log(JSON.stringify(failing, null, 2));
    } else {
      printResults(failing);
    }
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  printResults(results);
}

function printResults(results: LensScoreResult[]) {
  // Group by status
  const byStatus: Record<string, LensScoreResult[]> = {};
  for (const r of results) {
    const key = r.status;
    if (!byStatus[key]) byStatus[key] = [];
    byStatus[key].push(r);
  }

  console.log('\n  ═══════════════════════════════════════════════════════');
  console.log('  LENS CAPABILITY SCORES');
  console.log('  ═══════════════════════════════════════════════════════\n');

  const capNames = ['artifact', 'persist', 'editor', 'engine', 'pipeline', 'export', 'dtu'];
  const capKeys: (keyof CapabilityResult)[] = [
    'primary_artifact', 'persistence', 'editor_workspace',
    'engine', 'pipeline', 'import_export', 'dtu_exhaust',
  ];

  // Header
  const header = '  ' + 'Lens'.padEnd(20) + 'Status'.padEnd(12) + capNames.map(n => n.padEnd(9)).join('') + 'Score'.padEnd(8) + 'Gate';
  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  const statusOrder = ['product', 'hybrid', 'viewer', 'system', 'deprecated', 'unknown'];

  for (const status of statusOrder) {
    const group = byStatus[status];
    if (!group || group.length === 0) continue;

    console.log(`\n  [${status.toUpperCase()}]`);

    // Sort by score descending within group
    group.sort((a, b) => b.score - a.score);

    for (const r of group) {
      const caps = capKeys.map(k => (r.capabilities[k] ? ' Y ' : ' - ').padEnd(9)).join('');
      const scoreStr = `${r.score}/${r.maxScore}`.padEnd(8);
      const gate = r.passes ? 'PASS' : 'FAIL';
      const merge = r.mergeTarget ? ` → ${r.mergeTarget}` : '';
      console.log(`  ${r.lensId.padEnd(20)}${r.status.padEnd(12)}${caps}${scoreStr}${gate}${merge}`);
    }
  }

  // Summary
  const passing = results.filter(r => r.passes).length;
  const failing = results.filter(r => !r.passes).length;
  const products = results.filter(r => r.status === 'product').length;
  const deprecated = results.filter(r => r.status === 'deprecated').length;

  console.log('\n  ─────────────────────────────────────────────────────');
  console.log(`  Total:      ${results.length} lenses`);
  console.log(`  Passing:    ${passing} (score >= ${GATE_PASS_THRESHOLD}/7)`);
  console.log(`  Failing:    ${failing} (score < ${GATE_PASS_THRESHOLD}/7)`);
  console.log(`  Product:    ${products}`);
  console.log(`  Deprecated: ${deprecated} (scheduled for merge)`);
  console.log('  ═══════════════════════════════════════════════════════\n');
}

main();
