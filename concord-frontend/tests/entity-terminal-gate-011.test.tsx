// FIX-entity-011 — the Entity Terminal tab presented as fully usable
// although terminal execution is operator-gated OFF by design (the
// server macro refuses with { disabled: true } before any validation
// or side effect). The only explanation arrived AFTER running a
// command, in raw operator wording. The tab now probes the gate on
// mount (an empty command is side-effect-free precisely because the
// gate answers first) and presents the state up front in member
// wording, with the input disabled.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: {
      runDomain: vi.fn(async () => ({
        data: { ok: false, disabled: true, error: 'Terminal execution is disabled. Set ENABLE_TERMINAL_EXEC=true to enable.' },
      })),
    },
  },
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {}, error: null } })),
}));

vi.mock('@/components/entity/entity-model', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/entity/entity-model')>();
  return {
    ...orig,
    wm: vi.fn(async () => ({
      entity: {
        id: 'ent_1', type: 'person', name: 'Ada', description: '',
        state: { confidence: 0.5, salience: 0.5, volatility: 0.5, properties: {} },
        createdAt: '', updatedAt: '',
      },
      relations: [],
    })),
  };
});

import { EntityInspector } from '@/components/entity/EntityInspector';

describe('Entity terminal gate presentation (FIX-entity-011)', () => {
  it('shows the operator-disabled explanation up front and disables the command input', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EntityInspector entityId="ent_1" others={[]} onSelect={() => {}} onDeleted={() => {}} onFork={() => {}} forking={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^terminal$/i }));
    expect(await screen.findByText(/Terminal execution is turned off on this server by the operator/)).toBeTruthy();
    const input = screen.getByLabelText('Terminal command') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.queryByText(/ENABLE_TERMINAL_EXEC/)).toBeNull();
  });
});
