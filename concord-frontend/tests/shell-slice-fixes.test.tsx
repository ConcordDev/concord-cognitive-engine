// Shell slice pins (B6, CB-0568):
//  - FIX-privacy-011 / FIX-suffering-011: CrossDomainConnections presents a
//    corpus item as a connection only when the search measured positive
//    similarity — zero/unscored hits no longer ride in; strongest first,
//    capped; an all-zero semantic result falls back to graph neighbours.
//  - FIX-billing-013 (labelled-controls leg): the billing action-result
//    dismiss button carries a real name, not the icon component's name.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';

const search = vi.hoisted(() => vi.fn());
const force = vi.hoisted(() => vi.fn());
const lensRunMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/lenses/x', useSearchParams: () => new URLSearchParams() }));
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
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import CrossDomainConnections from '../components/common/CrossDomainConnections';
import { openLensTool } from '@/lib/lens-dock';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
afterEach(() => cleanup());
beforeEach(() => {
  [search, force, lensRunMock].forEach((f) => f.mockReset());
  lensRunMock.mockResolvedValue({ data: { ok: true, result: { nodes: [] } } });
  force.mockResolvedValue({ data: { nodes: [{ id: 'g1', title: 'Graph neighbour', domain: 'chemistry', score: 0.5 }], links: [] } });
});

describe('CrossDomainConnections relevance floor', () => {
  it('drops zero/unscored corpus hits and orders the rest strongest first', async () => {
    search.mockResolvedValue({ data: { ok: true, results: [
      { id: 'weak', title: 'Weak hit', tags: ['biology'], score: 0.21 },
      { id: 'zero', title: 'Zero hit', tags: ['geology'], score: 0 },
      { id: 'strong', title: 'Strong hit', tags: ['chemistry'], score: 0.87 },
      { id: 'unscored', title: 'Unscored hit', tags: ['history'] },
    ] } });
    render(<CrossDomainConnections domain="physics" domainLabel="Physics" />);
    await act(async () => { openLensTool('connections'); });
    await settle();
    const text = document.body.textContent || '';
    expect(text).toMatch(/Strong hit/);
    expect(text).toMatch(/Weak hit/);
    expect(text).not.toMatch(/Zero hit/);
    expect(text).not.toMatch(/Unscored hit/);
    expect(text).toMatch(/2 connections across 2 domains/);
    expect(text.indexOf('Strong hit')).toBeLessThan(text.indexOf('Weak hit'));
    expect(force).not.toHaveBeenCalled();
  });

  it('falls back to graph neighbours when every semantic hit is zero-scored', async () => {
    search.mockResolvedValue({ data: { ok: true, results: [
      { id: 'zero', title: 'Zero hit', tags: ['geology'], score: 0 },
    ] } });
    render(<CrossDomainConnections domain="physics" domainLabel="Physics" />);
    await act(async () => { openLensTool('connections'); });
    await settle();
    const text = document.body.textContent || '';
    expect(force).toHaveBeenCalled();
    expect(text).toMatch(/Graph neighbour/);
    expect(text).not.toMatch(/Zero hit/);
  });
});

describe('FIX-billing-013 labelled-controls leg', () => {
  it('the action-result dismiss button is named for its purpose', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/billing/BillingWorkbench.tsx'), 'utf8');
    expect(src).not.toContain('aria-label="Xcircle"');
    expect(src).toContain('aria-label="Dismiss result"');
  });
});
