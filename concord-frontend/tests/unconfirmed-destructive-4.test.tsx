// CB-0492 Part A — unconfirmed-destructive genus (RCA-missing-delete-confirm),
// page leg: FIX-civic-bonds-009 (Unpledge) · FIX-lfg-005 (Cancel your
// request). Nothing fires until the two-step confirm is pressed.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ domain: string; action: string; input: unknown }>,
  fetches: [] as string[],
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: (a: unknown, b?: unknown, c?: unknown) => {
    const domain = typeof a === 'string' ? a : (a as { domain: string }).domain;
    const action = typeof a === 'string' ? (b as string) : (a as { action: string }).action;
    const input = typeof a === 'string' ? c : (a as { input: unknown }).input;
    h.calls.push({ domain, action, input });
    const ok = (result: unknown) => Promise.resolve({ ok: true, data: { ok: true, result } });
    if (domain === 'civic_bonds' && action === 'list') {
      return ok({
        bonds: [{
          id: 'b1', world_id: 'concordia-hub', realm_id: null, title: 'Harbor Lights',
          description: 'Fund the pier lights', status: 'voting', target_amount: 1000,
          current_pledged: 200, denomination: 10, vote_for: 3, vote_against: 0,
          created_at: '2026-11-01', closes_at: null, my_pledge: 50,
        }],
      });
    }
    return ok({});
  },
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/lens/NorthStarFrame', () => ({ NorthStarFrame: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me-1', name: 'Ramaj' } }) }));
vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: () => {} }),
}));

import CivicBondsPage from '@/app/lenses/civic-bonds/page';
import LfgPage from '@/app/lenses/lfg/page';

beforeEach(() => {
  vi.stubGlobal('fetch', (url: string) => {
    h.fetches.push(String(url));
    if (String(url).includes('/api/lfg/open')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          requests: [{
            id: 'r1', userId: 'me-1', posterName: 'Ramaj', worldId: 'concordia-hub',
            role: 'healer', partyType: 'normal', note: 'need one more', createdAt: 1,
            expiresAt: 9999999999999, partyMaxSize: 4, currentSize: 1,
          }],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
});
afterEach(() => { cleanup(); h.calls.length = 0; h.fetches.length = 0; vi.unstubAllGlobals(); });

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const called = (action: string) => h.calls.some((c) => c.action === action);

describe('FIX-civic-bonds-009 unpledge confirm', () => {
  it('unpledge fires only from the confirm step', async () => {
    wrap(<CivicBondsPage />);
    const arm = await screen.findByRole('button', { name: 'Refund my pledge to Harbor Lights' });
    fireEvent.click(arm);
    expect(called('unpledge')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm refund of my pledge to Harbor Lights' }));
    await waitFor(() => expect(called('unpledge')).toBe(true));
  });
});

describe('FIX-lfg-005 cancel-request confirm', () => {
  it('cancelling a request fires only from the confirm step', async () => {
    wrap(<LfgPage />);
    const arm = await screen.findByRole('button', { name: 'Cancel your request' });
    fireEvent.click(arm);
    expect(h.fetches.some((u) => u.includes('/cancel'))).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm cancel your request' }));
    await waitFor(() => expect(h.fetches.some((u) => u.includes('/api/lfg/r1/cancel'))).toBe(true));
  });
});
