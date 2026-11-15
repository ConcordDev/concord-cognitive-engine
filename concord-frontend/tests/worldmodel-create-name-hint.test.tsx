/**
 * FIX-worldmodel-003 — Create with an empty entity name "silently did
 * nothing": the button disabled itself on a blank name with no reason
 * anywhere (the server already refuses by name). The form now states
 * the requirement while the name is blank, and whitespace-only names
 * count as blank, matching the server's trim.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/dtu/DTUPickerModal', () => ({ DTUPickerModal: () => null }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { EntitiesPanel } from '@/components/worldmodel/EntitiesPanel';

const envelope = (result: unknown) => ({ data: { ok: true, result, error: null } });

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('FIX-worldmodel-003 — a blank entity name speaks', () => {
  it('shows the name-required note while blank and clears it once named', async () => {
    lensRun.mockReset();
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'wm_list_entities') return Promise.resolve(envelope({ entities: [], total: 0 }));
      if (action === 'wm_list_relations') return Promise.resolve(envelope({ relations: [], total: 0 }));
      if (action === 'list_entity_types') return Promise.resolve(envelope({ types: [], total: 0 }));
      return Promise.resolve(envelope({}));
    });
    render(wrap(<EntitiesPanel />));
    const create = await screen.findByRole('button', { name: /^create$/i });
    expect(screen.getByRole('note').textContent).toMatch(/give the entity a name/i);
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Entity name'), { target: { value: '   ' } });
    expect(screen.getByRole('note')).toBeTruthy();
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Entity name'), { target: { value: 'Harbour' } });
    expect(screen.queryByRole('note')).toBeNull();
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });
});
