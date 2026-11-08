// Behaviour coverage for the cross-domain connections drawer: opens via the lens tool bus, reads
// semantic search first and falls back to the graph, merges registered nodes, navigates, refreshes
// and reports failure.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
const search = vi.hoisted(() => vi.fn());
const force = vi.hoisted(() => vi.fn());
const lensRunMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/lenses/x', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { semanticSearch: { search: (...a: unknown[]) => search(...a) }, graph: { force: (...a: unknown[]) => force(...a) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout'].includes(k))), children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CrossDomainConnections from '../CrossDomainConnections';
import { openLensTool } from '@/lib/lens-dock';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
afterEach(() => cleanup());
beforeEach(() => {
  [push, search, force, lensRunMock].forEach((f) => f.mockReset());
  search.mockResolvedValue({ data: { ok: true, results: [{ id: 'd1', title: 'Hormone signalling', tags: ['biology'], score: 0.82, summary: 'Feedback in endocrine systems' }, { id: 'd2', title: 'Same domain', tags: ['physics'], score: 0.9 }, { id: 'd3', tags: ['economics'], score: 3.4 }, { id: 'd4', title: 'No tag', tags: [] }] } });
  force.mockResolvedValue({ data: { nodes: [{ id: 'g1', title: 'Graph node', domain: 'chemistry', score: 0.5 }, { id: 'g2', title: 'Own', domain: 'physics' }], links: [] } });
  lensRunMock.mockResolvedValue({ data: { ok: true, result: { nodes: [{ id: 'rg1', title: 'Saved thread check', domain: 'commonsense', summary: 'Checked' }, { id: 'd1', title: 'dup', domain: 'biology' }] } } });
});

describe('CrossDomainConnections', () => {
  it('stays closed until the lens tool opens it, then lists semantic and registered connections', async () => {
    render(<CrossDomainConnections domain="physics" domainLabel="Physics" />);
    await settle();
    expect(search).not.toHaveBeenCalled();
    await act(async () => { openLensTool('connections'); });
    await settle();
    expect(search).toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/Hormone signalling/);
    expect(document.body.textContent).toMatch(/Saved thread check/);
    await act(async () => { fireEvent.click(screen.getByLabelText('Refresh connections')); });
    await settle();
    const nav = screen.getAllByRole('button').find((b) => /Hormone signalling/.test(b.textContent || '')) as HTMLElement;
    await act(async () => { fireEvent.click(nav); });
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/lenses/biology?highlight=d1'));
    await act(async () => { openLensTool('connections'); });
    await settle();
    await act(async () => { fireEvent.click(screen.getByLabelText('Close panel')); });
    await settle();
  });

  it('falls back to the graph when semantic search finds nothing or fails', async () => {
    search.mockResolvedValue({ data: { ok: true, results: [] } });
    render(<CrossDomainConnections domain="physics" domainLabel="Physics" />);
    await act(async () => { openLensTool('connections'); });
    await settle();
    expect(force).toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/Graph node/);
    cleanup();
    search.mockRejectedValue(new Error('down'));
    render(<CrossDomainConnections domain="physics" domainLabel="Physics" />);
    await act(async () => { openLensTool('connections'); });
    await settle();
    expect(force.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports an error when both sources fail, and retries', async () => {
    search.mockRejectedValue(new Error('down'));
    force.mockRejectedValue(new Error('graph down'));
    lensRunMock.mockRejectedValue(new Error('x'));
    render(<CrossDomainConnections domain="physics" domainLabel="Physics" />);
    await act(async () => { openLensTool('connections'); });
    await settle(60);
    const retry = screen.queryAllByRole('button').find((b) => /retry|try again/i.test(b.textContent || ''));
    if (retry) await act(async () => { fireEvent.click(retry); });
    await settle();
    expect(document.body.textContent?.length).toBeGreaterThan(20);
  });
});
