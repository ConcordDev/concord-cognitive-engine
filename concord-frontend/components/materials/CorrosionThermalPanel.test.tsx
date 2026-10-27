/**
 * Clearing temperature or humidity must not invent 25 °C / 50 % RH,
 * and an unscored corrosion result must not render as undefined/100.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('lucide-react', () => ({ Cog: () => null, Droplet: () => null, Thermometer: () => null }));
vi.mock('@/components/lens-primitives/CalcPanel', () => ({
  CalcPanel: (props: {
    left: { render: ReactNode; buildArtifact: () => { data: { temperature: unknown; humidity: unknown } } };
    renderResults: (cor: Record<string, unknown> | null, therm: null) => ReactNode;
  }) => (
    <div>
      {props.left.render}
      <button type="button" onClick={() => { (globalThis as { __cor?: unknown }).__cor = props.left.buildArtifact(); }}>build</button>
      {props.renderResults({
        corrosionResistance: null,
        riskLevel: null,
        reason: 'not_recorded',
        unavailable: ['category'],
        protectionMethods: [],
      }, null)}
      {props.renderResults({
        corrosionResistance: 50,
        riskLevel: 'moderate',
        estimatedLifespan: '10-20 years',
        protectionMethods: [],
      }, null)}
    </div>
  ),
}));

import { CorrosionThermalPanel } from './CorrosionThermalPanel';

describe('CorrosionThermalPanel', () => {
  it('does not fill a cleared temperature with 25 °C or humidity with 50%', () => {
    render(<CorrosionThermalPanel />);
    const temp = screen.getByLabelText('Temperature (°C)') as HTMLInputElement;
    const humidity = screen.getByLabelText('Humidity (%)') as HTMLInputElement;
    expect(temp.value).toBe('');
    expect(humidity.value).toBe('');
    fireEvent.change(temp, { target: { value: '' } });
    fireEvent.change(humidity, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'build' }));
    const built = (globalThis as { __cor?: { data: { temperature: unknown; humidity: unknown } } }).__cor;
    expect(built?.data.temperature).toBe('');
    expect(built?.data.humidity).toBe('');
  });

  it('shows a dash reason for an unscored category and the real resistance when scored', () => {
    render(<CorrosionThermalPanel />);
    expect(screen.getByText('Not recorded: category')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('moderate')).toBeInTheDocument();
    expect(screen.getByText('10-20 years')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});
