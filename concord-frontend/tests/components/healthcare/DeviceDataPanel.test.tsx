import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));
vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: (p: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'chartkit' }, JSON.stringify((p.data as unknown[])?.length ?? 0)),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { DeviceDataPanel } from '@/components/healthcare/DeviceDataPanel';

const readings = [
  { id: 'r1', patientId: 'p1', metric: 'heart_rate', value: 72, unit: 'bpm', flag: 'normal',
    device: 'Watch', recordedAt: '2026-05-01T10:00:00Z', ingestedAt: '2026-05-01T10:01:00Z' },
  { id: 'r2', patientId: 'p1', metric: 'heart_rate', value: 88, unit: 'bpm', flag: 'high',
    device: 'Watch', recordedAt: '2026-05-02T10:00:00Z', ingestedAt: '2026-05-02T10:01:00Z' },
];
const summary = [
  { metric: 'heart_rate', count: 2, latest: 88, unit: 'bpm', latestFlag: 'high', trend: 'up' },
  { metric: 'glucose', count: 1, latest: 95, unit: 'mg/dL', latestFlag: 'normal', trend: 'stable' },
];

describe('DeviceDataPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { readings: [], summary: [] } } });
    render(<DeviceDataPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No device readings yet/)).toBeInTheDocument());
  });

  it('renders summary tiles, trend chart and the reading list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { readings, summary } } });
    render(<DeviceDataPanel patientId="p1" />);
    // "88" appears both as a summary tile latest value and a reading row value.
    await waitFor(() => expect(screen.getAllByText('88').length).toBeGreaterThan(0));
    expect(screen.getByTestId('chartkit')).toBeInTheDocument();
    expect(screen.getAllByText(/reading/).length).toBeGreaterThan(0);
  });

  it('ingests a new reading with a valid numeric value', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { readings: [], summary: [] } } });
    render(<DeviceDataPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No device readings yet/));
    fireEvent.change(screen.getByPlaceholderText('Value *'), { target: { value: '75' } });
    fireEvent.change(screen.getByPlaceholderText('Device'), { target: { value: 'Fitbit' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Log/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'device-ingest')).toBe(true));
  });

  it('ingests with an explicit recordedAt timestamp', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { readings: [], summary: [] } } });
    render(<DeviceDataPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No device readings yet/));
    fireEvent.change(screen.getByPlaceholderText('Value *'), { target: { value: '120' } });
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-05-10T08:30' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Log/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'device-ingest')).toBe(true));
    const ingestCall = lensRun.mock.calls.find((c) => c[1] === 'device-ingest')!;
    expect((ingestCall[2] as { recordedAt?: string }).recordedAt).toBeTruthy();
  });

  it('changes the metric select in the ingest form', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { readings: [], summary: [] } } });
    render(<DeviceDataPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No device readings yet/));
    const metricSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(metricSelect, { target: { value: 'glucose' } });
    expect((metricSelect as HTMLSelectElement).value).toBe('glucose');
  });

  it('changes the metric filter and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { readings: [], summary: [] } } });
    render(<DeviceDataPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No device readings yet/));
    const filter = screen.getAllByRole('combobox')[0];
    lensRun.mockClear();
    fireEvent.change(filter, { target: { value: 'glucose' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<DeviceDataPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No device readings yet/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
