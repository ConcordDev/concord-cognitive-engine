import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — engineering premise exercises (FIX-engineering-002/-012):
// drive the REAL provider + ModelPanel. An unreferenced node's delete
// must reach model-save with the node gone; a referenced node's delete
// must be refused in words; the armed confirm must offer a Cancel and
// dismiss on Escape.

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: () => {} }),
  useRecallableAction: () => ({ run: async (fn: () => unknown) => fn() }),
  RecallSlot: () => null,
}));

import { EngineeringFeaProvider } from '@/components/engineering/EngineeringFeaProvider';
import { ModelPanel } from '@/components/engineering/ModelPanel';
import { EngineeringActionPanel } from '@/components/engineering/EngineeringActionPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function saves() {
  return lensRun.mock.calls.filter((c) => c[1] === 'model-save');
}

const MODEL = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'NX', x: 5, y: 0, z: 0 },
  ],
  members: [
    { id: 'M1', nodeI: 'N1', nodeJ: 'NX', area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600, material: 'A36 Steel' },
  ],
  loads: [],
  supports: [{ nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] }],
};

function route() {
  return (_d: string, action: string) => {
    switch (action) {
      case 'model-get': return ok({ model: MODEL, updatedAt: null });
      case 'workspace-get': return ok({ state: null });
      case 'model-save': return ok({ updatedAt: 'now', counts: { nodes: 1, members: 1, loads: 0, supports: 1 } });
      case 'materialLibrary': return ok({ materials: [], categories: [] });
      case 'listLoadCases': return ok({ loadCases: [] });
      default: return ok({});
    }
  };
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(route());
});

function mount() {
  return render(
    <EngineeringFeaProvider>
      <ModelPanel />
    </EngineeringFeaProvider>,
  );
}

describe('ModelPanel node delete (FIX-engineering-002/-012)', () => {
  it('a referenced node (member + support) is refused in words and never saved away', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete N1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete N1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/N1 is not deleted/);
    expect(await screen.findByRole('alert')).toHaveTextContent(/support/);
    // The node still renders, and no save carried a model without it.
    expect(screen.getByRole('button', { name: 'Delete N1' })).toBeInTheDocument();
    for (const c of saves()) {
      expect((c[2] as { model: { nodes: { id: string }[] } }).model.nodes.map((n) => n.id)).toContain('N1');
    }
  });

  it('an unreferenced node deletes and the deletion is what model-save persists', async () => {
    // NX is referenced by member M1 here, so use a model where the
    // second node stands alone.
    lensRun.mockImplementation(((_d: string, action: string) => {
      if (action === 'model-get') {
        return ok({
          model: {
            nodes: MODEL.nodes,
            members: [],
            loads: [],
            supports: [{ nodeId: 'N1', type: 'fixed', fixedDOF: ['x'] }],
          },
          updatedAt: null,
        });
      }
      return route()(_d, action);
    }) as never);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete NX' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete NX' }));
    await waitFor(() => expect(saves().length).toBeGreaterThan(0), { timeout: 3000 });
    const last = saves()[saves().length - 1][2] as { model: { nodes: { id: string }[] } };
    expect(last.model.nodes.map((n) => n.id)).toEqual(['N1']);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete NX' })).not.toBeInTheDocument());
  });

  it('FIX-engineering-004: removing a part marks the AI review stale (the result already self-marks)', async () => {
    const tolSig = JSON.stringify([['Shaft QA', 50, 0.02], ['Bushing', 49.9, 0.01]]);
    const bench = {
      tolParts: [
        { name: 'Shaft QA', nominal: 50, tolerance: 0.02 },
        { name: 'Bushing', nominal: 49.9, tolerance: 0.01 },
      ],
      tolResult: {
        parts: [
          { part: 'Shaft QA', nominal: 50, tolerance: 0.02, min: 49.98, max: 50.02, toleranceClass: 'fine' },
          { part: 'Bushing', nominal: 49.9, tolerance: 0.01, min: 49.89, max: 49.91, toleranceClass: 'fine' },
        ],
        stackUp: { nominal: 99.9, worstCaseTolerance: 0.03, rssTolerance: 0.022, worstCaseMin: 99.87, worstCaseMax: 99.93 },
        method: 'worst-case + RSS',
      },
      tolSig,
      agentReply: 'The Shaft QA dominates the stack risk; loosen its tolerance first.',
      agentSig: JSON.stringify({ tol: tolSig, stress: ['', '', ''] }),
    };
    lensRun.mockImplementation(((_d: string, action: string, input?: { key?: string }) => {
      if (action === 'workspace-get' && input?.key === 'bench') return ok({ state: bench });
      if (action === 'workspace-get') return ok({ state: null });
      if (action === 'workspace-save') return ok({ saved: true });
      return ok({});
    }) as never);
    render(<EngineeringActionPanel />);
    expect(await screen.findByText(/The Shaft QA dominates the stack risk/)).toBeInTheDocument();
    expect(screen.queryByText(/may describe a part that is no longer on the bench/)).not.toBeInTheDocument();

    // Remove the Shaft QA row — the restored review must mark itself
    // stale rather than presenting the removed part as current.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove part' })[0]);
    expect(await screen.findByText(/may describe a part that is no longer on the bench/)).toBeInTheDocument();
  });

  it('the armed delete confirm offers Cancel and dismisses on Escape (FIX-engineering-012)', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete N1' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete N1' });
    expect(screen.getByRole('button', { name: 'Cancel delete N1' })).toBeInTheDocument();
    fireEvent.keyDown(confirm, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm delete N1' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete N1' })).toBeInTheDocument();
    expect(saves()).toHaveLength(0);
  });
});
