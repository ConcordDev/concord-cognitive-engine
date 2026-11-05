/**
 * Clearing temperature or humidity must not invent 25 °C / 50 % RH,
 * and an unscored corrosion result must not render as undefined/100.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

// Thermal payload the CalcPanel mock hands to renderResults; each test sets it.
const fixtures = vi.hoisted(() => ({ therm: null as unknown }));

vi.mock('lucide-react', () => ({ Cog: () => null, Droplet: () => null, Thermometer: () => null }));
vi.mock('@/components/lens-primitives/CalcPanel', () => ({
  CalcPanel: (props: {
    left: { render: ReactNode; buildArtifact: () => { data: { temperature: unknown; humidity: unknown } } };
    right: { render: ReactNode; buildArtifact: () => { data: Record<string, unknown> } };
    renderResults: (cor: Record<string, unknown> | null, therm: unknown) => ReactNode;
  }) => (
    <div>
      {props.left.render}
      {props.right.render}
      <button type="button" onClick={() => { (globalThis as { __cor?: unknown }).__cor = props.left.buildArtifact(); }}>build</button>
      <button type="button" onClick={() => { (globalThis as { __therm?: unknown }).__therm = props.right.buildArtifact(); }}>build thermal</button>
      {props.renderResults({
        corrosionResistance: null,
        riskLevel: null,
        reason: 'not_recorded',
        unavailable: ['category'],
        protectionMethods: [],
      }, fixtures.therm)}
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
  beforeEach(() => {
    fixtures.therm = null;
  });

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

  it('shows Not recorded (not AT-RISK) for a NOT_COMPUTED thermal payload', () => {
    fixtures.therm = {
      status: 'NOT_COMPUTED',
      missingInputs: ['operatingTemp'],
      message: 'Thermal analysis needs operatingTemp (was assumed 25 °C).',
    };
    render(<CorrosionThermalPanel />);
    expect(screen.getByText('Not recorded: operating temperature')).toBeInTheDocument();
    expect(screen.queryByText(/AT-RISK/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SAFE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Safety margin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('reads the server margin string and shows SAFE only with a real margin and verdict', () => {
    fixtures.therm = {
      thermalClass: 'moderate',
      safetyMargin: '42%',
      isSafe: true,
      suitability: {},
      warnings: [],
    };
    render(<CorrosionThermalPanel />);
    expect(screen.getByText('Safety margin: 42% — SAFE')).toBeInTheDocument();
    expect(screen.queryByText(/AT-RISK/)).not.toBeInTheDocument();
  });

  it('shows AT-RISK when the computed margin is unsafe', () => {
    fixtures.therm = { thermalClass: 'insulator', safetyMargin: '-10%', isSafe: false, suitability: {}, warnings: [] };
    render(<CorrosionThermalPanel />);
    expect(screen.getByText('Safety margin: -10% — AT-RISK')).toBeInTheDocument();
  });

  it('shows a recorded class and withholds SAFE when the melt was not recorded', () => {
    fixtures.therm = {
      thermalClass: 'excellent-conductor',
      safetyMargin: null,
      isSafe: null,
      missingInputs: ['meltingPoint'],
      suitability: { 'heat-sink': 'excellent', insulation: null },
      warnings: [],
    };
    render(<CorrosionThermalPanel />);
    expect(screen.getByText('excellent-conductor')).toBeInTheDocument();
    expect(screen.getByText('Not recorded: melting point')).toBeInTheDocument();
    expect(screen.getByText('Safety margin: —')).toBeInTheDocument();
    expect(screen.getByText('not recorded')).toBeInTheDocument();
    expect(screen.queryByText(/SAFE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AT-RISK/)).not.toBeInTheDocument();
  });

  it('does not send a blank thermal property as zero', () => {
    render(<CorrosionThermalPanel />);
    const melt = screen.getByLabelText('Melting point (°C)') as HTMLInputElement;
    expect((screen.getByLabelText('Thermal cond. (W/mK)') as HTMLInputElement).value).toBe('');
    expect(melt.value).toBe('');
    fireEvent.change(melt, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'build thermal' }));
    const built = (globalThis as { __therm?: { data: Record<string, unknown> } }).__therm;
    expect(built?.data.meltingPoint).toBe(0);
    expect(built?.data.thermalConductivity).toBeUndefined();
    expect(built?.data.thermalExpansion).toBeUndefined();
    expect(built?.data.operatingTemp).toBeUndefined();
  });
});
