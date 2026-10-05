// Engineering working model persistence: the in-progress model (nodes,
// members, supports, loads) is stored server-side per user through
// engineering.model-get / engineering.model-save, so a reload or a server
// restart doesn't lose it. The empty initial state must never overwrite the
// stored model before it has been read back.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

type Call = { action: string; input: Record<string, unknown> };
const calls: Call[] = [];
let stored: unknown = null;

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((_domain: string, action: string, input: Record<string, unknown>) => {
    calls.push({ action, input });
    if (action === 'model-get') {
      return Promise.resolve({ data: { ok: true, result: { model: stored, updatedAt: stored ? '2026-10-05T19:00:00Z' : null } } });
    }
    if (action === 'model-save') {
      stored = input.model;
      return Promise.resolve({ data: { ok: true, result: { updatedAt: 'now' } } });
    }
    return Promise.resolve({ data: { ok: true, result: { materials: [], categories: [], loadCases: [] } } });
  }),
}));

import { EngineeringFeaProvider } from '@/components/engineering/EngineeringFeaProvider';
import { ModelPanel } from '@/components/engineering/ModelPanel';

const savedModel = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'N2', x: 10, y: 0, z: 0 },
  ],
  members: [
    { id: 'M1', nodeI: 'N1', nodeJ: 'N2', area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600, material: 'A36 Steel' },
  ],
  supports: [{ nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] }],
  loads: [{ nodeId: 'N2', Fy: -1000 }],
};

function mount() {
  return render(
    <EngineeringFeaProvider>
      <ModelPanel />
    </EngineeringFeaProvider>,
  );
}

describe('Engineering working model persistence', () => {
  beforeEach(() => {
    calls.length = 0;
    stored = null;
  });

  it('loads the stored model on mount and does not echo it straight back', async () => {
    stored = savedModel;
    mount();
    await waitFor(() => expect(screen.getByTestId('model-save-state').textContent).toBe('Saved to your account'));
    expect(screen.getByDisplayValue('10')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    expect(calls.filter((c) => c.action === 'model-save')).toHaveLength(0);
  });

  it('saves edits to the account after a short debounce', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('model-save-state').getAttribute('data-state')).toBe('idle'));
    expect(calls.filter((c) => c.action === 'model-save')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Node/ }));
    await waitFor(() => expect(screen.getByTestId('model-save-state').textContent).toBe('Saved to your account'), { timeout: 2000 });
    const saves = calls.filter((c) => c.action === 'model-save');
    expect(saves).toHaveLength(1);
    expect((saves[0].input.model as { nodes: unknown[] }).nodes).toHaveLength(1);
  });
});
