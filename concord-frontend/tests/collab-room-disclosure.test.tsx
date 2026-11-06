/**
 * Collab D3 (repriced, Lead ruling 2026-11-06) — the room states what
 * a room is, on the room surface, before the user types.
 *
 * Premise correction of record: at the pass (2026-10-31) the room was
 * session-scoped and said nothing; the rebuild has since landed
 * persistence (collab_rooms, migration 463 — rooms survive restart,
 * pinned by server/tests/collab-room-restart.test.js), so the evolved
 * sentence states the true scope: saved to the account, listed on
 * return. These tests pin the sentence's presence in every room
 * state — empty, populated, and composing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

const SENTENCE =
  'A room is a title and a note, saved to your account and listed here when you return.';

function listed(rows: { id: string; title: string }[]) {
  return { data: { ok: true, result: { rooms: rows, count: rows.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('collab room disclosure (D3)', () => {
  it('EMPTY: the sentence stands on the room surface before anything is typed', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    expect(await view.findByText('No room open.')).toBeInTheDocument();
    expect(view.getByTestId('cb-room-about')).toHaveTextContent(SENTENCE);
  });

  it('POPULATED: the sentence stays when the saved rooms list', async () => {
    lensRun.mockImplementation(async (_domain: string, name: string) => {
      if (name === 'room-list') return listed([{ id: 'r1', title: 'Kept room' }]);
      if (name === 'room-detail') {
        return { data: { ok: true, result: { room: { id: 'r1', title: 'Kept room', note: 'kept note' } }, error: null } };
      }
      throw new Error(`unexpected verb ${name}`);
    });
    const view = render(<CollabLensPage />);
    expect(await view.findByText('Kept room')).toBeInTheDocument();
    expect(view.getByTestId('cb-room-about')).toHaveTextContent(SENTENCE);
  });

  it('COMPOSING: the sentence stands over the editor while the user types', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<CollabLensPage />);
    expect(await view.findByText('No room open.')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Open a room' }));
    expect(view.getByTestId('cb-title')).toBeInTheDocument();
    expect(view.getByTestId('cb-room-about')).toHaveTextContent(SENTENCE);
  });
});
