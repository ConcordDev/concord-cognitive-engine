/**
 * lattice-full-build.test.tsx — pins for the Lattice full lens build
 * (F-C row 14): the declaration stands REAL_LIVE in both registries,
 * the pickers offer all six brains the server knows, the unit labels
 * name what they count, and the floating CTA opens a picker.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('lattice declaration stands (REAL_LIVE)', () => {
  it('the manifest declares REAL_LIVE and the badge reads Live', () => {
    expect(getLensManifest('lattice')?.dataTier).toBe('REAL_LIVE');
    const { result } = renderHook(() => useDepthBadge('lattice'));
    expect(result.current.label).toBe('Live');
    expect(result.current.tone).toBe('live');
  });
  it('the registry entry agrees (REAL_LIVE, substrate-flagged)', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => /^\s*lattice:/.test(l)) ?? '';
    expect(line).toContain('REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
});

describe('lattice build pins', () => {
  it('both pickers offer all six brains', () => {
    for (const rel of ['components/lattice/RefreshSchedule.tsx', 'components/lattice/TrainingRuns.tsx']) {
      const src = read(rel);
      for (const b of ['conscious', 'subconscious', 'utility', 'repair', 'multimodal', 'lattice']) {
        expect(src).toContain(`'${b}'`);
      }
    }
  });
  it('the consented units are named where they render', () => {
    expect(read('components/lattice/OverviewPanel.tsx')).toContain('Consented (DTU rows)');
    expect(read('components/lattice/BrainsPanel.tsx')).toContain('Consented interactions:');
  });
  it('the schedule gate speaks and refusals surface', () => {
    const src = read('components/lattice/RefreshSchedule.tsx');
    expect(src).toContain('Schedule changes are admin-gated');
    expect(src).toContain('canEdit');
    expect(src).toContain('Schedule change refused');
  });
  it('the grant direction confirms with scope + count; revoke never confirms (F9)', () => {
    const src = read('components/lattice/ConsentPanel.tsx');
    expect(src).toContain('Grant consent for all');
    expect(src).toContain('armGrant');
    expect(src).toContain('Revoke all');
    expect(src).not.toContain('armRevoke');
  });
  it('the floating CTA opens a brain picker, not a bare section switch', () => {
    const src = read('app/lenses/lattice/page.tsx');
    expect(src).toContain('brainPickerOpen');
    expect(src).toContain('lattice.openBrain');
    expect(src).toContain("role=\"menu\"");
  });
});
