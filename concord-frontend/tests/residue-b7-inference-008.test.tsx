// residue-b7-inference-008.test.tsx
//
// FIX-inference-008: the Cross-domain panel listed records from the shared
// corpus — titles and snippets included — with no ownership label, so a
// reader could not tell whose records they were. The semantic endpoint
// now classifies each result (mine / member / platform) and every corpus
// card carries the label: Yours, Another member, or Platform.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/lenses/inference', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { nodes: [] } } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {
    semanticSearch: {
      search: vi.fn(async () => ({
        data: {
          ok: true,
          results: [
            { id: 'd-mine', title: 'My own record', tags: ['biology'], score: 0.9, summary: 'Mine', ownership: 'mine' },
            { id: 'd-member', title: 'A shared study', tags: ['biology'], score: 0.8, summary: 'Theirs', ownership: 'member' },
            { id: 'd-platform', title: 'Platform sample', tags: ['physics'], score: 0.7, summary: 'Sample', ownership: 'platform' },
          ],
        },
      })),
    },
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

describe('FIX-inference-008 — cross-domain cards carry ownership labels', () => {
  it('each corpus record is labelled Yours / Another member / Platform', async () => {
    rtlRender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CrossDomainConnections domain="inference" domainLabel="Inference" />
      </QueryClientProvider>,
    );
    await act(async () => { openLensTool('connections'); });
    await settle();

    const rowFor = (title: string) =>
      screen.getAllByRole('button').find((b) => (b.textContent || '').includes(title));

    expect(rowFor('My own record')?.textContent).toMatch(/Yours/);
    expect(rowFor('A shared study')?.textContent).toMatch(/Another member/);
    expect(rowFor('Platform sample')?.textContent).toMatch(/Platform/);
    // Ownership is not the Registered origin label — the two stay distinct.
    expect(rowFor('My own record')?.textContent).not.toMatch(/Registered/);
  });
});
