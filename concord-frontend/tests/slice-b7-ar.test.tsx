import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Slice B7 — FIX-ar-016: a Sketchfab "Save as DTU" lands on a library
// row in the lens — the caller's saved DTUs are listed, openable, and
// deletable — instead of vanishing after the save toast.

const h = vi.hoisted(() => ({ paginated: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { dtus: { paginated: h.paginated, get: h.get, delete: h.del } },
}));
vi.mock('@/lib/public-lookup', () => ({
  publicLookup: vi.fn(async () => ({ results: [] })),
  lookupMeta: () => null,
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { SketchfabModels } from '@/components/ar/SketchfabModels';

const SAVED = { id: 'dtu_sf1', title: 'Sketchfab models — "dragon"', tags: ['real-data', 'sketchfab', 'ar'], timestamp: '2026-03-04T00:00:00.000Z' };
const NOT_SF = { id: 'dtu_other', title: 'Something else', tags: ['notes'], timestamp: '2026-03-04T00:00:00.000Z' };

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SketchfabModels />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.paginated.mockReset(); h.get.mockReset(); h.del.mockReset();
  h.paginated.mockResolvedValue({ data: { dtus: [SAVED, NOT_SF] } });
  h.get.mockResolvedValue({ data: { id: SAVED.id, content: '1. Dragon by A (10♥/20👁)' } });
  h.del.mockResolvedValue({ data: { ok: true } });
});

describe('FIX-ar-016 saved Sketchfab DTUs', () => {
  it('lists only the sketchfab-tagged saves, opens one in place, and deletes behind the confirm', async () => {
    wrap();
    expect(await screen.findByText('Your saved Sketchfab DTUs')).toBeTruthy();
    expect(screen.getByText('Sketchfab models — "dragon"')).toBeTruthy();
    expect(screen.queryByText('Something else')).toBeNull();
    expect(h.paginated).toHaveBeenCalledWith(expect.objectContaining({ scope: 'mine', tags: 'sketchfab' }));

    // Open: the row fetches and shows the DTU content.
    fireEvent.click(screen.getByRole('button', { name: 'Open Sketchfab models — "dragon"' }));
    expect(await screen.findByText(/Dragon by A/)).toBeTruthy();
    expect(h.get).toHaveBeenCalledWith('dtu_sf1');

    // Delete: the arm click fires nothing; the confirm deletes.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sketchfab models — "dragon"' }));
    expect(h.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('dtu_sf1'));
  });
});
