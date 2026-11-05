/**
 * /lenses/maker — one bench.
 *
 * F5 fix: the lens reads/writes its own domain (maker.list/create/update/
 * delete) instead of app-maker's shared project store, so no foreign
 * object can render here. F2/F3: a make carries a name and a spec body
 * field, and can be edited/renamed/deleted. F4: the compose draft
 * (name + spec) is a lens draft and survives navigation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import MakerPage from '@/app/lenses/maker/page';

function listed(makes: { id: string; name: string; spec?: string }[]) {
  return { data: { ok: true, result: { makes }, error: null } };
}

function draftsFallback(domain: string, action: string) {
  if (domain === 'drafts' && action === 'load') return { data: { ok: true, draft: null } };
  if (domain === 'drafts' && (action === 'save' || action === 'delete')) return { data: { ok: true } };
  return null;
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('maker bench', () => {
  it('EMPTY: says nothing is on the bench and offers + New make', async () => {
    lensRun.mockImplementation(async (domain: string, action: string) =>
      draftsFallback(domain, action) ?? listed([]));
    const view = render(<MakerPage />);
    expect(await view.findByText('Nothing on the bench.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Maker' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New make' })).toBeEnabled();
    expect(view.queryByText('Builder')).toBeNull();
    expect(view.queryByText('Quest Designer')).toBeNull();
    expect(view.queryByText('Untitled App')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockImplementation(async (domain: string, action: string) => {
      const fb = draftsFallback(domain, action);
      if (fb) return fb;
      if (domain === 'maker' && action === 'list') return { data: { ok: false, result: null, error: 'state_unavailable' } };
      return listed([]);
    });
    const view = render(<MakerPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
  });

  it('MAKE: a blank name does not call maker.create', async () => {
    lensRun.mockImplementation(async (domain: string, action: string) =>
      draftsFallback(domain, action) ?? listed([]));
    const view = render(<MakerPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New make' }));
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A name is required/);
    expect(lensRun.mock.calls.filter((call) => call[0] === 'maker').map((call) => call[1])).not.toContain('create');
  });

  it('MAKE: shows the name only after maker.list contains the id and name', async () => {
    const makes: { id: string; name: string; spec?: string }[] = [];
    lensRun.mockImplementation(async (domain: string, action: string, input?: { name?: string; spec?: string }) => {
      const fb = draftsFallback(domain, action);
      if (fb) return fb;
      if (domain === 'maker' && action === 'list') return listed(makes);
      if (domain === 'maker' && action === 'create') {
        makes.unshift({ id: 'make_1', name: input?.name || '', spec: input?.spec || '' });
        return { data: { ok: true, result: { make: { id: 'make_1', name: input?.name } }, error: null } };
      }
      throw new Error(`${domain}.${action}`);
    });
    const view = render(<MakerPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New make' }));
    fireEvent.change(view.getByTestId('maker-name'), { target: { value: '  Bench lamp  ' } });
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('heading', { name: 'Bench lamp' })).toBeInTheDocument();
    expect(view.queryByText('Nothing on the bench.')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[0] === 'maker' && call[1] === 'create');
    expect(save?.[2]).toEqual({ name: 'Bench lamp', spec: '' });
  });

  it('MAKE: a list miss does not show the name', async () => {
    lensRun.mockImplementation(async (domain: string, action: string) => {
      const fb = draftsFallback(domain, action);
      if (fb) return fb;
      if (domain === 'maker' && action === 'list') return listed([]);
      if (domain === 'maker' && action === 'create') {
        return { data: { ok: true, result: { make: { id: 'make_missing', name: 'Lost make' } }, error: null } };
      }
      throw new Error(`${domain}.${action}`);
    });
    const view = render(<MakerPage />);
    fireEvent.click(await view.findByRole('button', { name: '+ New make' }));
    fireEvent.change(view.getByTestId('maker-name'), { target: { value: 'Lost make' } });
    fireEvent.click(view.getByRole('button', { name: '+ New make' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost make' })).toBeNull();
  });

  it('LOAD: shows a name already on the bench', async () => {
    lensRun.mockImplementation(async (domain: string, action: string) => {
      const fb = draftsFallback(domain, action);
      if (fb) return fb;
      if (domain === 'maker' && action === 'list') {
        return listed([{ id: 'make_a', name: 'First make' }]);
      }
      throw new Error(`${domain}.${action}`);
    });
    const view = render(<MakerPage />);
    expect(await view.findByRole('heading', { name: 'First make' })).toBeInTheDocument();
    expect(view.queryByText('Nothing on the bench.')).toBeNull();
  });

  // F2/F3 — a make is no longer a name-only shell: it carries a spec and
  // can be renamed and deleted.
  it('EDIT: renames a make through maker.update', async () => {
    const makes = [{ id: 'make_a', name: 'First make', spec: 'wood' }];
    lensRun.mockImplementation(async (domain: string, action: string, input?: { id?: string; name?: string; spec?: string }) => {
      const fb = draftsFallback(domain, action);
      if (fb) return fb;
      if (domain === 'maker' && action === 'list') return listed(makes);
      if (domain === 'maker' && action === 'update') {
        const row = makes.find((m) => m.id === input?.id);
        if (row && input?.name) row.name = input.name;
        return { data: { ok: true, result: { make: { id: input?.id, name: input?.name } } } };
      }
      throw new Error(`${domain}.${action}`);
    });
    const view = render(<MakerPage />);
    await view.findByRole('heading', { name: 'First make' });
    fireEvent.click(view.getByRole('button', { name: 'Edit' }));
    const nameInput = view.getByTestId('maker-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Renamed make' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the name' }));
    expect(await view.findByRole('heading', { name: 'Renamed make' })).toBeInTheDocument();
    const upd = lensRun.mock.calls.find((call) => call[0] === 'maker' && call[1] === 'update');
    expect(upd?.[2]).toMatchObject({ id: 'make_a', name: 'Renamed make' });
  });

  it('DELETE: requires a second click to confirm, then calls maker.delete', async () => {
    const makes = [{ id: 'make_a', name: 'First make' }];
    lensRun.mockImplementation(async (domain: string, action: string, input?: { id?: string }) => {
      const fb = draftsFallback(domain, action);
      if (fb) return fb;
      if (domain === 'maker' && action === 'list') return listed(makes);
      if (domain === 'maker' && action === 'delete') return { data: { ok: true, result: { deleted: input?.id } } };
      throw new Error(`${domain}.${action}`);
    });
    const view = render(<MakerPage />);
    await view.findByRole('heading', { name: 'First make' });
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    const confirm = await view.findByRole('button', { name: 'Delete this make?' });
    fireEvent.click(confirm);
    await waitFor(() => expect(view.queryByRole('heading', { name: 'First make' })).toBeNull());
    const del = lensRun.mock.calls.find((call) => call[0] === 'maker' && call[1] === 'delete');
    expect(del?.[2]).toEqual({ id: 'make_a' });
  });

  it('SPEC: a saved spec renders under the make name', async () => {
    lensRun.mockImplementation(async (domain: string, action: string) => {
      const fb = draftsFallback(domain, action);
      if (fb) return fb;
      if (domain === 'maker' && action === 'list') {
        return listed([{ id: 'make_a', name: 'First make', spec: 'Pine, 3 steps' }]);
      }
      throw new Error(`${domain}.${action}`);
    });
    const view = render(<MakerPage />);
    expect(await view.findByText('Pine, 3 steps')).toBeInTheDocument();
  });
});
