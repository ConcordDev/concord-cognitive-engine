// Pins the Legal header chip and empty-state copy. Matters, time entries and
// invoices are the user's own persisted records, so the lens must not be
// labelled DEMO, and the manifest must only advertise macros the server
// really registers.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('legal');

describe('Legal manifest honesty', () => {
  it('is on the real-data tier with a "Real" chip, not DEMO', () => {
    expect(m?.dataTier).toBe('REAL_FREE');
    const badge = renderHook(() => useDepthBadge('legal')).result.current;
    expect(badge?.label).toBe('Real');
  });

  it('empty state and guide do not call the lens DEMO, and say Westlaw/Lexis is not supported yet', () => {
    const copy = JSON.stringify([m?.emptyState, m?.firstRunGuide]);
    expect(copy).not.toMatch(/DEMO|DocsShell opens by default|scheduled passes/);
    expect(m?.emptyState?.caption).toMatch(/not supported yet/);
  });

  it('every advertised action and guide macro is registered by server/domains/legal.js', () => {
    const src = readFileSync(join(__dirname, '../../server/domains/legal.js'), 'utf8');
    for (const a of m?.actions || []) {
      expect(src, a).toContain(`"legal", "${a}"`);
    }
    for (const gone of ['clauseChecker', 'citationPackager', 'caseTimelineBuilder', 'briefExport']) {
      expect(JSON.stringify(m)).not.toContain(gone);
    }
  });
});
