/**
 * world-observatory-full-build.test.tsx — pins for the World-Observatory
 * full lens build (F-C row 19): the three-registry declaration, the
 * test-data badge, the real export, the grouped relations, and the
 * manual-refresh receipt.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('world-observatory declaration (S1)', () => {
  it('the manifest declares REAL_LIVE; the badge reads Live with the simulation caption', () => {
    expect(getLensManifest('world-observatory')?.dataTier).toBe('REAL_LIVE');
    const { result } = renderHook(() => useDepthBadge('world-observatory'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('world stores');
    expect(result.current.caption).toContain('seeded with');
  });
  it('the registry entry agrees (REAL_LIVE, substrate-flagged)', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => l.includes('"world-observatory"')) ?? '';
    expect(line).toContain('REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
});

describe('world-observatory build pins', () => {
  const page = read('app/lenses/world-observatory/page.tsx');
  it('test worlds are badged and counted separately (S2)', () => {
    expect(page).toContain('Test data');
    expect(page).toContain('TEST DATA — this world is test/harness data');
    expect(page).toContain('isTestWorld');
  });
  it('the export carries the displayed state (S3)', () => {
    expect(page).toContain('exportObservatory');
    expect(page).toContain('Export JSON');
    expect(page).toContain('Export CSV');
  });
  it('relations are grouped in-world vs cross-world with the scope stated (S4)', () => {
    expect(page).toContain('Within this world');
    expect(page).toContain('Cross-world relations');
    expect(page).toContain('grouped as cross-world');
  });
  it('a manual refresh leaves its own receipt (S4)', () => {
    expect(page).toContain('lastManualRefresh');
    expect(page).toContain('manual refresh');
  });
});
