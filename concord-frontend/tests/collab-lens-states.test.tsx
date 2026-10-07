/**
 * /lenses/collab — one room.
 *
 * Open a room calls collab.room-open and shows the title only after
 * room-list contains that id and the same title, and the note only
 * after room-detail returns it. Participants stay off the card.
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

import CollabLensPage from '@/app/lenses/collab/page';

function listed(rows: { id: string; title: string }[]) {
  return { data: { ok: true, result: { rooms: rows, count: rows.length }, error: null } };
}

function opened(id: string, note: string) {
  return { data: { ok: true, result: { room: { id, title: 'kept', note } }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('collab room card', () => {
  it('EMPTY: says no room open and nothing selected', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    expect(await view.findByText('No room open.')).toBeInTheDocument();
    expect(view.getByText('Nothing selected.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The room' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Open a room' })).toBeEnabled();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('Invitations')).toBeNull();
  });

  it('WARMING: a shed room-list retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    expect(await view.findByText('No room open.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<CollabLensPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No room open.')).toBeInTheDocument();
  });

  it('does not send a blank title', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a room' }));
    fireEvent.click(view.getByRole('button', { name: 'Open a room' }));
    expect(view.getByText('A title is required.')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('does not send a blank note', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a room' }));
    fireEvent.change(view.getByTestId('cb-title'), { target: { value: 'Design jam' } });
    fireEvent.click(view.getByRole('button', { name: 'Open a room' }));
    expect(view.getByText('A note is required.')).toBeInTheDocument();
    expect(lensRun.mock.calls.some((call) => call[1] === 'room-open')).toBe(false);
  });

  it('shows the title and the note only after list and detail match', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a room' }));
    fireEvent.change(view.getByTestId('cb-title'), { target: { value: 'Design jam' } });
    fireEvent.change(view.getByTestId('cb-note-input'), { target: { value: 'the hinge note' } });
    lensRun.mockImplementation((domain: string, name: string) => {
      if (name === 'room-open') {
        return Promise.resolve({ data: { ok: true, result: { roomId: 'rm_door' }, error: null } });
      }
      if (name === 'room-list') return Promise.resolve(listed([{ id: 'rm_door', title: 'Design jam' }]));
      if (name === 'room-detail') return Promise.resolve(opened('rm_door', 'the hinge note'));
      return Promise.resolve({ data: { ok: false, result: null, error: `unexpected ${domain}.${name}` } });
    });
    fireEvent.click(view.getByRole('button', { name: 'Open a room' }));
    expect(await view.findByRole('heading', { name: 'Design jam' })).toBeInTheDocument();
    expect(view.getByTestId('cb-note')).toHaveTextContent('the hinge note');
    expect(view.queryByText('No room open.')).toBeNull();
    expect(view.queryByText('Nothing selected.')).toBeNull();
    const choose = lensRun.mock.calls.find((call) => call[1] === 'room-open');
    expect(choose?.[2]).toEqual({ title: 'Design jam', note: 'the hinge note' });
  });

  it('stays on the composer when the list misses the new id', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a room' }));
    fireEvent.change(view.getByTestId('cb-title'), { target: { value: 'Design jam' } });
    fireEvent.change(view.getByTestId('cb-note-input'), { target: { value: 'the hinge note' } });
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'room-open') {
        return Promise.resolve({ data: { ok: true, result: { roomId: 'rm_door' }, error: null } });
      }
      if (name === 'room-list') return Promise.resolve(listed([]));
      return Promise.resolve(opened('rm_door', 'the hinge note'));
    });
    fireEvent.click(view.getByRole('button', { name: 'Open a room' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.getByTestId('cb-title')).toBeInTheDocument();
  });

  it('greets the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    expect(await view.findByRole('heading', { name: 'The room, Ramaj' })).toBeInTheDocument();
  });

  it('stays on the composer when open is refused', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open a room' }));
    fireEvent.change(view.getByTestId('cb-title'), { target: { value: 'Design jam' } });
    fireEvent.change(view.getByTestId('cb-note-input'), { target: { value: 'the hinge note' } });
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'room_not_saved' } });
    fireEvent.click(view.getByRole('button', { name: 'Open a room' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/room_not_saved/);
    expect(view.getByTestId('cb-title')).toBeInTheDocument();
  });
});
