// Behavior test for ZoningSiteAnalysis's new "Sun / Shadow Study" tool —
// closes the "Shadow/sun-path 3D massing study" row in
// docs/WAVE4_INVENTORY.md / docs/lens-specs/urban-planning-capability-map.md.
// The backend macro (urban-planning.shadowStudy) is real (NOAA solar
// position + shadow trig, hourly UTC samples); this test pins that the
// tool form calls it with the right params, renders the ACTUAL returned
// numbers (not a JSON blob, not a fabricated 3D scene), honestly labels
// the result as a 2D shadow-path study, and surfaces the backend's error
// string on failure — no client-side fabrication of any of these fields.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { ZoningSiteAnalysis } from '@/components/urban-planning/ZoningSiteAnalysis';

function mockShadowStudySuccess() {
  lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    expect(domain).toBe('urban-planning');
    if (action === 'shadowStudy') {
      return {
        data: {
          ok: true,
          result: {
            label: '2D shadow-path study — real hourly sun position + shadow length/direction; NOT a rendered 3D massing study',
            location: { lat: Number(input.lat), lng: Number(input.lng), source: 'params' },
            date: String(input.date),
            envelope: { widthFt: 126.5, depthFt: 126.5, heightFt: 55 },
            method: 'NOAA Solar Calculator algorithm (Spencer 1971 declination + equation-of-time series, https://gml.noaa.gov/grad/solcalc/solareqns.PDF), computed in UTC throughout. shadowLengthFt = heightFt / tan(altitude); shadowDirectionDeg = azimuth + 180deg.',
            resolution: 'hourly (24 UTC samples/day)',
            daylightHours: 3,
            samples: [
              { hourUtc: 16, sunUp: true, altitudeDeg: 68.95, azimuthDeg: 140.73, shadowLengthFt: 21.5, shadowDirectionDeg: 320.73 },
              { hourUtc: 17, sunUp: true, altitudeDeg: 72.73, azimuthDeg: 182.01, shadowLengthFt: 17.2, shadowDirectionDeg: 2.01 },
              { hourUtc: 18, sunUp: true, altitudeDeg: 68.31, azimuthDeg: 222.03, shadowLengthFt: 21.9, shadowDirectionDeg: 42.03 },
              { hourUtc: 4, sunUp: false, altitudeDeg: -10.2, azimuthDeg: 45.1, shadowLengthFt: null, shadowDirectionDeg: null },
            ],
            approxSolarNoon: { hourUtc: 17, altitudeDeg: 72.73, note: 'highest-altitude hourly sample (UTC); true solar noon may fall between samples' },
          },
        },
      };
    }
    return { data: { ok: false, result: null, error: `unexpected action ${action}` } };
  });
}

describe('ZoningSiteAnalysis — Sun / Shadow Study tool', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('switches to the sun-study tab and calls shadowStudy with the form params', async () => {
    mockShadowStudySuccess();
    render(<ZoningSiteAnalysis />);

    fireEvent.click(screen.getByRole('button', { name: /Sun \/ Shadow Study/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run Sun Study/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    const [domain, action, input] = lensRun.mock.calls[0];
    expect(domain).toBe('urban-planning');
    expect(action).toBe('shadowStudy');
    expect(input).toMatchObject({ lat: 40.7128, lng: -74.006, zoneType: 'commercial', date: '2026-06-21' });
  });

  it('renders the honest 2D-shadow-path label, not a 3D-massing claim', async () => {
    mockShadowStudySuccess();
    render(<ZoningSiteAnalysis />);
    fireEvent.click(screen.getByRole('button', { name: /Sun \/ Shadow Study/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run Sun Study/i }));

    await waitFor(() => screen.getByText(/NOT a rendered 3D massing study/i));
    expect(screen.getByText(/2D shadow-path study — real hourly sun position/i)).toBeTruthy();
  });

  it('renders only the daylight (sunUp) samples as real rows in the table', async () => {
    mockShadowStudySuccess();
    render(<ZoningSiteAnalysis />);
    fireEvent.click(screen.getByRole('button', { name: /Sun \/ Shadow Study/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run Sun Study/i }));

    // Three sunUp rows (16:00, 17:00, 18:00) rendered; the sun-down 04:00
    // sample must NOT appear as a data row (it carries null shadow fields).
    await waitFor(() => screen.getByText('16:00'));
    expect(screen.getByText('17:00')).toBeTruthy();
    expect(screen.getByText('18:00')).toBeTruthy();
    expect(screen.queryByText('04:00')).toBeNull();

    // Real computed numbers appear verbatim (not re-derived/fabricated client-side).
    expect(screen.getByText('72.73°')).toBeTruthy(); // altitude at peak
    expect(screen.getByText('182.01°')).toBeTruthy(); // azimuth at peak
    expect(screen.getByText('2.01°')).toBeTruthy(); // shadow direction at peak

    // Peak-sun summary field, daylight-hours count, and envelope height are
    // all the real backend-computed values, not client-side guesses.
    expect(screen.getByText('3')).toBeTruthy(); // daylightHours
    expect(screen.getByText('55 ft')).toBeTruthy(); // envelope height
    expect(screen.getByText(/17:00 @ 72\.73°/)).toBeTruthy(); // approxSolarNoon summary
  });

  it('surfaces the backend error string honestly on failure, without fabricating a result', async () => {
    lensRun.mockImplementation(async () => ({
      data: { ok: false, result: null, error: 'lat must be between -90 and 90' },
    }));
    render(<ZoningSiteAnalysis />);
    fireEvent.click(screen.getByRole('button', { name: /Sun \/ Shadow Study/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run Sun Study/i }));

    await waitFor(() => screen.getByText('lat must be between -90 and 90'));
    // No fabricated result card (with the backend's real label text) should
    // render alongside the error.
    expect(screen.queryByText(/2D shadow-path study — real hourly sun position/i)).toBeNull();
    expect(screen.queryByText('hourly (24 UTC samples/day)')).toBeNull();
  });
});
