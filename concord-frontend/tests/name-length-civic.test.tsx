/**
 * CB-0496 Part A — civic-bonds-006: the drive Title field carries the
 * createBond storage cap (server/lib/civic-bonds.js slices title to 500)
 * as maxLength, so an over-long title can no longer be silently cut.
 * (Separate file: the page needs the shell/auth mocks from the CB-0492
 * page suite, which would disturb the panel mounts in the main suite.)
 */
import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ calls: [] as Array<{ domain: string; action: string }> }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (a: unknown, b?: unknown, c?: unknown) => {
    const domain = typeof a === 'string' ? a : (a as { domain: string }).domain;
    const action = typeof a === 'string' ? (b as string) : (a as { action: string }).action;
    h.calls.push({ domain, action });
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

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => { h.calls.length = 0; });

describe('CB-0496 Part A — civic-bonds title cap', () => {
  it('the drive Title input carries maxLength 500 (the createBond slice)', async () => {
    const view = wrap(<CivicBondsPage />);
    const input = await screen.findByPlaceholderText('Community project title');
    expect((input as HTMLInputElement).maxLength).toBe(500);
    expect(view.container.querySelector('#civic-bond-title')).toBeTruthy();
  });
});
