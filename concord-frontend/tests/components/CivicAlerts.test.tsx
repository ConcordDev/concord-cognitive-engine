/// <reference types="@testing-library/jest-dom/vitest" />
/** INC-SWEEP government F5 — geolocation denial must not claim "your area". */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { CivicAlerts, FALLBACK_AREA_LABEL, FALLBACK_COORDS } from '@/components/government/CivicAlerts';

describe('CivicAlerts (F5)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { alerts: [] } } });
    // Deny geolocation → component uses SF fallback.
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: unknown, err: (e?: unknown) => void) => {
          err({ code: 1, message: 'denied' });
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('labels the SF fallback honestly and does not say "your area"', async () => {
    render(<CivicAlerts />);
    expect(await screen.findByText(new RegExp(FALLBACK_AREA_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    const empty = await screen.findByText(/No active alerts for default area/i);
    expect(empty.textContent).toMatch(/San Francisco/i);
    expect(empty.textContent).not.toMatch(/your area/i);
    expect(lensRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'government',
        action: 'alerts-current',
        input: { lat: FALLBACK_COORDS.lat, lng: FALLBACK_COORDS.lng },
      }),
    );
  });
});
