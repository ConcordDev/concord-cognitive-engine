// Engineering Calcs / Multi-physics / Actions tabs: inputs and latest results
// are restored from engineering.workspace-get on open and saved through
// engineering.workspace-save as the user works. Sample data that used to be
// pre-filled (a 12 V divider circuit, a shaft/bushing tolerance pair) is gone.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

type Call = { action: string; input: Record<string, unknown> };
const calls: Call[] = [];
let store: Record<string, unknown> = {};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((_d: string, action: string, input: Record<string, unknown>) => {
    calls.push({ action, input });
    if (action === 'workspace-get') return Promise.resolve({ data: { ok: true, result: { state: store[input.key as string] ?? null } } });
    if (action === 'workspace-save') { store[input.key as string] = input.state; return Promise.resolve({ data: { ok: true, result: { key: input.key } } }); }
    if (action === 'thermalAnalysis') {
      return Promise.resolve({ data: { ok: true, result: { ok: true, results: {
        heatLoad: { value: 1234, unit: 'BTU/h', formula: 'Q = A·ΔT/R + solar' },
        ductSize: { value: 7.8, unit: 'in' }, cooling: { value: 3000, unit: 'BTU/h' } } } } });
    }
    return Promise.resolve({ data: { ok: true, result: null } });
  }),
  api: { post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

vi.mock('@/components/engineering/EngineeringFeaProvider', () => ({
  useEngineeringFea: () => ({ model: { nodes: [], members: [], loads: [], supports: [] }, libMaterials: [] }),
}));

import { MultiDisciplineCalcPanel } from '@/components/engineering/MultiDisciplineCalcPanel';
import { MultiPhysicsPanel } from '@/components/engineering/MultiPhysicsPanel';
import { ActionsPanel } from '@/components/engineering/ActionsPanel';

beforeEach(() => { calls.length = 0; store = {}; });

describe('Engineering Calcs persistence', () => {
  it('restores a saved result and inputs, and does not save defaults over them on load', async () => {
    store['calcs.thermal'] = {
      inp: { deltaTemp: 44, rValue: 19, areaSqft: 900, solarGain: 0, cfm: 400, velocity: 1200, roomSqft: 200, occupants: 2, equipment: 300, windows: 2 },
      result: { heatLoad: { value: 2084.2, unit: 'BTU/h', formula: 'Q = A·ΔT/R + solar' }, ductSize: { value: 7.8, unit: 'in' }, cooling: { value: 3100, unit: 'BTU/h' } },
      resultAt: '2026-10-05T20:00:00Z',
    };
    render(<MultiDisciplineCalcPanel />);
    await waitFor(() => expect(screen.getByTestId('calc-thermal-at')).toBeTruthy());
    expect(screen.getByText(/2,084\.2/)).toBeTruthy();
    expect(screen.getAllByDisplayValue('44').length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 800));
    expect(calls.filter((c) => c.action === 'workspace-save' && c.input.key === 'calcs.thermal')).toHaveLength(0);
    expect(screen.getByTestId('calcs-note').textContent).toMatch(/example values/);
  });

  it('saves a new result after Run', async () => {
    render(<MultiDisciplineCalcPanel />);
    await waitFor(() => expect(screen.getByTestId('calc-thermal-save').getAttribute('data-state')).toBe('idle'));
    fireEvent.click(screen.getByText('Run Thermal Analysis'));
    await waitFor(() => expect((store['calcs.thermal'] as { result?: unknown })?.result).toBeTruthy(), { timeout: 3000 });
    expect((store['calcs.thermal'] as { resultAt?: string }).resultAt).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('calc-thermal-save').getAttribute('data-state')).toBe('saved'));
  });
});

describe('Engineering Multi-physics persistence', () => {
  it('starts with an empty circuit (no sample divider) and saves added elements', async () => {
    render(<MultiPhysicsPanel />);
    await waitFor(() => expect(screen.getByTestId('physics-save').getAttribute('data-state')).toBe('idle'));
    expect(screen.queryByDisplayValue('R2')).toBeNull();
    expect(screen.getByTestId('circuit-elements').textContent).toMatch(/No elements yet/);
    fireEvent.click(screen.getByText('V'));
    await waitFor(() => expect(((store['physics'] as { els?: unknown[] })?.els || []).length).toBe(1), { timeout: 3000 });
  });

  it('restores a saved circuit and its solved result', async () => {
    store['physics'] = {
      els: [{ id: 'V1', type: 'voltage_source', nodeA: 'N1', nodeB: 'GND', value: 9 }, { id: 'R1', type: 'resistor', nodeA: 'N1', nodeB: 'GND', value: 450 }],
      circuit: { value: { nodeVoltages: { N1: 9 }, branchCurrents: { R1: 0.02 }, powerByElement: { R1: 0.18 } }, at: '2026-10-05T20:01:00Z' },
    };
    render(<MultiPhysicsPanel />);
    await waitFor(() => expect(screen.getByTestId('physics-circuit-at')).toBeTruthy());
    expect(screen.getByDisplayValue('450')).toBeTruthy();
    expect(screen.getByText(/N1: 9\.000 V/)).toBeTruthy();
  });
});

describe('Engineering Actions bench persistence', () => {
  it('starts with no sample parts and restores saved parts and results', async () => {
    const { unmount } = render(<ActionsPanel />);
    await waitFor(() => expect(screen.getByTestId('bench-save').getAttribute('data-state')).toBe('idle'));
    expect(screen.queryByDisplayValue('Shaft dia')).toBeNull();
    unmount();
    store['bench'] = {
      tolParts: [{ name: 'Pin OD', nominal: 6, tolerance: 0.01 }],
      unitResult: { input: '25.4 mm', output: '1 in', conversion: 'mm → in' },
    };
    render(<ActionsPanel />);
    await waitFor(() => expect(screen.getByDisplayValue('Pin OD')).toBeTruthy());
    expect(screen.getByText('1 in')).toBeTruthy();
  });
});
