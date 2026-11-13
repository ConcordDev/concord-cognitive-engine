/**
 * FIX-consulting-007 — the Consulting lens's Lighthouse a11y bundle:
 * unlabeled selects, heading order, contrast, touch targets.
 * (The bundle's CSP 'eval' Issue has no source in this tree — zero
 * eval/Function occurrences in components/consulting — and is filed
 * as an Issues-panel rider in the fix record, not pinned here.)
 *
 * DOM pins render the statically reachable surfaces; a brace-aware
 * source sweep covers every select in the tree, including the ones
 * inside dialogs (a naive tag regex truncates at the '>' of '=>').
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === 'profitability-report') {
      return { data: { ok: true, result: { rows: [], totalBilled: 0, totalCost: 0, totalMargin: 0, overallMarginPct: 0 } } };
    }
    if (action === 'timer-status') return { data: { ok: true, result: { timer: null } } };
    return { data: { ok: true, result: {} } };
  }),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { LiveTimer } from '@/components/consulting/LiveTimer';
import { ProfitabilityReport } from '@/components/consulting/ProfitabilityReport';
import { ClientPortal } from '@/components/consulting/ClientPortal';

function withQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** Opening tag of the element at `start`, skipping '>' inside { }. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, k + 1);
  }
  return src.slice(start);
}

describe('FIX-consulting-007 — consulting a11y bundle', () => {
  it('LiveTimer: panel title is h2 and the engagement select is named', async () => {
    withQuery(<LiveTimer engagements={[{ id: 'e1', name: 'Acme' }]} onLogged={() => {}} />);
    expect(await screen.findByRole('heading', { level: 2, name: /Live Timer/ })).toBeTruthy();
    expect(screen.getByLabelText('Engagement')).toBeTruthy();
  });

  it('ProfitabilityReport: panel title is h2', async () => {
    withQuery(<ProfitabilityReport />);
    expect(await screen.findByRole('heading', { level: 2, name: /Profitability/ })).toBeTruthy();
  });

  it('ClientPortal: the share dialog title is h2 and its engagement select is named', async () => {
    withQuery(<ClientPortal engagements={[{ id: 'e1', name: 'Acme' }]} />);
    fireEvent.click(await screen.findByRole('button', { name: /Share Deliverable/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Share Deliverable' })).toBeTruthy();
    expect(screen.getByLabelText('Engagement')).toBeTruthy();
  });

  it('source sweep: every consulting select is named and floored; no h4 titles remain', () => {
    const root = path.join(process.cwd(), 'components', 'consulting');
    for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      let i = 0;
      for (;;) {
        const j = src.indexOf('<select', i);
        if (j < 0) break;
        const tag = openingTag(src, j);
        expect(tag, `${f}: select without aria-label`).toContain('aria-label');
        expect(tag, `${f}: select without the target floor`).toContain('min-h-11');
        i = j + tag.length;
      }
      expect(src.includes('<h4'), `${f}: h4 title remains`).toBe(false);
    }
    const ws = fs.readFileSync(path.join(root, 'ConsultingWorkspace.tsx'), 'utf8');
    expect(ws).not.toContain('text-stone-700');
    expect(ws).not.toContain('text-stone-500');
  });
});
