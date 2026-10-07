/**
 * EnergyLivePanel — real-time polling + "Now" tile pulse.
 *
 * Sense/Emporia Vue's whole identity is a power meter that visibly moves.
 * Before this pass the panel called `energy.live-stream` exactly once on
 * mount and then sat static until the user manually submitted a sample —
 * a flat, one-shot fetch dressed as a "live consumption" surface. This
 * proves it now genuinely re-polls the real backend on an interval (not
 * a fake ticker) and that a real value change updates the "Now" tile
 * (tied to actual state change, never decorative).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Record<string, unknown>])),
}));

vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }) }));

import { EnergyLivePanel } from '@/components/energy/EnergyLivePanel';

describe('EnergyLivePanel — real live polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lensRun.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Distinct current/peak/avg per call so assertions on one tile can't
  // collide with another tile showing the same number.
  function mockStream(current: number) {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'live-stream') {
        return { data: { ok: true, result: { samples: [], current, peak: current + 111, avgWatts: current - 33 } } };
      }
      return { data: { ok: true, result: {} } };
    });
  }

  it('polls the real energy.live-stream macro on an interval, not just once on mount', async () => {
    mockStream(500);
    render(<EnergyLivePanel meterId="meter_1" meterName="Main panel" onChange={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByText('500')).toBeInTheDocument();
    const callsAfterMount = lensRun.mock.calls.filter((c) => c[1] === 'live-stream').length;
    expect(callsAfterMount).toBe(1);

    mockStream(650);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(screen.getByText('650')).toBeInTheDocument();
    const callsAfterPoll = lensRun.mock.calls.filter((c) => c[1] === 'live-stream').length;
    expect(callsAfterPoll).toBeGreaterThan(callsAfterMount);
  });

  it('a real wattage change updates the "Now" tile to the new server value', async () => {
    mockStream(100);
    render(<EnergyLivePanel meterId="meter_1" meterName="Main panel" onChange={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('100')).toBeInTheDocument();

    mockStream(340);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('stops polling on unmount (no leaked interval calling a dead component)', async () => {
    mockStream(200);
    const { unmount } = render(<EnergyLivePanel meterId="meter_1" meterName="Main panel" onChange={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('200')).toBeInTheDocument();

    const callsBefore = lensRun.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(lensRun.mock.calls.length).toBe(callsBefore);
  });

  it('submits a real sample against the selected meter and reconciles', async () => {
    mockStream(0);
    render(<EnergyLivePanel meterId="meter_1" meterName="Main panel" onChange={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    fireEvent.change(screen.getByLabelText('Watts now'), { target: { value: '725' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Sample/i })); });

    expect(lensRun).toHaveBeenCalledWith('energy', 'live-sample', { watts: 725, deviceId: 'meter_1' });
  });
});
