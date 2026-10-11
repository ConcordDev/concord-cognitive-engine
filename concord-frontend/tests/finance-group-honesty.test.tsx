/**
 * Finance-group honesty:
 *  - The Concordia world ledger is game-world economy lore. It must not sit
 *    in the Finance workspace tabs, and its label must say it is the game world.
 *  - Billing's header chip and subtitle must name one data tier. The balance
 *    and platform economy are the real economy ledger, so the chip is Real
 *    and the copy does not say Simulated.
 *  - /lenses/insurance shows "Community feed unavailable" when the Reddit
 *    fetch fails, without console.error, and keeps the workbench tools
 *    behind one Tools menu.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/navigation', () => ({
  usePathname: () => '/lenses/insurance',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: null } })),
  api: {
    get: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: { ok: true } })),
    delete: vi.fn(async () => ({ data: { ok: true } })),
  },
  apiHelpers: {
    lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) },
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({
    latestData: null,
    alerts: [],
    insights: [],
    isConnected: false,
    isLive: false,
    hasReceivedData: false,
    lastUpdated: null,
    clearAlerts: () => {},
  }),
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  useLensId: () => 'insurance',
}));

import { DESTINATIONS, getDestinationForLens } from '@/lib/destinations';
import { getAbsorbedLenses, getLensById, getParentCoreLens } from '@/lib/lens-registry';
import { DestinationNav } from '@/components/common/DestinationNav';
import { CoreLensNav } from '@/components/common/CoreLensNav';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import InsuranceLensPage from '@/app/lenses/insurance/page';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

function renderInsurance() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InsuranceLensPage />
    </QueryClientProvider>,
  );
}

describe('Finance group honesty — ledger', () => {
  it('is not a Finance workspace tab', () => {
    const finance = DESTINATIONS.find((d) => d.id === 'finance');
    expect(finance?.absorbs ?? []).not.toContain('ledger');
    expect(getDestinationForLens('ledger')?.id).not.toBe('finance');

    render(<DestinationNav destinationId="finance" />);
    const nav = screen.getByRole('navigation', { name: 'Finance workspace navigation' });
    expect(nav.textContent).not.toMatch(/ledger/i);
    expect(nav.querySelector('a[href="/lenses/ledger"]')).toBeNull();
  });

  it('lives under World and is labelled as the Concordia game world', () => {
    expect(getParentCoreLens('ledger')).toBe('world');
    const lens = getLensById('ledger');
    expect(lens?.name).toBe('Concordia world ledger (game world)');
    expect(lens?.tabLabel).toBe('Concordia world ledger (game world)');
    expect(lens?.coreLens).toBe('world');
    expect(getAbsorbedLenses('world').some((l) => l.id === 'ledger')).toBe(true);

    render(<CoreLensNav coreLensId="world" />);
    const nav = screen.getByRole('navigation', { name: 'World workspace navigation' });
    const tab = nav.querySelector('a[href="/lenses/ledger"]');
    expect(tab?.textContent).toBe('Concordia world ledger (game world)');

    const page = read('app/lenses/ledger/page.tsx');
    expect(page).toContain('Concordia world ledger (game world)');
    expect(page).not.toContain('What the books say');
  });
});

describe('Finance group honesty — billing data tier', () => {
  it('shows one Real label, not Simulated over a real-ledger claim', () => {
    const badge = renderHook(() => useDepthBadge('billing')).result.current;
    const page = read('app/lenses/billing/page.tsx');
    expect(badge?.label).toBe('Real');
    expect(badge?.caption).not.toMatch(/Not real data/);
    expect(page).not.toMatch(/Simulated/);
    expect(page).toMatch(/real ledger/);
    expect(page).not.toContain('from real ledger numbers');
  });
});

describe('Finance group honesty — insurance', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('reddit.com')) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('shows Community feed unavailable with no console error, and one Tools menu', async () => {
    renderInsurance();
    await waitFor(() => expect(screen.getByText('Community feed unavailable')).toBeInTheDocument());
    expect(errorSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Compare quotes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Loss ratio/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThanOrEqual(11);
    expect(screen.getByRole('menuitem', { name: /Loss ratio/ })).toBeInTheDocument();
  });
});
