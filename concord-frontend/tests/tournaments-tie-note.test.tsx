/**
 * FIX-tournaments-003 (FE leg) — reporting a 0-0 result "did nothing":
 * the Submit button was disabled on a tie with no explanation anywhere.
 * The server already refuses draws (draws_not_allowed); the bracket card
 * now says why in place while the scores are tied, and the note clears
 * as soon as the scores differ.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { BracketView } from '@/components/tournaments/BracketView';
import type { Tournament } from '@/components/tournaments/types';

const T: Tournament = {
  id: 'tour1',
  title: 'Cup',
  game: 'Concord PvP',
  format: 'single_elimination',
  mode: 'solo',
  teamSize: 1,
  maxEntrants: 4,
  prizePoolCc: 0,
  payoutSplit: [60, 25, 15],
  swissRounds: 5,
  status: 'in_progress',
  createdAt: 0,
  startsAt: 0,
  shareSlug: 'cup',
  entrants: [
    { id: 'e1', name: 'Ana', seed: 1, rating: 0, checkedIn: true, eliminated: false },
    { id: 'e2', name: 'Bo', seed: 2, rating: 0, checkedIn: true, eliminated: false },
  ],
  matches: [
    { id: 'm1', bracket: 'main', round: 1, slotIndex: 0, aId: 'e1', bId: 'e2', scoreA: 0, scoreB: 0, winnerId: null, status: 'pending' },
  ],
  standings: [],
  payouts: [],
  log: [],
} as unknown as Tournament;

describe('FIX-tournaments-003 — a tied score speaks', () => {
  it('shows the winner-needed note at 0-0 and clears it when the scores differ', () => {
    render(<BracketView t={T} canReport onReport={vi.fn()} busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: /report result/i }));
    expect(screen.getByRole('note').textContent).toMatch(/needs a winner/i);
    expect((screen.getByRole('button', { name: /submit/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Ana score'), { target: { value: '2' } });
    expect(screen.queryByRole('note')).toBeNull();
    expect((screen.getByRole('button', { name: /submit/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
