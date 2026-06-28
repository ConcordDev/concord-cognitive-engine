import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// LensShell + the cross-lens/recents/section panels pull in next/dynamic, the
// UI store, the panel registry, and a11y hooks. Stub them to passthroughs /
// no-ops so this test isolates the wellness PAGE's own four UX states + a11y on
// the page-level WellnessOverview block (bound to wellness-dashboard-summary).
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/wellness/WellnessSection', () => ({ WellnessSection: () => null }));
vi.mock('@/components/wellness/WellnessFeed', () => ({ WellnessFeed: () => null }));
vi.mock('@/components/wellness/WellnessActionPanel', () => ({ WellnessActionPanel: () => null }));
vi.mock('@/components/wellness/SelfFieldsPanel', () => ({ SelfFieldsPanel: () => null }));
vi.mock('@/components/wellness/CBTPanel', () => ({ CBTPanel: () => null }));
vi.mock('@/components/wellness/SessionsPanel', () => ({ SessionsPanel: () => null }));
vi.mock('@/components/wellness/WearableImportPanel', () => ({ WearableImportPanel: () => null }));
vi.mock('@/components/wellness/DailyRecommendationPanel', () => ({ DailyRecommendationPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: React.PropsWithChildren) => children }));

// The page calls the real wellness.wellness-dashboard-summary macro through
// lensRun. Each test installs its own resolution.
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

function envelope(ok: boolean, result: unknown, error: string | null = null) {
  return { data: { ok, result, error } };
}

async function renderPage() {
  const { default: WellnessPage } = await import('@/app/lenses/wellness/page');
  render(React.createElement(WellnessPage));
}

describe('WellnessPage — four UX states on the page-level overview', () => {
  beforeEach(() => { vi.resetModules(); lensRun.mockReset(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('LOADING: shows an a11y status while the macro is in flight', async () => {
    lensRun.mockReturnValue(new Promise(() => {})); // never resolves
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByText(/loading your wellness overview/i)).toBeInTheDocument();
  });

  it('ERROR: shows an honest alert with a Retry button when the macro fails', async () => {
    lensRun.mockResolvedValue(envelope(false, null, 'boom'));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn’t load your wellness overview/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeInTheDocument();

    // Retry re-invokes the macro — second call succeeds and clears the error.
    lensRun.mockResolvedValue(envelope(true, {
      habitCount: 1, habitsDoneToday: 1, workoutsThisWeek: 0, workoutMinThisWeek: 0,
      avgMoodThisWeek: null, activeGoals: 0, metricEntryCount: 0,
    }));
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/wellness overview/i)).toBeInTheDocument();
  });

  it('EMPTY: shows a genuine empty state when there is no logged data', async () => {
    lensRun.mockResolvedValue(envelope(true, {
      habitCount: 0, habitsDoneToday: 0, workoutsThisWeek: 0, workoutMinThisWeek: 0,
      avgMoodThisWeek: null, activeGoals: 0, metricEntryCount: 0,
    }));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no wellness data yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/loading your wellness overview/i)).not.toBeInTheDocument();
  });

  it('POPULATED: renders the real rollup tiles from the macro result', async () => {
    lensRun.mockResolvedValue(envelope(true, {
      habitCount: 3, habitsDoneToday: 2, workoutsThisWeek: 4, workoutMinThisWeek: 180,
      avgMoodThisWeek: 3.5, activeGoals: 1, metricEntryCount: 12,
    }));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/wellness overview/i)).toBeInTheDocument();
    });
    // Real values rendered from the data, not placeholders.
    expect(screen.getByText('2/3')).toBeInTheDocument();      // habits done today
    expect(screen.getByText('180')).toBeInTheDocument();      // active minutes
    expect(screen.getByText('3.5/4')).toBeInTheDocument();    // avg mood
    expect(screen.getByText('12')).toBeInTheDocument();       // metric entries
    expect(screen.queryByText(/no wellness data yet/i)).not.toBeInTheDocument();
  });

  it('calls the wellness-dashboard-summary macro exactly', async () => {
    lensRun.mockResolvedValue(envelope(true, {
      habitCount: 0, habitsDoneToday: 0, workoutsThisWeek: 0, workoutMinThisWeek: 0,
      avgMoodThisWeek: null, activeGoals: 0, metricEntryCount: 1,
    }));
    await renderPage();
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'wellness', action: 'wellness-dashboard-summary' }),
    );
  });
});
