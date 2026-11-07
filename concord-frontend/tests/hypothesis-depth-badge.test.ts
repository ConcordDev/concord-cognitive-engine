/**
 * Hypothesis declaration + build pins (F-C hypothesis build):
 *  - the declaration is REAL_LIVE in the manifest and integration registry
 *  - the depth badge's scoped caption (no claim of external polling)
 *  - the standalone page retires into the canonical lens (S1)
 *  - the pre-registration outcome form pre-answers nothing (S4 rider)
 *  - the dataset→hypothesis link is wired in the workbench (S3)
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import { getLensManifest } from '@/lib/lenses/manifest';

const REPO_ROOT = path.join(__dirname, '..', '..');

describe('hypothesis declaration (REAL_LIVE, registry agreement)', () => {
  it('the manifest declares REAL_LIVE', () => {
    expect(getLensManifest('hypothesis')?.dataTier).toBe('REAL_LIVE');
  });
  it('the integration registry agrees (REAL_LIVE off the substrate)', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'server/lib/integration-registry.js'),
      'utf8',
    );
    const line = src.split('\n').find((l) => /^\s*hypothesis:/.test(l));
    expect(line).toBeTruthy();
    expect(line).toContain('TIER.REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
  it('astronomy control untouched: REAL_FREE / Real', () => {
    expect(getLensManifest('astronomy')?.dataTier).toBe('REAL_FREE');
    const { result } = renderHook(() => useDepthBadge('astronomy'));
    expect(result.current.label).toBe('Real');
  });
});

describe('hypothesis depth badge — scoped Live', () => {
  it('renders Live with the scoped caption (no external-polling claim)', () => {
    const { result } = renderHook(() => useDepthBadge('hypothesis'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain("platform's hypothesis engine");
    expect(result.current.caption).toContain('Global Library');
    expect(result.current.caption).toContain('arXiv feed, labelled at its panel');
    expect(result.current.caption).not.toContain('polled live from an external source');
  });
});

describe('hypothesis build source pins', () => {
  it('S1: the standalone page redirects to the canonical lens', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'concord-frontend/app/hypothesis-lab/page.tsx'),
      'utf8',
    );
    expect(src).toContain("redirect('/lenses/hypothesis')");
  });
  it('S4 rider: the H₀-rejected checkbox starts unchecked', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'concord-frontend/components/hypothesis/StatsWorkbench.tsx'),
      'utf8',
    );
    expect(src).toContain('const [reject, setReject] = useState(false)');
  });
  it('S3: the workbench wires the dataset→hypothesis link both ways', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'concord-frontend/components/hypothesis/StatsWorkbench.tsx'),
      'utf8',
    );
    expect(src).toContain('datasetSetHypothesis');
    expect(src).toContain('attachedToHypothesis');
  });
  it('S4: the Lab wires search, duplicates and delete', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'concord-frontend/components/hypothesis/HypothesisLab.tsx'),
      'utf8',
    );
    expect(src).toContain('Search statements');
    expect(src).toContain('duplicate_statement');
    expect(src).toContain("hyp('delete'");
  });
});
