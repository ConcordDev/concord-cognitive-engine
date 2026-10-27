/**
 * Clearing a solar field must not invent 1000 sq ft / 5 sun hours / 900 kWh,
 * and a not_recorded quote must render as a dash plus the missing fields.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('lucide-react', () => ({ Sun: () => null, Leaf: () => null, Zap: () => null }));
vi.mock('@/components/lens-primitives/CalcPanel', () => ({
  CalcPanel: (props: {
    left: { render: ReactNode; buildArtifact: () => { data: Record<string, unknown> } };
    renderResults: (solar: Record<string, unknown>, carbon: null) => ReactNode;
  }) => (
    <div>
      {props.left.render}
      <button type="button" onClick={() => { (globalThis as { __solar?: unknown }).__solar = props.left.buildArtifact(); }}>build</button>
      {props.renderResults({
        maxPanels: null,
        systemSizeKW: null,
        monthlyProductionKWh: null,
        coveragePercent: null,
        estimatedCost: null,
        afterTaxCredit: null,
        annualSavings: null,
        paybackYears: null,
        reason: 'not_recorded',
        unavailable: ['roofAreaSqFt', 'peakSunHours', 'monthlyUsageKWh'],
      }, null)}
    </div>
  ),
}));

import { SolarCarbonPanel } from './SolarCarbonPanel';

describe('SolarCarbonPanel', () => {
  it('does not fill an empty roof with 1000 sq ft', () => {
    render(<SolarCarbonPanel />);
    const roof = screen.getByLabelText('Roof area (sq ft)') as HTMLInputElement;
    expect(roof.value).toBe('');
    fireEvent.change(roof, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'build' }));
    const built = (globalThis as { __solar?: { data: { roofAreaSqFt: unknown } } }).__solar;
    expect(built?.data.roofAreaSqFt).toBe('');
  });

  it('shows a dash and the missing site fields', () => {
    render(<SolarCarbonPanel />);
    expect(screen.getByText(/Site not recorded: roofAreaSqFt, peakSunHours, monthlyUsageKWh/)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('null%')).not.toBeInTheDocument();
  });
});
