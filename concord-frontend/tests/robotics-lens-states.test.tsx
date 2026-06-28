/**
 * /lenses/robotics — four-UX-state contract for the Robotics fleet surface.
 *
 * The robotics lens's primary live surface is FleetManager, which loads its fleet
 * via lensRun('robotics', 'fleetList', {}) in a mount effect and renders genuine
 * loading / error (with a WORKING Retry) / empty (CTA) / populated states. This
 * pins all four against the real backend channel and asserts the Retry actually
 * RE-INVOKES lensRun (closing the swallowed-fetch → silent-empty defect class),
 * plus that the runner is constructed on the 'robotics' domain (a regression to
 * any other id resolves to NO backend receiver).
 *
 * No fabricated data — every state is driven by a mocked lensRun standing in for
 * the real /api/lens/run dispatch in the exact { data: { ok, result } } shape the
 * component reads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── backend channel: lensRun (controls loading/error/empty/populated) ────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { FleetManager } from '@/components/robotics/FleetManager';

const POPULATED = {
  data: {
    ok: true,
    result: {
      robots: [
        { id: 'r1', name: 'Atlas-01', status: 'online', type: 'arm', firmware: '2.1', batteryWh: 50, drawW: 35 },
      ],
      total: 1, online: 1, running: 0, errors: 0,
    },
  },
};
const EMPTY = { data: { ok: true, result: { robots: [], total: 0, online: 0, running: 0, errors: 0 } } };
const ERROR = { data: { ok: false, error: 'fleet service unavailable' } };

beforeEach(() => { lensRun.mockReset(); });

describe('/lenses/robotics — FleetManager four UX states', () => {
  it('WIRING: loads the fleet on the robotics domain via fleetList', async () => {
    lensRun.mockResolvedValue(EMPTY);
    render(<FleetManager />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(lensRun).toHaveBeenCalledWith('robotics', 'fleetList', {});
  });

  it('LOADING: shows a role=status indicator before the fleet resolves', async () => {
    let resolve!: (v: unknown) => void;
    lensRun.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { getByRole, container } = render(<FleetManager />);
    expect(getByRole('status')).toBeTruthy();
    resolve(EMPTY);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull());
  });

  it('POPULATED: renders the real robot rows from the handler result', async () => {
    lensRun.mockResolvedValue(POPULATED);
    const { findByText } = render(<FleetManager />);
    expect(await findByText('Atlas-01')).toBeTruthy();
  });

  it('EMPTY: shows the honest "no robots" CTA, not a blank panel', async () => {
    lensRun.mockResolvedValue(EMPTY);
    const { findByText } = render(<FleetManager />);
    expect(await findByText(/No robots registered yet/i)).toBeTruthy();
  });

  it('ERROR: surfaces role=alert + a Retry that RE-FETCHES (not silent-empty)', async () => {
    lensRun.mockResolvedValue(ERROR);
    const { getByRole, findByText } = render(<FleetManager />);
    await waitFor(() => expect(getByRole('alert')).toBeTruthy());
    expect(await findByText(/fleet service unavailable/i)).toBeTruthy();

    // Retry recovers to populated — proving it re-invokes lensRun.
    lensRun.mockResolvedValue(POPULATED);
    fireEvent.click(getByRole('button', { name: /Retry/i }));
    expect(await findByText('Atlas-01')).toBeTruthy();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });
});
