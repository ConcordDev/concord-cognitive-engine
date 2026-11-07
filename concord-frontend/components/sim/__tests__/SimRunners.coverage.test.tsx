// Render coverage for the simulation studio runners: each panel mounts against a
// permissive stubbed macro result and the generic sweep drives its handlers.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise, fakeEntity } from '../../../tests/helpers/exercise';
import {
  projectToScaffoldSpec, projectToScreens, projectToWireframe,
} from '@/lib/app-maker/project-to-compute-input';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) } },
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div data-testid="chart" /> }));
vi.mock('@/lib/sim/studio-activity', () => ({ recordStudioRun: vi.fn(), recordStudioModelSave: vi.fn() }));
vi.mock('@/hooks/useLensDraft', () => ({
  useLensDraft: () => ({ value: null, setValue: vi.fn(), save: vi.fn(), clear: vi.fn(), draft: null, status: 'idle' }),
}));

import { AgentBasedRunner } from '../AgentBasedRunner';
import { DiscreteEventRunner } from '../DiscreteEventRunner';
import { SystemDynamicsBuilder } from '../SystemDynamicsBuilder';
import { SimToolkit } from '../SimToolkit';

const series = Array.from({ length: 6 }, (_, i) => ({ t: i, step: i, time: i, value: i * 2, population: 10 - i }));
const stat = { n: 10, mean: 100, std: 2 };
const SIM: Record<string, Record<string, unknown>> = {
  evaluateFormula: { value: 42 },
  goalSeek: { solution: 3, achievedOutput: 9, residual: 0.1, converged: true, iterationCount: 2, objective: 'target', iterations: [{ iteration: 1, x: 1, output: 2, error: 1 }, { x: 3, output: 9 }] },
  scenarioDiff: { sampleA: stat, sampleB: stat, meanDifference: 1, percentChange: 2.5, tStatistic: 2, pValue: 0.01, significant: true, cohensD: 0.8, effectSize: 'large', verdict: 'different' },
  calibrate: { fitStock: 'infected', calibratedParameters: { spreadRate: 0.3 }, sse: 1, rmse: 0.5, rSquared: 0.99, pointsMatched: 3, fittedTrajectory: [{ t: 0, fitted: 10, observed: 10 }, { t: 1, fitted: 14, observed: null }] },
  scenarioRun: { stepsRun: 10, initialState: { a: 1 }, finalState: { a: 2 }, deltas: { a: { start: 1, end: 2, change: 1 } } },
  parameterSweep: { parameter: 'price', runsCompleted: 2, stepsPerRun: 10, results: [{ price: 10, inventory: 5 }, { price: 15, inventory: 4 }], bestOutcome: { price: 10 } },
  monteCarlo: { trials: 10, formula: 'sum', mean: 5, stddev: 1, min: 1, max: 9, percentiles: { p5: 1, p25: 2, p50: 5, p75: 7, p95: 9 }, confidenceInterval90: { lower: 1, upper: 9 } },
  sensitivityAnalysis: { outputField: 'units', baselineOutput: 10, mostSensitive: 'price', leastSensitive: 'units', sensitivity: [{ parameter: 'price', sensitivity: 1.2, direction: 'positive' }] },
};
const RESULT = (action: string): Record<string, unknown> => ({
  ...(fakeEntity(action) as object),
  ...(SIM[action] ?? {}),
  series, history: series, trajectory: series, steps: series, states: series, results: series, events: series,
  ok: true,
});

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...args: unknown[]) => ({ data: { ok: true, result: RESULT(actionOf(args)), error: null } }));
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe.each([
  ['AgentBasedRunner', AgentBasedRunner],
  ['DiscreteEventRunner', DiscreteEventRunner],
  ['SystemDynamicsBuilder', SystemDynamicsBuilder],
  ['SimToolkit', SimToolkit],
])('%s', (_name, Comp) => {
  it('renders and drives its controls', async () => {
    const view = render(<Comp />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
    await exercise({ passes: 3 });
    await settle();
  });

  it('survives an offline macro', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<Comp />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('SimToolkit tools', () => {
  it.each(['Formula', 'Goal Seek', 'Compare', 'Calibrate', 'Scenario Run', 'Param Sweep', 'Monte Carlo', 'Elasticity'])('walks the %s tool', async (label) => {
    render(<SimToolkit />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}$`) })); });
    await settle();
    await exercise({ passes: 3, skip: /^(formula|goal seek|compare|calibrate|scenario run|param sweep|monte carlo|elasticity)$|delete|remove|clear/i });
    await settle();
    expect(document.body.textContent).toBeTruthy();
  });
});

describe('project-to-compute-input', () => {
  const project = {
    id: 'p1', name: 'App',
    pages: [{ id: 'g1', name: 'Home', route: '', elements: [{ id: 'e1', type: 'Button', props: { label: 'x' } }, { id: 'e2', type: 'Text' }] }],
  };
  it('maps pages to scaffold, screens and wireframe shapes without inventing data', () => {
    expect(projectToScaffoldSpec(project)).toEqual({
      pages: [{ name: 'Home', path: '/home', components: [{ type: 'Button', props: { label: 'x' }, children: [] }, { type: 'Text', props: {}, children: [] }] }],
      auth: false,
    });
    expect(projectToScreens(project)[0].widgets).toHaveLength(2);
    expect(projectToWireframe(project).screens[0]).toEqual({ name: 'Home', links: [], actions: [] });
  });
});
