/**
 * Audit fix sweep — collab create-form tickets:
 *  - FIX-collab-002: real typing in the room title must keep every
 *    character in the title, with focus staying in the field.
 *  - FIX-collab-003: the title caps at 200 characters in the field,
 *    and a server length rejection reads as a plain sentence, never
 *    the validator's raw wording.
 *  - FIX-collab-004: a blank-title error is tied to the title field
 *    (aria-invalid + aria-describedby), not a detached alert.
 *  - FIX-collab-005: after creating a room, the status line names the
 *    room just saved — including the second one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import CollabLensPage from '@/app/lenses/collab/page';

interface StoredRoom { id: string; title: string; note: string }

function wireStore() {
  const rooms: StoredRoom[] = [];
  let seq = 0;
  lensRun.mockImplementation(async (_domain: string, name: string, input?: { title?: string; note?: string; id?: string }) => {
    if (name === 'room-list') {
      return { data: { ok: true, result: { rooms: rooms.map(({ id, title }) => ({ id, title })), count: rooms.length }, error: null } };
    }
    if (name === 'room-detail') {
      const room = rooms.find((r) => r.id === input?.id);
      return { data: { ok: true, result: { room }, error: null } };
    }
    if (name === 'room-open') {
      seq += 1;
      const room = { id: `r${seq}`, title: input?.title ?? '', note: input?.note ?? '' };
      rooms.unshift(room);
      return { data: { ok: true, result: { roomId: room.id, room: { id: room.id, title: room.title } }, error: null } };
    }
    throw new Error(`unexpected verb ${name}`);
  });
  return rooms;
}

async function openComposer(view: ReturnType<typeof render>) {
  const user = userEvent.setup();
  const openBtn = await view.findByRole('button', { name: 'Open a room' });
  await user.click(openBtn);
  return user;
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('collab create form (audit fixes)', () => {
  it('FIX-collab-002: typing a long title keeps every character and the focus', async () => {
    wireStore();
    const view = render(<CollabLensPage />);
    const user = await openComposer(view);
    const title = view.getByTestId('cb-title') as HTMLInputElement;
    await user.click(title);
    const text = 'Collab fulltest room 2026-11-09-a';
    await user.type(title, text);
    expect(title.value).toBe(text);
    expect(document.activeElement).toBe(title);
    expect((view.getByTestId('cb-note-input') as HTMLInputElement).value).toBe('');
  });

  it('FIX-collab-003: the title field caps at 200 characters', async () => {
    wireStore();
    const view = render(<CollabLensPage />);
    const user = await openComposer(view);
    const title = view.getByTestId('cb-title') as HTMLInputElement;
    expect(title.maxLength).toBe(200);
    await user.click(title);
    await user.type(title, 'x'.repeat(220));
    expect(title.value).toHaveLength(200);
    expect(view.getByText('200/200')).toBeInTheDocument();
  });

  it('FIX-collab-003: a server length rejection reads as a plain sentence', async () => {
    wireStore();
    lensRun.mockImplementation(async (_domain: string, name: string) => {
      if (name === 'room-list') {
        return { data: { ok: true, result: { rooms: [], count: 0 }, error: null } };
      }
      if (name === 'room-open') {
        return { data: { ok: false, result: null, error: 'Input too long: input.title: 301 chars (max 200)' } };
      }
      throw new Error(`unexpected verb ${name}`);
    });
    const view = render(<CollabLensPage />);
    const user = await openComposer(view);
    await user.type(view.getByTestId('cb-title'), 'A perfectly fine title');
    await user.type(view.getByTestId('cb-note-input'), 'A note');
    await user.click(view.getByRole('button', { name: 'Open a room' }));
    expect(await view.findByText('That title is too long — keep it to 200 characters or fewer.')).toBeInTheDocument();
    expect(view.queryByText(/Input too long/)).not.toBeInTheDocument();
  });

  it('FIX-collab-004: a blank title marks the field and ties the error to it', async () => {
    wireStore();
    const view = render(<CollabLensPage />);
    const user = await openComposer(view);
    await user.type(view.getByTestId('cb-note-input'), 'A note with no title');
    await user.click(view.getByRole('button', { name: 'Open a room' }));
    const title = view.getByTestId('cb-title');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title.getAttribute('aria-describedby')).toContain('cb-title-error');
    expect(view.getByText('A title is required.')).toHaveAttribute('id', 'cb-title-error');
  });

  it('FIX-collab-005: the status line names each room just saved, including the second', async () => {
    wireStore();
    const view = render(<CollabLensPage />);
    const user = await openComposer(view);
    await user.type(view.getByTestId('cb-title'), 'Room Alpha');
    await user.type(view.getByTestId('cb-note-input'), 'first note');
    await user.click(view.getByRole('button', { name: 'Open a room' }));
    expect(await view.findByText('Saved “Room Alpha”.')).toBeInTheDocument();

    await user.click(view.getByRole('button', { name: 'Open a room' }));
    await user.type(view.getByTestId('cb-title'), 'Room Beta');
    await user.type(view.getByTestId('cb-note-input'), 'second note');
    await user.click(view.getByRole('button', { name: 'Open a room' }));
    expect(await view.findByText('Saved “Room Beta”.')).toBeInTheDocument();
    expect(view.queryByText('Saved “Room Alpha”.')).not.toBeInTheDocument();
  });
});
