/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the Wave 4 wiring of `travel.place-delete` into TravelExplorePanel's
// detail view (docs/lens-specs/travel-capability-map.md flagged the macro as
// UNSURFACED — real backend, no button). The macro is contributor-gated
// server-side (addedBy must match), so the panel always offers the button and
// renders the server's real rejection for non-contributors — no client-side
// ownership guess, no fabricated success.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { TravelExplorePanel } from '@/components/travel/TravelExplorePanel';

const PLACE = {
  id: 'pl_1', name: 'Harbor Grand', kind: 'hotel', destination: 'Lisbon',
  priceLevel: 3, rating: 4.5, reviewCount: 2, saved: false,
};

function mockCommonCalls(overrides: Record<string, unknown> = {}) {
  lensRun.mockImplementation(async (_domain: string, action: string) => {
    if (action in overrides) return overrides[action];
    if (action === 'place-list') return { data: { ok: true, result: { places: [PLACE], count: 1 } } };
    if (action === 'place-detail') return { data: { ok: true, result: { place: PLACE, reviews: [] } } };
    return { data: { ok: true, result: {} } };
  });
}

async function openDetail() {
  render(<TravelExplorePanel />);
  fireEvent.click(await screen.findByText('Harbor Grand'));
  await screen.findByLabelText('Remove place');
}

describe('TravelExplorePanel — place-delete wiring', () => {
  beforeEach(() => lensRun.mockReset());

  it('confirm-then-delete calls place-delete with the place id and returns to the refreshed list', async () => {
    mockCommonCalls({ 'place-delete': { data: { ok: true, result: { deleted: 'pl_1' } } } });
    await openDetail();

    fireEvent.click(screen.getByLabelText('Remove place'));
    fireEvent.click(await screen.findByText('Remove'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'place-delete', { id: 'pl_1' }),
    );
    // Back on the list view (detail closed).
    await waitFor(() =>
      expect(screen.queryByLabelText('Remove place')).not.toBeInTheDocument(),
    );
  });

  it('"Keep" cancels the confirmation without ever calling place-delete', async () => {
    mockCommonCalls();
    await openDetail();

    fireEvent.click(screen.getByLabelText('Remove place'));
    fireEvent.click(await screen.findByText('Keep'));

    expect(lensRun.mock.calls.filter(([, a]) => a === 'place-delete')).toHaveLength(0);
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });

  it("renders the server's real contributor-gate rejection and stays on the detail view", async () => {
    mockCommonCalls({
      'place-delete': { data: { ok: false, result: null, error: 'only the contributor can remove this place' } },
    });
    await openDetail();

    fireEvent.click(screen.getByLabelText('Remove place'));
    fireEvent.click(await screen.findByText('Remove'));

    expect(await screen.findByRole('alert')).toHaveTextContent('only the contributor can remove this place');
    // Detail view still open — the place was NOT removed client-side.
    expect(screen.getByLabelText('Remove place')).toBeInTheDocument();
  });
});
