/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the fashion moodboard panel (Wave 4 gap-closure,
// docs/lens-specs/fashion-capability-map.md "No moodboards (pin
// inspiration to a canvas)" — Whering/Stylebook parity) against the real
// fashion.moodboard-* macro contract: create, list, add-item, remove-item,
// delete, update — all server-persisted, never client-invented, with
// honest error surfacing on any macro failure.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { FashionMoodboardPanel } from '@/components/fashion/FashionMoodboardPanel';

const BOARD = {
  id: 'mb_1',
  name: 'Autumn capsule',
  items: [],
  itemCount: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const PIN = {
  id: 'pin_1',
  imageUrl: 'https://example.com/inspo.jpg',
  note: 'Great texture',
  x: 0,
  y: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
};

function listResponse(boards: Array<Record<string, unknown>> = []) {
  return { data: { ok: true, result: { moodboards: boards, count: boards.length }, error: null } };
}

describe('FashionMoodboardPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via moodboard-list and renders board cards', async () => {
    lensRun.mockResolvedValueOnce(listResponse([BOARD]));
    render(<FashionMoodboardPanel />);

    await screen.findByTestId('board-mb_1');
    expect(screen.getByText('Autumn capsule')).toBeInTheDocument();
    expect(screen.getByText('0 pins')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('fashion', 'moodboard-list', {});
  });

  it('an empty moodboard list renders an honest empty state, not fabricated boards', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<FashionMoodboardPanel />);
    await waitFor(() => expect(screen.getByText(/No moodboards yet/)).toBeInTheDocument());
  });

  it('create flow calls moodboard-create and refreshes the list', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { moodboard: BOARD }, error: null } })
      .mockResolvedValueOnce(listResponse([BOARD]));

    render(<FashionMoodboardPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('New board'));
    fireEvent.change(screen.getByPlaceholderText('Board name'), { target: { value: 'Autumn capsule' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'moodboard-create', { name: 'Autumn capsule' }),
    );
    await screen.findByTestId('board-mb_1');
  });

  it('rejects creating a board with an empty name (client-side honesty check, no macro call)', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<FashionMoodboardPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('New board'));
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Board name is required');
    expect(lensRun).toHaveBeenCalledTimes(1); // no moodboard-create call fired
  });

  it('opens a board and renders its pins on the canvas', async () => {
    const boardWithPin = { ...BOARD, items: [PIN], itemCount: 1 };
    lensRun.mockResolvedValueOnce(listResponse([boardWithPin]));
    render(<FashionMoodboardPanel />);

    await screen.findByTestId('board-mb_1');
    fireEvent.click(screen.getByText('Autumn capsule'));

    await screen.findByTestId('moodboard-canvas');
    const pinCard = screen.getByTestId('pin-pin_1');
    expect(pinCard).toBeInTheDocument();
    expect(screen.getByText('Great texture')).toBeInTheDocument();
  });

  it('an opened board with no pins shows an honest empty state', async () => {
    lensRun.mockResolvedValueOnce(listResponse([BOARD]));
    render(<FashionMoodboardPanel />);
    await screen.findByTestId('board-mb_1');
    fireEvent.click(screen.getByText('Autumn capsule'));
    await waitFor(() => expect(screen.getByText(/No pins yet/)).toBeInTheDocument());
  });

  it('add-pin flow calls moodboard-add-item and refreshes', async () => {
    const boardWithPin = { ...BOARD, items: [PIN], itemCount: 1 };
    lensRun
      .mockResolvedValueOnce(listResponse([BOARD]))
      .mockResolvedValueOnce({ data: { ok: true, result: { moodboardId: 'mb_1', item: PIN, itemCount: 1 }, error: null } })
      .mockResolvedValueOnce(listResponse([boardWithPin]));

    render(<FashionMoodboardPanel />);
    await screen.findByTestId('board-mb_1');
    fireEvent.click(screen.getByText('Autumn capsule'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('Image URL (https://... or data:image/...)'), {
      target: { value: 'https://example.com/inspo.jpg' },
    });
    fireEvent.change(screen.getByPlaceholderText('Note (optional)'), { target: { value: 'Great texture' } });
    fireEvent.click(screen.getByText('Pin it'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'moodboard-add-item', {
        boardId: 'mb_1', imageUrl: 'https://example.com/inspo.jpg', note: 'Great texture',
      }),
    );
    await screen.findByTestId('pin-pin_1');
  });

  it('rejects pinning without an image URL (client-side honesty check, no macro call)', async () => {
    lensRun.mockResolvedValueOnce(listResponse([BOARD]));
    render(<FashionMoodboardPanel />);
    await screen.findByTestId('board-mb_1');
    fireEvent.click(screen.getByText('Autumn capsule'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Pin it'));
    expect(await screen.findByRole('alert')).toHaveTextContent('An image URL is required');
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('remove-pin flow calls moodboard-remove-item and refreshes', async () => {
    const boardWithPin = { ...BOARD, items: [PIN], itemCount: 1 };
    lensRun
      .mockResolvedValueOnce(listResponse([boardWithPin]))
      .mockResolvedValueOnce({ data: { ok: true, result: { moodboardId: 'mb_1', deleted: 'pin_1', itemCount: 0 }, error: null } })
      .mockResolvedValueOnce(listResponse([BOARD]));

    render(<FashionMoodboardPanel />);
    await screen.findByTestId('board-mb_1');
    fireEvent.click(screen.getByText('Autumn capsule'));
    await screen.findByTestId('pin-pin_1');

    fireEvent.click(screen.getByLabelText('Remove pin'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'moodboard-remove-item', { boardId: 'mb_1', itemId: 'pin_1' }),
    );
    await waitFor(() => expect(screen.getByText(/No pins yet/)).toBeInTheDocument());
  });

  it('delete-board flow calls moodboard-delete and refreshes the list', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([BOARD]))
      .mockResolvedValueOnce({ data: { ok: true, result: { deleted: 'mb_1' }, error: null } })
      .mockResolvedValueOnce(listResponse([]));

    render(<FashionMoodboardPanel />);
    await screen.findByTestId('board-mb_1');

    fireEvent.click(screen.getByLabelText('Delete Autumn capsule'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('fashion', 'moodboard-delete', { id: 'mb_1' }));
    await waitFor(() => expect(screen.getByText(/No moodboards yet/)).toBeInTheDocument());
  });

  it('surfaces an honest error on a failed load instead of a silent blank panel', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    render(<FashionMoodboardPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('STATE unavailable');
  });

  it('surfaces an honest error when moodboard-create fails, without inserting a fabricated board', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'moodboard name required' } });

    render(<FashionMoodboardPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('New board'));
    fireEvent.change(screen.getByPlaceholderText('Board name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByRole('alert')).toHaveTextContent('moodboard name required');
    expect(screen.getByText(/No moodboards yet/)).toBeInTheDocument();
  });
});
