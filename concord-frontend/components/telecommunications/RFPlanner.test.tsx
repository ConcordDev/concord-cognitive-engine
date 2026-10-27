/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RFPlanner } from './RFPlanner';

const lensRunMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => <div data-testid="cap-chart" />,
  TimelineView: () => null,
  TreeDiagram: () => null,
  MapView: () => null,
}));

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

describe('RFPlanner capacity nulls', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'towerList') return ok({ towers: [] });
      if (action === 'spectrumList') return ok({ allocations: [] });
      if (action === 'outageList') return ok({ outages: [] });
      return ok(null);
    });
  });

  async function openCapacity() {
    render(<RFPlanner tab="capacity" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Project capacity/i })).toBeEnabled());
  }

  it('renders a cleared projection as not recorded instead of null mo', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string, input?: { bandwidthGbps?: number }) => {
      if (action === 'capacityProjection') {
        expect(input?.bandwidthGbps).toBeNaN();
        return ok({
          horizonMonths: null,
          series: null,
          breachMonth: null,
          recommendedBandwidthGbps: null,
          reason: 'not_recorded',
          unavailable: ['bandwidthGbps'],
        });
      }
      if (action === 'towerList') return ok({ towers: [] });
      if (action === 'spectrumList') return ok({ allocations: [] });
      if (action === 'outageList') return ok({ outages: [] });
      return ok(null);
    });

    await openCapacity();
    fireEvent.change(screen.getByLabelText(/Bandwidth/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Project capacity/i }));

    await waitFor(() => expect(screen.getByText(/Not recorded: bandwidthGbps/)).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/null mo|undefined/);
    expect(screen.queryByTestId('cap-chart')).toBeNull();
  });

  it('keeps a measured projection', async () => {
    lensRunMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'capacityProjection') {
        return ok({
          horizonMonths: 24,
          series: [{ month: 0, subscribers: 5000, demandMbps: 7500, utilizationPercent: 75, headroomPercent: 25 }],
          targetUtilizationPercent: 80,
          breachMonth: null,
          breachWarning: 'Capacity holds through the 24-month horizon.',
          recommendedBandwidthGbps: 12,
          additionalGbps: 2,
        });
      }
      if (action === 'towerList') return ok({ towers: [] });
      if (action === 'spectrumList') return ok({ allocations: [] });
      if (action === 'outageList') return ok({ outages: [] });
      return ok(null);
    });

    await openCapacity();
    fireEvent.click(screen.getByRole('button', { name: /Project capacity/i }));
    await waitFor(() => expect(screen.getByText('24 mo')).toBeInTheDocument());
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(screen.getByText('12 Gbps')).toBeInTheDocument();
    expect(screen.getByText('+2 Gbps')).toBeInTheDocument();
    expect(screen.getByText(/Capacity holds through the 24-month horizon/)).toBeInTheDocument();
    expect(screen.getAllByTestId('cap-chart')).toHaveLength(2);
  });
});
