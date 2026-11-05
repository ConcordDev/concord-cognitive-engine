/**
 * World Model full-lens build (GB-1021) — frontend behaviour tests.
 *
 * Pins: S1 — substrate deletes are two-step with the consequence stated
 * (a connected entity's confirm names its relation cascade), the item
 * leaves the view at once, NOTHING is deleted server-side inside the
 * undo window, Undo restores it, and the commit fires only when the
 * window lapses. S2 — Simulate and Compare render the per-entity
 * numbers the sim record already holds (B's final value, which the
 * walked surface could not show at all).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/dtu/DTUPickerModal', () => ({ DTUPickerModal: () => null }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { EntitiesPanel } from '@/components/worldmodel/EntitiesPanel';
import { SimulatePanel } from '@/components/worldmodel/SimulatePanel';
import { ComparePanel } from '@/components/worldmodel/ComparePanel';
import { DeleteReceiptToast } from '@/components/worldmodel/DeleteSafety';
import { requestDelete, undoDelete, resetDeleteSafetyForTests } from '@/components/worldmodel/delete-safety-store';

const envelope = (result: unknown) => ({ data: { ok: true, result, error: null } });

const ENTITIES = [
  { id: 'ent_a', name: 'PR2WM-A', type: 'concept', attributes: { value: 100 } },
  { id: 'ent_b', name: 'PR2WM-B', type: 'concept', attributes: { value: 50 } },
];
const RELATIONS = [{ id: 'rel_1', from: 'ent_a', to: 'ent_b', type: 'relates_to', weight: 0.5 }];

const SIM = {
  id: 'sim_1', name: 'forward run', mode: 'scenario', total: 321.9005,
  params: { steps: 10, growth: 0.05, shocks: [] },
  entityNames: { ent_a: 'PR2WM-A', ent_b: 'PR2WM-B' },
  trajectory: [
    { step: 0, ent_a: 100, ent_b: 50 },
    { step: 10, ent_a: 162.8894, ent_b: 159.0111 },
  ],
  finalState: { ent_a: 162.8894, ent_b: 159.0111 },
};

function dispatcher(_domain: string, action: string, input: Record<string, unknown> = {}) {
  switch (action) {
    case 'wm_list_entities': return envelope({ entities: ENTITIES, total: 2 });
    case 'wm_list_relations': return envelope({ relations: RELATIONS, total: 1 });
    case 'list_entity_types': return envelope({ types: [], total: 0 });
    case 'list_sims': return envelope({ simulations: [], total: 0 });
    case 'run_scenario': return envelope(SIM);
    case 'get_sim': return envelope(SIM);
    case 'compare_scenarios': return envelope({
      steps: 10,
      entityNames: { ent_a: 'PR2WM-A', ent_b: 'PR2WM-B' },
      baseline: { trajectory: SIM.trajectory, finalState: { ent_a: 162.8894, ent_b: 159.0111 }, total: 321.9005 },
      counterfactual: { trajectory: SIM.trajectory, finalState: { ent_a: 221.964, ent_b: 190.5 }, total: 412.464 },
      delta: [{ step: 0, ent_a: 0, ent_b: 0 }, { step: 10, ent_a: 59.0746, ent_b: 31.4889 }],
      totalSwing: 90.5635,
      verdict: 'counterfactual outperforms baseline',
    });
    case 'wm_delete_entity': return envelope({ deleted: input.id, relationsRemoved: 1 });
    default: return envelope({});
  }
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (d: string, a: string, i?: Record<string, unknown>) => dispatcher(d, a, i));
  resetDeleteSafetyForTests();
});
afterEach(() => { vi.useRealTimers(); });

describe('S1 — the substrate guard', () => {
  it('a connected entity’s confirm states the cascade; Undo inside the window means nothing was deleted', async () => {
    render(wrap(<><EntitiesPanel /><DeleteReceiptToast /></>));
    await waitFor(() => expect(screen.getByText('PR2WM-A')).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText('Delete entity')[0]);
    // The definition is stated BEFORE anything happens:
    expect(await screen.findByText(/also deletes its 1 relation/)).toBeInTheDocument();
    expect(screen.getByText(/Snapshots and saved runs keep their own copies/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByLabelText('Confirm delete PR2WM-A')); });
    // The item leaves the view at once, the receipt offers Undo…
    expect(screen.queryByText('PR2WM-A')).toBeNull();
    expect(await screen.findByText(/Deleting “PR2WM-A”/)).toBeInTheDocument();
    // …and the delete macro has NOT run — the window is still open.
    expect(lensRun.mock.calls.some((c) => c[1] === 'wm_delete_entity')).toBe(false);
    await act(async () => { fireEvent.click(screen.getByText('Undo')); });
    await waitFor(() => expect(screen.getByText('PR2WM-A')).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[1] === 'wm_delete_entity')).toBe(false);
  });

  it('the commit fires only when the window lapses', async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => {});
    act(() => { requestDelete({ key: 'entity:x', label: 'X', commit }); });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(8100); });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('undoDelete cancels the commit outright', async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => {});
    act(() => { requestDelete({ key: 'entity:y', label: 'Y', commit }); });
    act(() => { undoDelete('entity:y'); });
    await act(async () => { vi.advanceTimersByTime(8100); });
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('S2 — show the numbers', () => {
  it('Simulate renders every entity’s start, final, and change beside the chart', async () => {
    render(wrap(<SimulatePanel />));
    await waitFor(() => expect(screen.getByRole('button', { name: /Run/ })).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Run/ })); });
    // B's final value — the number the walked surface could not show:
    expect(await screen.findByText('159.0111')).toBeInTheDocument();
    expect(screen.getByText('162.8894')).toBeInTheDocument();
    expect(screen.getByText(/How a run advances/)).toBeInTheDocument();
  });

  it('Compare renders per-entity final values for both scenarios', async () => {
    render(wrap(<ComparePanel />));
    const btn = await screen.findByRole('button', { name: /Compare/ });
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText('Per-entity final values')).toBeInTheDocument();
    expect(screen.getByText('221.964')).toBeInTheDocument();
    expect(screen.getByText('159.0111')).toBeInTheDocument();
  });
});
