/**
 * understanding-full-build.test.tsx — pins for the Understanding full
 * lens build (F-C row 21): the scoped caption, the envelope unwrap
 * that makes the panels readable, the two-step delete, and the
 * honest llm label.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('understanding declaration + caption', () => {
  it('the manifest declares REAL_LIVE; the caption names the in-process substrate', () => {
    expect(getLensManifest('understanding')?.dataTier).toBe('REAL_LIVE');
    const { result } = renderHook(() => useDepthBadge('understanding'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('in-process');
    expect(result.current.caption).not.toContain('polled live from an external source');
  });
  it('the registry agrees (REAL_LIVE, substrate-flagged)', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => l.trim().startsWith('understanding:')) ?? '';
    expect(line).toContain('REAL_LIVE');
  });
});

describe('understanding build pins', () => {
  it('the macro helper unwraps the shaped envelope (S1)', () => {
    const src = read('components/understanding/understanding-shared.tsx');
    expect(src).toContain("'result' in data");
    expect(src).toContain('ok: true');
  });
  it('note delete is a two-step in-page confirm, no window.confirm (S2)', () => {
    const src = read('components/understanding/NotesWorkbench.tsx');
    expect(src).not.toContain('window.confirm(');
    expect(src).toContain('armDelete');
    expect(src).toContain('Click again to confirm');
  });
  it('the llm composer is labelled not-yet-wired (S1)', () => {
    const src = read('components/understanding/ComposePanel.tsx');
    expect(src).toContain('not yet wired');
  });
});
