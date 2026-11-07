// Close-out A5 — the declaration flip. The platform vocabulary gains
// REAL_WORKSPACE for the shape no value named: the user's own records,
// written and persisted per-account in their workspace. The six member
// lenses flip in the manifest, and the badge the hook returns reads
// "Workspace" with a caption naming each lens's second half where one
// exists. Controls: lenses outside the flip keep their declarations.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const MEMBERS = ['consulting', 'creative', 'hvac', 'mentorship', 'defense', 'physics'] as const;

describe('A5 declaration flip — the members', () => {
  it.each(MEMBERS)('%s declares REAL_WORKSPACE in the manifest', (domain) => {
    expect(getLensManifest(domain)?.dataTier).toBe('REAL_WORKSPACE');
  });

  it.each(MEMBERS)('%s badge reads Workspace and never the old lines', (domain) => {
    const badge = renderHook(() => useDepthBadge(domain)).result.current;
    expect(badge?.label).toBe('Workspace');
    expect(badge?.caption).not.toMatch(/Not real data|static \/ open-access/);
  });

  it('the generic Workspace caption names the substrate honestly', () => {
    const badge = renderHook(() => useDepthBadge('consulting')).result.current;
    expect(badge?.caption).toMatch(/your own live records/i);
  });

  it('scoped captions name the second half where a lens carries one', () => {
    expect(renderHook(() => useDepthBadge('mentorship')).result.current?.caption).toMatch(/dataset/);
    expect(renderHook(() => useDepthBadge('creative')).result.current?.caption).toMatch(/template generators/);
    expect(renderHook(() => useDepthBadge('hvac')).result.current?.caption).toMatch(/published tables/);
    expect(renderHook(() => useDepthBadge('physics')).result.current?.caption).toMatch(/arXiv/);
  });
});

describe('A5 declaration flip — controls', () => {
  it('lenses outside the flip keep their declarations', () => {
    expect(getLensManifest('accounting')?.dataTier).toBe('REAL_FREE');
    expect(renderHook(() => useDepthBadge('accounting')).result.current?.label).toBe('Real');
    expect(getLensManifest('sim')?.dataTier).toBe('SIM_GRADE_A');
    expect(renderHook(() => useDepthBadge('sim')).result.current?.label).toBe('Simulated');
  });
});
