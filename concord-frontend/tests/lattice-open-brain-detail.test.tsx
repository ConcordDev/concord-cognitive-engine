// Audit fix sweep (PR #2356) — FIX-lattice-001: 'Open a brain' selected
// a brain but opened no detail view (a scroll + ring on a stats card,
// and on an instance with no recorded interactions, not even that).
// Picking a brain now opens its detail view — corpus stats plus the
// model-version history from /api/brains/:brainId/history — and every
// brain card carries a Details button into the same view.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = opts.queryKey[0];
    if (key === 'lattice-brains-stats') {
      return {
        data: {
          ok: true,
          brains: [
            { brainId: 'conscious', total: 3, positive: 1, consented: 2, pending: 1 },
            { brainId: 'repair', total: 1, positive: 0, consented: 0, pending: 1 },
          ],
        },
        isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false,
      };
    }
    if (key === 'lattice-brains-active') {
      return { data: { ok: true, active: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false };
    }
    if (key === 'lattice-brain-history') {
      return {
        data: {
          ok: true,
          brainId: opts.queryKey[1],
          history: [
            { id: 1, model_name: 'concord-conscious:v3', base_model: 'llama-3', corpus_size: 120, eval_score: 0.87, active: 1, created_at: 1762000000 },
          ],
        },
        isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false,
      };
    }
    return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false };
  },
}));

import { BrainsPanel } from '@/components/lattice/BrainsPanel';

beforeEach(() => {
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("lattice 'Open a brain' — a pick opens the brain's detail", () => {
  it('opens detail from the picker handoff and from a card Details button', () => {
    sessionStorage.setItem('lattice.openBrain', 'conscious');
    const view = render(<BrainsPanel />);

    const detail = view.getByLabelText('Brain detail conscious');
    expect(detail.textContent).toContain('3 interactions');
    expect(detail.textContent).toContain('concord-conscious:v3');
    expect(detail.textContent).toContain('eval 0.87');

    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(view.queryByLabelText('Brain detail conscious')).toBeNull();

    const detailsButtons = view.getAllByRole('button', { name: 'Details' });
    fireEvent.click(detailsButtons[1]);
    expect(view.getByLabelText('Brain detail repair')).toBeTruthy();
  });
});
