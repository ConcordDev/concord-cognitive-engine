/**
 * Fitness lens — Wave 4 gap-closure verification.
 *
 * `docs/lens-specs/fitness-capability-map.md` flagged three backend macros
 * that existed and worked but had no UI: `gps-track` (view one past
 * workout's GPS route), `beacon-list` (browse persisted/followed Beacons),
 * and `plan-session-move` (reschedule one specific training-plan session).
 * This file pins that each new UI action calls the real macro with the
 * right payload shape — no fabricated data, no generic action-bar buttons.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { StravaActivitiesPanel } from '@/components/fitness/StravaActivitiesPanel';
import { StravaBeaconPanel } from '@/components/fitness/StravaBeaconPanel';
import { StravaPlanPanel } from '@/components/fitness/StravaPlanPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

// ── 1. gps-track — "View route" on a GPS-sourced activity ──────────────────
describe('StravaActivitiesPanel — gps-track (view one past route)', () => {
  const GPS_ACTIVITY = {
    id: 'act_1', type: 'run', name: 'Morning Run', distanceKm: 5.2, durationSec: 1500,
    elevationGainM: 30, avgHr: 140, relativeEffort: 55, paceSecPerKm: 288,
    date: '2026-07-01', kudos: [], comments: [], photos: [],
    hasGps: true, source: 'gps_recording',
  };
  const NON_GPS_ACTIVITY = {
    id: 'act_2', type: 'yoga', name: 'Evening Yoga', distanceKm: 0, durationSec: 1800,
    elevationGainM: 0, avgHr: 0, relativeEffort: 10, paceSecPerKm: null,
    date: '2026-07-02', kudos: [], comments: [], photos: [],
  };

  it('only shows "View route" for activities with hasGps, not manually-logged ones', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'fitness' && action === 'activity-list') {
        return ok({ activities: [GPS_ACTIVITY, NON_GPS_ACTIVITY], totalDistanceKm: 5.2 });
      }
      return ok({});
    });
    const view = render(<StravaActivitiesPanel />);
    await waitFor(() => expect(view.getByText('Morning Run')).toBeInTheDocument());
    expect(view.getAllByText(/View route/i)).toHaveLength(1);
  });

  it('clicking "View route" calls fitness.gps-track with the activity id and renders the track', async () => {
    lensRunMock.mockImplementation((domain: string, action: string, input?: Record<string, unknown>) => {
      if (domain === 'fitness' && action === 'activity-list') {
        return ok({ activities: [GPS_ACTIVITY], totalDistanceKm: 5.2 });
      }
      if (domain === 'fitness' && action === 'gps-track') {
        expect(input).toEqual({ id: 'act_1' });
        return ok({
          track: {
            activityId: 'act_1',
            points: [
              { lat: 40.0, lon: -73.0, ele: 10 },
              { lat: 40.01, lon: -73.01, ele: 12 },
              { lat: 40.02, lon: -73.02, ele: 11 },
            ],
            bounds: { minLat: 40.0, maxLat: 40.02, minLon: -73.02, maxLon: -73.0 },
          },
        });
      }
      return ok({});
    });
    const view = render(<StravaActivitiesPanel />);
    await waitFor(() => expect(view.getByText('Morning Run')).toBeInTheDocument());

    const routeBtn = view.getByText(/View route/i);
    await act(async () => { fireEvent.click(routeBtn); });

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[0] === 'fitness' && c[1] === 'gps-track');
      expect(call).toBeTruthy();
      expect(call?.[2]).toEqual({ id: 'act_1' });
    });
    // map renders (dependency-free SVG MapView) once the track resolves
    await waitFor(() => expect(view.getByText(/Hide route/i)).toBeInTheDocument());
  });

  it('surfaces an honest error when gps-track fails, not a blank map', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'fitness' && action === 'activity-list') {
        return ok({ activities: [GPS_ACTIVITY], totalDistanceKm: 5.2 });
      }
      if (domain === 'fitness' && action === 'gps-track') {
        return err('no GPS track for this activity');
      }
      return ok({});
    });
    const view = render(<StravaActivitiesPanel />);
    await waitFor(() => expect(view.getByText('Morning Run')).toBeInTheDocument());
    await act(async () => { fireEvent.click(view.getByText(/View route/i)); });
    await waitFor(() => expect(view.getByText(/no GPS track for this activity/i)).toBeInTheDocument());
  });
});

// ── 2. beacon-list — browse persisted/followed Beacons ──────────────────────
describe('StravaBeaconPanel — beacon-list (browse active/followed Beacons)', () => {
  it('calls fitness.beacon-list on mount and renders both mine + following summaries', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'fitness' && action === 'beacon-list') {
        return ok({
          mine: [{ id: 'bcn_1', shareToken: 'tok_abc', userId: 'u1', type: 'run', status: 'live', startedAt: '2026-07-11T10:00:00Z', distanceKm: 3.2 }],
          following: [{ userId: 'u2', type: 'ride', status: 'live', startedAt: '2026-07-11T09:00:00Z', distanceKm: 8.1 }],
        });
      }
      return ok({});
    });
    const view = render(<StravaBeaconPanel />);

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[0] === 'fitness' && c[1] === 'beacon-list');
      expect(call).toBeTruthy();
      expect(call?.[2]).toEqual({});
    });
    await waitFor(() => expect(view.getByText(/Your beacons/i)).toBeInTheDocument());

    // switch to the follow tab to see the following list
    fireEvent.click(view.getByText('Follow a Beacon'));
    await waitFor(() => expect(view.getByText(/Beacons you're following/i)).toBeInTheDocument());
    expect(view.getByText('u2')).toBeInTheDocument();
  });

  it('clicking "View" on a persisted own beacon calls fitness.beacon-status with its id (recovers state after refresh)', async () => {
    lensRunMock.mockImplementation((domain: string, action: string, input?: Record<string, unknown>) => {
      if (domain === 'fitness' && action === 'beacon-list') {
        return ok({
          mine: [{ id: 'bcn_1', shareToken: 'tok_abc', userId: 'u1', type: 'run', status: 'live', startedAt: '2026-07-11T10:00:00Z', distanceKm: 3.2 }],
          following: [],
        });
      }
      if (domain === 'fitness' && action === 'beacon-status') {
        expect(input).toEqual({ id: 'bcn_1' });
        return ok({
          beacon: {
            id: 'bcn_1', shareToken: 'tok_abc', status: 'live', type: 'run',
            position: { lat: 40.0, lon: -73.0, at: '2026-07-11T10:05:00Z' },
            distanceKm: 3.2, durationSec: 900, followerCount: 1,
          },
          isOwner: true,
        });
      }
      return ok({});
    });
    const view = render(<StravaBeaconPanel />);
    await waitFor(() => expect(view.getByText(/Your beacons/i)).toBeInTheDocument());

    await act(async () => { fireEvent.click(view.getByText('View')); });

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[0] === 'fitness' && c[1] === 'beacon-status');
      expect(call).toBeTruthy();
      expect(call?.[2]).toEqual({ id: 'bcn_1' });
    });
    // the recovered share token is now visible (the doc's stated bug: refresh used to lose it)
    await waitFor(() => expect(view.getByText('tok_abc')).toBeInTheDocument());
  });
});

// ── 3. plan-session-move — reschedule one specific session ──────────────────
describe('StravaPlanPanel — plan-session-move (reschedule one session)', () => {
  const PLAN = {
    id: 'plan_1',
    name: 'Marathon Block',
    goalRace: null,
    goalDate: null,
    sessions: [
      { id: 'sess_1', date: '2026-07-15', type: 'long', title: null, targetDistanceKm: 20, targetDurationMin: 0, status: 'planned' },
    ],
    adherence: { completed: 0, missed: 0, upcoming: 1, rate: 0 },
  };

  it('clicking a session date opens an inline date editor that calls fitness.plan-session-move on change', async () => {
    lensRunMock.mockImplementation((domain: string, action: string, input?: Record<string, unknown>) => {
      if (domain === 'fitness' && action === 'plan-list') return ok({ plans: [PLAN] });
      if (domain === 'fitness' && action === 'plan-session-move') {
        expect(input).toEqual({ planId: 'plan_1', sessionId: 'sess_1', date: '2026-07-17' });
        return ok({ sessionId: 'sess_1', date: '2026-07-17' });
      }
      return ok({});
    });
    const view = render(<StravaPlanPanel />);
    await waitFor(() => expect(view.getByText('Marathon Block')).toBeInTheDocument());

    const dateBtn = view.getByTitle('Reschedule this session');
    fireEvent.click(dateBtn);

    const dateInput = view.getByDisplayValue('2026-07-15') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-07-17' } });
    await act(async () => { fireEvent.blur(dateInput); });

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[0] === 'fitness' && c[1] === 'plan-session-move');
      expect(call).toBeTruthy();
      expect(call?.[2]).toEqual({ planId: 'plan_1', sessionId: 'sess_1', date: '2026-07-17' });
    });
  });

  it('pressing Escape cancels the edit without calling plan-session-move', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'fitness' && action === 'plan-list') return ok({ plans: [PLAN] });
      return ok({});
    });
    const view = render(<StravaPlanPanel />);
    await waitFor(() => expect(view.getByText('Marathon Block')).toBeInTheDocument());

    fireEvent.click(view.getByTitle('Reschedule this session'));
    const dateInput = view.getByDisplayValue('2026-07-15') as HTMLInputElement;
    await act(async () => { fireEvent.keyDown(dateInput, { key: 'Escape' }); });

    expect(lensRunMock.mock.calls.some((c) => c[1] === 'plan-session-move')).toBe(false);
    // reverted back to the plain date button
    await waitFor(() => expect(view.getByTitle('Reschedule this session')).toBeInTheDocument());
  });
});
