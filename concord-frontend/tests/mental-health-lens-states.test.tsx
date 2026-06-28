/**
 * /lenses/mental-health — four-UX-state contract.
 *
 * Pins that the Mental Health lens's wellness section renders genuine
 * loading / error (with a working Retry) / empty / populated states against
 * the real macro surface (lensRun('mental-health', 'wellness-dashboard') →
 * POST /api/lens/run), plus a11y (loading is role=status, error is role=alert).
 *
 * The component under test is MentalHealthSection — the Calm/Headspace-shaped
 * dashboard that the page mounts. Before Phase 2 its data fetch swallowed a
 * thrown request into a stuck spinner (the swallowed-fetch → silent-empty
 * defect fixed across sibling lenses); this test pins the now-honest error +
 * empty + populated states.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, exactly the shape server/domains/mentalhealth.js returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the section's single backend channel ─────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

// Import AFTER mocks are registered.
import { MentalHealthSection } from '@/components/mental-health/MentalHealthSection';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown> | null, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

// A populated wellness-dashboard envelope (real server shape).
const POPULATED = {
  streak: 3, sessionsThisWeek: 4, minutesThisWeek: 42,
  latestMood: 4, avgSleepHours: 7.5, activeCourses: 1, gratitudeEntries: 2,
};
// An all-zero dashboard (the genuine "no check-ins yet" empty state).
const EMPTY_DASH = {
  streak: 0, sessionsThisWeek: 0, minutesThisWeek: 0,
  latestMood: null, avgSleepHours: null, activeCourses: 0, gratitudeEntries: 0,
};

// Child panels (rendered under the default "practice" tab) also call lensRun;
// give them benign resolved envelopes so the test stays on the section's own
// state machine.
function panelDefault() {
  return reply({ sessions: [], courses: [], patterns: [], count: 0 });
}

beforeEach(() => { lensRun.mockReset(); });

describe('mental-health lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the dashboard is in flight', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'wellness-dashboard') return new Promise(() => {}); // never resolves
      return panelDefault();
    });
    const { container, getByText } = render(<MentalHealthSection />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading your wellness dashboard/i)).toBeInTheDocument();
  });

  it('ERROR: a thrown dashboard load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'wellness-dashboard') {
        if (fail) return Promise.reject(new Error('network down'));
        return reply(POPULATED);
      }
      return panelDefault();
    });
    const { container, getByText } = render(<MentalHealthSection />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/network down/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'wellness-dashboard').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'wellness-dashboard').length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('Day streak')).toBeInTheDocument());
  });

  it('ERROR: an ok:false envelope surfaces the backend error (not a silent empty)', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'wellness-dashboard'
        ? Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } })
        : panelDefault());
    const { container, getByText } = render(<MentalHealthSection />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();
  });

  it('EMPTY: an all-zero dashboard shows the honest "no check-ins yet" CTA', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'wellness-dashboard' ? reply(EMPTY_DASH) : panelDefault());
    const { getByText } = render(<MentalHealthSection />);
    await waitFor(() => expect(getByText(/No check-ins yet/i)).toBeInTheDocument());
    expect(getByText(/Log a mood, breathe, or start a practice session/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real dashboard stats from the macro envelope', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'wellness-dashboard' ? reply(POPULATED) : panelDefault());
    const { getByText } = render(<MentalHealthSection />);
    await waitFor(() => expect(getByText('Day streak')).toBeInTheDocument());
    // real values, not fabricated
    expect(getByText('3')).toBeInTheDocument();        // streak
    expect(getByText('4/5')).toBeInTheDocument();      // latest mood
    expect(getByText('7.5h')).toBeInTheDocument();     // avg sleep
    expect(getByText(/not medical advice/i)).toBeInTheDocument();
  });
});
