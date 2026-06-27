/// <reference types="@testing-library/jest-dom/vitest" />
// Behavior test for FoundryWorldsPanel — the page-level wiring surface that
// drives the foundry.{list,create,get,delete} macros via lensRun.
//
// Pins all FOUR required UX states as a pure function of the real macro
// result + a11y:
//   • loading   — role="status" while foundry.list is in flight
//   • error     — role="alert" + a Retry that re-calls foundry.list
//   • empty     — EmptyState CTA when list returns zero worlds
//   • populated — the worlds list, with a working delete round-trip
//
// lensRun + useLensData are mocked so the test is hermetic (no network).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
// useLensData reads the generic artifact store — stub it to a fixed total.
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ total: 3, items: [], isLoading: false }),
}));

import { FoundryWorldsPanel } from '@/components/foundry/FoundryWorldsPanel';

function env(result: unknown, ok = true, error: string | null = null) {
  return { data: { ok, result, error } };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('FoundryWorldsPanel — UX states', () => {
  it('loading: shows role="status" while foundry.list is in flight', async () => {
    const d = deferred<unknown>();
    lensRun.mockImplementation((_domain: string, name: string) =>
      name === 'list' ? d.promise : Promise.resolve(env({})),
    );
    render(<FoundryWorldsPanel />);
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    // resolve so we don't leak a pending promise
    d.resolve(env({ ok: true, worlds: [] }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('error: shows role="alert" + a Retry that re-calls foundry.list', async () => {
    let calls = 0;
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name !== 'list') return Promise.resolve(env({}));
      calls += 1;
      // first list fails, the retry succeeds with an empty world set
      return calls === 1
        ? Promise.resolve(env(null, false, 'backend down'))
        : Promise.resolve(env({ ok: true, worlds: [] }));
    });
    render(<FoundryWorldsPanel />);
    await screen.findByRole('alert');
    expect(screen.getByText(/backend down/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByText(/build a world from scratch/i);
    const listCalls = lensRun.mock.calls.filter((c) => c[1] === 'list');
    expect(listCalls.length).toBe(2);
  });

  it('empty: renders the EmptyState CTA when there are no worlds', async () => {
    lensRun.mockResolvedValue(env({ ok: true, worlds: [] }));
    render(<FoundryWorldsPanel />);
    await screen.findByText(/build a world from scratch/i);
    expect(screen.getByRole('button', { name: /create your first world/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/new world name/i)).toBeInTheDocument();
  });

  it('populated: lists worlds and deletes one via foundry.delete', async () => {
    const worlds = [
      { id: 'fw_1', name: 'Alpha World', description: 'first', status: 'draft', publishedWorldId: null, updatedAt: 2 },
      { id: 'fw_2', name: 'Beta World', description: '', status: 'published', publishedWorldId: 'world-xyz', updatedAt: 1 },
    ];
    lensRun.mockImplementation((_domain: string, name: string, input?: Record<string, unknown>) => {
      if (name === 'list') return Promise.resolve(env({ ok: true, worlds }));
      if (name === 'delete') return Promise.resolve(env({ ok: true, deleted: input?.id }));
      return Promise.resolve(env({}));
    });
    render(<FoundryWorldsPanel />);
    await screen.findByText('Alpha World');
    expect(screen.getByText('Beta World')).toBeInTheDocument();
    // published world surfaces an Open link to the live world
    expect(screen.getByRole('link', { name: /open/i }).getAttribute('href')).toContain('world-xyz');

    // delete the draft → it disappears, foundry.delete called with its id
    fireEvent.click(screen.getByRole('button', { name: /delete alpha world/i }));
    await waitFor(() => expect(screen.queryByText('Alpha World')).not.toBeInTheDocument());
    const delCall = lensRun.mock.calls.find((c) => c[1] === 'delete');
    expect(delCall?.[2]).toEqual({ id: 'fw_1' });

    // the published world's delete button is disabled (must unpublish first)
    expect(screen.getByRole('button', { name: /delete beta world/i })).toBeDisabled();
  });

  it('create: posts foundry.create then re-lists', async () => {
    let created = false;
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'list') {
        return Promise.resolve(env({
          ok: true,
          worlds: created
            ? [{ id: 'fw_new', name: 'Fresh World', description: '', status: 'draft', publishedWorldId: null, updatedAt: 9 }]
            : [],
        }));
      }
      if (name === 'create') { created = true; return Promise.resolve(env({ ok: true, world: { id: 'fw_new' } })); }
      return Promise.resolve(env({}));
    });
    render(<FoundryWorldsPanel />);
    await screen.findByText(/build a world from scratch/i);

    fireEvent.change(screen.getByLabelText(/new world name/i), { target: { value: 'Fresh World' } });
    fireEvent.click(screen.getByRole('button', { name: /create world/i }));

    await screen.findByText('Fresh World');
    const createCall = lensRun.mock.calls.find((c) => c[1] === 'create');
    expect(createCall?.[2]).toEqual({ name: 'Fresh World' });
  });
});
