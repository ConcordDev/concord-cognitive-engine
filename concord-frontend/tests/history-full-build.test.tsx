/**
 * history-full-build.test.tsx — pins for the History full lens build
 * (F-C row 11): the scoped badge over a REAL_FREE declaration (the
 * walked gate read this lens's declaration HONEST — no tier flip is
 * owed; the caption scopes the static/open-access dataset truthfully),
 * and the catalogue copy counts nothing the lens does not hold.
 * Registry agreement is pinned at the file level (manifest + badge
 * override).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');

describe('history declaration stands honest (REAL_FREE, as walked)', () => {
  it('the manifest declares REAL_FREE', () => {
    expect(getLensManifest('history')?.dataTier).toBe('REAL_FREE');
  });
  it('the badge reads Real for the open-access dataset', () => {
    const { result } = renderHook(() => useDepthBadge('history'));
    expect(result.current.label).toBe('Real');
  });
  it('the import component discloses that it builds a NEW timeline from real dates', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components/history/WikiTimelineImport.tsx'), 'utf8');
    expect(src).toContain('Builds a NEW timeline');
    expect(src).toContain('never guessed');
  });
  it('the builder carries no native confirm() gate (the F2 dead-control class)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components/history/TimelineBuilder.tsx'), 'utf8');
    expect(src.includes("confirm('Delete this timeline?')")).toBe(false);
    expect(src).toContain('event-update');
  });
});
