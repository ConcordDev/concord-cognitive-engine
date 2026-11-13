// cross-domain-source-labels.test.tsx
//
// FIX-strategic-adds-016: the Cross-domain panel merged shared-corpus
// search hits (public items from every account, platform samples
// included) with the lens's own registered work into one unlabelled
// list, so corpus content read as the viewer's own connections. The
// panel now states the corpus source in words and marks registered
// (own-work) items with a Registered badge.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/lenses/x', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { nodes: [{ id: 'rg1', title: 'Saved thread check', domain: 'commonsense', summary: 'Checked' }] } } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {
    semanticSearch: { search: vi.fn(async () => ({ data: { ok: true, results: [{ id: 'd1', title: 'Hormone signalling', tags: ['biology'], score: 0.82, summary: 'Feedback' }] } })) },
    graph: { force: vi.fn(async () => ({ data: { nodes: [] } })) },
  },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout'].includes(k))), children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CrossDomainConnections from '@/components/common/CrossDomainConnections';
import { openLensTool } from '@/lib/lens-dock';

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe('Cross-domain source labels (FIX-strategic-adds-016)', () => {
  it('labels the corpus source and badges registered own-work items only', async () => {
    rtlRender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CrossDomainConnections domain="physics" domainLabel="Physics" />
      </QueryClientProvider>,
    );
    await act(async () => { openLensTool('connections'); });
    await settle();
    expect(document.body.textContent).toMatch(/shared Concord corpus/);
    expect(document.body.textContent).toMatch(/not just yours/);

    const registeredRow = screen.getAllByRole('button').find((b) => /Saved thread check/.test(b.textContent || ''));
    expect(registeredRow?.textContent).toMatch(/Registered/);
    const corpusRow = screen.getAllByRole('button').find((b) => /Hormone signalling/.test(b.textContent || ''));
    expect(corpusRow?.textContent).not.toMatch(/Registered/);
  });
});
