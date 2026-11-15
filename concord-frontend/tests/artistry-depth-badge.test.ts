// Pins the Artistry header chip after FIX-artistry-003.
// The declaration stood at SIM_GRADE_A ("Simulated") in the manifest and
// the server registry, over a substrate that was already the user's real
// workspace: server/domains/artistry.js serves per-user project /
// collection / image / DM actions persisted in STATE.artistryLens (+
// artistry_studies rows across restarts), and the lens's panels call
// them (projectList, collectionList, personalizedFeed, notifications).
// The manifest and the registry now declare REAL_WORKSPACE and the chip
// reads "Workspace". A still-simulated sibling (animation) is the
// control.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('artistry');

describe('Artistry manifest honesty (FIX-artistry-003)', () => {
  it('is on the workspace tier with a "Workspace" chip, not Simulated', () => {
    expect(m?.dataTier).toBe('REAL_WORKSPACE');
    const badge = renderHook(() => useDepthBadge('artistry')).result.current;
    expect(badge?.tier).toBe('REAL_WORKSPACE');
    expect(badge?.label).toBe('Workspace');
    expect(badge?.caption).toMatch(/Your own live records, saved in your workspace/);
  });

  it('the server integration registry agrees (REAL_WORKSPACE, liveFromSubstrate)', () => {
    const src = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    expect(src).toMatch(/artistry:\s*\{\s*tier: TIER\.REAL_WORKSPACE, liveFromSubstrate: true/);
  });

  it('control: a still-simulated sibling keeps its declaration (animation)', () => {
    const a = getLensManifest('animation');
    expect(a?.dataTier).toBe('SIM_GRADE_A');
    const badge = renderHook(() => useDepthBadge('animation')).result.current;
    expect(badge?.label).toBe('Simulated');
  });
});
