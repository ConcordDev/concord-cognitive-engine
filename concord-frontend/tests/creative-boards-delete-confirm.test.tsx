/**
 * CreativeBoardsSection — board-delete confirmation (F9).
 *
 * `delBoard` used to fire on a single click with zero confirmation, the
 * `unconfirmed-destructive` defect class. The lens already owns a Confirm
 * control at board rename (CreativeBoard.tsx) — this test pins the same
 * two-step inline confirm/cancel pattern for board delete: a single click
 * on the trash icon must NOT call `board-delete`; it must first render a
 * "Confirm delete" / "Cancel" pair, and only a click on "Confirm delete"
 * calls through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => runDomain(...args),
}));

vi.mock('./CreativeBoard', () => ({ CreativeBoard: () => null }));

import { CreativeBoardsSection } from '@/components/creative/CreativeBoardsSection';

beforeEach(() => {
  runDomain.mockReset();
  runDomain.mockImplementation((domain: string, action: string) => {
    if (action === 'board-list') {
      return Promise.resolve({ data: { ok: true, result: { boards: [{ id: 'b1', title: 'Pitch deck', cardCount: 3 }] } } });
    }
    if (action === 'board-templates') {
      return Promise.resolve({ data: { ok: true, result: { templates: [] } } });
    }
    if (action === 'board-delete') {
      return Promise.resolve({ data: { ok: true } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
});

describe('creative boards — delete confirmation (F9)', () => {
  it('does not delete on a single click; requires an explicit Confirm', async () => {
    const { getByLabelText, getByText, queryByText } = render(<CreativeBoardsSection />);
    await waitFor(() => expect(getByText('Pitch deck')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByLabelText('Delete')); });
    // A single click must surface a Confirm/Cancel pair, not call board-delete yet.
    expect(runDomain).not.toHaveBeenCalledWith('creative', 'board-delete', expect.anything());
    expect(getByText('Confirm delete')).toBeInTheDocument();
    expect(getByText('Cancel')).toBeInTheDocument();

    await act(async () => { fireEvent.click(getByText('Cancel')); });
    expect(queryByText('Confirm delete')).toBeNull();
    expect(runDomain).not.toHaveBeenCalledWith('creative', 'board-delete', expect.anything());
  });

  it('deletes only after Confirm delete is clicked', async () => {
    const { getByLabelText, getByText } = render(<CreativeBoardsSection />);
    await waitFor(() => expect(getByText('Pitch deck')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByLabelText('Delete')); });
    await act(async () => { fireEvent.click(getByText('Confirm delete')); });

    await waitFor(() => expect(runDomain).toHaveBeenCalledWith('creative', 'board-delete', { id: 'b1' }));
  });
});
