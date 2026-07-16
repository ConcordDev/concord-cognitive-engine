/**
 * OwnedSatellites — user-owned satellite tracking + ESTIMATED ground-station
 * pass scheduling (the ENGINEERING gap-closure for space-capability-map.md
 * line 93: "Ground-station pass scheduling for own satellites").
 *
 * A user-tracked satellite has no live ephemeris feed (unlike the ISS panel
 * next to this one, which samples real wheretheiss.at telemetry) — so the
 * pass-finder must always render an honestly-labeled ESTIMATE, including an
 * honest ZERO-passes result for a ground station outside the satellite's
 * inclination band. These tests pin the CRUD round-trip, the backend-derived
 * period/orbits/type display (no client-side computation), and both pass-
 * finder outcomes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OwnedSatellites } from '@/components/space/OwnedSatellites';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, result: null, error } });
}

const SAT_A = {
  id: 'sat_a1', name: 'Concordia-1', altitudeKm: 420, inclinationDeg: 51.6,
  notes: '', trackedAt: '2026-01-01T00:00:00.000Z',
  periodMinutes: 92.7, orbitsPerDay: 15.5, type: 'LEO' as const,
};

describe('OwnedSatellites', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('loads satellite-list on mount and shows the empty state with no tracked satellites', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'space' && action === 'satellite-list') return ok({ satellites: [] });
      return ok({});
    });
    render(<OwnedSatellites />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('space', 'satellite-list', {}));
    expect(await screen.findByTestId('sat-list-empty')).toBeInTheDocument();
  });

  it('renders each tracked satellite using ONLY backend-derived fields — no client-side period computation', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'space' && action === 'satellite-list') return ok({ satellites: [SAT_A] });
      return ok({});
    });
    render(<OwnedSatellites />);
    const detail = await screen.findByTestId('sat-list-item-sat_a1-detail');
    expect(detail.textContent).toContain('420 km');
    expect(detail.textContent).toContain('incl 51.6°');
    expect(detail.textContent).toContain('period 92.7 min');
    expect(detail.textContent).toContain('15.5 orbits/day');
    expect(screen.getByTestId('sat-list-item-sat_a1-zone')).toHaveTextContent('LEO');
  });

  it('client-side validates before calling the API: rejects an empty name without a network call', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [] });
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-empty');
    fireEvent.change(screen.getByTestId('sat-track-altitude'), { target: { value: '500' } });
    // name stays empty -> submit button is disabled by design, but also guard
    // the handler itself: the button is disabled, so directly assert the
    // disabled state rather than clicking (clicking a disabled button is a no-op).
    expect(screen.getByTestId('sat-track-submit')).toBeDisabled();
  });

  it('client-side validates altitude: rejects zero/negative before calling satellite-track', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [] });
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-empty');
    fireEvent.change(screen.getByTestId('sat-track-name'), { target: { value: 'BadBird' } });
    fireEvent.change(screen.getByTestId('sat-track-altitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('sat-track-submit'));
    await waitFor(() => expect(screen.getByTestId('sat-track-error')).toHaveTextContent(/positive number/));
    expect(lensRunMock).not.toHaveBeenCalledWith('space', 'satellite-track', expect.anything());
  });

  it('track flow: submits the form, calls satellite-track, then refreshes the list', async () => {
    let listCalls = 0;
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') {
        listCalls += 1;
        return ok({ satellites: listCalls > 1 ? [SAT_A] : [] });
      }
      if (action === 'satellite-track') {
        return ok({ satellite: SAT_A, count: 1 });
      }
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-empty');

    fireEvent.change(screen.getByTestId('sat-track-name'), { target: { value: 'Concordia-1' } });
    fireEvent.change(screen.getByTestId('sat-track-altitude'), { target: { value: '420' } });
    fireEvent.click(screen.getByTestId('sat-track-submit'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('space', 'satellite-track', expect.objectContaining({
        name: 'Concordia-1', altitudeKm: 420,
      }));
    });
    expect(await screen.findByTestId('sat-list-item-sat_a1')).toBeInTheDocument();
  });

  it('shows a server-side rejection (e.g. duplicate name) without crashing', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [SAT_A] });
      if (action === 'satellite-track') return fail('already tracking a satellite with this name');
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    fireEvent.change(screen.getByTestId('sat-track-name'), { target: { value: 'Concordia-1' } });
    fireEvent.change(screen.getByTestId('sat-track-altitude'), { target: { value: '420' } });
    fireEvent.click(screen.getByTestId('sat-track-submit'));
    await waitFor(() => expect(screen.getByTestId('sat-track-error')).toHaveTextContent(/already tracking/));
  });

  it('untrack flow: clicking delete calls satellite-untrack with the id and refreshes', async () => {
    let listCalls = 0;
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') {
        listCalls += 1;
        return ok({ satellites: listCalls > 1 ? [] : [SAT_A] });
      }
      if (action === 'satellite-untrack') return ok({ removed: 'sat_a1', count: 0 });
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    fireEvent.click(screen.getByTestId('sat-list-item-sat_a1-delete'));
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('space', 'satellite-untrack', { id: 'sat_a1' });
    });
    await waitFor(() => expect(screen.getByTestId('sat-list-empty')).toBeInTheDocument());
  });

  it('pass finder: requires a satellite selection before "Find passes" is enabled', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [SAT_A] });
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    expect(screen.getByTestId('sat-passes-find')).toBeDisabled();
    fireEvent.change(screen.getByTestId('sat-passes-select'), { target: { value: 'sat_a1' } });
    expect(screen.getByTestId('sat-passes-find')).not.toBeDisabled();
  });

  it('pass finder: renders a non-zero ESTIMATED result with the honesty note and badge', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [SAT_A] });
      if (action === 'satellite-passes') {
        return ok({
          satellite: { id: 'sat_a1', name: 'Concordia-1', altitudeKm: 420, inclinationDeg: 51.6 },
          observer: { latitude: 40.7, longitude: -74 },
          windowHours: 24,
          periodMinutes: 92.7,
          passes: [
            { index: 0, startUtc: '2026-07-16T10:00:00.000Z', endUtc: '2026-07-16T10:07:24.000Z', durationMinutes: 7.4 },
            { index: 1, startUtc: '2026-07-16T11:32:42.000Z', endUtc: '2026-07-16T11:40:06.000Z', durationMinutes: 7.4 },
          ],
          count: 2,
          precision: 'estimated',
          note: 'Estimated from orbital period only (92.7 min) — passes are assumed to recur once per revolution.',
        });
      }
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    fireEvent.change(screen.getByTestId('sat-passes-select'), { target: { value: 'sat_a1' } });
    fireEvent.change(screen.getByTestId('sat-passes-lat'), { target: { value: '40.7' } });
    fireEvent.change(screen.getByTestId('sat-passes-lon'), { target: { value: '-74' } });
    fireEvent.click(screen.getByTestId('sat-passes-find'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('space', 'satellite-passes', expect.objectContaining({
        id: 'sat_a1', latitude: 40.7, longitude: -74,
      }));
    });
    expect(await screen.findByTestId('sat-passes-list')).toBeInTheDocument();
    expect(screen.getByTestId('sat-passes-note')).toHaveTextContent(/Estimated from orbital period only/);
    expect(screen.getByTestId('sat-passes-estimated-badge')).toHaveTextContent(/ESTIMATED/);
    expect(screen.getAllByText('est.').length).toBeGreaterThan(0);
  });

  it('pass finder: renders the HONEST zero-passes case (out-of-inclination-band) without fabricating a pass', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [SAT_A] });
      if (action === 'satellite-passes') {
        return ok({
          satellite: { id: 'sat_a1', name: 'Concordia-1', altitudeKm: 420, inclinationDeg: 51.6 },
          observer: { latitude: 80, longitude: 0 },
          windowHours: 24,
          periodMinutes: 92.7,
          passes: [],
          count: 0,
          precision: 'estimated',
          note: "Ground station latitude 80° is outside this satellite's 51.6°-inclination ground-track band (max reachable latitude ~51.6°) — this orbit can never pass overhead here, so zero passes is the honest answer.",
        });
      }
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    fireEvent.change(screen.getByTestId('sat-passes-select'), { target: { value: 'sat_a1' } });
    fireEvent.change(screen.getByTestId('sat-passes-lat'), { target: { value: '80' } });
    fireEvent.change(screen.getByTestId('sat-passes-lon'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('sat-passes-find'));

    await waitFor(() => expect(screen.getByTestId('sat-passes-zero')).toBeInTheDocument());
    expect(screen.getByTestId('sat-passes-note')).toHaveTextContent(/outside this satellite's/);
    expect(screen.queryByTestId('sat-passes-list')).toBeNull();
  });

  it('pass finder: surfaces a server error (e.g. fabricated id) without rendering a result', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [SAT_A] });
      if (action === 'satellite-passes') return fail('satellite not found');
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    fireEvent.change(screen.getByTestId('sat-passes-select'), { target: { value: 'sat_a1' } });
    fireEvent.change(screen.getByTestId('sat-passes-lat'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('sat-passes-lon'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('sat-passes-find'));

    await waitFor(() => expect(screen.getByTestId('sat-passes-error')).toHaveTextContent(/satellite not found/));
    expect(screen.queryByTestId('sat-passes-result')).toBeNull();
  });

  it('pass finder: "My location" uses navigator.geolocation and triggers a pass lookup', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [SAT_A] });
      if (action === 'satellite-passes') {
        return ok({
          satellite: { id: 'sat_a1', name: 'Concordia-1', altitudeKm: 420, inclinationDeg: 51.6 },
          observer: { latitude: 51.5, longitude: -0.12 },
          windowHours: 24, periodMinutes: 92.7, passes: [], count: 0,
          precision: 'estimated', note: 'in-band note',
        });
      }
      return ok({});
    });

    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 51.5, longitude: -0.12 } } as GeolocationPosition);
    });
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    fireEvent.change(screen.getByTestId('sat-passes-select'), { target: { value: 'sat_a1' } });
    fireEvent.click(screen.getByTestId('sat-passes-mylocation'));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('space', 'satellite-passes', expect.objectContaining({
        id: 'sat_a1', latitude: 51.5, longitude: -0.12,
      }));
    });
    expect(getCurrentPosition).toHaveBeenCalled();
  });

  it('respects a custom windowHours input when calling satellite-passes', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'satellite-list') return ok({ satellites: [SAT_A] });
      if (action === 'satellite-passes') {
        return ok({
          satellite: { id: 'sat_a1', name: 'Concordia-1', altitudeKm: 420, inclinationDeg: 51.6 },
          observer: { latitude: 10, longitude: 10 }, windowHours: 6, periodMinutes: 92.7,
          passes: [], count: 0, precision: 'estimated', note: 'in-band note',
        });
      }
      return ok({});
    });
    render(<OwnedSatellites />);
    await screen.findByTestId('sat-list-item-sat_a1');
    fireEvent.change(screen.getByTestId('sat-passes-select'), { target: { value: 'sat_a1' } });
    fireEvent.change(screen.getByTestId('sat-passes-lat'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('sat-passes-lon'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('sat-passes-window'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('sat-passes-find'));
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('space', 'satellite-passes', expect.objectContaining({ windowHours: 6 }));
    });
  });
});
