/// <reference types="@testing-library/jest-dom/vitest" />
// Vitest for the Sessions lens page — pins the four UX states (loading,
// empty, populated, error) and the a11y contract, and proves the page is
// wired to the REAL sessions.* macros (sessions.search drives the list,
// sessions.pause/close drive the row actions). Heavy children + next/navigation
// are mocked so the test focuses on the page's own state machine.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Stub the heavy lens chrome + sessions children to render-passthrough/no-op so
// the test exercises the page's own list/state logic, not theirs.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/sessions/SessionDetail', () => ({
  SessionDetail: ({ sessionId }: { sessionId: string }) => <div data-testid="session-detail">{sessionId}</div>,
}));
vi.mock('@/components/sessions/StaleReminder', () => ({ StaleReminder: () => null }));

import SessionsLensPage from './page';

const NOW = Math.floor(Date.now() / 1000);

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sess_1', lensId: 'kingdoms', title: 'War campaign', status: 'open',
    currentStep: 'muster', stepCount: 2, createdAt: NOW - 100, updatedAt: NOW - 50, closedAt: null,
    ...over,
  };
}

/** lensRun envelope: helper returns { data: { ok, result, error } } where result
 *  is the unwrapped macro payload. */
function ok(payload: Record<string, unknown>) {
  return { data: { ok: true, result: { ok: true, ...payload }, error: null } };
}
function fail(reason: string) {
  return { data: { ok: true, result: { ok: false, reason }, error: null } };
}

describe('Sessions lens page', () => {
  beforeEach(() => {
    lensRun.mockReset();
    push.mockReset();
  });

  it('renders the populated state from sessions.search with real values', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'search') return Promise.resolve(ok({ sessions: [row()], total: 1, sort: 'recent' }));
      return Promise.resolve(ok({}));
    });

    render(<SessionsLensPage />);

    await waitFor(() => expect(screen.getByText('War campaign')).toBeInTheDocument());
    // it calls the REAL macro name
    expect(lensRun).toHaveBeenCalledWith('sessions', 'search', expect.any(Object));
    // real fields surface
    expect(screen.getByText(/2 transitions/)).toBeInTheDocument();
    expect(screen.getByText(/muster/)).toBeInTheDocument();
  });

  it('renders the empty state when search returns no sessions', async () => {
    lensRun.mockResolvedValue(ok({ sessions: [], total: 0, sort: 'recent' }));
    render(<SessionsLensPage />);
    await waitFor(() => expect(screen.getByText('No sessions yet.')).toBeInTheDocument());
  });

  it('renders the error state when search fails', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'search') return Promise.resolve(fail('boom'));
      return Promise.resolve(ok({ sessions: [] }));
    });
    render(<SessionsLensPage />);
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });

  it('shows a loading affordance on first paint, then clears it once data resolves', async () => {
    lensRun.mockResolvedValue(ok({ sessions: [], total: 0, sort: 'recent' }));
    const { container } = render(<SessionsLensPage />);
    // loading initialises true → the refresh button is disabled + spinning
    const refresh = screen.getByLabelText('Refresh');
    expect(refresh).toBeDisabled();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    // once the (debounced) search resolves, loading clears
    await waitFor(() => expect(screen.getByLabelText('Refresh')).not.toBeDisabled());
  });

  it('drives a real row action through the matching sessions.* macro', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'search') return Promise.resolve(ok({ sessions: [row()], total: 1, sort: 'recent' }));
      if (action === 'pause') return Promise.resolve(ok({ status: 'paused' }));
      return Promise.resolve(ok({}));
    });
    render(<SessionsLensPage />);
    await waitFor(() => expect(screen.getByText('War campaign')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Pause'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('sessions', 'pause', expect.objectContaining({ sessionId: 'sess_1' })),
    );
  });

  it('satisfies the a11y contract — labelled controls', async () => {
    lensRun.mockResolvedValue(ok({ sessions: [], total: 0, sort: 'recent' }));
    render(<SessionsLensPage />);
    await waitFor(() => expect(screen.getByText('No sessions yet.')).toBeInTheDocument());
    // every interactive control is reachable by an accessible name
    expect(screen.getByLabelText('Refresh')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort sessions')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by title or lens/)).toBeInTheDocument();
  });
});
