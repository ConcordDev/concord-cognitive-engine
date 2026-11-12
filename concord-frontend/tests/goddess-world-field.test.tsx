// Audit fix sweep (PR #2356) — FIX-goddess-005: the World field validates in
// the open. Blank says it reads as concordia-hub, a malformed id (e.g.
// '-99999999999') gets a format message and is never fetched, and the field
// caps at 64 chars — instead of every value being accepted silently.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'tester' } }) }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/goddess/GoddessGallery', () => ({ GoddessGallery: () => null }));
vi.mock('@/components/goddess/DispatchArchive', () => ({ DispatchArchive: () => null }));
vi.mock('@/components/goddess/ToneSubscriptions', () => ({ ToneSubscriptions: () => null }));
vi.mock('@/components/goddess/DispatchDetail', () => ({ DispatchDetail: () => null }));

import GoddessPage from '@/app/lenses/goddess/page';

function reply(result: Record<string, unknown>) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_d: string, name: string) => {
    if (name === 'recent') return reply({ dispatches: [], count: 0, toneCounts: {} });
    return reply({});
  });
});

describe('goddess World field — validation is stated, not silent', () => {
  it('caps at 64, explains blank, and refuses to fetch a malformed id', async () => {
    const { container, getByText, findAllByRole } = render(<GoddessPage />);
    const input = await waitFor(() => container.querySelector('#goddess-world') as HTMLInputElement);
    expect(input).toBeTruthy();
    expect(input.maxLength).toBe(64);

    fireEvent.change(input, { target: { value: '' } });
    expect(getByText('Blank reads as concordia-hub.')).toBeTruthy();

    lensRun.mockClear();
    fireEvent.change(input, { target: { value: '-99999999999' } });
    const alerts = await findAllByRole('alert');
    expect(alerts.some(a => (a.textContent || '').includes('World ids are 1–64 characters'))).toBe(true);
    await new Promise(r => setTimeout(r, 50));
    const recentCalls = lensRun.mock.calls.filter(c => c[1] === 'recent');
    expect(recentCalls.length).toBe(0);
  });
});
