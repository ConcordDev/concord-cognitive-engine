/**
 * Grid inputs start blank. A missing frequency must not render as stable,
 * and an empty snapshot must not render as 0% low-load.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('lucide-react', () => ({ Activity: () => null, Waves: () => null }));
vi.mock('@/components/lens-primitives/CalcPanel', () => ({
  CalcPanel: (props: {
    right: { render: ReactNode; buildArtifact: () => { data: Record<string, unknown> } };
    renderResults: (c: Record<string, unknown> | null, g: unknown) => ReactNode;
  }) => (
    <div>
      {props.right.render}
      <button type="button" onClick={() => { (globalThis as { __grid?: unknown }).__grid = props.right.buildArtifact(); }}>build grid</button>
      {props.renderResults(null, {
        currentDemand: null,
        totalCapacity: null,
        utilization: null,
        renewableShare: null,
        gridFrequency: null,
        frequencyStable: null,
        status: null,
        reserves: null,
        reason: 'not_recorded',
        unavailable: ['currentDemandMW', 'totalCapacityMW', 'renewablePercent', 'gridFrequencyHz'],
        message: 'Not recorded: currentDemandMW, totalCapacityMW, renewablePercent, gridFrequencyHz.',
      })}
      {props.renderResults(null, {
        currentDemand: '800 MW',
        totalCapacity: '1000 MW',
        utilization: 80,
        renewableShare: '35%',
        gridFrequency: null,
        frequencyStable: null,
        status: 'high-load',
        reserves: '200 MW available',
        reason: 'not_recorded',
        unavailable: ['gridFrequencyHz'],
      })}
    </div>
  ),
}));

import { EnergyGridCalcPanel } from './EnergyGridCalcPanel';

describe('EnergyGridCalcPanel', () => {
  it('starts grid inputs blank and sends a typed 0 without inventing 60 Hz', () => {
    render(<EnergyGridCalcPanel />);
    const demand = screen.getByLabelText('Demand (MW)') as HTMLInputElement;
    const frequency = screen.getByLabelText('Frequency (Hz)') as HTMLInputElement;
    expect(demand.value).toBe('');
    expect((screen.getByLabelText('Capacity (MW)') as HTMLInputElement).value).toBe('');
    expect(frequency.value).toBe('');
    fireEvent.change(demand, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'build grid' }));
    const built = (globalThis as { __grid?: { data: Record<string, unknown> } }).__grid;
    expect(built?.data.currentDemandMW).toBe(0);
    expect(built?.data.gridFrequencyHz).toBeUndefined();
    expect(built?.data.totalCapacityMW).toBeUndefined();
    expect(built?.data.renewablePercent).toBeUndefined();
  });

  it('shows Not recorded for an empty snapshot and does not call a missing frequency stable', () => {
    render(<EnergyGridCalcPanel />);
    expect(screen.getByText('Not recorded: demand, capacity, renewable share, frequency')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('high-load')).toBeInTheDocument();
    expect(screen.getByText('Not recorded: frequency')).toBeInTheDocument();
    expect(screen.getByText(/\(not recorded\)/)).toBeInTheDocument();
    expect(screen.queryByText(/stable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/deviating/)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0%$/)).not.toBeInTheDocument();
  });
});
