/**
 * /lenses/photography — one roll.
 *
 * Import a roll calls photography.shoot-create and shows the name and
 * the filename only after shoot-list contains that id, the same name,
 * and the same filename. Date, location, and client stay off the card.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

import PhotographyLens from '@/app/lenses/photography/page';

function listed(shoots: { id: string; name: string; frames?: { id: string; filename: string }[]; date?: string | null; location?: string | null; client?: string | null }[]) {
  return { data: { ok: true, result: { shoots, count: shoots.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('photography card', () => {
  it('EMPTY: says no roll is loaded and offers Import a roll', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    expect(await view.findByText('No roll loaded.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The roll' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Import a roll' })).toBeEnabled();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('Catalog')).toBeNull();
    expect(view.queryByText('Develop')).toBeNull();
  });

  it('WARMING: a shed shoot-list retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    expect(await view.findByText('No roll loaded.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No roll loaded.')).toBeInTheDocument();
  });

  it('ROLL: a blank name does not call shoot-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    expect(view.queryByText('No roll loaded.')).toBeNull();
    fireEvent.change(view.getByTestId('ph-filename'), { target: { value: 'door.jpg' } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A name is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('shoot-create');
  });

  it('ROLL: a blank filename does not call shoot-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: 'Door roll' } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A filename is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('shoot-create');
  });

  it('ROLL: shows the name and filename only after shoot-list matches', async () => {
    const shoots: { id: string; name: string; frames: { id: string; filename: string }[] }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { name?: string; frames?: string[] }) => {
      if (action === 'shoot-list') return listed(shoots);
      if (action === 'shoot-create') {
        const filename = input?.frames?.[0] || '';
        shoots.unshift({ id: 'sht_1', name: input?.name || '', frames: [{ id: 'img_1', filename }] });
        return { data: { ok: true, result: { shoot: { id: 'sht_1', name: input?.name } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: '  Door roll  ' } });
    fireEvent.change(view.getByTestId('ph-filename'), { target: { value: '  door.jpg  ' } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('heading', { name: 'Door roll' })).toBeInTheDocument();
    expect(view.getByText('door.jpg')).toBeInTheDocument();
    expect(view.queryByText('No roll loaded.')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'shoot-create');
    expect(save?.[0]).toBe('photography');
    expect(save?.[2]).toEqual({ name: 'Door roll', frames: ['door.jpg'] });
  });

  it('ROLL: a list miss does not show the name', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'shoot-list') return listed([]);
      if (action === 'shoot-create') {
        return { data: { ok: true, result: { shoot: { id: 'sht_missing', name: 'Lost roll' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: 'Lost roll' } });
    fireEvent.change(view.getByTestId('ph-filename'), { target: { value: 'lost.jpg' } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost roll' })).toBeNull();
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'The roll, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('No roll loaded.')).toBeInTheDocument();
  });

  it('LOAD: shows a stored name and filename and hides date, location, and client', async () => {
    lensRun.mockResolvedValue(listed([
      {
        id: 'sht_a',
        name: 'First roll',
        frames: [{ id: 'img_a', filename: 'first.jpg' }],
        date: '1999-01-01',
        location: 'Lisbon',
        client: 'Acme Client',
      },
      { id: 'sht_b', name: '   ', frames: [] },
    ]));
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'First roll' })).toBeInTheDocument();
    expect(view.getByText('first.jpg')).toBeInTheDocument();
    expect(view.queryByText('No roll loaded.')).toBeNull();
    expect(view.queryByText('1999-01-01')).toBeNull();
    expect(view.queryByText('Lisbon')).toBeNull();
    expect(view.queryByText('Acme Client')).toBeNull();
  });

  it('ROLL: a refused create does not show the name', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'shoot-list') return listed([]);
      if (action === 'shoot-create') return { data: { ok: false, result: null, error: 'roll_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: 'Bad roll' } });
    fireEvent.change(view.getByTestId('ph-filename'), { target: { value: 'bad.jpg' } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/roll_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad roll' })).toBeNull();
    expect(view.getByTestId('ph-name')).toBeInTheDocument();
  });
});
