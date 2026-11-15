// Audit fix sweep (PR #2356) — FIX-goddess-006: 'Listen again'
// re-fetched the feed with no trace the click did anything (the same
// dispatches came back and nothing on screen changed). The click now
// announces 'Listening again…' and, when the fetch lands, confirms
// 'Dispatches refreshed · <time>'.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
let capturedCta: { onClick: () => void; label: string } | null = null;

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children, cta }: { children: React.ReactNode; cta?: { onClick: () => void; label: string } }) => {
    capturedCta = cta ?? null;
    return React.createElement('div', null, children);
  },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/goddess/GoddessGallery', () => ({ GoddessGallery: () => null }));
vi.mock('@/components/goddess/DispatchArchive', () => ({ DispatchArchive: () => null }));
vi.mock('@/components/goddess/ToneSubscriptions', () => ({ ToneSubscriptions: () => null }));
vi.mock('@/components/goddess/DispatchDetail', () => ({ DispatchDetail: () => null }));

import GoddessPage from '@/app/lenses/goddess/page';

const dispatch = {
  id: 1, body: 'The orchards hum tonight.', tone: 'neutral',
  ecosystem_score: 0.5, refusal_strength: 1, composed_at: 1762000000,
};

let resolveRefresh: ((v: unknown) => void) | null = null;

beforeEach(() => {
  capturedCta = null;
  resolveRefresh = null;
  lensRun.mockReset();
  let recentCalls = 0;
  lensRun.mockImplementation((_d: string, name: string) => {
    if (name === 'recent') {
      recentCalls += 1;
      // The refresh fetch stays in flight until the test releases it, so
      // the 'Listening again…' state is observable.
      if (recentCalls > 1) return new Promise((res) => { resolveRefresh = res; });
      return Promise.resolve({ data: { ok: true, result: { dispatches: [dispatch] }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  });
});

describe("goddess 'Listen again' — the refresh announces itself", () => {
  it('says it is listening, then confirms the refresh with a time', async () => {
    const view = render(<GoddessPage />);
    await view.findByText('The orchards hum tonight.');
    expect(capturedCta?.label).toBe('Listen again');
    expect(view.queryByText(/Dispatches refreshed/)).toBeNull();

    await act(async () => { capturedCta!.onClick(); });
    expect(view.getByText('Listening again…')).toBeTruthy();

    await act(async () => {
      resolveRefresh!({ data: { ok: true, result: { dispatches: [dispatch] }, error: null } });
    });
    await view.findByText(/Dispatches refreshed/);
    const recentCalls = lensRun.mock.calls.filter((c) => c[1] === 'recent');
    expect(recentCalls.length).toBeGreaterThanOrEqual(2);
  });
});
